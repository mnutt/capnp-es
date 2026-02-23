import { describe, test, expect } from "vitest";
import { Message } from "src/serialization/message";
import { Server } from "src/rpc/server";
import { RPC_METHOD_NOT_IMPLEMENTED } from "src/errors";
import {
  SimpleInterface,
  SimpleInterface_Subtract$Params,
} from "test/fixtures/simple-interface";

describe("rpc server", () => {
  test("startCall captures synchronous impl throws as rejected answers", async () => {
    const method = (SimpleInterface as any).Client.methods[0];
    const server = new Server({}, [
      {
        ...method,
        impl: () => {
          throw new Error("sync impl boom");
        },
      },
    ] as any);

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

  test("call rejects when method id exists but interface id mismatches", async () => {
    const method = (SimpleInterface as any).Client.methods[0];
    const server = new Server({}, [
      {
        ...method,
        impl: async () => {
          throw new Error("should not be reached");
        },
      },
    ] as any);

    const wrongInterfaceMethod = {
      ...method,
      interfaceId: method.interfaceId + 1n,
    };

    const paramsMsg = new Message();
    const params = paramsMsg.initRoot(SimpleInterface_Subtract$Params);

    const answer = server.call({
      method: wrongInterfaceMethod,
      params,
    } as any);

    expect(() => answer.struct()).toThrow(RPC_METHOD_NOT_IMPLEMENTED);
  });
});
