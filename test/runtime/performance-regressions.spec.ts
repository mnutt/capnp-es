import { test, expect } from "vitest";
import { Message, Pointer, Text, utils, type Struct } from "capnp-es";
import { ListMania } from "../fixtures/list-mania";
import { TestDefaults } from "../fixtures/test";

test("near pointer decoding preserves signed offsets and traversal accounting", () => {
  const message = new Message();
  const segment = message.getSegment(0);
  segment.allocate(32);
  // Struct pointer at byte 24, referring backwards to data at byte 8.
  segment.setInt32(24, -3 << 2);
  segment.setUint16(28, 1);
  const p = new Pointer(segment, 24);
  const before = message._capnp.traversalLimit;
  const content = utils.getContent(p);
  expect(content.segment).toBe(segment);
  expect(content.byteOffset).toBe(8);
  expect(message._capnp.traversalLimit).toBe(before - 8);
});

test("internal text fast path preserves Unicode and public Text indexing", () => {
  const root = new Message().initRoot(ListMania);
  const list = root._initTextList(5);
  const input = ["", "ascii", "café 🦀", "x\u0000y", "unpaired \uD800"];
  for (const [i, s] of input.entries()) list.set(i, s);
  expect([...list]).toEqual(["", "ascii", "café 🦀", "x\u0000y", "unpaired �"]);
  const pointer = utils.getContent(list);
  pointer.byteOffset += 8;
  const text = Text.fromPointer(pointer);
  expect(text[1]).toBe("scii");
  expect(text.get()).toBe("ascii");
  text.set(2, "é");
  expect(text.get()).toBe("asé");
  expect([...list]).toEqual(["", "asé", "café 🦀", "x\u0000y", "unpaired �"]);
  const defaults = new Message().initRoot(TestDefaults);
  expect(defaults.textField).toBe("foo");
  defaults.textField = "🦀";
  expect(defaults.textField).toBe("🦀");
  const empty = new Message();
  expect(
    Text.fromPointer(new Pointer(empty.getSegment(0), 0)).toArray(),
  ).toEqual([]);
});
