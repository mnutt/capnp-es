// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import { ListElementSize } from "../../list-element-size";
import { _ListCtor, List, type ListCtor, getListTarget } from "./list";
import { Struct, StructCtor } from "../struct";
import { copyFrom } from "../pointer.utils";

export function CompositeList<T extends Struct>(
  CompositeClass: StructCtor<T>,
): ListCtor<T> {
  return class extends List<T> {
    static readonly _capnp: _ListCtor = {
      compositeSize: CompositeClass._capnp.size,
      displayName: `List<${CompositeClass._capnp.displayName}>`,
      size: ListElementSize.COMPOSITE,
    };

    get(index: number): T {
      const target = getListTarget(this);
      return new CompositeClass(
        target.segment,
        target.byteOffset,
        target._capnp.depthLimit - 1,
        index,
      );
    }

    set(index: number, value: T): void {
      copyFrom(value, this.get(index));
    }

    [Symbol.toStringTag](): string {
      return `Composite_${super.toString()},cls:${CompositeClass.toString()}`;
    }
  };
}
