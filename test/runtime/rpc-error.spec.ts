import { describe, test, assert as t } from "vitest";
import {
  CapnpRpcError,
  RpcProtocolError,
  RpcProtocolErrorKind,
  toException,
} from "capnp-es";
import { Exception } from "src/capnp/rpc";
import { MethodError } from "src/rpc/method-error";
import { Message } from "src/serialization/message";
import { AnyStruct } from "src/serialization/pointers/struct";

describe("CapnpRpcError", () => {
  test("maps Cap'n Proto exception types to stable codes", () => {
    const exc = new Message().initRoot(Exception);
    exc.reason = "remote connection disappeared";
    exc.trace = "remote stack";
    exc.type = Exception.Type.DISCONNECTED;

    const err = new CapnpRpcError(exc);

    t.instanceOf(err, Error);
    t.equal(err.name, "CapnpRpcError");
    t.equal(err.code, "disconnected");
    t.equal(err.remoteReason, "remote connection disappeared");
    t.equal(err.remoteTrace, "remote stack");
    t.equal(err.exception, exc);
    t.match(err.message, /remote connection disappeared/);
  });

  test("serializes typed errors back to RPC exceptions", () => {
    const err = new CapnpRpcError("not implemented here", {
      code: "unimplemented",
      remoteTrace: "local trace",
    });
    const exc = new Message().initRoot(Exception);

    toException(exc, err);

    t.equal(exc.reason, "not implemented here");
    t.equal(exc.type, Exception.Type.UNIMPLEMENTED);
    t.equal(exc.trace, "local trace");
  });

  test("protocol errors carry a discriminant", () => {
    const err = new RpcProtocolError(
      RpcProtocolErrorKind.UnknownExportId,
      "unknown export",
    );

    t.instanceOf(err, CapnpRpcError);
    t.equal(err.name, "RpcProtocolError");
    t.equal(err.kind, RpcProtocolErrorKind.UnknownExportId);
    t.equal(err.remoteReason, "unknown export");
  });

  test("method errors keep RPC exception codes", () => {
    const exc = new Message().initRoot(Exception);
    exc.reason = "old server";
    exc.type = Exception.Type.UNIMPLEMENTED;

    const err = new MethodError(
      {
        ParamsClass: AnyStruct,
        ResultsClass: AnyStruct,
        interfaceId: 1n,
        methodId: 2,
        interfaceName: "TestInterface",
        methodName: "doThing",
      },
      exc,
    );

    t.instanceOf(err, CapnpRpcError);
    t.equal(err.code, "unimplemented");
    t.equal(err.remoteReason, "old server");
    t.match(err.message, /TestInterface\.doThing/);
  });
});
