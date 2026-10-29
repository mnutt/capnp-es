// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import { ListElementSize } from "../../list-element-size";
import { _ListCtor, List, getListTarget } from "./list";
import { Text, readText } from "../text";
import { getContent } from "../pointer.utils";

export class TextList extends List<string> {
  static readonly _capnp: _ListCtor = {
    displayName: "List<Text>" as string,
    size: ListElementSize.POINTER,
  };

  get(index: number): string {
    const c = getContent(getListTarget(this));

    c.byteOffset += index * 8;

    return readText(c);
  }

  set(index: number, value: string): void {
    const c = getContent(getListTarget(this));

    c.byteOffset += index * 8;

    Text.fromPointer(c, false).set(0, value);
  }

  [Symbol.toStringTag](): string {
    return `Text_${super.toString()}`;
  }
}
