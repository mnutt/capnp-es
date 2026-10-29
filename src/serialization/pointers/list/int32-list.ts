// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import { ListElementSize } from "../../list-element-size";
import { _ListCtor, List, getListTarget } from "./list";
import { getContentOffset } from "../pointer.utils";

export class Int32List extends List<number> {
  static readonly _capnp: _ListCtor = {
    displayName: "List<Int32>" as string,
    size: ListElementSize.BYTE_4,
  };

  get(index: number): number {
    const target = getListTarget(this);
    const c = getContentOffset(target);
    const segment = typeof c === "number" ? target.segment : c.segment;
    const contentOffset = typeof c === "number" ? c : c.byteOffset;
    return segment.getInt32(contentOffset + index * 4);
  }

  set(index: number, value: number): void {
    const target = getListTarget(this);
    const c = getContentOffset(target);
    const segment = typeof c === "number" ? target.segment : c.segment;
    const contentOffset = typeof c === "number" ? c : c.byteOffset;
    segment.setInt32(contentOffset + index * 4, value);
  }

  [Symbol.toStringTag](): string {
    return `Int32_${super.toString()}`;
  }
}
