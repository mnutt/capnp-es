import { ListElementSize } from "./serialization/list-element-size";
import { Data, List, type Struct, utils } from "./serialization/pointers";
import { initList as initRawList } from "./serialization/pointers/list/list";

export type MaybePromise<T> = T | PromiseLike<T>;

type StructFieldKeys<T extends Struct> = Exclude<
  {
    [K in keyof T]: K extends keyof Struct
      ? never
      : K extends `_${string}`
        ? never
        : K extends `${string}OrNull`
          ? never
          : T[K] extends (...args: any[]) => any
            ? never
            : K;
  }[keyof T],
  symbol
>;

export type InitValue<T> = T extends Data
  ? T | ArrayBuffer | ArrayBufferView | Iterable<number>
  : T extends List<infer U>
    ? T | Iterable<InitValue<U>>
    : T extends Struct
      ? T | Init<T>
      : T;

export type Init<T extends Struct> = {
  [K in StructFieldKeys<T>]?: InitValue<T[K]>;
};

export type Initializer<T extends Struct> = Init<T> | ((target: T) => void);

export function applyInit<T extends Struct>(
  target: T,
  value: Initializer<T> | undefined,
): void {
  if (value === undefined) {
    return;
  }

  if (typeof value === "function") {
    value(target);
    return;
  }

  const structClass = target.constructor as {
    _applyInit?: (target: T, value: Init<T>) => void;
  };
  if (typeof structClass._applyInit === "function") {
    structClass._applyInit(target, value);
    return;
  }

  throw new TypeError(
    `${target.constructor.name} does not have a generated _applyInit() method.`,
  );
}

export function dataBytes(value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }

  if (isIterable(value)) {
    return Uint8Array.from(value as Iterable<number>);
  }

  throw new TypeError(
    "Data fields require Data, ArrayBuffer, ArrayBufferView, or Iterable<number> values.",
  );
}

export function initDataValue(data: Data, length: number): Data {
  utils.erase(data);
  initRawList(ListElementSize.BYTE, length, data);
  return data;
}

export function initListValue<T>(list: List<T>, length: number): List<T> {
  const listClass = list.constructor as typeof List;
  utils.erase(list);
  initRawList(
    listClass._capnp.size,
    length,
    list,
    listClass._capnp.compositeSize,
  );
  return list;
}

function isIterable(value: unknown): value is Iterable<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as Iterable<unknown>)[Symbol.iterator] === "function"
  );
}
