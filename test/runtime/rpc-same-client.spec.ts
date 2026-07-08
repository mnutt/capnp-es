import { describe, test, assert as t } from "vitest";
import { isSameClient, type Client } from "src/rpc/client";
import { RefCount } from "src/rpc/refcount";
import { ImportClient } from "src/rpc/import-client";
import { PromiseExportClient } from "src/rpc/promise-export-client";
import { QueueClient, callQueueSize } from "src/rpc/queue-client";
import { Fulfiller } from "src/rpc/fulfiller/fulfiller";
import { Conn } from "src/rpc/conn";
import type { Transport } from "src/rpc/transport";
import { Message as RPCMessage } from "src/capnp/rpc";
import { Struct } from "src/serialization";
import type { Call } from "src/rpc/call";
import type { Answer } from "src/rpc/answer";

class TestTransport implements Transport {
  sendMessage(_msg: RPCMessage): void {
    // no-op
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
  call<P extends Struct, R extends Struct>(_call: Call<P, R>): Answer<R> {
    throw new Error("not implemented");
  }

  close(): void {
    // no-op
  }
}

class LoopClient extends DummyClient {
  next?: Client;

  normalize(): Client | undefined {
    return this.next;
  }
}

describe("isSameClient", () => {
  test("matches identical terminal clients", () => {
    const server = new DummyClient();

    t.equal(isSameClient(server, server), true);
  });

  test("normalizes refs that share one refcount", () => {
    const server = new DummyClient();
    const [rc, ref] = RefCount.new(server, () => {});
    const ref2 = rc.ref();

    t.equal(isSameClient(ref, ref2), true);
    t.equal(isSameClient(rc, server), true);
  });

  test("normalizes resolved imports to their target", () => {
    const conn = new TestConn(new TestTransport());
    const target = new DummyClient();
    const imported = new ImportClient(conn, 12);

    imported.setResolved(target);

    t.equal(isSameClient(imported, target), true);
  });

  test("normalizes resolved promise exports to their target", () => {
    const target = new DummyClient();
    const promise = new PromiseExportClient();

    promise.resolve(target);

    t.equal(isSameClient(promise, target), true);
  });

  test("distinguishes genuinely different terminal clients", () => {
    t.equal(isSameClient(new DummyClient(), new DummyClient()), false);
  });

  test("does not normalize queue clients while calls are pending", () => {
    const conn = new TestConn(new TestTransport());
    const target = new DummyClient();
    const pendingCalls = Array.from({ length: callQueueSize }, () => ({
      call: {} as any,
      f: new Fulfiller<any>(),
    }));
    const queued = new QueueClient(conn, target, pendingCalls);

    t.equal(isSameClient(queued, target), false);
  });

  test("stops normalizing cyclic clients", () => {
    const a = new LoopClient();
    const b = new LoopClient();
    a.next = b;
    b.next = a;

    t.equal(isSameClient(a, b), false);
  });
});
