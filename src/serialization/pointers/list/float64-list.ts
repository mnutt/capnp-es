// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import { ListElementSize } from "../../list-element-size";
import { _ListCtor, List, getListTarget } from "./list";
import { getContentOffset } from "../pointer.utils";

export class Float64List extends List<number> {
  static readonly _capnp: _ListCtor = {
    displayName: "List<Float64>" as string,
    size: ListElementSize.BYTE_8,
  };

  get(index: number): number {
    const target = getListTarget(this);
    const c = getContentOffset(target);
    const segment = typeof c === "number" ? target.segment : c.segment;
    const contentOffset = typeof c === "number" ? c : c.byteOffset;

    return segment.getFloat64(contentOffset + index * 8);
  }

  set(index: number, value: number): void {
    const target = getListTarget(this);
    const c = getContentOffset(target);
    const segment = typeof c === "number" ? target.segment : c.segment;
    const contentOffset = typeof c === "number" ? c : c.byteOffset;

    segment.setFloat64(contentOffset + index * 8, value);
  }

  [Symbol.toStringTag](): string {
    return `Float64_${super.toString()}`;
  }
}
