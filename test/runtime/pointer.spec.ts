// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import { test, assert as t } from "vitest";

import {
  CompositeList,
  Message,
  ObjectSize,
  Pointer,
  Struct,
  utils,
} from "capnp-es";
import * as C from "src/constants";
import { PTR_DEPTH_LIMIT_EXCEEDED } from "src/errors";

class ChainStruct extends Struct {
  static readonly _capnp = {
    displayName: "ChainStruct",
    id: "0000000000000003",
    size: new ObjectSize(0, 1),
  };

  initNext(): ChainStruct {
    return utils.initStructAt(0, ChainStruct, this);
  }
}

class EraseChild extends Struct {
  static readonly _capnp = {
    displayName: "EraseChild",
    id: "0000000000000004",
    size: new ObjectSize(8, 1),
  };

  set name(value: string) {
    utils.setText(0, value, this);
  }
}

class EraseParent extends Struct {
  static readonly _capnp = {
    displayName: "EraseParent",
    id: "0000000000000005",
    size: new ObjectSize(8, 1),
  };

  initChild(): EraseChild {
    return utils.initStructAt(0, EraseChild, this);
  }

  initChildren(length: number) {
    return utils.initList(0, CompositeList(EraseChild), length, this);
  }
}

function includesBytes(haystack: Uint8Array, needle: string): boolean {
  const bytes = new TextEncoder().encode(needle);

  return haystack.some((_, i) =>
    bytes.every((byte, j) => haystack[i + j] === byte),
  );
}

test("new Pointer()", () => {
  const m = new Message();
  const s = m.getSegment(0);

  const initialTraversalLimit = m._capnp.traversalLimit;

  t.throws(
    () => {
      new Pointer(s, 0, 0);
    },
    // "should throw when exceeding the depth limit",
  );

  const p = new Pointer(s, 4);

  t.equal(
    m._capnp.traversalLimit,
    initialTraversalLimit - 8,
    "should track pointer allocation in the message",
  );

  t.throws(
    () => {
      new Pointer(s, -1);
    },
    // "should throw with a negative offset",
  );

  t.throws(
    () => {
      new Pointer(s, 100);
    },
    // "should throw when exceeding segment bounds",
  );

  t.equal(s.byteLength, 8);
  t.ok(
    new Pointer(s, 8),
    "should allow creating pointers at the end of the segment",
  );

  t.equal(p.segment, s);
  t.equal(p.byteOffset, 4);
  t.equal(p._capnp.depthLimit, C.DEFAULT_DEPTH_LIMIT);
});

test("Pointer depth limit applies to nested reads", () => {
  const root = new Message().initRoot(ChainStruct);

  t.throws(
    () => {
      let cur = root;
      for (let i = 0; i < C.DEFAULT_DEPTH_LIMIT; i++) {
        cur = cur.initNext();
      }
    },
    new RegExp(PTR_DEPTH_LIMIT_EXCEEDED.slice(0, 12)),
  );
});

test("Pointer.isNull() rejects out-of-bounds pointer words", () => {
  const m = new Message();
  const s = m.getSegment(0);

  t.throws(() => utils.isNull(new Pointer(s, s.byteLength)));
});

test("Pointer.erase() erases struct pointer sections after data", () => {
  const root = new Message().initRoot(EraseParent);
  root.initChild().name = "struct secret";

  utils.erase(root);

  t.equal(
    includesBytes(
      new Uint8Array(root.segment.buffer, 0, root.segment.byteLength),
      "struct secret",
    ),
    false,
  );
});

test("Pointer.erase() erases composite-list struct pointer sections after data", () => {
  const root = new Message().initRoot(EraseParent);
  const children = root.initChildren(1);
  children.get(0).name = "composite secret";

  utils.erase(root);

  t.equal(
    includesBytes(
      new Uint8Array(root.segment.buffer, 0, root.segment.byteLength),
      "composite secret",
    ),
    false,
  );
});

test("Pointer.adopt(), Pointer.disown()", () => {
  const m = new Message();
  const s = m.getSegment(0);
  const p = new Pointer(s, 0);

  // Empty bit list.
  s.setUint32(0, 0x00_00_00_01);
  s.setUint32(4, 0x00_00_00_01);

  const o = utils.disown(p);

  t.equal(s.getUint32(0), 0x00_00_00_00);
  t.equal(s.getUint32(4), 0x00_00_00_00);

  utils.adopt(o, p);

  t.equal(s.getUint32(0), 0x00_00_00_01);
  t.equal(s.getUint32(4), 0x00_00_00_01);
});

test("Pointer.dump()", () => {
  const m = new Message();
  const s = m.getSegment(0);
  const p = new Pointer(s, 0);

  s.setUint32(0, 0x00_00_00_01);
  s.setUint32(4, 0x00_00_00_02);

  t.equal(utils.dump(p), "[01 00 00 00 02 00 00 00]");
});

test("Pointer.toString()", () => {
  const m = new Message();
  const s = m.getSegment(0);
  const p = new Pointer(s, 0);

  s.setUint32(0, 0x00_00_00_01);
  s.setUint32(4, 0x00_00_00_02);

  t.equal(p.toString(), "->0@0x00000000[01 00 00 00 02 00 00 00]");
});
