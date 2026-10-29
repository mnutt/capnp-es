import { test, expect } from "vitest";
import { Message, Pointer, Text, utils } from "capnp-es";
import { ListMania } from "../fixtures/list-mania";
import { TestDefaults } from "../fixtures/test";

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
