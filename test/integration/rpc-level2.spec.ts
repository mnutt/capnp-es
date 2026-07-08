import { afterEach, beforeEach, describe, test, assert as t } from "vitest";
import { Message, utils } from "src/serialization";
import { Conn } from "src/rpc";
import { Persistent } from "src/capnp/persistent";
import { RPC_METHOD_NOT_IMPLEMENTED } from "src/errors";
import { MapRestorerLookup } from "src/rpc/persistence";
import {
  createPersistentSaveServer,
  persistentClient,
} from "src/rpc/persistent-interface";
import { TestRPC } from "./rpc.utils";
import { ReturnCapability } from "test/fixtures/import-interface";
import {
  SimpleInterface,
  type SimpleInterface_Subtract$Params,
  type SimpleInterface$Client,
} from "test/fixtures/simple-interface";
import {
  RpcLevel2Owner,
  RpcLevel2PersistenceService,
  RpcLevel2Restorer,
  type RpcLevel2Restorer_Restore$Params,
  RpcLevel2SturdyRef,
} from "test/fixtures/rpc-level2";

describe("rpc level-2", () => {
  let rpc: TestRPC;

  beforeEach(() => {
    rpc = new TestRPC();
  });

  afterEach(() => {
    rpc.close();
  });

  test("Persistent.save returns a sturdyRef that can be restored locally", async () => {
    const lookup = new MapRestorerLookup<
      { host: string; object: string },
      SimpleInterface$Client
    >();

    const server = async () => {
      const s = await rpc.accept();
      const persistentServer = createPersistentSaveServer((sealFor) => {
        const owner = utils.getAs(RpcLevel2Owner, sealFor);
        const key = {
          host: "local",
          object: `cap-for:${owner.id || "anon"}`,
        };

        const capability = new SimpleInterface.Server({
          subtract: async (params, results) => {
            results.result = params.a - params.b;
          },
        }).client();

        lookup.set(key, capability);

        const msg = new Message();
        const ref = msg.initRoot(RpcLevel2SturdyRef);
        ref.host = key.host;
        const objectId = new TextEncoder().encode(key.object);
        ref._initObjectId(objectId.byteLength).copyBuffer(objectId);
        return ref;
      });
      s.initMain(Persistent, persistentServer.target);
      return s;
    };

    const client = async () => {
      const saved = await rpc
        .connect()
        .bootstrap(Persistent)
        .save((params) => {
          const msg = new Message();
          const owner = msg.initRoot(RpcLevel2Owner);
          owner.id = "alice";
          params.sealFor = owner;
        })
        .promise();

      const sturdyRef = utils.getAs(RpcLevel2SturdyRef, saved.sturdyRef);
      const object = new TextDecoder().decode(
        sturdyRef.objectId.toUint8Array(),
      );
      const restored = lookup.restore({
        host: sturdyRef.host,
        object,
      });
      const out = await restored
        .subtract((params) => {
          params.a = 13;
          params.b = 4;
        })
        .promise();
      return out.result;
    };

    const [, result] = await Promise.all([server(), client()]);
    t.equal(result, 9);
  });

  test("casting a non-persistent capability to Persistent fails deterministically", async () => {
    const server = async () => {
      const s = await rpc.accept();
      s.initMain(ReturnCapability, {
        get: async (_params, results) => {
          results.capability = new SimpleInterface.Server({
            subtract: async (params, out) => {
              out.result = params.a - params.b;
            },
          }).client();
        },
      });
      return s;
    };

    const client = async () => {
      const result = await rpc
        .connect()
        .bootstrap(ReturnCapability)
        .get()
        .promise();
      const persistent = persistentClient(result.capability.client);
      try {
        await persistent.save().promise();
        throw new Error("expected save failure");
      } catch (error_) {
        const message = (error_ as Error).message;
        t.ok(
          message.includes(RPC_METHOD_NOT_IMPLEMENTED) ||
            message.includes("Method not implemented"),
        );
      }
    };

    await Promise.all([server(), client()]);
  });

  test("pipelined calls on a promised capability preserve e-order", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: number[] = [];

    const server = async () => {
      const s = await rpc.accept();
      s.initMain(ReturnCapability, {
        get: async (_params, results) => {
          await gate;
          results.capability = new SimpleInterface.Server({
            subtract: async (params, out) => {
              order.push(params.a);
              out.result = params.a - params.b;
            },
          }).client();
        },
      });
      return s;
    };

    const client = async () => {
      const pending = rpc.connect().bootstrap(ReturnCapability).get();
      const cap = pending.getCapability();
      const calls = [1, 2, 3].map((value) =>
        cap
          .subtract((params) => {
            params.a = value;
            params.b = 0;
          })
          .promise(),
      );
      release();
      const results = await Promise.all(calls);
      return results.map((result) => result.result);
    };

    const [, results] = await Promise.all([server(), client()]);
    t.deepEqual(order, [1, 2, 3]);
    t.deepEqual(results, [1, 2, 3]);
  });

  test("cast flow to Persistent works when capability implements Persistent", async () => {
    const server = async () => {
      const s = await rpc.accept();
      s.initMain(ReturnCapability, {
        get: async (_params, results) => {
          const persistent = createPersistentSaveServer(() => {
            const msg = new Message();
            const ref = msg.initRoot(RpcLevel2SturdyRef);
            ref.host = "cast-ok";
            ref._initObjectId(1).copyBuffer(new Uint8Array([1]));
            return ref;
          });
          results.capability =
            persistent.client() as unknown as SimpleInterface$Client;
        },
      });
      return s;
    };

    const client = async () => {
      const result = await rpc
        .connect()
        .bootstrap(ReturnCapability)
        .get()
        .promise();
      const persistent = persistentClient(result.capability.client);
      const saved = await persistent.save().promise();
      const sturdyRef = utils.getAs(RpcLevel2SturdyRef, saved.sturdyRef);
      return sturdyRef.host;
    };

    const [, host] = await Promise.all([server(), client()]);
    t.equal(host, "cast-ok");
  });

  test("bootstrap restorer can restore sturdyRef and return callable capability", async () => {
    const lookup = new MapRestorerLookup<
      { host: string; object: string },
      SimpleInterface$Client
    >();

    const server = async () => {
      const s = await rpc.accept();
      const cap = new SimpleInterface.Server({
        subtract: async (params, results) => {
          results.result = params.a - params.b;
        },
      }).client();
      lookup.set({ host: "vat-a", object: "calc-1" }, cap);
      s.initMain(RpcLevel2Restorer, {
        async restore(params, results) {
          const sturdyRef = params.sturdyRef;
          const object = new TextDecoder().decode(
            sturdyRef.objectId.toUint8Array(),
          );
          results.capability = lookup.restore({
            host: sturdyRef.host,
            object,
          });
        },
      });
      return s;
    };

    const client = async () => {
      const restored = await rpc
        .connect()
        .bootstrap(RpcLevel2Restorer)
        .restore((params) => {
          params._initSturdyRef().host = "vat-a";
          const objectId = new TextEncoder().encode("calc-1");
          params.sturdyRef
            ._initObjectId(objectId.byteLength)
            .copyBuffer(objectId);
          params._initOwner().id = "owner-a";
        })
        .promise();
      const out = await restored.capability
        .subtract((params) => {
          params.a = 20;
          params.b = 6;
        })
        .promise();
      return out.result;
    };

    const [, result] = await Promise.all([server(), client()]);
    t.equal(result, 14);
  });

  test("bootstrap restorer rejects unknown sturdyRef deterministically", async () => {
    const lookup = new MapRestorerLookup<
      { host: string; object: string },
      SimpleInterface$Client
    >();

    const server = async () => {
      const s = await rpc.accept();
      s.initMain(RpcLevel2Restorer, {
        async restore(params, results) {
          const sturdyRef = params.sturdyRef;
          const object = new TextDecoder().decode(
            sturdyRef.objectId.toUint8Array(),
          );
          results.capability = lookup.restore({
            host: sturdyRef.host,
            object,
          });
        },
      });
      return s;
    };

    const client = async () => {
      try {
        await rpc
          .connect()
          .bootstrap(RpcLevel2Restorer)
          .restore((params) => {
            params._initSturdyRef().host = "vat-a";
            const objectId = new TextEncoder().encode("missing");
            params.sturdyRef
              ._initObjectId(objectId.byteLength)
              .copyBuffer(objectId);
            params._initOwner().id = "owner-a";
          })
          .promise();
        throw new Error("expected restore failure");
      } catch (error_) {
        t.ok((error_ as Error).message.includes("unknown sturdyRef"));
      }
    };

    await Promise.all([server(), client()]);
  });

  test("forwarded restore (A->B->C) returns callable restored capability", async () => {
    const upstream = new TestRPC();

    const upstreamServer = async () => {
      const s = await upstream.accept();
      const cap = new SimpleInterface.Server({
        subtract: async (params, results) => {
          results.result = params.a - params.b;
        },
      }).client();
      s.initMain(RpcLevel2Restorer, {
        async restore(params, results) {
          const sturdyRef = params.sturdyRef;
          const object = new TextDecoder().decode(
            sturdyRef.objectId.toUint8Array(),
          );
          if (sturdyRef.host !== "vat-c" || object !== "calc-c") {
            throw new Error("unknown sturdyRef");
          }
          results.capability = cap;
        },
      });
      return s;
    };

    const middleServer = async () => {
      const s = await rpc.accept();
      s.initMain(RpcLevel2Restorer, {
        async restore(params, results) {
          const upstreamRestore = upstream
            .connect()
            .bootstrap(RpcLevel2Restorer);
          const restored = await upstreamRestore
            .restore((p) => {
              const ref = p._initSturdyRef();
              ref.host = params.sturdyRef.host;
              const objectId = params.sturdyRef.objectId.toUint8Array();
              ref._initObjectId(objectId.byteLength).copyBuffer(objectId);
              p._initOwner().id = params.owner.id;
            })
            .promise();
          results.capability = restored.capability;
        },
      });
      return s;
    };

    const middlePromise = middleServer();
    const upstreamPromise = upstreamServer();

    let middleConn: any;
    let upstreamConn: any;
    let clientConn: any;
    try {
      clientConn = rpc.connect();
      middleConn = await middlePromise;

      const restored = await clientConn
        .bootstrap(RpcLevel2Restorer)
        .restore((p: RpcLevel2Restorer_Restore$Params) => {
          p._initSturdyRef().host = "vat-c";
          const objectId = new TextEncoder().encode("calc-c");
          p.sturdyRef._initObjectId(objectId.byteLength).copyBuffer(objectId);
          p._initOwner().id = "owner-c";
        })
        .promise();

      const out = await restored.capability
        .subtract((p: SimpleInterface_Subtract$Params) => {
          p.a = 22;
          p.b = 5;
        })
        .promise();
      t.equal(out.result, 17);
      upstreamConn = await upstreamPromise;
    } finally {
      if (clientConn) {
        clientConn.shutdown();
      }
      if (middleConn) {
        middleConn.shutdown();
      }
      if (upstreamConn) {
        upstreamConn.shutdown();
      }
      upstream.close();
    }
  });

  test("save on one connection can be restored on a new connection", async () => {
    const store = new Map<string, SimpleInterface$Client>();
    const persisted = new SimpleInterface.Server({
      subtract: async (params, results) => {
        results.result = params.a - params.b;
      },
    }).client();

    const initServerConn = async () => {
      const s = await rpc.accept();
      s.onError = () => {};
      s.initMain(RpcLevel2PersistenceService, {
        async save(params, results) {
          const ownerId = params.sealFor.id || "anon";
          const key = `persisted:${ownerId}`;
          store.set(key, persisted);
          const objectId = new TextEncoder().encode(key);
          const ref = results._initSturdyRef();
          ref.host = "vat-e";
          ref._initObjectId(objectId.byteLength).copyBuffer(objectId);
        },
        async restore(params, results) {
          const object = new TextDecoder().decode(
            params.sturdyRef.objectId.toUint8Array(),
          );
          const cap = store.get(object);
          if (!cap) {
            throw new Error("unknown sturdyRef");
          }
          results.capability = cap;
        },
      });
      return s;
    };

    const serverConn1 = initServerConn();
    const clientConn1 = rpc.connect(1);
    const saved = await clientConn1
      .bootstrap(RpcLevel2PersistenceService)
      .save((params) => {
        params._initSealFor().id = "owner-e";
      })
      .promise();
    const sturdyRef = utils.getAs(RpcLevel2SturdyRef, saved.sturdyRef);
    clientConn1.shutdown();
    (await serverConn1).shutdown();

    const serverConn2 = initServerConn();
    const clientConn2 = rpc.connect(2);
    const restored = await clientConn2
      .bootstrap(RpcLevel2PersistenceService)
      .restore((params) => {
        params._initSturdyRef().host = sturdyRef.host;
        const objectId = sturdyRef.objectId.toUint8Array();
        params.sturdyRef
          ._initObjectId(objectId.byteLength)
          .copyBuffer(objectId);
        params._initOwner().id = "owner-e";
      })
      .promise();
    const out = await restored.capability
      .subtract((params) => {
        params.a = 40;
        params.b = 13;
      })
      .promise();
    t.equal(out.result, 27);
    clientConn2.shutdown();
    (await serverConn2).shutdown();
  });

  test("save+restore returns callable imported capability while exporter stays connected", async () => {
    const store = new Map<string, SimpleInterface$Client>();

    const initServerConn = async () => {
      const s = await rpc.accept();
      s.onError = () => {};
      s.initMain(RpcLevel2PersistenceService, {
        async save(params, results) {
          const ownerId = params.sealFor.id || "anon";
          const key = `persisted-cap:${ownerId}`;
          store.set(key, params.capability);
          const objectId = new TextEncoder().encode(key);
          const ref = results._initSturdyRef();
          ref.host = "vat-f";
          ref._initObjectId(objectId.byteLength).copyBuffer(objectId);
        },
        async restore(params, results) {
          const object = new TextDecoder().decode(
            params.sturdyRef.objectId.toUint8Array(),
          );
          const cap = store.get(object);
          if (!cap) {
            throw new Error("unknown sturdyRef");
          }
          results.capability = cap;
        },
      });
      return s;
    };

    const exportedCap = new SimpleInterface.Server({
      subtract: async (params, results) => {
        results.result = params.a - params.b;
      },
    }).client();

    let conn1Server: Awaited<ReturnType<typeof initServerConn>> | undefined;
    let conn1Client: Conn | undefined;
    let conn2Server: Awaited<ReturnType<typeof initServerConn>> | undefined;
    let conn2Client: Conn | undefined;
    try {
      conn1Client = rpc.connect(10);
      const conn1ServerPromise = initServerConn();
      const saved = await conn1Client
        .bootstrap(RpcLevel2PersistenceService)
        .save((params) => {
          params.capability = exportedCap;
          params._initSealFor().id = "owner-f";
        })
        .promise();
      const sturdyRef = utils.getAs(RpcLevel2SturdyRef, saved.sturdyRef);
      conn1Server = await conn1ServerPromise;

      conn2Client = rpc.connect(11);
      const conn2ServerPromise = initServerConn();
      const restored = await conn2Client
        .bootstrap(RpcLevel2PersistenceService)
        .restore((params) => {
          params._initSturdyRef().host = sturdyRef.host;
          const objectId = sturdyRef.objectId.toUint8Array();
          params.sturdyRef
            ._initObjectId(objectId.byteLength)
            .copyBuffer(objectId);
          params._initOwner().id = "owner-f";
        })
        .promise();
      conn2Server = await conn2ServerPromise;

      const out = await restored.capability
        .subtract((params) => {
          params.a = 33;
          params.b = 8;
        })
        .promise();
      t.equal(out.result, 25);
    } finally {
      conn2Client?.shutdown();
      conn2Server?.shutdown();
      conn1Client?.shutdown();
      conn1Server?.shutdown();
    }
  });

  test("save+restore imported capability fails after exporter disconnects", async () => {
    const store = new Map<string, SimpleInterface$Client>();

    const initServerConn = async () => {
      const s = await rpc.accept();
      s.onError = () => {};
      s.initMain(RpcLevel2PersistenceService, {
        async save(params, results) {
          const ownerId = params.sealFor.id || "anon";
          const key = `persisted-cap:${ownerId}`;
          store.set(key, params.capability);
          const objectId = new TextEncoder().encode(key);
          const ref = results._initSturdyRef();
          ref.host = "vat-g";
          ref._initObjectId(objectId.byteLength).copyBuffer(objectId);
        },
        async restore(params, results) {
          const object = new TextDecoder().decode(
            params.sturdyRef.objectId.toUint8Array(),
          );
          const cap = store.get(object);
          if (!cap) {
            throw new Error("unknown sturdyRef");
          }
          results.capability = cap;
        },
      });
      return s;
    };

    const exportedCap = new SimpleInterface.Server({
      subtract: async (params, results) => {
        results.result = params.a - params.b;
      },
    }).client();

    let conn1Server: Awaited<ReturnType<typeof initServerConn>> | undefined;
    let conn1Client: Conn | undefined;
    let conn2Server: Awaited<ReturnType<typeof initServerConn>> | undefined;
    let conn2Client: Conn | undefined;
    try {
      conn1Client = rpc.connect(12);
      const conn1ServerPromise = initServerConn();
      const saved = await conn1Client
        .bootstrap(RpcLevel2PersistenceService)
        .save((params) => {
          params.capability = exportedCap;
          params._initSealFor().id = "owner-g";
        })
        .promise();
      const sturdyRef = utils.getAs(RpcLevel2SturdyRef, saved.sturdyRef);
      conn1Server = await conn1ServerPromise;
      conn1Client.shutdown();
      conn1Server.shutdown();
      conn1Client = undefined;
      conn1Server = undefined;

      conn2Client = rpc.connect(13);
      const conn2ServerPromise = initServerConn();
      const restored = await conn2Client
        .bootstrap(RpcLevel2PersistenceService)
        .restore((params) => {
          params._initSturdyRef().host = sturdyRef.host;
          const objectId = sturdyRef.objectId.toUint8Array();
          params.sturdyRef
            ._initObjectId(objectId.byteLength)
            .copyBuffer(objectId);
          params._initOwner().id = "owner-g";
        })
        .promise();
      conn2Server = await conn2ServerPromise;

      try {
        await restored.capability
          .subtract((params) => {
            params.a = 33;
            params.b = 8;
          })
          .promise();
        throw new Error("expected restored imported capability to fail");
      } catch (error_) {
        t.match(
          (error_ as Error).message,
          /closed import|Method not implemented|null capability|Target not found/i,
        );
      }
    } finally {
      conn2Client?.shutdown();
      conn2Server?.shutdown();
      conn1Client?.shutdown();
      conn1Server?.shutdown();
    }
  });

  test("sealed sturdyRef restores for allowed owner", async () => {
    const cap = new SimpleInterface.Server({
      subtract: async (params, results) => {
        results.result = params.a - params.b;
      },
    }).client();

    const server = async () => {
      const s = await rpc.accept();
      s.onError = () => {};
      s.initMain(RpcLevel2Restorer, {
        async restore(params, results) {
          const sturdyRef = params.sturdyRef;
          const object = new TextDecoder().decode(
            sturdyRef.objectId.toUint8Array(),
          );
          if (
            sturdyRef.host === "sealed-vat" &&
            object === "sealed-1" &&
            params.owner.id === "owner-ok"
          ) {
            results.capability = cap;
            return;
          }
          throw new Error("owner not allowed");
        },
      });
      return s;
    };

    const serverConn = server();
    const clientConn = rpc.connect();
    const restored = await clientConn
      .bootstrap(RpcLevel2Restorer)
      .restore((p) => {
        p._initSturdyRef().host = "sealed-vat";
        const objectId = new TextEncoder().encode("sealed-1");
        p.sturdyRef._initObjectId(objectId.byteLength).copyBuffer(objectId);
        p._initOwner().id = "owner-ok";
      })
      .promise();
    const out = await restored.capability
      .subtract((p) => {
        p.a = 10;
        p.b = 3;
      })
      .promise();
    t.equal(out.result, 7);
    clientConn.shutdown();
    (await serverConn).shutdown();
  });

  test("sealed sturdyRef rejects different owner", async () => {
    const server = async () => {
      const s = await rpc.accept();
      s.onError = () => {};
      s.initMain(RpcLevel2Restorer, {
        async restore(params, _results) {
          const sturdyRef = params.sturdyRef;
          const object = new TextDecoder().decode(
            sturdyRef.objectId.toUint8Array(),
          );
          if (
            sturdyRef.host === "sealed-vat" &&
            object === "sealed-1" &&
            params.owner.id === "owner-ok"
          ) {
            return;
          }
          throw new Error("owner not allowed");
        },
      });
      return s;
    };

    const serverConn = server();
    const clientConn = rpc.connect();
    const error_ = await clientConn
      .bootstrap(RpcLevel2Restorer)
      .restore((p) => {
        p._initSturdyRef().host = "sealed-vat";
        const objectId = new TextEncoder().encode("sealed-1");
        p.sturdyRef._initObjectId(objectId.byteLength).copyBuffer(objectId);
        p._initOwner().id = "owner-bad";
      })
      .promise()
      .then(() => null)
      .catch((error__: unknown) => error__ as Error);
    t.ok(error_ instanceof Error);
    t.ok(error_.message.includes("owner not allowed"));
    clientConn.shutdown();
    (await serverConn).shutdown();
  });

  test("revoked sturdyRef fails restore-time", async () => {
    const store = new Map<string, SimpleInterface$Client>();
    const revoked = new Set<string>();
    const cap = new SimpleInterface.Server({
      subtract: async (params, results) => {
        results.result = params.a - params.b;
      },
    }).client();

    const initServerConn = async () => {
      const s = await rpc.accept();
      s.onError = () => {};
      s.initMain(RpcLevel2PersistenceService, {
        async save(params, results) {
          const ownerId = params.sealFor.id || "anon";
          const key = `revokable:${ownerId}`;
          store.set(key, cap);
          const objectId = new TextEncoder().encode(key);
          const ref = results._initSturdyRef();
          ref.host = "vat-rev";
          ref._initObjectId(objectId.byteLength).copyBuffer(objectId);
        },
        async restore(params, results) {
          const object = new TextDecoder().decode(
            params.sturdyRef.objectId.toUint8Array(),
          );
          if (revoked.has(object)) {
            throw new Error("revoked sturdyRef");
          }
          const found = store.get(object);
          if (!found) {
            throw new Error("unknown sturdyRef");
          }
          results.capability = found;
        },
      });
      return s;
    };

    const serverConn1 = initServerConn();
    const clientConn1 = rpc.connect(11);
    const saved = await clientConn1
      .bootstrap(RpcLevel2PersistenceService)
      .save((params) => {
        params._initSealFor().id = "owner-rev";
      })
      .promise();
    const sturdyRef = utils.getAs(RpcLevel2SturdyRef, saved.sturdyRef);
    const key = new TextDecoder().decode(sturdyRef.objectId.toUint8Array());
    revoked.add(key);
    store.delete(key);
    clientConn1.shutdown();
    (await serverConn1).shutdown();

    const serverConn2 = initServerConn();
    const clientConn2 = rpc.connect(12);
    const error_ = await clientConn2
      .bootstrap(RpcLevel2PersistenceService)
      .restore((params) => {
        params._initSturdyRef().host = sturdyRef.host;
        const objectId = sturdyRef.objectId.toUint8Array();
        params.sturdyRef
          ._initObjectId(objectId.byteLength)
          .copyBuffer(objectId);
        params._initOwner().id = "owner-rev";
      })
      .promise()
      .then(() => null)
      .catch((error__: unknown) => error__ as Error);

    t.ok(error_ instanceof Error);
    t.ok(error_.message.includes("revoked sturdyRef"));
    clientConn2.shutdown();
    (await serverConn2).shutdown();
  });
});
