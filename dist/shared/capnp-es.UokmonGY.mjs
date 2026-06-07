import { M as Message } from './capnp-es.BbvJItGh.mjs';
import { M as MethodError, c as copyCall, F as Fulfiller } from './capnp-es.CpncuNn1.mjs';
import { E as ErrorAnswer } from './capnp-es.d92Owwob.mjs';
import { R as RPC_METHOD_NOT_IMPLEMENTED } from './capnp-es.DQO_cvul.mjs';

const disposeSymbol = Symbol.for("capnp-es.dispose");
class Server {
  constructor(target, methods) {
    this.target = target;
    this.methods = methods;
    for (const method of methods) {
      this.#methodsById.set(methodKey(method.interfaceId, method.methodId), method);
    }
  }
  #methodsById = /* @__PURE__ */ new Map();
  startCall(call) {
    const msg = new Message();
    const results = msg.initRoot(call.method.ResultsClass);
    void (async () => {
      try {
        await call.serverMethod.impl.call(this.target, call.params, results);
        call.answer.fulfill(results);
      } catch (error_) {
        try {
          call.answer.reject(error_);
        } catch {
        }
      }
    })();
  }
  call(call) {
    const serverMethod = this.#methodsById.get(
      methodKey(call.method.interfaceId, call.method.methodId)
    );
    if (!serverMethod) {
      return new ErrorAnswer(
        new MethodError(call.method, RPC_METHOD_NOT_IMPLEMENTED)
      );
    }
    const serverCall = {
      ...copyCall(call),
      answer: new Fulfiller(),
      serverMethod
    };
    this.startCall(serverCall);
    return serverCall.answer;
  }
  close() {
    const dispose = this.target?.[disposeSymbol];
    if (typeof dispose !== "function") {
      return;
    }
    try {
      void Promise.resolve(dispose.call(this.target)).catch((err) => {
        console.error("Error disposing capnp server target:", err);
      });
    } catch (err) {
      console.error("Error disposing capnp server target:", err);
    }
  }
}
function methodKey(interfaceId, methodId) {
  return `${interfaceId}:${methodId}`;
}

export { Server as S };
