import { describe, test, assert as t } from "vitest";
import { Conn as BaseConn } from "src/rpc/conn";
import type { Transport } from "src/rpc/transport";
import { Message as RPCMessage } from "src/capnp/rpc";
import {
  RpcLevel2PersistenceService,
  RpcLevel2Restorer,
} from "test/fixtures/rpc-level2";

class LinkedTransport implements Transport {
  peer?: TestConn;
  sendMessage(msg: any): void {
    if (this.peer) {
      const wire = msg.segment.message.copy().getRoot(RPCMessage);
      this.peer.handleMessage(wire);
    }
  }
  async recvMessage(): Promise<any> {
    throw new Error("recvMessage should not be called in linked runtime tests");
  }
  close(): void {
    // no-op
  }
}

class TestConn extends BaseConn {
  override startWork(): void {
    // Disable background recv loop for deterministic runtime tests.
  }
}

function makeLinkedConns(): { client: TestConn; server: TestConn } {
  const a = new LinkedTransport();
  const b = new LinkedTransport();
  const client = new TestConn(a);
  const server = new TestConn(b);
  a.peer = server;
  b.peer = client;
  return { client, server };
}

describe("rpc level-2 runtime shutdown races", () => {
  test("pending restore rejects when caller shuts down", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const { client, server } = makeLinkedConns();
    server.initMain(RpcLevel2Restorer, {
      async restore(_params, _results) {
        await gate;
        throw new Error("late restore");
      },
    });

    const pending = client
      .bootstrap(RpcLevel2Restorer)
      .restore((p) => {
        p._initSturdyRef().host = "race";
        const objectId = new TextEncoder().encode("restore");
        p.sturdyRef._initObjectId(objectId.byteLength).copyBuffer(objectId);
        p._initOwner().id = "owner";
      })
      .promise();

    const observed = pending
      .then(() => null)
      .catch((error__: unknown) => error__ as Error);
    client.shutdown();
    release();
    const error_ = await observed;
    t.ok(error_ instanceof Error);
    t.equal((client as any).closed, true);
    t.equal(Object.keys((client as any).imports).length, 0);
    t.equal((client as any).exports.filter(Boolean).length, 0);
  });

  test("pending save rejects when caller shuts down", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const { client, server } = makeLinkedConns();
    server.initMain(RpcLevel2PersistenceService, {
      async save(_params, results) {
        await gate;
        const ref = results._initSturdyRef();
        ref.host = "late";
        ref._initObjectId(1).copyBuffer(new Uint8Array([1]));
      },
      async restore(_params, _results) {
        throw new Error("not used");
      },
    });

    const pending = client
      .bootstrap(RpcLevel2PersistenceService)
      .save((p) => {
        p._initSealFor().id = "owner";
      })
      .promise();

    const observed = pending
      .then(() => null)
      .catch((error__: unknown) => error__ as Error);
    client.shutdown();
    release();
    const error_ = await observed;
    t.ok(error_ instanceof Error);
    t.equal((client as any).closed, true);
    t.equal(Object.keys((client as any).imports).length, 0);
    t.equal((client as any).exports.filter(Boolean).length, 0);
  });
});
