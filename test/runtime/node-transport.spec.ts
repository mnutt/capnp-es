import { Duplex, PassThrough } from "node:stream";
import { describe, test, assert as t } from "vitest";
import { CapnpRpcError } from "capnp-es";
import { transportFromDuplex } from "capnp-es/node";
import { Message as RPCMessage } from "src/capnp/rpc";
import { Message } from "src/serialization/message";

class MemoryDuplex extends Duplex {
  peer?: MemoryDuplex;

  _read(): void {
    // Data is pushed by the peer's _write().
  }

  _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
    this.peer?.push(Buffer.from(data));
    callback();
  }

  _final(callback: (error?: Error | null) => void): void {
    this.peer?.push(null);
    callback();
  }
}

function createDuplexPair(): [MemoryDuplex, MemoryDuplex] {
  const a = new MemoryDuplex();
  const b = new MemoryDuplex();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

function bootstrapMessage(questionId: number): {
  message: Message;
  root: RPCMessage;
} {
  const message = new Message();
  const root = message.initRoot(RPCMessage);
  root._initBootstrap().questionId = questionId;
  return { message, root };
}

describe("Node RPC transport", () => {
  test("sends stream-framed RPC messages over a Duplex", async () => {
    const [a, b] = createDuplexPair();
    const tx = transportFromDuplex(a);
    const rx = transportFromDuplex(b);
    const { root } = bootstrapMessage(123);

    tx.sendMessage(root);
    const received = await rx.recvMessage();

    t.equal(received.which(), RPCMessage.BOOTSTRAP);
    t.equal(received.bootstrap.questionId, 123);

    tx.close();
    rx.close();
  });

  test("decodes fragmented stream frames", async () => {
    const stream = new PassThrough();
    const transport = transportFromDuplex(stream);
    const { message } = bootstrapMessage(456);
    const frame = Buffer.from(message.toArrayBuffer());
    const received = transport.recvMessage();

    stream.write(frame.subarray(0, 3));
    stream.write(frame.subarray(3, 11));
    stream.write(frame.subarray(11));

    const msg = await received;
    t.equal(msg.which(), RPCMessage.BOOTSTRAP);
    t.equal(msg.bootstrap.questionId, 456);

    transport.close();
  });

  test("turns peer stream end into a typed disconnected error", async () => {
    const [a, b] = createDuplexPair();
    const transport = transportFromDuplex(b);
    const pending = transport.recvMessage();

    a.end();

    try {
      await pending;
      throw new Error("expected recvMessage() to reject");
    } catch (error_) {
      t.instanceOf(error_, CapnpRpcError);
      t.equal((error_ as CapnpRpcError).code, "disconnected");
    }
  });
});
