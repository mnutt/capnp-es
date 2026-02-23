// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import { test, describe, assert as t, afterEach, beforeEach } from "vitest";
import { Hash, HashFactory } from "test/fixtures/hash-factory";
import { ReturnCapability } from "test/fixtures/import-interface";
import {
  SimpleInterface,
  SimpleInterface_Subtract$Params,
} from "test/fixtures/simple-interface";
import { createHash } from "node:crypto";
import { TestRPC } from "./rpc.utils";
import { bufferToHex } from "src/util.js";
import { Message } from "src/serialization/message";
import {
  Message as RPCMessage,
  Disembargo_Context_Which,
  MessageTarget,
  Resolve,
} from "src/capnp/rpc";
import { ErrorClient } from "src/rpc/error-client";

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 500,
  intervalMs = 5,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("timeout waiting for condition");
}

describe("rpc", () => {
  let rpc: TestRPC;

  beforeEach(() => {
    rpc = new TestRPC();
  });

  afterEach(() => {
    rpc.close();
  });

  test("two-party mode replies unimplemented for level-3 messages", async () => {
    const client = rpc.connect();
    const server = await rpc.accept();
    const sentByServer: number[] = [];
    const transport = server.transport as {
      sendMessage: (msg: RPCMessage) => void;
    };
    const originalSend = transport.sendMessage.bind(transport);
    transport.sendMessage = (msg: RPCMessage): void => {
      sentByServer.push(msg.which());
      originalSend(msg);
    };

    const m = new Message().initRoot(RPCMessage);
    m._initProvide();
    client.sendMessage(m);

    await waitUntil(() => sentByServer.length > 0);
    t.equal(sentByServer[0], RPCMessage.UNIMPLEMENTED);
  });

  test("SimpleInterface", { timeout: 1000 }, async () => {
    const server = async () => {
      const s = await rpc.accept();
      s.initMain(SimpleInterface, {
        subtract: async (p, r) => {
          r.result = p.a - p.b;
        },
      });
      return s;
    };

    const client = async () => {
      const res = await rpc
        .connect()
        .bootstrap(SimpleInterface)
        .subtract((p) => {
          p.a = 9;
          p.b = -1;
        })
        .promise();
      return res.result;
    };

    const [, result] = await Promise.all([server(), client()]);
    t.equal(result, 10);
  });

  test("HashFactory", { timeout: 1000 }, async () => {
    const server = async () => {
      const s = await rpc.accept();
      s.initMain(HashFactory, {
        newSha1: async (_, r) => {
          const hash = createHash("sha1");
          const hs = new Hash.Server({
            async sum(_, r) {
              const digest = hash.digest();
              return r._initHash(digest.length).copyBuffer(digest);
            },

            write: (p) =>
              new Promise((resolve, reject) =>
                hash.write(p.data.toUint8Array(), "utf8", (err) =>
                  err ? reject(err) : resolve(),
                ),
              ),
          });
          r.hash = hs.client();
        },
      });
      return s;
    };

    const client = async () => {
      const hash = rpc.connect().bootstrap(HashFactory).newSha1().getHash();
      hash.write((p) => {
        const buf = new TextEncoder().encode("hello ");
        p._initData(buf.byteLength).copyBuffer(buf);
      });
      hash.write((p) => {
        const buf = new TextEncoder().encode("world");
        p._initData(buf.byteLength).copyBuffer(buf);
      });
      const sum = await hash.sum().promise();
      return sum.hash.toUint8Array();
    };

    const [, result] = await Promise.all([server(), client()]);
    t.equal(
      // @ts-expect-error
      bufferToHex(result),
      "[2a ae 6c 35 c9 4f cf b4 15 db e9 5f 40 8b 9c e9 1e e8 46 ed]",
    );
  });

  test(
    "senderPromise resolves across forwarded pipeline",
    { timeout: 4000 },
    async () => {
      const upstream = new TestRPC();
      let releaseUpstream: (() => void) | undefined;
      const upstreamGate = new Promise<void>((resolve) => {
        releaseUpstream = resolve;
      });

      const upstreamServer = async () => {
        const s = await upstream.accept();
        s.initMain(ReturnCapability, {
          get: async (_, r) => {
            await upstreamGate;
            r.capability = new SimpleInterface.Server({
              subtract: async (p, out) => {
                out.result = p.a - p.b;
              },
            }).client();
          },
        });
        return s;
      };

      const middleServer = async () => {
        const s = await rpc.accept();
        s.initMain(ReturnCapability, {
          get: async (_, r) => {
            const forwarded = upstream.connect().bootstrap(ReturnCapability);
            const pending = forwarded.get();
            void pending.promise().catch(() => {});
            r.capability = pending.getCapability();
          },
        });
        return s;
      };

      const middlePromise = middleServer();
      const upstreamPromise = upstreamServer();

      let getPromise: Promise<any> | undefined;
      let middleConn: any;
      let upstreamConn: any;
      let clientConn: any;
      const seenClientResolves: number[] = [];
      let unlistenClient: (() => void) | undefined;
      try {
        clientConn = rpc.connect();
        const clientPort = (clientConn.transport as any).port;
        const onClientMessage = (buf: ArrayBuffer) => {
          const inbound = new Message(buf, false).getRoot(RPCMessage);
          if (inbound.which() !== RPCMessage.RESOLVE) {
            return;
          }
          seenClientResolves.push(inbound.resolve.which());
        };
        clientPort.on("message", onClientMessage);
        unlistenClient = () => {
          clientPort.off("message", onClientMessage);
        };
        middleConn = await middlePromise;
        getPromise = clientConn.bootstrap(ReturnCapability).get().promise();
        upstreamConn = await upstreamPromise;

        await waitUntil(
          () => Object.keys((middleConn as any).exportPromises).length > 0,
          1000,
        );
        await waitUntil(
          () =>
            Object.values((clientConn as any).imports).some(
              (entry: any) => entry.isPromise === true,
            ),
          1000,
        );

        releaseUpstream?.();
        const result = await getPromise;
        t.ok(result.capability);

        await waitUntil(
          () =>
            Object.values((middleConn as any).exportPromises).every(
              (entry: any) => entry.settled === true,
            ),
          1000,
        );
        await waitUntil(
          () =>
            Object.values((clientConn as any).imports).every(
              (entry: any) => entry.isPromise === false,
            ),
          1000,
        );
        t.ok(seenClientResolves.includes(Resolve.CAP));
      } finally {
        unlistenClient?.();
        if (getPromise) {
          await getPromise.catch(() => {});
        }
        if (middleConn) {
          middleConn.shutdown();
        }
        if (upstreamConn) {
          upstreamConn.shutdown();
        }
        upstream.close();
      }
    },
  );

  test(
    "incoming resolve.exception settles senderPromise import over integration transport",
    {
      timeout: 4000,
    },
    async () => {
      const upstream = new TestRPC();
      let releaseUpstream: (() => void) | undefined;
      const upstreamGate = new Promise<void>((resolve) => {
        releaseUpstream = resolve;
      });

      const upstreamServer = async () => {
        const s = await upstream.accept();
        s.initMain(ReturnCapability, {
          get: async (_, r) => {
            await upstreamGate;
            r.capability = new SimpleInterface.Server({
              subtract: async (p, out) => {
                out.result = p.a - p.b;
              },
            }).client();
          },
        });
        return s;
      };

      const middleServer = async () => {
        const s = await rpc.accept();
        s.initMain(ReturnCapability, {
          get: async (_, r) => {
            const forwarded = upstream.connect().bootstrap(ReturnCapability);
            r.capability = forwarded.get().getCapability();
          },
        });
        return s;
      };

      const middlePromise = middleServer();
      const upstreamPromise = upstreamServer();

      let middleConn: any;
      let clientConn: any;
      let pendingCap: any;
      try {
        clientConn = rpc.connect();
        middleConn = await middlePromise;
        pendingCap = await clientConn
          .bootstrap(ReturnCapability)
          .get()
          .promise();
        await upstreamPromise;

        await waitUntil(
          () =>
            Object.values((clientConn as any).imports).some(
              (entry: any) => entry.isPromise === true,
            ),
          1000,
        );

        const promiseImportIds = Object.keys(
          (clientConn as any).imports,
        ).filter(
          (id) => (clientConn as any).imports[Number(id)].isPromise === true,
        );
        t.ok(promiseImportIds.length > 0);
        const promiseId = Number(promiseImportIds[0]);

        const resolveMsg = new Message().initRoot(RPCMessage);
        const resolve = resolveMsg._initResolve();
        resolve.promiseId = promiseId;
        resolve._initException().reason =
          "integration forced resolve exception";
        middleConn.sendMessage(resolveMsg);

        await waitUntil(
          () => (clientConn as any).imports[promiseId]?.isPromise === false,
          1000,
        );

        const err = await pendingCap.capability
          .subtract((p: SimpleInterface_Subtract$Params) => {
            p.a = 7;
            p.b = 4;
          })
          .promise()
          .then(() => null)
          .catch((error_: unknown) => error_ as Error);
        t.ok(err instanceof Error);
        t.ok(err.message.includes("integration forced resolve exception"));

        releaseUpstream?.();
      } finally {
        releaseUpstream?.();
        upstream.close();
      }
    },
  );

  test(
    "senderPromise emits outgoing resolve.exception over integration transport",
    {
      timeout: 4000,
    },
    async () => {
      const upstream = new TestRPC();

      const upstreamServer = async () => {
        const s = await upstream.accept();
        s.initMain(ReturnCapability, {
          get: async () => {
            await new Promise(() => {});
          },
        });
        return s;
      };

      const middleServer = async () => {
        const s = await rpc.accept();
        s.initMain(ReturnCapability, {
          get: async (_, r) => {
            const forwarded = upstream.connect().bootstrap(ReturnCapability);
            const pending = forwarded.get();
            void pending.promise().catch(() => {});
            r.capability = pending.getCapability();
          },
        });
        return s;
      };

      const middlePromise = middleServer();
      const upstreamPromise = upstreamServer();

      let middleConn: any;
      let clientConn: any;
      const resolveExceptionReasons: string[] = [];
      let unlistenClient: (() => void) | undefined;
      try {
        clientConn = rpc.connect();
        middleConn = await middlePromise;

        const clientPort = (clientConn.transport as any).port;
        const onClientMessage = (buf: ArrayBuffer) => {
          const inbound = new Message(buf, false).getRoot(RPCMessage);
          if (inbound.which() !== RPCMessage.RESOLVE) {
            return;
          }
          const resolve = inbound.resolve;
          if (resolve._isException) {
            resolveExceptionReasons.push(resolve.exception.reason);
          }
        };
        clientPort.on("message", onClientMessage);
        unlistenClient = () => {
          clientPort.off("message", onClientMessage);
        };

        const pending = clientConn.bootstrap(ReturnCapability).get();
        void pending.promise().catch(() => {});
        const cap = pending.getCapability();
        void cap;

        const upstreamConn = await upstreamPromise;
        void upstreamConn;

        await waitUntil(
          () => Object.keys((middleConn as any).exportPromises).length > 0,
          1000,
        );
        await waitUntil(
          () =>
            Object.values((clientConn as any).imports).some(
              (entry: any) => entry.isPromise === true,
            ),
          1000,
        );
        const promiseExportIds = Object.keys(
          (middleConn as any).exportPromises,
        );
        t.ok(promiseExportIds.length > 0);
        const promiseId = Number(promiseExportIds[0]);
        (middleConn as any).resolveExportPromiseException(
          promiseId,
          new Error("forced upstream exception"),
        );

        await waitUntil(
          () =>
            resolveExceptionReasons.some((reason) =>
              reason.includes("forced upstream exception"),
            ),
          1000,
        );
        await waitUntil(
          () =>
            Object.values((clientConn as any).imports).some(
              (entry: any) =>
                entry.isPromise === false &&
                entry.rc?._client?.resolved instanceof ErrorClient,
            ),
          1000,
        );
      } finally {
        unlistenClient?.();
        if (middleConn) {
          middleConn.shutdown();
        }
        upstream.close();
      }
    },
  );

  test(
    "closing imported capability releases remote export",
    { timeout: 2000 },
    async () => {
      let serverConn: any;
      let baselineExports = 0;
      let resolveClientReady: ((client: any) => void) | undefined;
      const clientReady = new Promise<any>((resolve) => {
        resolveClientReady = resolve;
      });
      let releaseClose: (() => void) | undefined;
      const closeGate = new Promise<void>((resolve) => {
        releaseClose = resolve;
      });

      const server = async () => {
        const s = await rpc.accept();
        serverConn = s;
        s.initMain(ReturnCapability, {
          get: async (_, r) => {
            const returnedClient = new SimpleInterface.Server({
              subtract: async (p, out) => {
                out.result = p.a - p.b;
              },
            }).client();
            r.capability = returnedClient;
          },
        });
        baselineExports = (s.exports as any[]).filter(Boolean).length;
        return s;
      };

      const client = async () => {
        const res = await rpc
          .connect()
          .bootstrap(ReturnCapability)
          .get()
          .promise();
        resolveClientReady?.(res.capability.client);
        await closeGate;
        res.capability.client.close();
      };

      const clientTask = client();
      await Promise.all([server(), clientReady]);
      await waitUntil(() => !!serverConn, 500);
      await waitUntil(
        () =>
          (serverConn.exports as any[]).filter(Boolean).length >
          baselineExports,
        1000,
      );

      releaseClose?.();
      await clientTask;
      await waitUntil(
        () =>
          (serverConn.exports as any[]).filter(Boolean).length ===
          baselineExports,
        1000,
      );
    },
  );

  test(
    "sendResultsTo.yourself returns resultsSentElsewhere in integration flow",
    {
      timeout: 2000,
    },
    async () => {
      const server = async () => {
        const s = await rpc.accept();
        s.initMain(ReturnCapability, {
          get: async (_, r) => {
            r.capability = new SimpleInterface.Server({
              subtract: async (p, out) => {
                out.result = p.a - p.b;
              },
            }).client();
          },
        });
        return s;
      };

      const serverConnPromise = server();
      const clientConn = rpc.connect();
      const cap = await clientConn.bootstrap(ReturnCapability).get().promise();
      void cap.capability.subtract((p) => {
        p.a = 3;
        p.b = 1;
      });

      const importIds = Object.keys((clientConn as any).imports);
      t.ok(importIds.length > 0);
      const importId = Number(importIds[0]);

      const method = (SimpleInterface as any).Client.methods[0];
      const q = (clientConn as any).newQuestion(method);
      const wait = q
        .struct()
        .then(() => {
          throw new Error("expected resultsSentElsewhere rejection");
        })
        .catch((error_: unknown) => error_ as Error);

      const msg = new Message().initRoot(RPCMessage);
      const call = msg._initCall();
      call.questionId = q.id;
      call.interfaceId = method.interfaceId;
      call.methodId = method.methodId;
      call._initTarget().importedCap = importId;
      const payload = call._initParams();
      const paramsMsg = new Message();
      const params = paramsMsg.initRoot(SimpleInterface_Subtract$Params);
      params.a = 9;
      params.b = 4;
      payload.content = params;
      call._initSendResultsTo().yourself = true;
      clientConn.sendMessage(msg);
      q.start();

      const err = await wait;
      t.ok(err.message.length > 0);
      t.equal((clientConn as any).findQuestion(q.id), null);
      (await serverConnPromise).shutdown();
    },
  );

  test(
    "pipeline close sends finish for unresolved parent question",
    {
      timeout: 2000,
    },
    async () => {
      let releaseGet: (() => void) | undefined;
      const getGate = new Promise<void>((resolve) => {
        releaseGet = resolve;
      });
      const serverConnPromise = (async () => {
        const s = await rpc.accept();
        s.initMain(ReturnCapability, {
          get: async (_, r) => {
            await getGate;
            r.capability = new SimpleInterface.Server({
              subtract: async (p, out) => {
                out.result = p.a - p.b;
              },
            }).client();
          },
        });
        return s;
      })();

      const clientConn = rpc.connect();
      const serverConn = await serverConnPromise;
      const serverPort = (serverConn.transport as any).port;

      let getQuestionId: number | undefined;
      const finishQuestionIds: number[] = [];
      const onMessage = (buf: ArrayBuffer) => {
        const inbound = new Message(buf, false).getRoot(RPCMessage);
        switch (inbound.which()) {
          case RPCMessage.CALL: {
            const call = inbound.call;
            if (
              call.interfaceId ===
                (ReturnCapability as any).Client.interfaceId &&
              call.methodId === 0
            ) {
              getQuestionId = call.questionId;
            }
            break;
          }
          case RPCMessage.FINISH: {
            finishQuestionIds.push(inbound.finish.questionId);
            break;
          }
          default:
        }
      };
      serverPort.on("message", onMessage);

      try {
        const pending = clientConn.bootstrap(ReturnCapability).get();
        void pending.promise().catch(() => {});
        const pipedCap = pending.getCapability();

        await waitUntil(() => getQuestionId !== undefined, 1000);
        pipedCap.client.close();
        await waitUntil(
          () => finishQuestionIds.includes(getQuestionId as number),
          1000,
        );
      } finally {
        serverPort.off("message", onMessage);
        releaseGet?.();
      }
    },
  );

  test(
    "disembargo senderLoopback echoes receiverLoopback over integration transport",
    {
      timeout: 2000,
    },
    async () => {
      const clientConn = rpc.connect();
      const serverConn = await rpc.accept();

      const received: Array<{
        which: number;
        loopbackId?: number;
        targetWhich: number;
        importedCap?: number;
      }> = [];

      const serverPort = (serverConn.transport as any).port;
      const onMessage = (buf: ArrayBuffer) => {
        const inbound = new Message(buf, false).getRoot(RPCMessage);
        if (inbound.which() !== RPCMessage.DISEMBARGO) {
          return;
        }
        const dis = inbound.disembargo;
        const ctx = dis.context;
        received.push({
          which: ctx.which(),
          loopbackId:
            ctx.which() === Disembargo_Context_Which.RECEIVER_LOOPBACK
              ? ctx.receiverLoopback
              : undefined,
          targetWhich: dis.target.which(),
          importedCap:
            dis.target.which() === MessageTarget.IMPORTED_CAP
              ? dis.target.importedCap
              : undefined,
        });
      };
      serverPort.on("message", onMessage);

      try {
        const msg = new Message().initRoot(RPCMessage);
        const dis = msg._initDisembargo();
        dis.context.senderLoopback = 42;
        dis._initTarget().importedCap = 99;
        serverConn.sendMessage(msg);

        await waitUntil(() => received.length > 0, 1000);
        t.equal(received[0].which, Disembargo_Context_Which.RECEIVER_LOOPBACK);
        t.equal(received[0].loopbackId, 42);
        t.equal(received[0].targetWhich, MessageTarget.IMPORTED_CAP);
        t.equal(received[0].importedCap, 99);
        void clientConn;
      } finally {
        serverPort.off("message", onMessage);
      }
    },
  );

  test(
    "disembargo level-3 contexts return unimplemented over integration transport",
    {
      timeout: 2000,
    },
    async () => {
      rpc.connect();
      const serverConn = await rpc.accept();
      const serverPort = (serverConn.transport as any).port;

      let sawUnimplemented = false;
      const onMessage = (buf: ArrayBuffer) => {
        const inbound = new Message(buf, false).getRoot(RPCMessage);
        if (inbound.which() === RPCMessage.UNIMPLEMENTED) {
          sawUnimplemented = true;
        }
      };
      serverPort.on("message", onMessage);

      try {
        const msg = new Message().initRoot(RPCMessage);
        const dis = msg._initDisembargo();
        dis.context.accept = true;
        dis._initTarget().importedCap = 1;
        serverConn.sendMessage(msg);

        await waitUntil(() => sawUnimplemented, 1000);
      } finally {
        serverPort.off("message", onMessage);
      }
    },
  );

  test(
    "return for unknown question id closes receiver connection",
    {
      timeout: 2000,
    },
    async () => {
      const clientConn = rpc.connect();
      const serverConn = await rpc.accept();

      const msg = new Message().initRoot(RPCMessage);
      const ret = msg._initReturn();
      ret.answerId = 999999;
      ret.canceled = true;
      serverConn.sendMessage(msg);

      await waitUntil(() => (clientConn as any).closed === true, 1000);
    },
  );

  test(
    "return.canceled rejects pending question over integration transport",
    {
      timeout: 2000,
    },
    async () => {
      const server = async () => {
        const s = await rpc.accept();
        s.initMain(SimpleInterface, {
          subtract: async (p, r) => {
            r.result = p.a - p.b;
          },
        });
        return s;
      };

      const serverConnPromise = server();
      const clientConn = rpc.connect();

      const method = (SimpleInterface as any).Client.methods[0];
      const q = (clientConn as any).newQuestion(method);
      const rejected = q
        .struct()
        .then(() => null)
        .catch((error_: unknown) => error_ as Error);

      const msg = new Message().initRoot(RPCMessage);
      const call = msg._initCall();
      call.questionId = q.id;
      call.interfaceId = method.interfaceId;
      call.methodId = method.methodId;
      call._initTarget().importedCap = 0;
      const payload = call._initParams();
      const paramsMsg = new Message();
      const params = paramsMsg.initRoot(SimpleInterface_Subtract$Params);
      params.a = 10;
      params.b = 6;
      payload.content = params;
      clientConn.sendMessage(msg);
      q.start();

      const retMsg = new Message().initRoot(RPCMessage);
      const ret = retMsg._initReturn();
      ret.answerId = q.id;
      ret.canceled = true;
      (await serverConnPromise).sendMessage(retMsg);

      const err = await rejected;
      t.ok(err instanceof Error);
      t.ok(err.message.includes("call canceled by remote"));
      t.equal((clientConn as any).findQuestion(q.id), null);
    },
  );

  test(
    "duplicate incoming call question id closes receiver connection",
    {
      timeout: 2000,
    },
    async () => {
      let releaseSubtract: (() => void) | undefined;
      const subtractGate = new Promise<void>((resolve) => {
        releaseSubtract = resolve;
      });
      const serverConnPromise = (async () => {
        const s = await rpc.accept();
        s.initMain(SimpleInterface, {
          subtract: async (p, r) => {
            await subtractGate;
            r.result = p.a - p.b;
          },
        });
        return s;
      })();

      const clientConn = rpc.connect();
      const serverConn = await serverConnPromise;
      (serverConn as any).onError = () => {};
      const method = (SimpleInterface as any).Client.methods[0];

      const makeCall = () => {
        const msg = new Message().initRoot(RPCMessage);
        const call = msg._initCall();
        call.questionId = 4242;
        call.interfaceId = method.interfaceId;
        call.methodId = method.methodId;
        call._initTarget().importedCap = 0;
        const payload = call._initParams();
        const paramsMsg = new Message();
        const params = paramsMsg.initRoot(SimpleInterface_Subtract$Params);
        params.a = 10;
        params.b = 1;
        payload.content = params;
        return msg;
      };

      clientConn.sendMessage(makeCall());
      await waitUntil(() => !!(serverConn as any).answers[4242], 1000);
      void (serverConn as any).answers[4242].deferred.promise.catch(() => {});
      clientConn.sendMessage(makeCall());

      await waitUntil(() => (serverConn as any).closed === true, 1000);
      releaseSubtract?.();
    },
  );

  test(
    "takeFromOtherQuestion follows source answer over integration transport",
    {
      timeout: 2000,
    },
    async () => {
      const clientConn = rpc.connect();
      let releaseSourceCall: (() => void) | undefined;
      const sourceCallGate = new Promise<void>((resolve) => {
        releaseSourceCall = resolve;
      });
      clientConn.initMain(SimpleInterface, {
        subtract: async (p, r) => {
          await sourceCallGate;
          r.result = p.a - p.b;
        },
      });
      const serverConn = await rpc.accept();

      // Bootstrap first and call through promisedAnswer to avoid import-id assumptions.
      const bootstrapQuestion = (serverConn as any).newQuestion();
      const bootstrapMsg = new Message().initRoot(RPCMessage);
      bootstrapMsg._initBootstrap().questionId = bootstrapQuestion.id;
      serverConn.sendMessage(bootstrapMsg);
      bootstrapQuestion.start();

      // Start an in-flight incoming call on the client: this creates the source answer id.
      const sourceMethod = (SimpleInterface as any).Client.methods[0];
      const sourceQuestion = (serverConn as any).newQuestion(sourceMethod);
      const sourceCallMsg = new Message().initRoot(RPCMessage);
      const sourceCall = sourceCallMsg._initCall();
      sourceCall.questionId = sourceQuestion.id;
      sourceCall.interfaceId = sourceMethod.interfaceId;
      sourceCall.methodId = sourceMethod.methodId;
      const promisedTarget = sourceCall._initTarget()._initPromisedAnswer();
      promisedTarget.questionId = bootstrapQuestion.id;
      promisedTarget._initTransform(0);
      const sourcePayload = sourceCall._initParams();
      const sourceParamsMsg = new Message();
      const sourceParams = sourceParamsMsg.initRoot(
        SimpleInterface_Subtract$Params,
      );
      sourceParams.a = 12;
      sourceParams.b = 5;
      sourcePayload.content = sourceParams;
      serverConn.sendMessage(sourceCallMsg);
      sourceQuestion.start();

      await waitUntil(
        () => !!(clientConn as any).answers[sourceQuestion.id],
        1000,
      );

      // Keep a pending client question that the server will resolve indirectly.
      const redirectedQuestion = (clientConn as any).newQuestion();
      const redirectedPromise = redirectedQuestion.struct();

      // Redirect the pending question to the in-flight source answer.
      const retMsg = new Message().initRoot(RPCMessage);
      const ret = retMsg._initReturn();
      ret.answerId = redirectedQuestion.id;
      ret.takeFromOtherQuestion = sourceQuestion.id;
      (serverConn as any).sendMessage(retMsg);

      releaseSourceCall?.();
      const redirectedResult = await redirectedPromise;
      t.equal(redirectedResult.result, 7);
      t.equal((clientConn as any).findQuestion(redirectedQuestion.id), null);
    },
  );
});
