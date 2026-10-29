// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import { ListElementSize } from "../../list-element-size";
import { _ListCtor, List, getListTarget } from "./list";
import { getContentOffset } from "../pointer.utils";

export class Int16List extends List<number> {
  static readonly _capnp: _ListCtor = {
    displayName: "List<Int16>" as string,
    size: ListElementSize.BYTE_2,
  };

  get(index: number): number {
    const target = getListTarget(this);
    const c = getContentOffset(target);
    const segment = typeof c === "number" ? target.segment : c.segment;
    const contentOffset = typeof c === "number" ? c : c.byteOffset;

    return segment.getInt16(contentOffset + index * 2);
  }

  set(index: number, value: number): void {
    const target = getListTarget(this);
    const c = getContentOffset(target);
    const segment = typeof c === "number" ? target.segment : c.segment;
    const contentOffset = typeof c === "number" ? c : c.byteOffset;

    segment.setInt16(contentOffset + index * 2, value);
  }

  [Symbol.toStringTag](): string {
    return `Int16_${super.toString()}`;
  }
}
