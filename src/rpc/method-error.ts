// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import { Method } from "./method";
import { Struct } from "../serialization/pointers/struct";
import { RPC_METHOD_ERROR } from "../errors";
import { Exception } from "../capnp/rpc";
import { CapnpRpcError } from "./rpc-error";

// Split the fixed format once, while still reading the method's current names.
const [messagePrefix, methodSeparator, reasonSeparator] =
  RPC_METHOD_ERROR.split("%s");

export class MethodError<
  P extends Struct,
  R extends Struct,
> extends CapnpRpcError {
  readonly method: Method<P, R>;

  constructor(method: Method<P, R>, error: string | Exception) {
    if (typeof error === "string") {
      super(error);
    } else {
      super(error);
    }
    this.name = "MethodError";
    this.method = method;
    this.message =
      messagePrefix +
      method.interfaceName +
      methodSeparator +
      method.methodName +
      reasonSeparator +
      this.remoteReason;
  }
}
