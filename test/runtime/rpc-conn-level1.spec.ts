import { describe, test, assert as t } from "vitest";
import { Conn } from "src/rpc/conn";
import { Transport } from "src/rpc/transport";
import { Message } from "src/serialization/message";
import {
  Message as RPCMessage,
  Disembargo_Context_Which,
  Return_Which,
  CapDescriptor,
  Resolve,
} from "src/capnp/rpc";
import { Client } from "src/rpc/client";
import { Struct, ObjectSize, utils } from "src/serialization";
import { AnyStruct } from "src/serialization/pointers/struct";
import { Call } from "src/rpc/call";
import { Answer } from "src/rpc/answer";
import { ImportClient } from "src/rpc/import-client";
import { Fulfiller } from "src/rpc/fulfiller/fulfiller";
import { ImmediateAnswer } from "src/rpc/immediate-answer";
import { Registry } from "src/rpc/registry";
import { Question } from "src/rpc/question";
import { QueueClient } from "src/rpc/queue-client";
import { Method } from "src/rpc/method";
import { Pipeline } from "src/rpc/pipeline";
import { Interface } from "src/serialization/pointers/interface";
import { LocalAnswerClient } from "src/rpc/local-answer-client";
import { ErrorClient } from "src/rpc/error-client";
import { Server } from "src/rpc/server";
import { RPC_CALL_QUEUE_FULL } from "src/errors";

class TestTransport implements Transport {
  sent: RPCMessage[] = [];
  isClosed = false;
  closeCount = 0;

  sendMessage(msg: RPCMessage): void {
    this.sent.push(msg);
  }

  async recvMessage(): Promise<RPCMessage> {
    throw new Error(`recvMessage should not be called in this test`);
  }

  close(): void {
    this.isClosed = true;
    this.closeCount++;
  }
}

class LinkedTransport implements Transport {
  peer?: TestConn;
  sent: RPCMessage[] = [];

  sendMessage(msg: RPCMessage): void {
    this.sent.push(msg);
    if (this.peer) {
      this.peer.handleMessage(msg);
    }
  }

  async recvMessage(): Promise<RPCMessage> {
    throw new Error("recvMessage should not be called in this test");
  }

  close(): void {
    // no-op
  }
}

class TestConn extends Conn {
  startWork(): void {
    // Disable background recv loop; tests call handleMessage directly.
  }
}

class DummyClient implements Client {
  closed = false;

  call<P extends Struct, R extends Struct>(_call: Call<P, R>): Answer<R> {
    throw new Error(`not implemented`);
  }

  close(): void {
    this.closed = true;
  }
}

class CountingClient implements Client {
  calls = 0;
  order: number[] = [];

  call<P extends Struct, R extends Struct>(call: Call<P, R>): Answer<R> {
    this.calls++;
    const tag = (call as any).tag;
    if (typeof tag === "number") {
      this.order.push(tag);
    }
    return new Fulfiller<R>();
  }

  close(): void {
    // no-op
  }
}

class ImmediateClient implements Client {
  call<P extends Struct, R extends Struct>(_call: Call<P, R>): Answer<R> {
    const m = new Message();
    const s = m.initRoot(AnyStruct);
    return new ImmediateAnswer(s as any);
  }

  close(): void {
    // no-op
  }
}

const TEST_METHOD: Method<any, any> = {
  interfaceId: 0x4444n,
  methodId: 0,
  ParamsClass: AnyStruct as any,
  ResultsClass: AnyStruct as any,
};

class OneCapStruct extends Struct {
  static readonly _capnp = {
    displayName: "OneCapStruct",
    id: "0000000000000001",
    size: new ObjectSize(0, 1),
  };

  setCap(client: Client): void {
    const capId = this.segment.message.addCap(client);
    utils.setInterfacePointer(capId, utils.getPointer(0, this));
  }
}

describe("Conn level-1 message dispatch", () => {
  test("table lookups return null for missing first slot", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    t.equal(conn.findExport(0), null);
    t.equal(conn.findQuestion(0), null);
  });

  test("resolve with exception rejects future calls and does not echo", async () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const importClient = conn.addImport(7, true);
    const m = new Message().initRoot(RPCMessage);
    const resolve = m._initResolve();
    resolve.promiseId = 7;
    resolve._initException().reason = "broken";

    conn.handleMessage(m);

    t.equal(transport.sent.length, 0);
    try {
      await importClient.call({} as any).struct();
      throw new Error("expected resolve exception");
    } catch (error_) {
      t.ok((error_ as Error).message.includes("broken"));
    }
    try {
      await importClient.call({} as any).struct();
      throw new Error("expected resolve exception on second call");
    } catch (error_) {
      t.ok((error_ as Error).message.includes("broken"));
    }
  });

  test("resolve with cap sets forwarding client and closes it on import close", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const promiseRef = conn.addImport(7, true);
    const m = new Message().initRoot(RPCMessage);
    const resolve = m._initResolve();
    resolve.promiseId = 7;
    resolve._initCap().senderHosted = 8;

    conn.handleMessage(m);

    const importEntry = conn.imports[7];
    t.ok(importEntry);
    t.equal(importEntry.isPromise, false);
    t.ok(importEntry.rc._client instanceof ImportClient);
    const base = importEntry.rc._client as ImportClient;
    t.ok(base.resolved);
    t.ok(conn.imports[8]);

    promiseRef.close();

    // Resolve emits sender-loopback disembargo, and closing promise import
    // releases both forwarding cap and promise import.
    t.equal(transport.sent.length, 3);
    t.equal(transport.sent[0].which(), RPCMessage.DISEMBARGO);
    t.equal(transport.sent[1].which(), RPCMessage.RELEASE);
    t.equal(transport.sent[1].release.id, 8);
    t.equal(transport.sent[2].which(), RPCMessage.RELEASE);
    t.equal(transport.sent[2].release.id, 7);
  });

  test("duplicate resolve for settled import is ignored and introduced cap is released", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    conn.addImport(7, true);

    {
      const m = new Message().initRoot(RPCMessage);
      const resolve = m._initResolve();
      resolve.promiseId = 7;
      resolve._initCap().senderHosted = 8;
      conn.handleMessage(m);
    }

    // First resolve starts disembargo flow.
    t.equal(transport.sent.length, 1);
    t.equal(transport.sent[0].which(), RPCMessage.DISEMBARGO);

    {
      const m = new Message().initRoot(RPCMessage);
      const resolve = m._initResolve();
      resolve.promiseId = 7;
      resolve._initCap().senderHosted = 9;
      conn.handleMessage(m);
    }

    // Duplicate resolve should not retarget; newly introduced cap should be
    // immediately released and cleaned up.
    t.equal(transport.sent.length, 2);
    t.equal(transport.sent[1].which(), RPCMessage.RELEASE);
    t.equal(transport.sent[1].release.id, 9);
    t.equal(conn.imports[9], undefined);
  });

  test("resolve.cap starts embargo and forwards calls after receiverLoopback", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const promiseRef = conn.addImport(7, true);

    {
      const m = new Message().initRoot(RPCMessage);
      const resolve = m._initResolve();
      resolve.promiseId = 7;
      resolve._initCap().senderHosted = 8;
      conn.handleMessage(m);
    }

    t.equal(transport.sent.length, 1);
    t.equal(transport.sent[0].which(), RPCMessage.DISEMBARGO);
    const loopbackId = transport.sent[0].disembargo.context.senderLoopback;

    const call = {
      method: TEST_METHOD,
      params: new Message().initRoot(AnyStruct),
    } as any;
    promiseRef.call(call);

    // Still embargoed: no forwarded call yet.
    t.equal(
      transport.sent.filter((m) => m.which() === RPCMessage.CALL).length,
      0,
    );

    {
      const m = new Message().initRoot(RPCMessage);
      const dis = m._initDisembargo();
      dis._initTarget().importedCap = 7;
      dis._initContext().receiverLoopback = loopbackId;
      conn.handleMessage(m);
    }

    const calls = transport.sent.filter((m) => m.which() === RPCMessage.CALL);
    t.equal(calls.length, 1);
    t.equal(calls[0].call.target.which(), 0); // importedCap
    t.equal(calls[0].call.target.importedCap, 8);
  });

  test("import embargo queues calls until receiverLoopback", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const importRef = conn.addImport(7, true);
    const entry = conn.imports[7];
    const base = entry.rc._client as ImportClient;
    const counting = new CountingClient();
    base.setResolved(counting);
    const embargoId = conn.registerDisembargo(base);
    base.activateEmbargo(embargoId);

    const fakeCall = { method: {} as any, params: {} as any } as any;
    importRef.call(fakeCall);
    t.equal(counting.calls, 0);

    const m = new Message().initRoot(RPCMessage);
    const dis = m._initDisembargo();
    dis._initTarget().importedCap = 7;
    dis._initContext().receiverLoopback = embargoId;
    conn.handleMessage(m);

    t.equal(counting.calls, 1);
  });

  test("embargo flush preserves queued call order", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const importRef = conn.addImport(7, true);
    const entry = conn.imports[7];
    const base = entry.rc._client as ImportClient;
    const counting = new CountingClient();
    base.setResolved(counting);
    const embargoId = conn.registerDisembargo(base);
    base.activateEmbargo(embargoId);

    importRef.call({ method: {} as any, params: {} as any, tag: 1 } as any);
    importRef.call({ method: {} as any, params: {} as any, tag: 2 } as any);
    importRef.call({ method: {} as any, params: {} as any, tag: 3 } as any);
    t.equal(counting.calls, 0);

    const m = new Message().initRoot(RPCMessage);
    const dis = m._initDisembargo();
    dis._initTarget().importedCap = 7;
    dis._initContext().receiverLoopback = embargoId;
    conn.handleMessage(m);

    t.equal(counting.calls, 3);
    t.deepEqual(counting.order, [1, 2, 3]);
  });

  test("calls after embargo lift are passthrough", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const importRef = conn.addImport(7, true);
    const entry = conn.imports[7];
    const base = entry.rc._client as ImportClient;
    const counting = new CountingClient();
    base.setResolved(counting);
    const embargoId = conn.registerDisembargo(base);
    base.activateEmbargo(embargoId);

    importRef.call({ method: {} as any, params: {} as any, tag: 1 } as any);

    const m = new Message().initRoot(RPCMessage);
    const dis = m._initDisembargo();
    dis._initTarget().importedCap = 7;
    dis._initContext().receiverLoopback = embargoId;
    conn.handleMessage(m);

    t.deepEqual(counting.order, [1]);

    importRef.call({ method: {} as any, params: {} as any, tag: 2 } as any);
    t.deepEqual(counting.order, [1, 2]);
  });

  test("closing embargoed import rejects queued calls", async () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const importRef = conn.addImport(7, true);
    const entry = conn.imports[7];
    const base = entry.rc._client as ImportClient;
    base.setResolved(new CountingClient());
    const embargoId = conn.registerDisembargo(base);
    base.activateEmbargo(embargoId);

    const queued = importRef.call({ method: {} as any, params: {} as any } as any);
    importRef.close();

    try {
      await queued.struct();
      throw new Error("expected queued call rejection");
    } catch (error_) {
      t.ok((error_ as Error).message.includes("closed import"));
    }
  });

  test("senderPromise imports are tracked as promise imports", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const m = new Message().initRoot(RPCMessage);
    const desc = m._initResolve()._initCap();
    desc.senderPromise = 44;

    conn.clientFromCapDescriptor(desc);

    t.ok(conn.imports[44]);
    t.equal(conn.imports[44].isPromise, true);
  });

  test("resolve for unknown promise releases introduced cap immediately", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const m = new Message().initRoot(RPCMessage);
    const resolve = m._initResolve();
    resolve.promiseId = 123;
    resolve._initCap().senderHosted = 77;

    conn.handleMessage(m);

    t.equal(transport.sent.length, 1);
    t.equal(transport.sent[0].which(), RPCMessage.RELEASE);
    t.equal(transport.sent[0].release.id, 77);
    t.equal(conn.imports[77], undefined);
  });

  test("resolve for unknown promise releases introduced senderPromise import", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const m = new Message().initRoot(RPCMessage);
    const resolve = m._initResolve();
    resolve.promiseId = 123;
    resolve._initCap().senderPromise = 78;

    conn.handleMessage(m);

    t.equal(transport.sent.length, 1);
    t.equal(transport.sent[0].which(), RPCMessage.RELEASE);
    t.equal(transport.sent[0].release.id, 78);
    t.equal(conn.imports[78], undefined);
  });

  test("resolve for unknown promise releases introduced receiverHosted export ref", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const exported = new DummyClient();
    const exportId = conn.addExport(exported);
    conn.addExport(exported); // wireRefs = 2

    const m = new Message().initRoot(RPCMessage);
    const resolve = m._initResolve();
    resolve.promiseId = 123;
    resolve._initCap().receiverHosted = exportId;
    conn.handleMessage(m);

    // clientFromCapDescriptor(receiverHosted) adds a local ref and close() drops it.
    // Net wireRefs remains unchanged at 2.
    const e = conn.findExport(exportId);
    t.ok(e);
    t.equal(e!.wireRefs, 2);
  });

  test("descriptorForClient exports cross-conn in-progress pipeline as senderPromise and emits resolve.cap", async () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const other = new TestConn(new TestTransport());
    const q = other.newQuestion(TEST_METHOD);
    const pc = new Pipeline(AnyStruct as any, q as any)
      .getPipeline(Interface as any, 0)
      .client();
    const desc = new Message().initRoot(RPCMessage)._initResolve()._initCap();

    conn.descriptorForClient(desc, pc);
    t.equal(desc.which(), CapDescriptor.SENDER_PROMISE);
    const promiseId = desc.senderPromise;
    t.ok(conn.findExport(promiseId));

    const resolvedCap = new DummyClient();
    const msg = new Message();
    const out = msg.initRoot(OneCapStruct);
    out.setCap(resolvedCap);
    q.fulfill(out as any);
    await new Promise((resolve) => setTimeout(resolve, 0));

    t.ok(transport.sent.some((m) => m.which() === RPCMessage.RESOLVE));
    const resolveMsg = transport.sent.find((m) => m.which() === RPCMessage.RESOLVE)!;
    t.equal(resolveMsg.resolve.promiseId, promiseId);
    t.equal(resolveMsg.resolve.which(), Resolve.CAP);
  });

  test("descriptorForClient emits resolve.exception for rejected senderPromise", async () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const other = new TestConn(new TestTransport());
    const q = other.newQuestion(TEST_METHOD);
    void q.struct().catch(() => {});
    const pc = new Pipeline(AnyStruct as any, q as any)
      .getPipeline(Interface as any, 0)
      .client();
    const desc = new Message().initRoot(RPCMessage)._initResolve()._initCap();

    conn.descriptorForClient(desc, pc);
    const promiseId = desc.senderPromise;
    q.reject(new Error("boom"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const resolveMsg = transport.sent.find((m) => m.which() === RPCMessage.RESOLVE);
    t.ok(resolveMsg);
    t.equal(resolveMsg!.resolve.promiseId, promiseId);
    t.equal(resolveMsg!.resolve.which(), Resolve.EXCEPTION);
    t.ok(resolveMsg!.resolve.exception.reason.includes("boom"));
  });

  test("descriptorForClient reuses senderPromise export for same question+transform", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const other = new TestConn(new TestTransport());
    const q = other.newQuestion(TEST_METHOD);
    const pc = new Pipeline(AnyStruct as any, q as any)
      .getPipeline(Interface as any, 0)
      .client();
    const desc1 = new Message().initRoot(RPCMessage)._initResolve()._initCap();
    const desc2 = new Message().initRoot(RPCMessage)._initResolve()._initCap();

    conn.descriptorForClient(desc1, pc);
    conn.descriptorForClient(desc2, pc);
    t.equal(desc1.which(), CapDescriptor.SENDER_PROMISE);
    t.equal(desc2.which(), CapDescriptor.SENDER_PROMISE);
    t.equal(desc1.senderPromise, desc2.senderPromise);

    const promiseId = desc1.senderPromise;
    t.ok(conn.findExport(promiseId));

    const rel1 = new Message().initRoot(RPCMessage);
    const release1 = rel1._initRelease();
    release1.id = promiseId;
    release1.referenceCount = 1;
    conn.handleMessage(rel1);
    t.ok(conn.findExport(promiseId));

    const rel2 = new Message().initRoot(RPCMessage);
    const release2 = rel2._initRelease();
    release2.id = promiseId;
    release2.referenceCount = 1;
    conn.handleMessage(rel2);
    t.equal(conn.findExport(promiseId), null);
  });

  test("reused senderPromise emits exactly one resolve on settlement", async () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const other = new TestConn(new TestTransport());
    const q = other.newQuestion(TEST_METHOD);
    const pc = new Pipeline(AnyStruct as any, q as any)
      .getPipeline(Interface as any, 0)
      .client();
    const desc1 = new Message().initRoot(RPCMessage)._initResolve()._initCap();
    const desc2 = new Message().initRoot(RPCMessage)._initResolve()._initCap();

    conn.descriptorForClient(desc1, pc);
    conn.descriptorForClient(desc2, pc);
    t.equal(desc1.senderPromise, desc2.senderPromise);

    const msg = new Message();
    const out = msg.initRoot(OneCapStruct);
    out.setCap(new DummyClient());
    q.fulfill(out as any);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const resolves = transport.sent.filter((m) => m.which() === RPCMessage.RESOLVE);
    t.equal(resolves.length, 1);
    t.equal(resolves[0].resolve.promiseId, desc1.senderPromise);
  });

  test("different transforms on same unresolved question allocate different senderPromises", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const other = new TestConn(new TestTransport());
    const q = other.newQuestion(TEST_METHOD);

    const p1 = new Pipeline(AnyStruct as any, q as any)
      .getPipeline(Interface as any, 0)
      .client();
    const p2 = new Pipeline(AnyStruct as any, q as any)
      .getPipeline(AnyStruct as any, 0)
      .getPipeline(Interface as any, 0)
      .client();

    const d1 = new Message().initRoot(RPCMessage)._initResolve()._initCap();
    const d2 = new Message().initRoot(RPCMessage)._initResolve()._initCap();
    conn.descriptorForClient(d1, p1);
    conn.descriptorForClient(d2, p2);

    t.equal(d1.which(), CapDescriptor.SENDER_PROMISE);
    t.equal(d2.which(), CapDescriptor.SENDER_PROMISE);
    t.notEqual(d1.senderPromise, d2.senderPromise);
  });

  test("senderPromise queue overflow returns immediate call exception", async () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const other = new TestConn(new TestTransport());
    const q = other.newQuestion(TEST_METHOD);
    const pc = new Pipeline(AnyStruct as any, q as any)
      .getPipeline(Interface as any, 0)
      .client();
    const d = new Message().initRoot(RPCMessage)._initResolve()._initCap();
    conn.descriptorForClient(d, pc);
    const promiseId = d.senderPromise;

    const iface = 0xface1n;
    Registry.register(iface, {
      methods: [
        {
          interfaceId: iface,
          methodId: 0,
          ParamsClass: AnyStruct as any,
          ResultsClass: AnyStruct as any,
        },
      ],
    });

    for (let i = 0; i < 65; i++) {
      const m = new Message().initRoot(RPCMessage);
      const call = m._initCall();
      call.questionId = 5000 + i;
      call.interfaceId = iface;
      call.methodId = 0;
      call._initTarget().importedCap = promiseId;
      call._initParams();
      conn.handleMessage(m);
      const a = conn.answers[5000 + i];
      if (a) {
        void a.deferred.promise.catch(() => {});
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    const returns = transport.sent.filter((m) => m.which() === RPCMessage.RETURN);
    t.equal(returns.length, 1);
    t.equal(returns[0].return.answerId, 5000 + 64);
    t.equal(returns[0].return.which(), Return_Which.EXCEPTION);
    t.ok(returns[0].return.exception.reason.includes(RPC_CALL_QUEUE_FULL));

    for (const a of Object.values(conn.answers)) {
      void a.deferred.promise.catch(() => {});
    }
    conn.shutdown(new Error("test cleanup"));
  });

  test("reused senderPromise emits exactly one resolve.exception on rejection", async () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const other = new TestConn(new TestTransport());
    const q = other.newQuestion(TEST_METHOD);
    void q.struct().catch(() => {});
    const pc = new Pipeline(AnyStruct as any, q as any)
      .getPipeline(Interface as any, 0)
      .client();
    const d1 = new Message().initRoot(RPCMessage)._initResolve()._initCap();
    const d2 = new Message().initRoot(RPCMessage)._initResolve()._initCap();
    conn.descriptorForClient(d1, pc);
    conn.descriptorForClient(d2, pc);

    q.reject(new Error("boom"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const resolves = transport.sent.filter((m) => m.which() === RPCMessage.RESOLVE);
    t.equal(resolves.length, 1);
    t.equal(resolves[0].resolve.promiseId, d1.senderPromise);
    t.equal(resolves[0].resolve.which(), Resolve.EXCEPTION);
  });

  test("release before senderPromise settlement suppresses outgoing resolve", async () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const other = new TestConn(new TestTransport());
    const q = other.newQuestion(TEST_METHOD);
    const pc = new Pipeline(AnyStruct as any, q as any)
      .getPipeline(Interface as any, 0)
      .client();
    const desc = new Message().initRoot(RPCMessage)._initResolve()._initCap();
    conn.descriptorForClient(desc, pc);
    const promiseId = desc.senderPromise;

    const rel = new Message().initRoot(RPCMessage);
    const release = rel._initRelease();
    release.id = promiseId;
    release.referenceCount = 1;
    conn.handleMessage(rel);

    const msg = new Message();
    const out = msg.initRoot(OneCapStruct);
    out.setCap(new DummyClient());
    q.fulfill(out as any);
    await new Promise((resolve) => setTimeout(resolve, 0));

    t.equal(transport.sent.some((m) => m.which() === RPCMessage.RESOLVE), false);
  });

  test("disembargo senderLoopback echos receiverLoopback", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const m = new Message().initRoot(RPCMessage);
    const dis = m._initDisembargo();
    dis._initTarget().importedCap = 99;
    const ctx = dis._initContext();
    ctx.senderLoopback = 42;
    t.equal(ctx.which(), Disembargo_Context_Which.SENDER_LOOPBACK);

    conn.handleMessage(m);

    t.equal(transport.sent.length, 1);
    t.equal(transport.sent[0].which(), RPCMessage.DISEMBARGO);
    t.equal(
      transport.sent[0].disembargo.context.which(),
      Disembargo_Context_Which.RECEIVER_LOOPBACK,
    );
    t.equal(transport.sent[0].disembargo.context.receiverLoopback, 42);
    t.equal(transport.sent[0].disembargo.target.importedCap, 99);
  });

  test("disembargo receiverLoopback is a no-op", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const m = new Message().initRoot(RPCMessage);
    const dis = m._initDisembargo();
    dis._initTarget().importedCap = 5;
    dis._initContext().receiverLoopback = 11;

    conn.handleMessage(m);

    t.equal(transport.sent.length, 0);
  });

  test("disembargo level-3 contexts return unimplemented", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const m = new Message().initRoot(RPCMessage);
    const dis = m._initDisembargo();
    dis._initTarget().importedCap = 1;
    dis._initContext().accept = true;

    conn.handleMessage(m);

    t.equal(transport.sent.length, 1);
    t.equal(transport.sent[0].which(), RPCMessage.UNIMPLEMENTED);
    t.equal(transport.sent[0].unimplemented.which(), RPCMessage.DISEMBARGO);
  });

  test("release dispatches to export refcount release", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const c = new DummyClient();
    const id = conn.addExport(c);
    conn.addExport(c); // wireRefs = 2

    {
      const m = new Message().initRoot(RPCMessage);
      const rel = m._initRelease();
      rel.id = id;
      rel.referenceCount = 1;
      conn.handleMessage(m);
      t.notEqual(conn.findExport(id), null);
      t.equal(c.closed, false);
    }

    {
      const m = new Message().initRoot(RPCMessage);
      const rel = m._initRelease();
      rel.id = id;
      rel.referenceCount = 1;
      conn.handleMessage(m);
      t.equal(conn.findExport(id), null);
      t.equal(c.closed, true);
    }
  });

  test("closing import emits release and drops import entry", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const importClient = conn.addImport(9);

    t.ok(conn.imports[9]);
    importClient.close();

    t.equal(transport.sent.length, 1);
    t.equal(transport.sent[0].which(), RPCMessage.RELEASE);
    t.equal(transport.sent[0].release.id, 9);
    t.equal(transport.sent[0].release.referenceCount, 1);
    t.equal(conn.imports[9], undefined);
  });

  test("closing import is idempotent and does not emit duplicate release", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const importClient = conn.addImport(12);

    importClient.close();
    importClient.close();

    t.equal(transport.sent.length, 1);
    t.equal(transport.sent[0].which(), RPCMessage.RELEASE);
    t.equal(transport.sent[0].release.id, 12);
    t.equal(transport.sent[0].release.referenceCount, 1);
  });

  test("closing multi-ref import emits aggregated release count", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const importRef1 = conn.addImport(10);
    const importRef2 = conn.addImport(10);
    const importRef3 = conn.addImport(10);

    t.ok(conn.imports[10]);
    t.equal(conn.imports[10].refs, 3);
    importRef1.close();
    importRef2.close();
    importRef3.close();

    t.equal(transport.sent.length, 1);
    t.equal(transport.sent[0].which(), RPCMessage.RELEASE);
    t.equal(transport.sent[0].release.id, 10);
    t.equal(transport.sent[0].release.referenceCount, 3);
    t.equal(conn.imports[10], undefined);
  });

  test("releaseImport clamps wire release count to held refs", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    conn.error = () => {};
    conn.addImport(13);

    conn.releaseImport(13, 5);

    t.equal(transport.sent.length, 1);
    t.equal(transport.sent[0].which(), RPCMessage.RELEASE);
    t.equal(transport.sent[0].release.id, 13);
    t.equal(transport.sent[0].release.referenceCount, 1);
    t.equal(conn.imports[13], undefined);
  });

  test("return with releaseParamCaps releases question param caps by ID", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const c = new DummyClient();
    const exportId = conn.addExport(c);
    const q = conn.newQuestion();
    q.paramCaps = [exportId];
    void q.struct().catch(() => {});

    const m = new Message().initRoot(RPCMessage);
    const ret = m._initReturn();
    ret.answerId = q.id;
    ret._initException().reason = "failed";
    conn.handleMessage(m);

    t.equal(conn.findExport(exportId), null);
    t.equal(c.closed, true);
  });

  test("return.releaseParamCaps releases cap referenced in serialized params", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const importRef = conn.addImport(90);
    const paramCap = new DummyClient();

    const answer = importRef.call({
      method: {
        interfaceId: 0xabcden,
        methodId: 0,
        ParamsClass: OneCapStruct as any,
        ResultsClass: AnyStruct as any,
      },
      paramsFunc: (params: OneCapStruct) => {
        params.setCap(paramCap);
      },
    });
    void answer.struct().catch(() => {});

    const callMsg = transport.sent[0];
    t.equal(callMsg.which(), RPCMessage.CALL);
    const questionId = callMsg.call.questionId;
    const q = conn.findQuestion(questionId);
    t.ok(q);
    t.equal(q!.paramCaps.length, 1);
    const capExportId = q!.paramCaps[0];
    t.notEqual(conn.findExport(capExportId), null);

    const m = new Message().initRoot(RPCMessage);
    const ret = m._initReturn();
    ret.answerId = questionId;
    ret._initException().reason = "done";
    conn.handleMessage(m);

    t.equal(conn.findExport(capExportId), null);
    t.equal(paramCap.closed, true);
  });

  test("finish with releaseResultCaps releases answer result caps by ID", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const c = new DummyClient();
    const exportId = conn.addExport(c);
    const a = conn.insertAnswer(55);
    if (!a) {
      throw new Error("expected answer slot");
    }
    a.resultCaps = [exportId];

    const m = new Message().initRoot(RPCMessage);
    const fin = m._initFinish();
    fin.questionId = 55;
    fin.releaseResultCaps = true;
    conn.handleMessage(m);

    t.equal(conn.findExport(exportId), null);
    t.equal(c.closed, true);
  });

  test("finish.releaseResultCaps releases cap referenced in serialized results", async () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const resultCap = new DummyClient();
    const interfaceId = 0xff01n;
    const methodId = 0;

    Registry.register(interfaceId, {
      methods: [
        {
          interfaceId,
          methodId,
          ParamsClass: AnyStruct as any,
          ResultsClass: OneCapStruct as any,
        },
      ],
    });

    class ResultCapClient implements Client {
      call<P extends Struct, R extends Struct>(_call: Call<P, R>): Answer<R> {
        const msg = new Message();
        const out = msg.initRoot(OneCapStruct);
        out.setCap(resultCap);
        return new ImmediateAnswer(out as any);
      }

      close(): void {
        // no-op
      }
    }

    const targetExportId = conn.addExport(new ResultCapClient());
    const callMsg = new Message().initRoot(RPCMessage);
    const call = callMsg._initCall();
    call.questionId = 71;
    call.interfaceId = interfaceId;
    call.methodId = methodId;
    call._initTarget().importedCap = targetExportId;
    call._initParams();
    conn.handleMessage(callMsg);

    await new Promise((resolve) => setTimeout(resolve, 0));
    t.equal(transport.sent.length, 1);
    t.equal(transport.sent[0].which(), RPCMessage.RETURN);
    const answer = conn.answers[71];
    t.ok(answer);
    t.equal(answer.resultCaps.length, 1);
    const resultCapExportId = answer.resultCaps[0];
    t.notEqual(conn.findExport(resultCapExportId), null);

    const finMsg = new Message().initRoot(RPCMessage);
    const fin = finMsg._initFinish();
    fin.questionId = 71;
    fin.releaseResultCaps = true;
    conn.handleMessage(finMsg);

    t.equal(conn.findExport(resultCapExportId), null);
    t.equal(resultCap.closed, true);
  });

  test("finish for unknown answer is ignored", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const m = new Message().initRoot(RPCMessage);
    const fin = m._initFinish();
    fin.questionId = 4242;
    conn.handleMessage(m);
    t.equal(transport.sent.length, 0);
  });

  test("return.takeFromOtherQuestion resolves when source answer resolves", async () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const source = conn.insertAnswer(77);
    if (!source) {
      throw new Error("expected source answer");
    }
    void source.deferred.promise.catch(() => {});
    const redirected = conn.newQuestion();
    const redirectedPromise = redirected
      .struct()
      .then(() => {
        throw new Error("expected redirected rejection");
      })
      .catch((error_) => error_ as Error);

    {
      const m = new Message().initRoot(RPCMessage);
      const ret = m._initReturn();
      ret.answerId = redirected.id;
      ret.takeFromOtherQuestion = 77;
      conn.handleMessage(m);
    }

    source.reject(new Error("source failed"));

    const redirectedError = await redirectedPromise;
    t.ok(redirectedError.message.includes("source failed"));
    t.equal(transport.sent.length, 2);
    t.ok(transport.sent.some((m) => m.which() === RPCMessage.RETURN));
    t.ok(transport.sent.some((m) => m.which() === RPCMessage.FINISH));
  });

  test("return.takeFromOtherQuestion fulfills when source answer fulfills", async () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const source = conn.insertAnswer(88);
    if (!source) {
      throw new Error("expected source answer");
    }
    const redirected = conn.newQuestion();
    const redirectedPromise = redirected.struct();

    {
      const m = new Message().initRoot(RPCMessage);
      const ret = m._initReturn();
      ret.answerId = redirected.id;
      ret.takeFromOtherQuestion = 88;
      conn.handleMessage(m);
    }

    const msg = new Message();
    const s = msg.initRoot(AnyStruct);
    source.fulfill(s);

    const redirectedResult = await redirectedPromise;
    t.ok(redirectedResult);
    t.equal(transport.sent.length, 2);
    t.ok(transport.sent.some((m) => m.which() === RPCMessage.RETURN));
    t.ok(transport.sent.some((m) => m.which() === RPCMessage.FINISH));
  });

  test("return.resultsSentElsewhere rejects waiting question", async () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const q = conn.newQuestion();
    const wait = q
      .struct()
      .then(() => {
        throw new Error("expected rejection");
      })
      .catch((error_) => error_ as Error);

    const m = new Message().initRoot(RPCMessage);
    const ret = m._initReturn();
    ret.answerId = q.id;
    ret.resultsSentElsewhere = true;
    conn.handleMessage(m);

    const err = await wait;
    t.ok(err.message.length > 0);
    t.equal(transport.sent.length, 1);
    t.equal(transport.sent[0].which(), RPCMessage.FINISH);
  });

  test("return.canceled rejects waiting question", async () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const q = conn.newQuestion();
    const wait = q
      .struct()
      .then(() => {
        throw new Error("expected canceled rejection");
      })
      .catch((error_) => error_ as Error);

    const m = new Message().initRoot(RPCMessage);
    const ret = m._initReturn();
    ret.answerId = q.id;
    ret.canceled = true;
    conn.handleMessage(m);

    const err = await wait;
    t.ok(err.message.includes("canceled"));
    t.equal(transport.sent.length, 1);
    t.equal(transport.sent[0].which(), RPCMessage.FINISH);
  });

  test("return.noFinishNeeded skips sending finish", async () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const q = conn.newQuestion();
    const wait = q.struct();

    const msg = new Message();
    const s = msg.initRoot(AnyStruct);
    const m = new Message().initRoot(RPCMessage);
    const ret = m._initReturn();
    ret.answerId = q.id;
    ret.noFinishNeeded = true;
    const payload = ret._initResults();
    payload.content = s;
    conn.handleMessage(m);

    await wait;
    t.equal(transport.sent.length, 0);
  });

  test("incoming call with sendResultsTo.yourself returns resultsSentElsewhere", async () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const interfaceId = 0xdeadbeefn;
    Registry.register(interfaceId, {
      methods: [
        {
          interfaceId,
          methodId: 0,
          ParamsClass: AnyStruct as any,
          ResultsClass: AnyStruct as any,
        },
      ],
    });
    const exportId = conn.addExport(new ImmediateClient());

    const m = new Message().initRoot(RPCMessage);
    const call = m._initCall();
    call.questionId = 33;
    call.interfaceId = interfaceId;
    call.methodId = 0;
    call._initTarget().importedCap = exportId;
    call._initParams();
    call._initSendResultsTo().yourself = true;

    conn.handleMessage(m);
    await new Promise((resolve) => setTimeout(resolve, 0));

    t.equal(transport.sent.length, 1);
    t.equal(transport.sent[0].which(), RPCMessage.RETURN);
    t.equal(transport.sent[0].return.answerId, 33);
    t.equal(transport.sent[0].return.which(), Return_Which.RESULTS_SENT_ELSEWHERE);
  });

  test("incoming call with unsupported sendResultsTo returns unimplemented and cleans answer", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const interfaceId = 0x1111n;
    Registry.register(interfaceId, {
      methods: [
        {
          interfaceId,
          methodId: 0,
          ParamsClass: AnyStruct as any,
          ResultsClass: AnyStruct as any,
        },
      ],
    });
    const exportId = conn.addExport(new ImmediateClient());
    const m = new Message().initRoot(RPCMessage);
    const call = m._initCall();
    call.questionId = 201;
    call.interfaceId = interfaceId;
    call.methodId = 0;
    call._initTarget().importedCap = exportId;
    call._initParams();
    call._initSendResultsTo().thirdParty = new Message().initRoot(AnyStruct);

    conn.handleMessage(m);

    t.equal(transport.sent.length, 1);
    t.equal(transport.sent[0].which(), RPCMessage.UNIMPLEMENTED);
    t.equal(conn.answers[201], undefined);
  });

  test("incoming call with duplicate question id triggers shutdown", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const interfaceId = 0x9999n;
    Registry.register(interfaceId, {
      methods: [
        {
          interfaceId,
          methodId: 0,
          ParamsClass: AnyStruct as any,
          ResultsClass: AnyStruct as any,
        },
      ],
    });
    const exportId = conn.addExport(new ImmediateClient());
    const existing = conn.insertAnswer(777);
    t.ok(existing);
    void existing!.deferred.promise.catch(() => {});

    const m = new Message().initRoot(RPCMessage);
    const call = m._initCall();
    call.questionId = 777;
    call.interfaceId = interfaceId;
    call.methodId = 0;
    call._initTarget().importedCap = exportId;
    call._initParams();
    conn.handleMessage(m);

    t.equal(conn.closed, true);
    t.equal(transport.isClosed, true);
  });

  test("incoming call unknown interface/method returns unimplemented and cleans answer", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const exportId = conn.addExport(new ImmediateClient());

    {
      const m = new Message().initRoot(RPCMessage);
      const call = m._initCall();
      call.questionId = 202;
      call.interfaceId = 0x2222n;
      call.methodId = 0;
      call._initTarget().importedCap = exportId;
      call._initParams();
      conn.handleMessage(m);
      t.equal(conn.answers[202], undefined);
    }

    const iface = 0x3333n;
    Registry.register(iface, {
      methods: [],
    });
    {
      const m = new Message().initRoot(RPCMessage);
      const call = m._initCall();
      call.questionId = 203;
      call.interfaceId = iface;
      call.methodId = 99;
      call._initTarget().importedCap = exportId;
      call._initParams();
      conn.handleMessage(m);
      t.equal(conn.answers[203], undefined);
    }

    t.equal(transport.sent.length, 2);
    t.equal(transport.sent[0].which(), RPCMessage.UNIMPLEMENTED);
    t.equal(transport.sent[1].which(), RPCMessage.UNIMPLEMENTED);
  });

  test("return.results decode failure responds unimplemented and rejects question", async () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const q = conn.newQuestion();
    const wait = q
      .struct()
      .then(() => {
        throw new Error("expected decode rejection");
      })
      .catch((error_) => error_ as Error);

    const m = new Message().initRoot(RPCMessage);
    const ret = m._initReturn();
    ret.answerId = q.id;
    const payload = ret._initResults();
    payload.content = new Message().initRoot(AnyStruct);
    payload._initCapTable(1).get(0).receiverHosted = 9999;

    conn.handleMessage(m);
    const err = await wait;
    t.ok(!!err);
    t.equal(transport.sent.length, 2);
    t.equal(transport.sent[0].which(), RPCMessage.UNIMPLEMENTED);
    t.equal(transport.sent[1].which(), RPCMessage.FINISH);
  });

  test("cross-conn takeFromOtherQuestion follows source answer result", async () => {
    const ta = new LinkedTransport();
    const tb = new LinkedTransport();
    const a = new TestConn(ta);
    const b = new TestConn(tb);
    ta.peer = b;
    tb.peer = a;

    const sourceAnswerId = 10;
    const source = a.insertAnswer(sourceAnswerId);
    if (!source) {
      throw new Error("expected source answer");
    }

    // B needs matching table entries for protocol-correct replies that A sends.
    b.questions[sourceAnswerId] = new Question(b, sourceAnswerId);

    const redirected = a.newQuestion();
    const redirectedPromise = redirected.struct();
    b.insertAnswer(redirected.id);

    {
      const m = new Message().initRoot(RPCMessage);
      const ret = m._initReturn();
      ret.answerId = redirected.id;
      ret.takeFromOtherQuestion = sourceAnswerId;
      b.sendMessage(m);
    }

    const msg = new Message();
    const s = msg.initRoot(AnyStruct);
    source.fulfill(s);

    const redirectedResult = await redirectedPromise;
    t.ok(redirectedResult);
    t.ok(
      ta.sent.some(
        (m) =>
          m.which() === RPCMessage.RETURN && m.return.answerId === sourceAnswerId,
      ),
    );
    t.ok(
      ta.sent.some(
        (m) => m.which() === RPCMessage.FINISH && m.finish.questionId === redirected.id,
      ),
    );
  });

  test("question.pipelineClose sends finish and rejects pending question", async () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const q = conn.newQuestion();
    const wait = q
      .struct()
      .then(() => {
        throw new Error("expected pipeline close rejection");
      })
      .catch((error_) => error_ as Error);

    q.pipelineClose([]);

    const err = await wait;
    t.ok(err.message.includes("pipeline closed"));
    t.equal(conn.findQuestion(q.id), null);
    t.equal(transport.sent.length, 1);
    t.equal(transport.sent[0].which(), RPCMessage.FINISH);
    t.equal(transport.sent[0].finish.questionId, q.id);
  });

  test("question.cancel after start sends finish and pops question", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const q = conn.newQuestion();
    void q.struct().catch(() => {});
    q.start();

    t.equal(q.cancel(new Error("cancel")), true);
    t.equal(conn.findQuestion(q.id), null);
    t.equal(transport.sent.length, 1);
    t.equal(transport.sent[0].which(), RPCMessage.FINISH);
    t.equal(transport.sent[0].finish.questionId, q.id);
  });

  test("importClient.call serialization failure returns ErrorAnswer and pops question", async () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const importRef = conn.addImport(66);

    const answer = importRef.call({
      method: TEST_METHOD,
      paramsFunc: () => {
        throw new Error("params explode");
      },
    } as any);

    try {
      await answer.struct();
      throw new Error("expected params serialization rejection");
    } catch (error_) {
      t.ok((error_ as Error).message.includes("params explode"));
    }
    t.equal(conn.questions.filter(Boolean).length, 0);
    t.equal(transport.sent.length, 0);
  });

  test("question.pipelineCall serialization failure returns ErrorAnswer and pops question", async () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const q = conn.newQuestion(TEST_METHOD);

    const answer = q.pipelineCall(
      [],
      {
        method: TEST_METHOD,
        paramsFunc: () => {
          throw new Error("pipeline explode");
        },
      } as any,
    );

    try {
      await answer.struct();
      throw new Error("expected pipeline serialization rejection");
    } catch (error_) {
      t.ok((error_ as Error).message.includes("pipeline explode"));
    }
    // only original question remains
    t.equal(conn.questions.filter(Boolean).length, 1);
    t.equal(transport.sent.length, 0);
  });

  test("queueClient.close rejects queued local calls", async () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const counting = new CountingClient();
    const qc = new QueueClient(conn, counting, []);
    const answer = qc.pushCall({ method: {} as any, params: {} as any } as any);

    qc.close();

    try {
      await answer.struct();
      throw new Error("expected canceled queued call");
    } catch (error_) {
      t.ok(!!error_);
    }
  });

  test("shutdown rejects in-flight questions and closes transport", async () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const q = conn.newQuestion();
    const wait = q
      .struct()
      .then(() => {
        throw new Error("expected shutdown rejection");
      })
      .catch((error_) => error_ as Error);

    conn.shutdown(new Error("shutdown now"));

    const err = await wait;
    t.ok(err.message.includes("shutdown now"));
    t.equal(transport.isClosed, true);
    t.equal(conn.closed, true);
    t.equal(conn.findQuestion(q.id), null);
  });

  test("shutdown rejects embargo-queued import calls", async () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const importRef = conn.addImport(70, true);
    const entry = conn.imports[70];
    const base = entry.rc._client as ImportClient;
    base.setResolved(new CountingClient());
    const embargoId = conn.registerDisembargo(base);
    base.activateEmbargo(embargoId);

    const queued = importRef.call({ method: {} as any, params: {} as any } as any);
    const wait = queued
      .struct()
      .then(() => {
        throw new Error("expected shutdown rejection");
      })
      .catch((error_) => error_ as Error);

    conn.shutdown(new Error("shutdown now"));
    const err = await wait;
    t.ok(err.message.includes("shutdown now"));
  });

  test("shutdown rejects tail-answer waiters", async () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const source = conn.insertAnswer(91);
    if (!source) {
      throw new Error("expected source answer");
    }
    void source.deferred.promise.catch(() => {});
    const redirected = conn.newQuestion();
    const wait = redirected
      .struct()
      .then(() => {
        throw new Error("expected shutdown rejection");
      })
      .catch((error_) => error_ as Error);

    {
      const m = new Message().initRoot(RPCMessage);
      const ret = m._initReturn();
      ret.answerId = redirected.id;
      ret.takeFromOtherQuestion = 91;
      conn.handleMessage(m);
    }

    conn.shutdown(new Error("shutdown now"));
    const err = await wait;
    t.ok(err.message.includes("shutdown now"));
  });

  test("shutdown is idempotent", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    conn.shutdown(new Error("first"));
    conn.shutdown(new Error("second"));
    t.equal(conn.closed, true);
    t.equal(transport.closeCount, 1);
  });

  test("shutdown clears disembargo/import/export state", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const importRef = conn.addImport(71, true);
    const importEntry = conn.imports[71];
    const base = importEntry.rc._client as ImportClient;
    const disembargoId = conn.registerDisembargo(base);
    base.activateEmbargo(disembargoId);
    const exportId = conn.addExport(new DummyClient());

    conn.shutdown(new Error("shutdown now"));

    t.equal(Object.keys(conn.imports).length, 0);
    t.equal(Object.keys(conn.disembargoes).length, 0);
    t.equal(conn.findExport(exportId), null);
    // avoid unused local warnings in case TS narrows differently
    importRef.close();
  });

  test("question ids are reusable after shutdown", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const q = conn.newQuestion();
    void q.struct().catch(() => {});
    t.equal(q.id, 0);
    conn.shutdown(new Error("shutdown now"));
    const next = conn.questionID.next();
    t.equal(next, 0);
  });

  test("export ids are reusable after shutdown", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const id = conn.addExport(new DummyClient());
    t.equal(id, 0);
    conn.shutdown(new Error("shutdown now"));
    const next = conn.exportID.next();
    t.equal(next, 0);
  });

  test("disembargo ids are reusable after shutdown", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const importRef = conn.addImport(80, true);
    const entry = conn.imports[80];
    const base = entry.rc._client as ImportClient;
    const id = conn.registerDisembargo(base);
    t.equal(id, 0);
    conn.shutdown(new Error("shutdown now"));
    const next = conn.disembargoID.next();
    t.equal(next, 0);
    importRef.close();
  });

  test("errorClient.close is a no-op", () => {
    const ec = new ErrorClient(new Error("x"));
    ec.close();
    ec.close();
  });

  test("server.close is a no-op", () => {
    const server = new Server({}, []);
    server.close();
    server.close();
  });

  test("localAnswerClient.close closes resolved target when answer is done", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const a = conn.insertAnswer(501);
    if (!a) {
      throw new Error("expected answer slot");
    }
    const target = new DummyClient();
    const msg = new Message();
    const out = msg.initRoot(OneCapStruct);
    out.setCap(target);
    a.fulfill(out as any);

    const lac = new LocalAnswerClient(a, [{ field: 0 }]);
    lac.close();

    t.equal(target.closed, true);
  });
});
