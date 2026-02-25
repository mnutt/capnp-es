import { describe, test, assert as t } from "vitest";
import { Conn } from "src/rpc/conn";
import { Message } from "src/serialization/message";
import { Message as RPCMessage } from "src/capnp/rpc";
import type { Client } from "src/rpc/client";
import type { Transport } from "src/rpc/transport";
import { Struct, ObjectSize, utils } from "src/serialization";
import { AnyStruct } from "src/serialization/pointers/struct";
import { ImmediateAnswer } from "src/rpc/immediate-answer";
import { Registry } from "src/rpc/registry";

class TestTransport implements Transport {
  sent: RPCMessage[] = [];

  sendMessage(msg: RPCMessage): void {
    this.sent.push(msg);
  }

  async recvMessage(): Promise<RPCMessage> {
    throw new Error("recvMessage should not be called in this test");
  }

  close(): void {
    // no-op
  }
}

class TestConn extends Conn {
  override startWork(): void {
    // Disable background recv loop; tests call handleMessage directly.
  }
}

class DummyClient implements Client {
  closed = false;

  call<P extends Struct, R extends Struct>(_call: any): any {
    throw new Error("not implemented");
  }

  close(): void {
    this.closed = true;
  }
}

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

describe("sandstorm release bookkeeping", () => {
  test("server Return uses releaseParamCaps=false on successful calls", async () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const interfaceId = 0x7ff1n;
    const methodId = 0;

    Registry.register(interfaceId, {
      methods: [
        {
          interfaceId,
          methodId,
          ParamsClass: AnyStruct as any,
          ResultsClass: AnyStruct as any,
        },
      ],
    });

    class OkClient implements Client {
      call<P extends Struct, R extends Struct>(_call: any): any {
        return new ImmediateAnswer(new Message().initRoot(AnyStruct) as any);
      }

      close(): void {
        // no-op
      }
    }

    const targetExportId = conn.addExport(new OkClient());
    const callMsg = new Message().initRoot(RPCMessage);
    const call = callMsg._initCall();
    call.questionId = 7001;
    call.interfaceId = interfaceId;
    call.methodId = methodId;
    call._initTarget().importedCap = targetExportId;
    call._initParams();
    conn.handleMessage(callMsg);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const ret = transport.sent.find((m) => m.which() === RPCMessage.RETURN);
    t.ok(ret);
    t.equal(ret!.return.answerId, 7001);
    t.equal(ret!.return.releaseParamCaps, false);
  });

  test("server Return uses releaseParamCaps=false on failed calls", async () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const interfaceId = 0x7ff2n;
    const methodId = 0;

    Registry.register(interfaceId, {
      methods: [
        {
          interfaceId,
          methodId,
          ParamsClass: AnyStruct as any,
          ResultsClass: AnyStruct as any,
        },
      ],
    });

    class FailingClient implements Client {
      call<P extends Struct, R extends Struct>(_call: any): any {
        throw new Error("boom");
      }

      close(): void {
        // no-op
      }
    }

    const targetExportId = conn.addExport(new FailingClient());
    const callMsg = new Message().initRoot(RPCMessage);
    const call = callMsg._initCall();
    call.questionId = 7002;
    call.interfaceId = interfaceId;
    call.methodId = methodId;
    call._initTarget().importedCap = targetExportId;
    call._initParams();
    conn.handleMessage(callMsg);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const ret = transport.sent.find((m) => m.which() === RPCMessage.RETURN);
    t.ok(ret);
    t.equal(ret!.return.answerId, 7002);
    t.equal(ret!.return.releaseParamCaps, false);
    t.equal(ret!.return.exception.reason, "boom");
  });

  test("return.releaseParamCaps releases only the matching question's exported cap", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const importRef = conn.addImport(90);
    const capA = new DummyClient();
    const capB = new DummyClient();

    const answerA = importRef.call({
      method: {
        interfaceId: 0xabcden,
        methodId: 0,
        ParamsClass: OneCapStruct as any,
        ResultsClass: AnyStruct as any,
      },
      paramsFunc: (params: OneCapStruct) => {
        params.setCap(capA);
      },
    });
    void answerA.struct().catch(() => {});

    const answerB = importRef.call({
      method: {
        interfaceId: 0xabcdn,
        methodId: 0,
        ParamsClass: OneCapStruct as any,
        ResultsClass: AnyStruct as any,
      },
      paramsFunc: (params: OneCapStruct) => {
        params.setCap(capB);
      },
    });
    void answerB.struct().catch(() => {});

    const qidA = transport.sent[0].call.questionId;
    const qidB = transport.sent[1].call.questionId;
    const exportA = conn.findQuestion(qidA)!.paramCaps[0];
    const exportB = conn.findQuestion(qidB)!.paramCaps[0];

    {
      const m = new Message().initRoot(RPCMessage);
      const ret = m._initReturn();
      ret.answerId = qidA;
      ret._initException().reason = "done";
      conn.handleMessage(m);
    }

    t.equal(conn.findExport(exportA), null);
    t.equal(capA.closed, true);
    t.notEqual(conn.findExport(exportB), null);
    t.equal(capB.closed, false);

    {
      const m = new Message().initRoot(RPCMessage);
      const ret = m._initReturn();
      ret.answerId = qidB;
      ret._initException().reason = "done";
      conn.handleMessage(m);
    }

    t.equal(conn.findExport(exportB), null);
    t.equal(capB.closed, true);
  });

  test("finish.releaseResultCaps releases only the matching answer's result cap", async () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const resultCapA = new DummyClient();
    const resultCapB = new DummyClient();
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
      private next: DummyClient;

      constructor(next: DummyClient) {
        this.next = next;
      }

      call<P extends Struct, R extends Struct>(_call: any): any {
        const msg = new Message();
        const out = msg.initRoot(OneCapStruct);
        out.setCap(this.next);
        return new ImmediateAnswer(out as any);
      }

      close(): void {
        // no-op
      }
    }

    const callWithResultCap = async (
      questionId: number,
      cap: DummyClient,
    ): Promise<number> => {
      const targetExportId = conn.addExport(new ResultCapClient(cap));
      const callMsg = new Message().initRoot(RPCMessage);
      const call = callMsg._initCall();
      call.questionId = questionId;
      call.interfaceId = interfaceId;
      call.methodId = methodId;
      call._initTarget().importedCap = targetExportId;
      call._initParams();
      conn.handleMessage(callMsg);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const answer = conn.answers[questionId];
      t.ok(answer);
      return answer!.resultCaps[0];
    };

    const exportA = await callWithResultCap(71, resultCapA);
    const exportB = await callWithResultCap(72, resultCapB);
    t.notEqual(conn.findExport(exportA), null);
    t.notEqual(conn.findExport(exportB), null);

    {
      const finMsg = new Message().initRoot(RPCMessage);
      const fin = finMsg._initFinish();
      fin.questionId = 71;
      fin.releaseResultCaps = true;
      conn.handleMessage(finMsg);
    }

    t.equal(conn.findExport(exportA), null);
    t.equal(resultCapA.closed, true);
    t.notEqual(conn.findExport(exportB), null);
    t.equal(resultCapB.closed, false);

    {
      const finMsg = new Message().initRoot(RPCMessage);
      const fin = finMsg._initFinish();
      fin.questionId = 72;
      fin.releaseResultCaps = true;
      conn.handleMessage(finMsg);
    }

    t.equal(conn.findExport(exportB), null);
    t.equal(resultCapB.closed, true);
  });
});
