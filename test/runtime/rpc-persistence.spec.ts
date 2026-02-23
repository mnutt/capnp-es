import { describe, test, assert as t } from "vitest";
import {
  JsonSturdyRefCodec,
  MalformedSturdyRefError,
  MapRestorerLookup,
  RealmTransformRegistry,
  UnknownSturdyRefError,
  UnsupportedRealmTransformError,
} from "src/rpc/persistence";

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
});
