import { describe, test, assert as t } from "vitest";
import { Conn } from "src/rpc/conn";
import { Transport } from "src/rpc/transport";
import { Message } from "src/serialization/message";
import { Message as RPCMessage, Disembargo_Context_Which } from "src/capnp/rpc";
import { Client } from "src/rpc/client";
import { Struct } from "src/serialization";
import { Call } from "src/rpc/call";
import { Answer } from "src/rpc/answer";

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

describe("Conn level-1 message dispatch", () => {
  test("resolve is handled via unimplemented echo", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const m = new Message().initRoot(RPCMessage);
    const resolve = m._initResolve();
    resolve.promiseId = 7;
    resolve._initException().reason = "broken";

    conn.handleMessage(m);

    t.equal(transport.sent.length, 1);
    t.equal(transport.sent[0].which(), RPCMessage.UNIMPLEMENTED);
    t.equal(transport.sent[0].unimplemented.which(), RPCMessage.RESOLVE);
  });

  test("disembargo is handled via unimplemented echo", () => {
    const transport = new TestTransport();
    const conn = new TestConn(transport);
    const m = new Message().initRoot(RPCMessage);
    const dis = m._initDisembargo();
    dis._initTarget().importedCap = 1;
    const ctx = dis._initContext();
    ctx.senderLoopback = 42;
    t.equal(ctx.which(), Disembargo_Context_Which.SENDER_LOOPBACK);

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
});
