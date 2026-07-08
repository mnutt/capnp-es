import { describe, test, assert as t } from "vitest";
import { CallQueue } from "src/rpc/call-queue";
import { Client } from "src/rpc/client";
import { Call } from "src/rpc/call";
import { Answer } from "src/rpc/answer";
import { Fulfiller } from "src/rpc/fulfiller/fulfiller";
import { Message } from "src/serialization/message";
import { Struct, ObjectSize } from "src/serialization";
import { RPC_CALL_QUEUE_FULL } from "src/errors";

class TinyStruct extends Struct {
  static readonly _capnp = {
    displayName: "TinyStruct",
    id: "0000000000001002",
    size: new ObjectSize(0, 0),
  };
}

class RecordingClient implements Client {
  calls: number[] = [];

  call<P extends Struct, R extends Struct>(call: Call<P, R>): Answer<R> {
    this.calls.push((call as any).tag);
    const f = new Fulfiller<R>();
    f.tryFulfill(new Message().initRoot(TinyStruct) as any);
    return f;
  }

  close(): void {
    // no-op
  }
}

const METHOD = {
  interfaceId: 0x1001n,
  methodId: 0,
  ParamsClass: TinyStruct as any,
  ResultsClass: TinyStruct as any,
};

function makeCall(tag: number): Call<TinyStruct, TinyStruct> {
  return {
    method: METHOD,
    params: new Message().initRoot(TinyStruct),
    tag,
  } as any;
}

function expectRejection(promise: Promise<unknown>): Promise<Error> {
  return promise.then(
    () => {
      throw new Error("expected rejection");
    },
    (error_) => error_ as Error,
  );
}

describe("CallQueue", () => {
  test("flushTo delivers calls in FIFO order", async () => {
    const queue = new CallQueue();
    const a = queue.push(makeCall(1));
    const b = queue.push(makeCall(2));
    const c = queue.push(makeCall(3));
    const client = new RecordingClient();

    queue.flushTo(client);

    t.deepEqual(client.calls, [1, 2, 3]);
    t.equal(queue.length, 0);
    await a.struct();
    await b.struct();
    await c.struct();
  });

  test("cap enforcement rejects the N+1 call", async () => {
    const queue = new CallQueue(2);
    queue.push(makeCall(1));
    queue.push(makeCall(2));

    const overflow = queue.push(makeCall(3));
    try {
      overflow.struct();
      throw new Error("expected overflow to throw");
    } catch (error_) {
      t.equal((error_ as Error).message, RPC_CALL_QUEUE_FULL);
    }
    t.equal(queue.length, 2);
  });

  test("rejectAll rejects every queued call", async () => {
    const queue = new CallQueue();
    const a = queue.push(makeCall(1));
    const b = queue.push(makeCall(2));
    const aErr = expectRejection(a.struct());
    const bErr = expectRejection(b.struct());

    queue.rejectAll(new Error("queue closed"));

    t.match((await aErr).message, /queue closed/);
    t.match((await bErr).message, /queue closed/);
    t.equal(queue.length, 0);
  });

  test("flushTo handles disembargo slots in order with calls", () => {
    const queue = new CallQueue();
    const target = {} as any;
    const client = new RecordingClient();
    const order: string[] = [];
    client.call = ((call: any) => {
      order.push(`call:${call.tag}`);
      const f = new Fulfiller<any>();
      f.tryFulfill(new Message().initRoot(TinyStruct));
      return f;
    }) as any;

    queue.push(makeCall(1));
    t.equal(queue.pushDisembargo(7, target), true);
    queue.push(makeCall(2));

    queue.flushTo(client, (id) => {
      order.push(`embargo:${id}`);
    });

    t.deepEqual(order, ["call:1", "embargo:7", "call:2"]);
  });
});
