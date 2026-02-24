import { describe, test, assert as t } from "vitest";
import type { Client } from "src/rpc/client";
import type { Call } from "src/rpc/call";
import type { Answer } from "src/rpc/answer";
import { TestRPC } from "./rpc.utils";
import {
  AppHooks,
  AppHooks$Client,
  AppPersistent$Client,
  AppPersistent$Server,
  Node$Client,
  Node$Server,
  SandstormBridge,
  SandstormBridge$Client,
  SessionContext,
} from "test/fixtures/sandstorm-powerbox-flow";

class CompositeClient implements Client {
  private readonly servers: Map<string, Client>;

  constructor(servers: Map<string, Client>) {
    this.servers = servers;
  }

  call(call: Call<any, any>): Answer<any> {
    const interfaceId = call?.method?.interfaceId;
    const key =
      typeof interfaceId === "bigint"
        ? interfaceId.toString()
        : String(interfaceId);
    const server = this.servers.get(key);
    if (!server) {
      throw new Error(`missing server for interface ${key}`);
    }
    return server.call(call);
  }

  close(): void {
    // no-op for test composite client
  }
}

function dataFromText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function dataToText(data: { toUint8Array(): Uint8Array }): string {
  return new TextDecoder().decode(data.toUint8Array());
}

function makePersistentNode(label: string): Node$Client {
  const nodeTarget = {
    async stat(_params: any, results: any): Promise<void> {
      results.isDir = true;
    },

    async save(_params: any, results: any): Promise<void> {
      const bytes = dataFromText(label);
      results._initObjectId(bytes.byteLength).copyBuffer(bytes);
    },
  };

  const nodeServer = new Node$Server(nodeTarget);
  const persistentServer = new AppPersistent$Server(nodeTarget);
  const servers = new Map<string, Client>();
  servers.set(Node$Client.interfaceId.toString(), nodeServer);
  servers.set(AppPersistent$Client.interfaceId.toString(), persistentServer);
  return new Node$Client(new CompositeClient(servers));
}

type SandstormHarness = {
  rpc: TestRPC;
  events: string[];
  getBridgeClient: () => SandstormBridge$Client;
  getRemoteAppHooks: () => AppHooks$Client;
  bridgeSeen: {
    getViewInfoCalls: number;
    fulfillCalls: number;
    claimCalls: number;
    savedObjectIds: string[];
  };
  appSeen: {
    restoreCalls: number;
    restoredObjectIds: string[];
  };
};

function timeout<T>(
  name: string,
  events: string[],
  promise: Promise<T>,
  ms = 1200,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`timeout at ${name}; events=${events.join(" -> ")}`));
      }, ms);
    }),
  ]);
}

async function setupHarness(): Promise<SandstormHarness> {
  const rpc = new TestRPC();
  const events: string[] = [];

  events.push("connect app");
  const appConn = rpc.connect(0);
  events.push("accept bridge");
  const bridgeConn = await rpc.accept();

  const appSeen = {
    restoreCalls: 0,
    restoredObjectIds: [] as string[],
  };
  const bridgeSeen = {
    getViewInfoCalls: 0,
    fulfillCalls: 0,
    claimCalls: 0,
    savedObjectIds: [] as string[],
  };

  appConn.initMain(AppHooks, {
    async getViewInfo(_params, results) {
      events.push("apphooks.getViewInfo");
      bridgeSeen.getViewInfoCalls++;
      results.supportsNode = true;
    },
    async restore(params, results) {
      events.push("apphooks.restore start");
      appSeen.restoreCalls++;
      const objectId = dataToText(params.objectId);
      appSeen.restoredObjectIds.push(objectId);
      results.cap = makePersistentNode(objectId);
      events.push("apphooks.restore done");
    },
    async drop(_params, _results) {
      events.push("apphooks.drop");
    },
  });

  const savedQueue: string[] = [];
  const sessionContextServer = new SessionContext.Server({
    async fulfillRequest(params, _results) {
      events.push("session.fulfillRequest start");
      bridgeSeen.fulfillCalls++;
      const persistent = new AppPersistent$Client(params.cap.client);
      const saved = await timeout(
        "bridge save()",
        events,
        persistent.save().promise(),
      );
      savedQueue.push(dataToText(saved.objectId));
      bridgeSeen.savedObjectIds.push(dataToText(saved.objectId));
      events.push("session.fulfillRequest done");
    },
    async claimRequest(_params, results) {
      events.push("session.claimRequest start");
      bridgeSeen.claimCalls++;
      const nextObjectId = savedQueue.shift();
      if (nextObjectId === undefined) {
        throw new Error("claimRequest called without saved capability");
      }
      const bytes = dataFromText(nextObjectId);
      const restored = await timeout(
        "bridge apphooks.restore()",
        events,
        bridgeConn
          .bootstrap(AppHooks)
          .restore((p) => {
            p._initObjectId(bytes.byteLength).copyBuffer(bytes);
          })
          .promise(),
      );
      results.cap = restored.cap;
      events.push("session.claimRequest done");
    },
  }).client();

  bridgeConn.initMain(SandstormBridge, {
    async getSessionContext(_params, results) {
      events.push("bridge.getSessionContext");
      results.context = sessionContextServer;
    },
  });

  return {
    rpc,
    events,
    getBridgeClient: () => appConn.bootstrap(SandstormBridge),
    getRemoteAppHooks: () => bridgeConn.bootstrap(AppHooks),
    bridgeSeen,
    appSeen,
  };
}

describe("sandstorm-style powerbox flow", () => {
  test(
    "bootstrap apphooks, fulfill, save, restore, and claim keep capability live",
    { timeout: 20000 },
    async () => {
      const harness = await setupHarness();
      const {
        rpc,
        events,
        getRemoteAppHooks,
        getBridgeClient,
        bridgeSeen,
        appSeen,
      } = harness;
      try {
        events.push("call remoteAppHooks.getViewInfo");
        const hooksInfo = await timeout(
          "remoteAppHooks.getViewInfo",
          events,
          getRemoteAppHooks().getViewInfo().promise(),
        );
        t.equal(hooksInfo.supportsNode, true);

        events.push("call bridge.getSessionContext");
        const session = await timeout(
          "bridgeClient.getSessionContext",
          events,
          getBridgeClient().getSessionContext().promise(),
        );
        const offeredCap = makePersistentNode("/var/davros/data");

        events.push("call session.fulfillRequest");
        await timeout(
          "session.fulfillRequest",
          events,
          session.context
            .fulfillRequest((p) => {
              p.cap = offeredCap;
            })
            .promise(),
        );

        events.push("call session.claimRequest");
        const claim = await timeout(
          "session.claimRequest",
          events,
          session.context.claimRequest().promise(),
        );
        const claimedPersistent = new AppPersistent$Client(claim.cap.client);
        const claimedSave = await timeout(
          "claimedPersistent.save",
          events,
          claimedPersistent.save().promise(),
        );

        t.equal(dataToText(claimedSave.objectId), "/var/davros/data");
        t.equal(bridgeSeen.getViewInfoCalls, 1);
        t.equal(bridgeSeen.fulfillCalls, 1);
        t.equal(bridgeSeen.claimCalls, 1);
        t.equal(bridgeSeen.savedObjectIds[0], "/var/davros/data");
        t.equal(appSeen.restoreCalls, 1);
        t.equal(appSeen.restoredObjectIds[0], "/var/davros/data");
      } finally {
        rpc.close();
      }
    },
  );

  test(
    "bootstrap capability remains stable under bidirectional traffic",
    { timeout: 20000 },
    async () => {
      const harness = await setupHarness();
      const {
        rpc,
        events,
        getRemoteAppHooks,
        getBridgeClient,
        bridgeSeen,
        appSeen,
      } = harness;
      try {
        for (let i = 0; i < 6; i++) {
          events.push(`round ${i} bootstrap+session concurrent`);
          const [hooksInfo, session] = await timeout(
            `round ${i} setup`,
            events,
            Promise.all([
              getRemoteAppHooks().getViewInfo().promise(),
              getBridgeClient().getSessionContext().promise(),
            ]),
          );
          t.equal(hooksInfo.supportsNode, true);

          const label = `/stable/round-${i}`;
          await timeout(
            `round ${i} fulfill`,
            events,
            session.context
              .fulfillRequest((p) => {
                p.cap = makePersistentNode(label);
              })
              .promise(),
          );
          const claim = await timeout(
            `round ${i} claim`,
            events,
            session.context.claimRequest().promise(),
          );
          const out = await timeout(
            `round ${i} claimed.save`,
            events,
            new AppPersistent$Client(claim.cap.client).save().promise(),
          );
          t.equal(dataToText(out.objectId), label);
        }

        t.equal(bridgeSeen.getViewInfoCalls, 6);
        t.equal(bridgeSeen.fulfillCalls, 6);
        t.equal(bridgeSeen.claimCalls, 6);
        t.equal(appSeen.restoreCalls, 6);
      } finally {
        rpc.close();
      }
    },
  );

  test(
    "fulfill imported capability then delayed claim survives protocol churn",
    { timeout: 20000 },
    async () => {
      const harness = await setupHarness();
      const {
        rpc,
        events,
        getRemoteAppHooks,
        getBridgeClient,
        bridgeSeen,
        appSeen,
      } = harness;
      try {
        const session = await timeout(
          "bridgeClient.getSessionContext",
          events,
          getBridgeClient().getSessionContext().promise(),
        );
        await timeout(
          "session.fulfillRequest",
          events,
          session.context
            .fulfillRequest((p) => {
              p.cap = makePersistentNode("/delayed/claim");
            })
            .promise(),
        );

        await timeout(
          "protocol churn",
          events,
          Promise.all([
            getRemoteAppHooks().getViewInfo().promise(),
            getRemoteAppHooks().getViewInfo().promise(),
            getBridgeClient().getSessionContext().promise(),
            getBridgeClient().getSessionContext().promise(),
          ]),
        );

        const claim = await timeout(
          "session.claimRequest",
          events,
          session.context.claimRequest().promise(),
        );
        const saved = await timeout(
          "claimedPersistent.save",
          events,
          new AppPersistent$Client(claim.cap.client).save().promise(),
        );
        t.equal(dataToText(saved.objectId), "/delayed/claim");
        t.equal(bridgeSeen.fulfillCalls, 1);
        t.equal(bridgeSeen.claimCalls, 1);
        t.equal(appSeen.restoreCalls, 1);
      } finally {
        rpc.close();
      }
    },
  );

  test(
    "claim->restore reentrancy stays live with interleaved in-flight calls",
    { timeout: 20000 },
    async () => {
      const harness = await setupHarness();
      const {
        rpc,
        events,
        getRemoteAppHooks,
        getBridgeClient,
        bridgeSeen,
        appSeen,
      } = harness;
      try {
        const session = await timeout(
          "bridgeClient.getSessionContext",
          events,
          getBridgeClient().getSessionContext().promise(),
        );
        await timeout(
          "session.fulfillRequest",
          events,
          session.context
            .fulfillRequest((p) => {
              p.cap = makePersistentNode("/reentrant/flow");
            })
            .promise(),
        );

        const [claim] = await timeout(
          "claim plus interleaved traffic",
          events,
          Promise.all([
            session.context.claimRequest().promise(),
            getBridgeClient().getSessionContext().promise(),
            getRemoteAppHooks().getViewInfo().promise(),
          ]),
        );
        const saved = await timeout(
          "claimedPersistent.save",
          events,
          new AppPersistent$Client(claim.cap.client).save().promise(),
        );
        t.equal(dataToText(saved.objectId), "/reentrant/flow");
        t.equal(bridgeSeen.claimCalls, 1);
        t.equal(appSeen.restoreCalls, 1);
      } finally {
        rpc.close();
      }
    },
  );

  test(
    "sequential and parallel fulfill/claim cycles preserve object identity",
    { timeout: 30000 },
    async () => {
      const harness = await setupHarness();
      const { rpc, events, getBridgeClient, bridgeSeen, appSeen } = harness;
      try {
        const session = await timeout(
          "bridgeClient.getSessionContext",
          events,
          getBridgeClient().getSessionContext().promise(),
        );

        for (let i = 0; i < 20; i++) {
          const label = `/seq/${i}`;
          await timeout(
            `seq fulfill ${i}`,
            events,
            session.context
              .fulfillRequest((p) => {
                p.cap = makePersistentNode(label);
              })
              .promise(),
          );
          const claim = await timeout(
            `seq claim ${i}`,
            events,
            session.context.claimRequest().promise(),
          );
          const out = await timeout(
            `seq save ${i}`,
            events,
            new AppPersistent$Client(claim.cap.client).save().promise(),
          );
          t.equal(dataToText(out.objectId), label);
        }

        const labels = Array.from({ length: 8 }, (_v, i) => `/par/${i}`);
        await timeout(
          "parallel fulfill batch",
          events,
          Promise.all(
            labels.map((label) =>
              session.context
                .fulfillRequest((p) => {
                  p.cap = makePersistentNode(label);
                })
                .promise(),
            ),
          ),
        );

        const claimedIds: string[] = [];
        for (let i = 0; i < labels.length; i++) {
          const claim = await timeout(
            `parallel claim ${i}`,
            events,
            session.context.claimRequest().promise(),
          );
          const out = await timeout(
            `parallel save ${i}`,
            events,
            new AppPersistent$Client(claim.cap.client).save().promise(),
          );
          claimedIds.push(dataToText(out.objectId));
        }
        t.sameMembers(claimedIds, labels);
        t.equal(bridgeSeen.fulfillCalls, 28);
        t.equal(bridgeSeen.claimCalls, 28);
        t.equal(appSeen.restoreCalls, 28);
      } finally {
        rpc.close();
      }
    },
  );
});
