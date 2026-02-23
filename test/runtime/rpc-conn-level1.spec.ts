import { describe, test, assert as t } from "vitest";
import { Conn } from "src/rpc/conn";
import { Transport } from "src/rpc/transport";
import { Message } from "src/serialization/message";
import { Message as RPCMessage, Disembargo_Context_Which } from "src/capnp/rpc";
import { Client } from "src/rpc/client";
import { Struct } from "src/serialization";
import { Call } from "src/rpc/call";
import { Answer } from "src/rpc/answer";
import { ImportClient } from "src/rpc/import-client";
import { Fulfiller } from "src/rpc/fulfiller/fulfiller";

class TestTransport implements Transport {
  sent: RPCMessage[] = [];

  sendMessage(msg: RPCMessage): void {
    this.sent.push(msg);
  }

  async recvMessage(): Promise<RPCMessage> {
    throw new Error(`recvMessage should not be called in this test`);
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

describe("Conn level-1 message dispatch", () => {
  test("table lookups return null for missing first slot", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    t.equal(conn.findExport(0), null);
    t.equal(conn.findQuestion(0), null);
  });

  test("resolve with exception updates import and does not echo", async () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const importClient = conn.addImport(7);
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

  test("return.takeFromOtherQuestion resolves when source question resolves", async () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const source = conn.newQuestion();
    const redirected = conn.newQuestion();
    void source.struct().catch(() => {});
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
      ret.takeFromOtherQuestion = source.id;
      conn.handleMessage(m);
    }

    {
      const m = new Message().initRoot(RPCMessage);
      const ret = m._initReturn();
      ret.answerId = source.id;
      ret._initException().reason = "source failed";
      conn.handleMessage(m);
    }

    const redirectedError = await redirectedPromise;
    t.ok(redirectedError.message.includes("source failed"));
    t.equal(transport.sent.length, 2);
    t.equal(transport.sent[0].which(), RPCMessage.FINISH);
    t.equal(transport.sent[1].which(), RPCMessage.FINISH);
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
});
