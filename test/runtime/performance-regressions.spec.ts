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

test("public lists retain indexing, callback identity, and snapshot iteration", () => {
  const list = new Message().initRoot(ListMania)._initUint32List(3);
  list.set(0, 10);
  list.set(1, 20);
  list.set(2, 30);
  expect(list[1]).toBe(20);
  expect(list.at(-1)).toBe(30);
  // Exercise callback receiver identity as part of the public Array API.
  // eslint-disable-next-line unicorn/no-array-for-each
  list.forEach((_v, _i, array) => expect(array).toBe(list));
  const iterator = list.values();
  list.set(0, 99);
  expect([...iterator]).toEqual([10, 20, 30]);
  expect([...list]).toEqual([99, 20, 30]);
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

test("growing a single segment preserves earlier list and text handles", () => {
  const message = new Message();
  const root = message.initRoot(ListMania);
  const numbers = root._initUint32List(2);
  numbers.set(0, 123);
  numbers.set(1, 456);
  const list = root._initTextList(4096);
  for (let i = 0; i < list.length; i++) list.set(i, `entry-${i}`);
  numbers.set(1, 789);
  const decoded = new Message(message.toArrayBuffer(), false).getRoot(
    ListMania,
  );
  expect([...decoded.uint32List]).toEqual([123, 789]);
  for (let i = 0; i < decoded.textList.length; i++) {
    expect(decoded.textList.get(i)).toBe(`entry-${i}`);
  }
});

test("text encoding handles UTF-8 boundaries and unpaired surrogates", () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const codes = [
    0, 0x7f, 0x80, 0x7ff, 0x800, 0xd7ff, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xe000,
    0xffff,
  ];
  const root = new Message().initRoot(TestDefaults);
  for (const first of codes) {
    for (const second of codes) {
      const input = String.fromCharCode(first, second);
      root.textField = input;
      expect(root.textField).toBe(decoder.decode(encoder.encode(input)));
    }
  }
  for (const count of [255, 256, 257, 4096]) {
    const input = "é".repeat(count - 2) + "🦀";
    root.textField = input;
    expect(root.textField).toBe(input);
  }
});
