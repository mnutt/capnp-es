// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import { ListElementSize } from "../list-element-size";
import { MAX_DEPTH } from "../../constants";
import type { Segment } from "../segment";
import { List, initList } from "./list/list";
import {
  validate,
  isNull,
  getContent,
  getTargetListLength,
  erase,
} from "./pointer.utils";
import { Pointer, PointerType, checkPointer } from "./pointer";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function utf8ByteLength(value: string): number {
  let length = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) length++;
    else if (code < 0x800) length += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      i + 1 < value.length &&
      value.charCodeAt(i + 1) >= 0xdc00 &&
      value.charCodeAt(i + 1) <= 0xdfff
    ) {
      length += 4;
      i++;
    } else length += 3;
  }
  return length;
}

export class Text extends List<string> {
  static fromPointer(pointer: Pointer, indexed = true): Text {
    validate(PointerType.LIST, pointer, ListElementSize.BYTE);

    return textFromPointerUnchecked(pointer, indexed);
  }

  /**
   * Read a utf-8 encoded string value from this pointer.
   *
   * @param index The index at which to start reading; defaults to zero.
   * @returns The string value.
   */
  get(index = 0): string {
    if (isNull(this)) return "";
    const c = getContent(this);
    return decodeTextBytes(
      c.segment,
      c.byteOffset + index,
      this.length - index,
    );
  }

  /**
   * Get the number of utf-8 encoded bytes in this text. This does **not** include the NUL byte.
   *
   * @returns The number of bytes allocated for the text.
   */
  get length(): number {
    return super.length - 1;
  }

  /**
   * Write a utf-8 encoded string value starting at the specified index.
   *
   * @param index The index at which to start copying the string. Note that if this is not zero the bytes
   * before `index` will be left as-is. All bytes after `index` will be overwritten.
   * @param value The string value to set.
   */
  set(index: number, value: string): void {
    // Short strings benefit from encoding directly into the segment. For long
    // strings the native encoder's sizing pass is faster than a JS UTF-16 scan.
    const src = value.length > 256 ? textEncoder.encode(value) : undefined;
    const dstLength = (src ? src.byteLength : utf8ByteLength(value)) + index;
    let c: Pointer;
    let original: Uint8Array | undefined;

    // TODO: Consider reusing existing space if list is already initialized and there's enough room for the value.

    if (!isNull(this)) {
      c = getContent(this);

      // Only copy bytes that will remain after copying. Everything after `index` should end up truncated.
      const originalLength = Math.min(this.length, index);

      original = new Uint8Array(
        c.segment.buffer.slice(c.byteOffset, c.byteOffset + originalLength),
      );

      erase(this);
    }

    // Always allocate an extra byte for the NUL byte.
    initList(ListElementSize.BYTE, dstLength + 1, this);

    c = getContent(this);
    const dst = new Uint8Array(c.segment.buffer, c.byteOffset, dstLength);

    if (original) {
      dst.set(original);
    }

    if (src) dst.set(src, index);
    else textEncoder.encodeInto(value, index === 0 ? dst : dst.subarray(index));
  }

  toString(): string {
    return this.get();
  }

  toJSON(): string {
    return this.get();
  }

  [Symbol.toPrimitive](): string {
    return this.get();
  }

  [Symbol.toStringTag](): string {
    return `Text_${super.toString()}`;
  }
}

// Internal scalar reads do not need a List/Text object. Preserve its pointer
// validation and traversal charge before decoding from the existing location.
export function readText(pointer: Pointer): string {
  const { segment, byteOffset } = pointer;
  const word = segment.getInt32(byteOffset);
  const high = segment.getUint32(byteOffset + 4);
  if ((word & 3) === PointerType.LIST && (high & 7) === ListElementSize.BYTE) {
    checkPointer(segment, byteOffset, pointer._capnp.depthLimit, pointer);
    const contentOffset = byteOffset + 8 + (word >> 2) * 8;
    // Validate and charge the content location without allocating a wrapper
    // whose only use would be to construct the decoder's byte view.
    checkPointer(segment, contentOffset, MAX_DEPTH, pointer);
    return decodeTextBytes(segment, contentOffset, (high >>> 3) - 1);
  }
  validate(PointerType.LIST, pointer, ListElementSize.BYTE);
  checkPointer(
    pointer.segment,
    pointer.byteOffset,
    pointer._capnp.depthLimit,
    pointer,
  );
  return decodeText(pointer, 0);
}

function decodeText(pointer: Pointer, index: number): string {
  if (isNull(pointer)) return "";
  const c = getContent(pointer);
  return decodeTextBytes(
    c.segment,
    c.byteOffset + index,
    getTargetListLength(pointer) - 1 - index,
  );
}

// Tiny ASCII values avoid both the byte-view object and the native decoder
// call. UTF-8, BOM handling, malformed input, and larger strings use TextDecoder.
function decodeTextBytes(
  segment: Segment,
  offset: number,
  length: number,
): string {
  if (
    length >= 0 &&
    length <= 8 &&
    offset >= 0 &&
    offset + length <= segment.buffer.byteLength
  ) {
    if (length === 0) return "";
    const a = segment.getUint8(offset);
    const b = length > 1 ? segment.getUint8(offset + 1) : 0;
    const c = length > 2 ? segment.getUint8(offset + 2) : 0;
    const d = length > 3 ? segment.getUint8(offset + 3) : 0;
    const e = length > 4 ? segment.getUint8(offset + 4) : 0;
    const f = length > 5 ? segment.getUint8(offset + 5) : 0;
    const g = length > 6 ? segment.getUint8(offset + 6) : 0;
    const h = length > 7 ? segment.getUint8(offset + 7) : 0;
    if ((a | b | c | d | e | f | g | h) < 128) {
      switch (length) {
        case 1: {
          return String.fromCharCode(a);
        }
        case 2: {
          return String.fromCharCode(a, b);
        }
        case 3: {
          return String.fromCharCode(a, b, c);
        }
        case 4: {
          return String.fromCharCode(a, b, c, d);
        }
        case 5: {
          return String.fromCharCode(a, b, c, d, e);
        }
        case 6: {
          return String.fromCharCode(a, b, c, d, e, f);
        }
        case 7: {
          return String.fromCharCode(a, b, c, d, e, f, g);
        }
        case 8: {
          return String.fromCharCode(a, b, c, d, e, f, g, h);
        }
      }
    }
  }
  return textDecoder.decode(new Uint8Array(segment.buffer, offset, length));
}

function textFromPointerUnchecked(pointer: Pointer, indexed: boolean): Text {
  return new Text(
    pointer.segment,
    pointer.byteOffset,
    pointer._capnp.depthLimit,
    indexed,
  );
}
