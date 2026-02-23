import { afterEach, assert as t, describe, test } from "vitest";
import { VatConnectionManager } from "src/rpc/network";
import { Conn } from "src/rpc/conn";
import { SimpleInterface } from "test/fixtures/simple-interface";
import { TestRPC } from "./rpc.utils";

describe("rpc level-3 network manager integration", () => {
  const rpc = new TestRPC();

  afterEach(() => {
    rpc.close();
  });

  test("manager opens and reuses vat-keyed conns", async () => {
    const manager = new VatConnectionManager<string>({
      connect: async (vatId) => {
        const index = vatId === "vat-a" ? 0 : 1;
        const conn = rpc.connect(index);
        const accepted = await rpc.accept();
        accepted.initMain(SimpleInterface, {
          subtract: async (params, out) => {
            out.result = params.a - params.b;
          },
        });
        return conn;
      },
    });

    const vatA1 = await manager.get("vat-a");
    const vatA2 = await manager.get("vat-a");
    t.equal(vatA1, vatA2);

    const resA = await (vatA1 as Conn)
      .bootstrap(SimpleInterface)
      .subtract((p) => {
        p.a = 9;
        p.b = 4;
      })
      .promise();
    t.equal(resA.result, 5);

    const vatB = await manager.get("vat-b");
    t.notEqual(vatA1, vatB);
    const resB = await vatB
      .bootstrap(SimpleInterface)
      .subtract((p) => {
        p.a = 7;
        p.b = 3;
      })
      .promise();
    t.equal(resB.result, 4);

    manager.closeAll();
    t.equal(vatA1.closed, true);
    t.equal(vatB.closed, true);
  });
});
