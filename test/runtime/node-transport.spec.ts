import { Duplex, PassThrough } from "node:stream";
import { describe, test, expect, assert as t } from "vitest";
import { CapnpRpcError } from "capnp-es";
import {
  copyDataToBuffer,
  messageToBuffer,
  transportFromDuplex,
  viewDataAsBuffer,
} from "capnp-es/node";
import { Message as RPCMessage } from "src/capnp/rpc";
import { Message } from "src/serialization/message";
import { MultiSegmentArena } from "src/serialization/arena/multi-segment-arena";
import { TestAllTypes } from "test/fixtures/test";

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

class RecordingDuplex extends Duplex {
  readonly chunks: Buffer[] = [];

  _read(): void {
    // Data is captured by _write().
  }

  _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding),
    );
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

  test("coalesces small stream frame chunks", () => {
    const stream = new RecordingDuplex();
    const transport = transportFromDuplex(stream);
    const { message, root } = bootstrapMessage(321);

    transport.sendMessage(root);

    t.lengthOf(stream.chunks, 1);
    t.deepEqual(
      Buffer.concat(stream.chunks),
      Buffer.from(message.toArrayBuffer()),
    );

    transport.close();
  });

  test("writes large stream frames without concatenating segment chunks", () => {
    const stream = new RecordingDuplex();
    const transport = transportFromDuplex(stream);
    const message = new Message();
    const root = message.initRoot(RPCMessage);
    const call = root._initCall();
    call.questionId = 654;
    call._initParams()._initCapTable(200);

    transport.sendMessage(root);

    t.isAbove(stream.chunks.length, 1);
    t.deepEqual(
      Buffer.concat(stream.chunks),
      Buffer.from(message.toArrayBuffer()),
    );

    transport.close();
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

  test.each([1, 7, 64, 65536])(
    "decodes multi-segment and coalesced frames in %i-byte chunks",
    async (chunkSize) => {
      const stream = new PassThrough();
      const transport = transportFromDuplex(stream);
      try {
        const first = bootstrapMessage(10).message;
        const second = new Message(
          new MultiSegmentArena([new ArrayBuffer(64)]),
        );
        const call = second.initRoot(RPCMessage)._initCall();
        call.questionId = 20;
        call._initParams()._initCapTable(200);
        t.isAbove(second._capnp.segments.length, 1);
        const third = bootstrapMessage(30).message;
        const bytes = Buffer.concat(
          [first, second, third].map((message) =>
            Buffer.from(message.toArrayBuffer()),
          ),
        );
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          stream.write(bytes.subarray(offset, offset + chunkSize));
        }
        t.equal((await transport.recvMessage()).bootstrap.questionId, 10);
        const received = await transport.recvMessage();
        t.equal(received.call.questionId, 20);
        t.equal(received.call.params.capTable.length, 200);
        t.equal((await transport.recvMessage()).bootstrap.questionId, 30);
      } finally {
        transport.close();
      }
    },
  );

  test("rejects invalid segment counts even when the header is fragmented", async () => {
    const stream = new PassThrough();
    const transport = transportFromDuplex(stream);
    const pending = transport.recvMessage();
    const bytes = Buffer.alloc(8);
    bytes.writeUInt32LE(4096);
    stream.write(bytes.subarray(0, 3));
    stream.write(bytes.subarray(3));
    await expect(pending).rejects.toThrow(/invalid segment count/);
    t.isTrue(stream.destroyed);
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

  test("aborts an active Duplex transport", async () => {
    const [a, b] = createDuplexPair();
    const controller = new AbortController();
    const transport = transportFromDuplex(b, { signal: controller.signal });
    const pending = transport.recvMessage();

    controller.abort();

    try {
      await pending;
      throw new Error("expected recvMessage() to reject");
    } catch (error_) {
      t.instanceOf(error_, CapnpRpcError);
      t.equal((error_ as CapnpRpcError).code, "disconnected");
    }

    t.equal(b.destroyed, true);
    a.destroy();
  });

  test("serializes messages to Buffer copies", () => {
    const { message } = bootstrapMessage(789);
    const buffer = messageToBuffer(message);

    t.instanceOf(buffer, Buffer);
    t.deepEqual(buffer, Buffer.from(message.toArrayBuffer()));

    buffer[0] = 0xff;
    t.notEqual(messageToBuffer(message)[0], 0xff);
  });

  test("copies and views Data pointers as Buffers", () => {
    const message = new Message();
    const root = message.initRoot(TestAllTypes);
    const data = root._initDataField(3);
    data.copyBuffer(new Uint8Array([1, 2, 3]));

    const copy = copyDataToBuffer(data);
    const view = viewDataAsBuffer(data);

    copy[0] = 9;
    t.equal(data.get(0), 1);

    view[0] = 8;
    t.equal(data.get(0), 8);
  });
});
