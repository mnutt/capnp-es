import { describe, test, assert as t } from "vitest";
import { CapnpRpcError, toException } from "capnp-es";
import { Exception } from "src/capnp/rpc";
import { MethodError } from "src/rpc/method-error";
import { Message } from "src/serialization/message";
import { AnyStruct } from "src/serialization/pointers/struct";
import { format } from "src/util";
import { RPC_ERROR, RPC_METHOD_ERROR } from "src/errors";

const method = {
  ParamsClass: AnyStruct,
  ResultsClass: AnyStruct,
  interfaceId: 1n,
  methodId: 2,
  interfaceName: "TestInterface",
  methodName: "doThing",
};

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

  test("preserves error messages, names, and captured stacks", () => {
    const reasons = ["", "failed", "100% %s %d", "é🦀\nremote failure"];
    for (const reason of reasons) {
      const exc = new Message().initRoot(Exception);
      exc.reason = reason;
      exc.trace = "remote trace";
      exc.type = Exception.Type.OVERLOADED;
      for (const input of [reason, exc]) {
        const err =
          typeof input === "string"
            ? new CapnpRpcError(input)
            : new CapnpRpcError(input);
        const methodError = new MethodError(method, input);
        t.equal(err.message, format(RPC_ERROR, reason));
        t.equal(
          methodError.message,
          format(
            RPC_METHOD_ERROR,
            method.interfaceName,
            method.methodName,
            reason,
          ),
        );
        for (const error of [err, methodError]) {
          t.instanceOf(error, Error);
          t.equal(error.remoteReason, reason);
          t.equal(
            error.code,
            typeof input === "string" ? "failed" : "overloaded",
          );
          t.equal(error.exception, typeof input === "string" ? undefined : exc);
          t.equal(
            error.remoteTrace,
            typeof input === "string" ? undefined : "remote trace",
          );
          t.equal(String(error), `${error.name}: ${error.message}`);
          t.ok(error.stack?.startsWith(String(error)));
          t.include(error.stack!, "rpc-error.spec.ts");
          t.isFalse(
            Object.prototype.propertyIsEnumerable.call(error, "message"),
          );
        }
        t.equal(err.name, "CapnpRpcError");
        t.equal(methodError.name, "MethodError");
        t.equal(methodError.method, method);
      }
    }
  });

  test("keeps optional method names and mutable metadata in error messages", () => {
    const unnamed = {
      ...method,
      interfaceName: undefined,
      methodName: undefined,
    };
    t.equal(
      new MethodError(unnamed, "failed").message,
      format(RPC_METHOD_ERROR, undefined, undefined, "failed"),
    );
    const mutable = { ...method };
    new MethodError(mutable, "before");
    mutable.interfaceName = "RenamedInterface";
    mutable.methodName = "renamedMethod";
    t.equal(
      new MethodError(mutable, "after").message,
      format(
        RPC_METHOD_ERROR,
        mutable.interfaceName,
        mutable.methodName,
        "after",
      ),
    );
  });

  test("preserves typed error options and the standard cause property", () => {
    const cause = new Error("underlying error");
    const exc = new Message().initRoot(Exception);
    const err = new CapnpRpcError("fallback", {
      code: "disconnected",
      remoteReason: "",
      remoteTrace: "remote trace",
      exception: exc,
      cause,
    });
    t.equal(err.message, format(RPC_ERROR, ""));
    t.equal(err.code, "disconnected");
    t.equal(err.remoteReason, "");
    t.equal(err.remoteTrace, "remote trace");
    t.equal(err.exception, exc);
    t.equal(err.cause, cause);
    t.isFalse(Object.prototype.propertyIsEnumerable.call(err, "cause"));
    t.notProperty(new CapnpRpcError("failed"), "cause");
  });
});
