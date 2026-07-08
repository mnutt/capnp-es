import { describe, test, assert as t } from "vitest";
import { Message, ObjectSize, Struct, utils } from "src/serialization";
import { MultiSegmentArena } from "src/serialization/arena";

class EmptyStruct extends Struct {
  static readonly _capnp = {
    displayName: "EmptyStruct",
    id: "0000000000000004",
    size: new ObjectSize(0, 0),
  };
}

class DefaultChild extends Struct {
  static readonly _capnp = {
    displayName: "DefaultChild",
    id: "0000000000000005",
    size: new ObjectSize(8, 0),
  };

  get value(): number {
    return utils.getUint32(0, this);
  }

  set value(value: number) {
    utils.setUint32(0, value, this);
  }
}

class WideStruct extends Struct {
  static readonly _capnp = {
    displayName: "WideStruct",
    id: "0000000000000006",
    size: new ObjectSize(8, 2),
  };

  get count(): number {
    return utils.getUint32(0, this);
  }

  get flag(): boolean {
    return utils.getBit(32, this);
  }

  get name(): string {
    return utils.getText(0, this, "default text");
  }

  get child(): DefaultChild {
    return utils.getStruct(1, DefaultChild, this, defaultChild);
  }

  get emptyChild(): DefaultChild {
    return utils.getStruct(2, DefaultChild, this);
  }
}

const defaultChildMessage = new Message();
const defaultChild = defaultChildMessage.initRoot(DefaultChild);
defaultChild.value = 123;

describe("read-only messages", () => {
  test("byte-backed messages read undersized structs without mutation", () => {
    const source = new Message();
    source.initRoot(EmptyStruct);
    const bytes = source.toUint8Array();
    const before = Buffer.from(bytes);
    const message = new Message(bytes, false);

    const root = message.getRoot(WideStruct);

    t.equal(root.count, 0);
    t.equal(root.flag, false);
    t.equal(root.name, "default text");
    t.equal(root.child.value, 123);
    t.equal(root.emptyChild.value, 0);
    t.deepEqual(Buffer.from(message.toUint8Array()), before);
  });

  test("default struct fallbacks from read-only messages are read-only copies", () => {
    const source = new Message();
    source.initRoot(EmptyStruct);
    const message = new Message(source.toUint8Array(), false);

    const child = message.getRoot(WideStruct).child;

    t.throws(() => {
      child.value = 456;
    });
    t.equal(defaultChild.value, 123);
  });

  test("empty pointer fallbacks from read-only messages are read-only", () => {
    const source = new Message();
    source.initRoot(EmptyStruct);
    const message = new Message(source.toUint8Array(), false);

    const child = message.getRoot(WideStruct).emptyChild;

    t.throws(() => {
      child.value = 456;
    });
  });

  test("mutable messages still resize undersized structs on read", () => {
    const message = new Message(new MultiSegmentArena([]));
    message.initRoot(EmptyStruct);
    const before = message.toUint8Array().byteLength;

    const root = message.getRoot(WideStruct);

    t.equal(root.count, 0);
    t.ok(message.toUint8Array().byteLength > before);
  });

  test("two readers over one read-only buffer do not interfere", () => {
    const source = new Message();
    source.initRoot(EmptyStruct);
    const bytes = source.toUint8Array();
    const first = new Message(bytes, false);
    const second = new Message(bytes, false);

    t.equal(first.getRoot(WideStruct).name, "default text");
    t.equal(second.getRoot(WideStruct).child.value, 123);
    t.deepEqual(Buffer.from(first.toUint8Array()), Buffer.from(bytes));
    t.deepEqual(Buffer.from(second.toUint8Array()), Buffer.from(bytes));
  });
});
