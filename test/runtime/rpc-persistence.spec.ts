import { describe, test, assert as t } from "vitest";
import {
  JsonSturdyRefCodec,
  MalformedSturdyRefError,
  MapRestorerLookup,
  RealmTransformRegistry,
  UnknownSturdyRefError,
  UnsupportedRealmTransformError,
} from "src/rpc/persistence";
import {
  createPersistentSaveServer,
  createUnsupportedPersistentServer,
  persistentClient,
} from "src/rpc/persistent-interface";
import { Message, Struct, utils } from "src/serialization";
import { Call } from "src/rpc/call";
import { Answer } from "src/rpc/answer";
import { RpcLevel2SturdyRef } from "test/fixtures/rpc-level2";
import { Persistent$Client, Persistent_SaveParams } from "src/capnp/persistent";

describe("rpc persistence abstractions", () => {
  test("json codec round-trips sturdy refs", () => {
    const codec = new JsonSturdyRefCodec<{ host: string; object: string }>();
    const input = { host: "vat-a", object: "obj-1" };
    const output = codec.decode(codec.encode(input));
    t.deepEqual(output, input);
  });

  test("json codec rejects malformed payloads", () => {
    const codec = new JsonSturdyRefCodec<{ host: string }>();
    const payload = new TextEncoder().encode("{not json");
    t.throws(() => codec.decode(payload), MalformedSturdyRefError);
  });

  test("json codec validation failure is deterministic", () => {
    const codec = new JsonSturdyRefCodec<{ host: string }>(
      (value): value is { host: string } => {
        if (typeof value !== "object" || value === null) {
          return false;
        }
        return typeof (value as { host?: unknown }).host === "string";
      },
    );
    const payload = new TextEncoder().encode("{\"bad\":true}");
    t.throws(() => codec.decode(payload), MalformedSturdyRefError);
  });

  test("realm transform uses identity for same realm", () => {
    const registry = new RealmTransformRegistry<{ id: string }>();
    const ref = { id: "x" };
    t.equal(registry.transform(ref, "same", "same"), ref);
  });

  test("realm transform applies registered transform", () => {
    const registry = new RealmTransformRegistry<{ id: string }>();
    registry.register("a", "b", (ref) => ({ id: `b:${ref.id}` }));
    const out = registry.transform({ id: "x" }, "a", "b");
    t.deepEqual(out, { id: "b:x" });
  });

  test("unknown realm transform throws deterministic error", () => {
    const registry = new RealmTransformRegistry<{ id: string }>();
    t.throws(
      () => registry.transform({ id: "x" }, "a", "z"),
      UnsupportedRealmTransformError,
    );
  });

  test("map restorer returns known capability", () => {
    const lookup = new MapRestorerLookup<
      { host: string; object: string },
      { tag: string }
    >();
    const cap = { tag: "cap-1" };
    lookup.set({ host: "vat", object: "1" }, cap);
    t.equal(lookup.restore({ host: "vat", object: "1" }), cap);
  });

  test("map restorer throws for unknown sturdy refs", () => {
    const lookup = new MapRestorerLookup<{ host: string; object: string }, {}>();
    t.throws(
      () => lookup.restore({ host: "vat", object: "missing" }),
      UnknownSturdyRefError,
    );
  });

  test("persistentClient wraps a raw Client", () => {
    const raw = {
      call<P extends Struct, R extends Struct>(_call: Call<P, R>): Answer<R> {
        throw new Error("not used");
      },
      close(): void {
        // no-op
      },
    };
    const wrapped = persistentClient(raw);
    t.equal(wrapped.client, raw);
  });

  test("createPersistentSaveServer wires save result pointer", async () => {
    const server = createPersistentSaveServer(() => {
      const message = new Message();
      const ref = message.initRoot(RpcLevel2SturdyRef);
      ref.host = "saved-host";
      ref._initObjectId(2).copyBuffer(new Uint8Array([7, 8]));
      return ref;
    });

    const client = server.client();
    const out = await client.save((_params: Persistent_SaveParams) => {}).promise();
    const decoded = utils.getAs(RpcLevel2SturdyRef, out.sturdyRef);
    t.equal(decoded.host, "saved-host");
    t.deepEqual([...decoded.objectId.toUint8Array()], [7, 8]);
  });

  test("createUnsupportedPersistentServer rejects save", async () => {
    const server = createUnsupportedPersistentServer("unsupported");
    const client = server.client();
    try {
      await client
        .save((_params: Persistent_SaveParams) => {})
        .promise();
      throw new Error("expected save failure");
    } catch (error_) {
      t.ok((error_ as Error).message.includes("unsupported"));
    }
  });
});
