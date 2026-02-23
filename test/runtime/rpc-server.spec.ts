import { describe, test, expect } from "vitest";
import { Message } from "src/serialization/message";
import { Server } from "src/rpc/server";
import {
  SimpleInterface,
  SimpleInterface_Subtract$Params,
} from "test/fixtures/simple-interface";

describe("rpc server", () => {
  test("startCall captures synchronous impl throws as rejected answers", async () => {
    const method = (SimpleInterface as any).Client.methods[0];
    const server = new Server(
      {},
      [
        {
          ...method,
          impl: () => {
            throw new Error("sync impl boom");
          },
        },
      ] as any,
    );

    const paramsMsg = new Message();
    const params = paramsMsg.initRoot(SimpleInterface_Subtract$Params);
    params.a = 5;
    params.b = 2;

    const answer = server.call({
      method,
      params,
    } as any);

    await expect(answer.struct()).rejects.toThrow("sync impl boom");
  });
});
