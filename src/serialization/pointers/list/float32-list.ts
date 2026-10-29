// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import { ListElementSize } from "../../list-element-size";
import { _ListCtor, List, getListTarget } from "./list";
import { getContentOffset } from "../pointer.utils";

export class Float32List extends List<number> {
  static readonly _capnp: _ListCtor = {
    displayName: "List<Float32>" as string,
    size: ListElementSize.BYTE_4,
  };

  get(index: number): number {
    const target = getListTarget(this);
    const c = getContentOffset(target);
    const segment = typeof c === "number" ? target.segment : c.segment;
    const contentOffset = typeof c === "number" ? c : c.byteOffset;

    return segment.getFloat32(contentOffset + index * 4);
  }

  set(index: number, value: number): void {
    const target = getListTarget(this);
    const c = getContentOffset(target);
    const segment = typeof c === "number" ? target.segment : c.segment;
    const contentOffset = typeof c === "number" ? c : c.byteOffset;

    segment.setFloat32(contentOffset + index * 4, value);
  }

  [Symbol.toStringTag](): string {
    return `Float32_${super.toString()}`;
  }
}
