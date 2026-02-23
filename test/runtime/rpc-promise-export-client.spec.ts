import { describe, test, assert as t } from "vitest";
import { PromiseExportClient } from "src/rpc/promise-export-client";
import { Client } from "src/rpc/client";
import { Call } from "src/rpc/call";
import { Answer } from "src/rpc/answer";
import { Struct, ObjectSize } from "src/serialization";
import { Fulfiller } from "src/rpc/fulfiller/fulfiller";
import { Message } from "src/serialization/message";

class TinyStruct extends Struct {
  static readonly _capnp = {
    displayName: "TinyStruct",
    id: "0000000000001001",
    size: new ObjectSize(0, 0),
  };
}

class CountingClient implements Client {
  calls = 0;

  call<P extends Struct, R extends Struct>(_call: Call<P, R>): Answer<R> {
    this.calls++;
    return new Fulfiller<R>();
  }

  close(): void {
    // no-op
  }
}

const METHOD = {
  interfaceId: 0x1000n,
  methodId: 0,
  ParamsClass: TinyStruct as any,
  ResultsClass: TinyStruct as any,
};

function makeParams(): TinyStruct {
  return new Message().initRoot(TinyStruct);
}

describe("PromiseExportClient", () => {
  test("queues unresolved calls and forwards after resolve", () => {
    const p = new PromiseExportClient();
    const downstream = new CountingClient();
    p.call({
      method: METHOD,
      params: makeParams(),
    } as any);
    p.call({
      method: METHOD,
      params: makeParams(),
    } as any);
    t.equal(downstream.calls, 0);
    p.resolve(downstream);
    t.equal(downstream.calls, 2);
  });

  test("reject rejects queued answers", async () => {
    const p = new PromiseExportClient();
    const ans = p.call({
      method: METHOD,
      params: makeParams(),
    } as any);
    const wait = ans
      .struct()
      .then(() => {
        throw new Error("expected rejection");
      })
      .catch((error_) => error_ as Error);
    p.reject(new Error("failed"));
    const err = await wait;
    t.ok(err.message.includes("failed"));
  });

  test("close rejects queued answers and future calls", async () => {
    const p = new PromiseExportClient();
    const queued = p.call({
      method: METHOD,
      params: makeParams(),
    } as any);
    const waitQueued = queued
      .struct()
      .then(() => {
        throw new Error("expected queued rejection");
      })
      .catch((error_) => error_ as Error);

    p.close();
    const queuedErr = await waitQueued;
    t.ok(queuedErr.message.includes("closed"));

    const later = p.call({
      method: METHOD,
      params: makeParams(),
    } as any);
    try {
      await later.struct();
      throw new Error("expected later call rejection");
    } catch (error_) {
      t.ok((error_ as Error).message.includes("closed"));
    }
  });
});
