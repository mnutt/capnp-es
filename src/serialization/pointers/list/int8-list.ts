// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import { ListElementSize } from "../../list-element-size";
import { _ListCtor, List, getListTarget } from "./list";
import { getContentOffset } from "../pointer.utils";

export class Int8List extends List<number> {
  static readonly _capnp: _ListCtor = {
    displayName: "List<Int8>" as string,
    size: ListElementSize.BYTE,
  };

  get(index: number): number {
    const target = getListTarget(this);
    const c = getContentOffset(target);
    const segment = typeof c === "number" ? target.segment : c.segment;
    const contentOffset = typeof c === "number" ? c : c.byteOffset;
    return segment.getInt8(contentOffset + index);
  }

  set(index: number, value: number): void {
    const target = getListTarget(this);
    const c = getContentOffset(target);
    const segment = typeof c === "number" ? target.segment : c.segment;
    const contentOffset = typeof c === "number" ? c : c.byteOffset;
    segment.setInt8(contentOffset + index, value);
  }

  [Symbol.toStringTag](): string {
    return `Int8_${super.toString()}`;
  }
}
