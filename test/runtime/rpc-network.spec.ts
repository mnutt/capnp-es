import { describe, test, assert as t } from "vitest";
import { Message as RPCMessage } from "src/capnp/rpc";
import { Conn } from "src/rpc/conn";
import {
  Level3NetworkAdapter,
  VatConnectionManager,
  withLevel3AdapterTracing,
} from "src/rpc/network";
import { Transport } from "src/rpc/transport";

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
  startWork(): void {
    // Disable background recv loop in tests.
  }
}

describe("rpc network abstractions", () => {
  test("adapter tracing emits start/success events", async () => {
    const events: string[] = [];
    const adapter: Level3NetworkAdapter<string, string, string, string> = {
      introduceTo: () => ({
        sendToRecipient: "third-cap",
        sendToTarget: "recipient",
      }),
      connectToIntroduced: () => ({
        connection: "conn-c",
        provisionId: "prov-1",
      }),
      acceptIntroducedConnection: () => "conn-a",
    };

    const traced = withLevel3AdapterTracing(adapter, (event) => {
      events.push(event.type);
    });

    await traced.introduceTo("recipient-conn");
    await traced.connectToIntroduced("third-cap");
    await traced.acceptIntroducedConnection("recipient");

    t.deepEqual(events, [
      "introduce_to_start",
      "introduce_to_success",
      "connect_to_introduced_start",
      "connect_to_introduced_success",
      "accept_introduced_start",
      "accept_introduced_success",
    ]);
  });

  test("adapter tracing emits error events and preserves failures", async () => {
    const events: string[] = [];
    const adapter: Level3NetworkAdapter<string, string, string, string> = {
      introduceTo: () => {
        throw new Error("bad intro");
      },
      connectToIntroduced: () => ({
        connection: "unused",
        provisionId: "unused",
      }),
      acceptIntroducedConnection: () => "unused",
    };
    const traced = withLevel3AdapterTracing(adapter, (event) => {
      events.push(event.type);
    });

    try {
      await traced.introduceTo("recipient-conn");
      throw new Error("expected introduction failure");
    } catch (error_) {
      t.ok((error_ as Error).message.includes("bad intro"));
    }

    t.deepEqual(events, ["introduce_to_start", "introduce_to_error"]);
  });

  test("manager reuses existing connection for same vat", async () => {
    let connects = 0;
    const manager = new VatConnectionManager<string>({
      connect: () => {
        connects++;
        return new TestConn(new TestTransport());
      },
    });

    const a = await manager.get("vat-a");
    const b = await manager.get("vat-a");
    t.equal(a, b);
    t.equal(connects, 1);
    t.equal(manager.size, 1);
  });

  test("manager deduplicates concurrent connect for same vat", async () => {
    let connects = 0;
    const manager = new VatConnectionManager<string>({
      connect: async () => {
        connects++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return new TestConn(new TestTransport());
      },
    });

    const [a, b] = await Promise.all([manager.get("vat-a"), manager.get("vat-a")]);
    t.equal(a, b);
    t.equal(connects, 1);
  });

  test("manager close and closeAll shutdown tracked connections", async () => {
    const manager = new VatConnectionManager<string>({
      connect: () => new TestConn(new TestTransport()),
    });

    const a = await manager.get("vat-a");
    const b = await manager.get("vat-b");
    t.equal(a.closed, false);
    t.equal(b.closed, false);

    manager.close("vat-a");
    t.equal(a.closed, true);
    t.equal(b.closed, false);
    t.equal(manager.has("vat-a"), false);

    manager.closeAll();
    t.equal(b.closed, true);
    t.equal(manager.size, 0);
  });
});
