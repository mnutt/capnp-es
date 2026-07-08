// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import { RPC_ERROR } from "../errors";
import { Exception, type Exception_Type } from "../capnp/rpc";
import { format } from "../util";

export type CapnpRpcErrorCode =
  | "failed"
  | "overloaded"
  | "disconnected"
  | "unimplemented";

export function exceptionTypeToCode(type: Exception_Type): CapnpRpcErrorCode {
  switch (type) {
    case Exception.Type.OVERLOADED: {
      return "overloaded";
    }
    case Exception.Type.DISCONNECTED: {
      return "disconnected";
    }
    case Exception.Type.UNIMPLEMENTED: {
      return "unimplemented";
    }
    default: {
      return "failed";
    }
  }
}

export function codeToExceptionType(code: CapnpRpcErrorCode): Exception_Type {
  switch (code) {
    case "overloaded": {
      return Exception.Type.OVERLOADED;
    }
    case "disconnected": {
      return Exception.Type.DISCONNECTED;
    }
    case "unimplemented": {
      return Exception.Type.UNIMPLEMENTED;
    }
    case "failed": {
      return Exception.Type.FAILED;
    }
  }
}

export interface CapnpRpcErrorOptions extends ErrorOptions {
  exception?: Exception;
  code?: CapnpRpcErrorCode;
  remoteReason?: string;
  remoteTrace?: string;
}

export class CapnpRpcError extends Error {
  readonly code: CapnpRpcErrorCode;
  readonly remoteReason: string;
  readonly remoteTrace?: string;
  readonly exception?: Exception;

  constructor(exception: Exception);
  constructor(message: string, options?: CapnpRpcErrorOptions);
  constructor(
    exceptionOrMessage: Exception | string,
    options: CapnpRpcErrorOptions = {},
  ) {
    if (typeof exceptionOrMessage === "string") {
      const remoteReason = options.remoteReason ?? exceptionOrMessage;
      super(format(RPC_ERROR, remoteReason), options);
      this.name = "CapnpRpcError";
      this.code = options.code ?? "failed";
      this.remoteReason = remoteReason;
      this.remoteTrace = options.remoteTrace;
      this.exception = options.exception;
      return;
    }

    const exception = exceptionOrMessage;
    super(format(RPC_ERROR, exception.reason), options);
    this.name = "CapnpRpcError";
    this.code = exceptionTypeToCode(exception.type);
    this.remoteReason = exception.reason;
    this.remoteTrace = exception.trace || undefined;
    this.exception = exception;
  }
}

export { CapnpRpcError as RPCError };

export enum RpcProtocolErrorKind {
  BadTarget = "badTarget",
  QuestionIdReused = "questionIdReused",
  ReturnForUnknownQuestion = "returnForUnknownQuestion",
  UnknownAnswerId = "unknownAnswerId",
  UnknownCapDescriptor = "unknownCapDescriptor",
  UnknownExportId = "unknownExportId",
}

export class RpcProtocolError extends CapnpRpcError {
  readonly kind: RpcProtocolErrorKind;

  constructor(kind: RpcProtocolErrorKind, message: string) {
    super(message, { code: "failed" });
    this.name = "RpcProtocolError";
    this.kind = kind;
  }
}

export function toException(exc: Exception, err: Error): void {
  if (err instanceof CapnpRpcError) {
    exc.reason = err.remoteReason;
    exc.type = err.exception?.type ?? codeToExceptionType(err.code);
    if (err.remoteTrace) {
      exc.trace = err.remoteTrace;
    }
    return;
  }
  exc.reason = err.message;
  exc.type = Exception.Type.FAILED;
}
