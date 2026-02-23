import { afterEach, beforeEach, describe, test, assert as t } from "vitest";
import { Message, utils } from "src/serialization";
import { Persistent } from "src/capnp/persistent";
import { RPC_METHOD_NOT_IMPLEMENTED } from "src/errors";
import { MapRestorerLookup } from "src/rpc/persistence";
import { createPersistentSaveServer, persistentClient } from "src/rpc/persistent-interface";
import { TestRPC } from "./rpc.utils";
import { ReturnCapability } from "test/fixtures/import-interface";
import {
  SimpleInterface,
  type SimpleInterface$Client,
} from "test/fixtures/simple-interface";
import { RpcLevel2Owner, RpcLevel2SturdyRef } from "test/fixtures/rpc-level2";

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
      const object = new TextDecoder().decode(sturdyRef.objectId.toUint8Array());
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
      const result = await rpc.connect().bootstrap(ReturnCapability).get().promise();
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
          results.capability = persistent.client() as unknown as SimpleInterface$Client;
        },
      });
      return s;
    };

    const client = async () => {
      const result = await rpc.connect().bootstrap(ReturnCapability).get().promise();
      const persistent = persistentClient(result.capability.client);
      const saved = await persistent.save().promise();
      const sturdyRef = utils.getAs(RpcLevel2SturdyRef, saved.sturdyRef);
      return sturdyRef.host;
    };

    const [, host] = await Promise.all([server(), client()]);
    t.equal(host, "cast-ok");
  });
});
