import { describe, test, assert as t } from "vitest";
import { Message } from "src/serialization/message";
import {
  RpcLevel2Owner,
  RpcLevel2PersistenceService,
  RpcLevel2Restorer,
  RpcLevel2SturdyRef,
} from "test/fixtures/rpc-level2";

describe("rpc level-2 fixture schema", () => {
  test("owner and sturdyRef structs can be encoded/decoded", () => {
    const message = new Message();
    const ref = message.initRoot(RpcLevel2SturdyRef);
    ref.host = "vat-a";
    ref._initObjectId(3).copyBuffer(new Uint8Array([1, 2, 3]));

    const copy = message.getRoot(RpcLevel2SturdyRef);
    t.equal(copy.host, "vat-a");
    t.deepEqual([...copy.objectId.toUint8Array()], [1, 2, 3]);
  });

  test("generated level-2 service interfaces instantiate", () => {
    const restorer = new RpcLevel2Restorer.Server({
      async restore(params, results) {
        const owner = params.owner;
        t.ok(owner instanceof RpcLevel2Owner);
        void results;
      },
    });

    const persistence = new RpcLevel2PersistenceService.Server({
      async save(_, results) {
        results._initSturdyRef().host = "saved";
      },
      async restore(_, results) {
        void results;
      },
    });

    t.ok(restorer.client());
    t.ok(persistence.client());
  });
});
