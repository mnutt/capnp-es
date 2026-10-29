// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import { ListElementSize } from "../../list-element-size";
import { _ListCtor, List, getListTarget } from "./list";
import { getContentOffset } from "../pointer.utils";

export class Int64List extends List<bigint> {
  static readonly _capnp: _ListCtor = {
    displayName: "List<Int64>" as string,
    size: ListElementSize.BYTE_8,
  };

  get(index: number): bigint {
    const target = getListTarget(this);
    const c = getContentOffset(target);
    const segment = typeof c === "number" ? target.segment : c.segment;
    const contentOffset = typeof c === "number" ? c : c.byteOffset;
    return segment.getInt64(contentOffset + index * 8);
  }

  set(index: number, value: bigint): void {
    const target = getListTarget(this);
    const c = getContentOffset(target);
    const segment = typeof c === "number" ? target.segment : c.segment;
    const contentOffset = typeof c === "number" ? c : c.byteOffset;
    segment.setInt64(contentOffset + index * 8, value);
  }

  [Symbol.toStringTag](): string {
    return `Int64_${super.toString()}`;
  }
}
