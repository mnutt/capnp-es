// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import { test, assert as t } from "vitest";

import { Message, ObjectSize, Pointer, Struct, utils } from "capnp-es";
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
