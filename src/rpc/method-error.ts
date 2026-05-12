// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import { Method } from "./method";
import { Struct } from "../serialization/pointers/struct";
import { format } from "../util";
import { RPC_METHOD_ERROR } from "../errors";
import { Exception } from "../capnp/rpc";
import { CapnpRpcError } from "./rpc-error";

export class MethodError<
  P extends Struct,
  R extends Struct,
> extends CapnpRpcError {
  readonly method: Method<P, R>;

  constructor(method: Method<P, R>, error: string | Exception) {
    const message = typeof error === "string" ? error : error.reason;
    if (typeof error === "string") {
      super(message);
    } else {
      super(error);
    }
    this.name = "MethodError";
    this.method = method;
    this.message = format(
      RPC_METHOD_ERROR,
      method.interfaceName,
      method.methodName,
      message,
    );
  }
}
