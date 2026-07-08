// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import { Method } from "./method";
import { Struct } from "../serialization/pointers/struct";
import { Message } from "../serialization/message";
import { DataCall, Call, copyCall } from "./call";
import { Fulfiller } from "./fulfiller/fulfiller";
import { Client } from "./client";
import { Answer } from "./answer";
import { ErrorAnswer } from "./error-answer";
import { MethodError } from "./method-error";
import { RPC_METHOD_NOT_IMPLEMENTED } from "../errors";

const disposeSymbol = Symbol.for("capnp-es.dispose");

export interface ServerMethod<
  P extends Struct,
  R extends Struct,
> extends Method<P, R> {
  impl(params: P, results: R): Promise<void>;
}

export interface ServerCall<
  P extends Struct,
  R extends Struct,
> extends DataCall<P, R> {
  serverMethod: ServerMethod<P, R>;
  answer: Fulfiller<R>;
}

// A server is a locally implemented interface
export class Server implements Client {
  readonly #methodsById = new Map<string, ServerMethod<any, any>>();

  constructor(
    public target: any,
    public methods: Array<ServerMethod<any, any>>,
  ) {
    for (const method of methods) {
      this.#methodsById.set(
        methodKey(method.interfaceId, method.methodId),
        method,
      );
    }
  }

  startCall<P extends Struct, R extends Struct>(call: ServerCall<P, R>): void {
    const msg = new Message();
    const results = msg.initRoot(call.method.ResultsClass);
    void (async () => {
      try {
        await call.serverMethod.impl.call(this.target, call.params, results);
        call.answer.fulfill(results);
      } catch (error_) {
        call.answer.tryReject(error_ as Error);
      }
    })();
  }

  call<P extends Struct, R extends Struct>(call: Call<P, R>): Answer<R> {
    const serverMethod = this.#methodsById.get(
      methodKey(call.method.interfaceId, call.method.methodId),
    );
    if (!serverMethod) {
      return new ErrorAnswer(
        new MethodError(call.method, RPC_METHOD_NOT_IMPLEMENTED),
      );
    }
    const serverCall: ServerCall<P, R> = {
      ...copyCall(call),
      answer: new Fulfiller<R>(),
      serverMethod,
    };
    this.startCall(serverCall);
    return serverCall.answer;
  }

  close(): void {
    const dispose = this.target?.[disposeSymbol];
    if (typeof dispose !== "function") {
      return;
    }

    try {
      void Promise.resolve(dispose.call(this.target)).catch(
        (error_: unknown) => {
          console.error("Error disposing capnp server target:", error_);
        },
      );
    } catch (error_) {
      console.error("Error disposing capnp server target:", error_);
    }
  }
}

function methodKey(interfaceId: bigint, methodId: number): string {
  return `${interfaceId}:${methodId}`;
}
