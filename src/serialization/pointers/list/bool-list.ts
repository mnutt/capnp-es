// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import { ListElementSize } from "../../list-element-size";
import { _ListCtor, List, getListTarget } from "./list";
import { getContentOffset } from "../pointer.utils";

export class BoolList extends List<boolean> {
  static readonly _capnp: _ListCtor = {
    displayName: "List<boolean>" as string,
    size: ListElementSize.BIT,
  };

  get(index: number): boolean {
    const bitMask = 1 << (index % 8);
    const byteOffset = index >>> 3;
    const target = getListTarget(this);
    const c = getContentOffset(target);
    const segment = typeof c === "number" ? target.segment : c.segment;
    const contentOffset = typeof c === "number" ? c : c.byteOffset;
    const v = segment.getUint8(contentOffset + byteOffset);

    return (v & bitMask) !== 0;
  }

  set(index: number, value: boolean): void {
    const bitMask = 1 << (index % 8);
    const target = getListTarget(this);
    const c = getContentOffset(target);
    const segment = typeof c === "number" ? target.segment : c.segment;
    const contentOffset = typeof c === "number" ? c : c.byteOffset;
    const byteOffset = contentOffset + (index >>> 3);
    const v = segment.getUint8(byteOffset);

    segment.setUint8(byteOffset, value ? v | bitMask : v & ~bitMask);
  }

  [Symbol.toStringTag](): string {
    return `Bool_${super.toString()}`;
  }
}
