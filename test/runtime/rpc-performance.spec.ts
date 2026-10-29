import { describe, test, assert as t } from "vitest";
import { Conn } from "src/rpc/conn";
import type { Transport } from "src/rpc/transport";
import { Message } from "src/serialization/message";
import { utils } from "src/serialization";
import { Payload } from "src/capnp/rpc";

class TestConn extends Conn {
  override startWork(): void {
    // Exercise message handling directly, without a background receive loop.
  }
}

function createConn(): TestConn {
  const transport: Transport = {
    sendMessage() {},
    async recvMessage() {
      throw new Error("unexpected receive");
    },
    close() {},
  };
  return new TestConn(transport);
}

describe("RPC capability-table reads", () => {
  test.each([false, true])(
    "does not grow or modify a received empty table (explicit: %s)",
    (explicit) => {
      const built = new Message();
      const payload = built.initRoot(Payload);
      if (explicit) payload._initCapTable(0);
      const bytes = built.toArrayBuffer();
      const received = new Message(bytes, false).getRoot(Payload);
      const buffer = received.segment.buffer;
      const byteLength = received.segment.byteLength;
      const conn = createConn();
      try {
        conn.populateMessageCapTable(received);
        t.deepEqual(conn.collectPayloadSenderHosted(received), []);
        t.strictEqual(received.segment.buffer, buffer);
        t.equal(received.segment.byteLength, byteLength);
        t.deepEqual(received.segment.message.toArrayBuffer(), bytes);
        t.equal(received.segment.message._capnp.capTable, undefined);
        t.equal(received._hasCapTable(), explicit);
      } finally {
        conn.shutdown();
      }
    },
  );

  test("retains descriptor positions and sender-hosted bookkeeping", () => {
    const payload = new Message().initRoot(Payload);
    const table = payload._initCapTable(2);
    table.get(0).none = true;
    table.get(1).senderHosted = 42;
    const conn = createConn();
    try {
      conn.populateMessageCapTable(payload);
      t.lengthOf(payload.segment.message._capnp.capTable!, 2);
      t.isNull(payload.segment.message._capnp.capTable![0]);
      t.ok(payload.segment.message._capnp.capTable![1]);
      t.equal(conn.imports[42].refs, 1);
      t.deepEqual(conn.collectPayloadSenderHosted(payload), [42]);
    } finally {
      conn.shutdown();
    }
  });

  test("still rejects an invalid descriptor in a present table", () => {
    const payload = new Message().initRoot(Payload);
    const desc = payload._initCapTable(1).get(0);
    utils.setUint16(0, 0xffff, desc);
    const conn = createConn();
    try {
      t.throws(
        () => conn.populateMessageCapTable(payload),
        /Unknown cap descriptor/,
      );
    } finally {
      conn.shutdown();
    }
  });
});
