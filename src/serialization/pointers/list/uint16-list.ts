// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import { ListElementSize } from "../../list-element-size";
import { _ListCtor, List, getListTarget } from "./list";
import { getContentOffset } from "../pointer.utils";

export class Uint16List extends List<number> {
  static readonly _capnp: _ListCtor = {
    displayName: "List<Uint16>",
    size: ListElementSize.BYTE_2,
  };

  get(index: number): number {
    const target = getListTarget(this);
    const c = getContentOffset(target);
    const segment = typeof c === "number" ? target.segment : c.segment;
    const contentOffset = typeof c === "number" ? c : c.byteOffset;
    return segment.getUint16(contentOffset + index * 2);
  }

  set(index: number, value: number): void {
    const target = getListTarget(this);
    const c = getContentOffset(target);
    const segment = typeof c === "number" ? target.segment : c.segment;
    const contentOffset = typeof c === "number" ? c : c.byteOffset;

    segment.setUint16(contentOffset + index * 2, value);
  }

  [Symbol.toStringTag](): string {
    return `Uint16_${super.toString()}`;
  }
}
