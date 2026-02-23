import { describe, test, assert as t } from "vitest";
import { Conn } from "src/rpc/conn";
import { Transport } from "src/rpc/transport";
import { Message } from "src/serialization/message";
import {
  Message as RPCMessage,
  Disembargo_Context_Which,
  Return_Which,
} from "src/capnp/rpc";
import { Client } from "src/rpc/client";
import { Struct } from "src/serialization";
import { AnyStruct } from "src/serialization/pointers/struct";
import { Call } from "src/rpc/call";
import { Answer } from "src/rpc/answer";
import { ImportClient } from "src/rpc/import-client";
import { Fulfiller } from "src/rpc/fulfiller/fulfiller";
import { ImmediateAnswer } from "src/rpc/immediate-answer";
import { Registry } from "src/rpc/registry";
import { Question } from "src/rpc/question";
import { QueueClient } from "src/rpc/queue-client";

class TestTransport implements Transport {
  sent: RPCMessage[] = [];
  isClosed = false;

  sendMessage(msg: RPCMessage): void {
    this.sent.push(msg);
  }

  async recvMessage(): Promise<RPCMessage> {
    throw new Error(`recvMessage should not be called in this test`);
  }

  close(): void {
    this.isClosed = true;
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
});
