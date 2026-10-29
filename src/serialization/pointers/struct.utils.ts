// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import { NATIVE_LITTLE_ENDIAN } from "../../constants";
import { format, padToWord } from "../../util";
import { ListElementSize } from "../list-element-size";
import {
  ObjectSize,
  getByteLength,
  getDataWordLength,
  getWordLength,
} from "../object-size";
import { Data } from "./data";
import {
  List,
  type ListCtor,
  initList as _initList,
  getListTarget,
} from "./list/list";
import { type Client } from "../../rpc/client";
import { clientOrNull } from "../../rpc/error-client";
import { _Pointer, _PointerCtor, Pointer, PointerCtor } from "./pointer";
import {
  getContent,
  getStructSize,
  initPointer,
  erase,
  copyFrom,
  setStructPointer,
  getInterfacePointer,
  followFars,
  getTargetListElementSize,
  getTargetPointerType,
  isNull,
  getTargetCompositeListSize,
  getTargetListLength,
  setListPointer,
  getTargetStructSize,
  validate,
  trackPointerAllocation,
} from "./pointer.utils";
import { PointerType, checkPointer, checkPointerOffset } from "./pointer";
import { Text, readText } from "./text";
import {
  PTR_INIT_COMPOSITE_STRUCT,
  PTR_INVALID_UNION_ACCESS,
  PTR_STRUCT_DATA_OUT_OF_BOUNDS,
  PTR_STRUCT_POINTER_OUT_OF_BOUNDS,
} from "../../errors";

import type { Struct, StructCtor } from "./struct";

// Used to apply bit masks (default values).
const TMP_WORD = new DataView(new ArrayBuffer(8));

/**
 * Initialize a struct with the provided object size. This will allocate new space for the struct contents, ideally in
 * the same segment as this pointer.
 *
 * @param size An object describing the size of the struct's data and pointer sections.
 * @param s The struct to initialize.
 */
export function initStruct(size: ObjectSize, s: Struct): void {
  if (s._capnp.compositeIndex !== undefined) {
    throw new Error(format(PTR_INIT_COMPOSITE_STRUCT, s));
  }

  // Make sure to clear existing contents before overwriting the pointer data (erase is a noop if already empty).
  erase(s);

  const c = s.segment.allocate(getByteLength(size));

  const res = initPointer(c.segment, c.byteOffset, s);

  setStructPointer(res.offsetWords, size, res.pointer);
}

export function initStructAt<T extends Struct>(
  index: number,
  StructClass: StructCtor<T>,
  p: Pointer,
): T {
  const s = getPointerAs(index, StructClass, p);

  initStruct(StructClass._capnp.size, s);

  return s;
}

export function checkPointerBounds(index: number, s: Struct): void {
  const { pointerLength } = getSize(s);

  if (index < 0 || index >= pointerLength) {
    throw new Error(
      format(PTR_STRUCT_POINTER_OUT_OF_BOUNDS, s, index, pointerLength),
    );
  }
}

// Resolve ordinary struct fields once. Composite elements share a tag word;
// avoid constructing its location repeatedly for the bounds check and offset.
// Keep the same traversal charges as checkPointerBounds + getPointerSection.
function getPointerSectionAt(index: number, s: Struct): Pointer {
  const segment = s.segment;
  const word = segment.getInt32(s.byteOffset);
  const high = segment.getUint32(s.byteOffset + 4);
  const compositeIndex = s._capnp.compositeIndex;
  const composite =
    compositeIndex !== undefined &&
    (word & 3) === PointerType.LIST &&
    (high & 7) === ListElementSize.COMPOSITE;
  if (
    (compositeIndex === undefined && (word & 3) === PointerType.STRUCT) ||
    composite
  ) {
    const contentOffset = s.byteOffset + 8 + (word >> 2) * 8;
    let ps: Pointer | undefined;
    let size = high;
    if (composite) {
      ps = new Pointer(segment, contentOffset);
      size = segment.getUint32(contentOffset + 4);
    }
    const pointerLength = size >>> 16;
    if (index < 0 || index >= pointerLength) {
      throw new Error(
        format(PTR_STRUCT_POINTER_OUT_OF_BOUNDS, s, index, pointerLength),
      );
    }
    if (ps) {
      trackPointerAllocation(segment.message, ps);
      trackPointerAllocation(segment.message, ps);
      ps.byteOffset +=
        8 + compositeIndex! * ((size & 0xffff) + pointerLength) * 8;
    } else {
      ps = new Pointer(segment, contentOffset);
    }
    ps.byteOffset += ((size & 0xffff) + index) * 8;
    return ps;
  }
  checkPointerBounds(index, s);
  const ps = getPointerSection(s);
  ps.byteOffset += index * 8;
  return ps;
}

export function getInterfaceClientOrNullAt(index: number, s: Struct): Client {
  return getInterfaceClientOrNull(getPointer(index, s));
}

export function getInterfaceClientOrNull(p: Pointer): Client {
  let client: Client | null = null;
  const capId = getInterfacePointer(p);
  const { capTable } = p.segment.message._capnp;
  if (capTable && capId >= 0 && capId < capTable.length) {
    client = capTable[capId];
  }
  return clientOrNull(client);
}

/**
 * Make a shallow copy of a struct's contents and update the pointer to point to the new content. The data and pointer
 * sections will be resized to the provided size.
 *
 * WARNING: This method can cause data loss if `dstSize` is smaller than the original size!
 *
 * @param dstSize The desired size for the struct contents.
 * @param s The struct to resize.
 */
export function resize(dstSize: ObjectSize, s: Struct): void {
  const srcSize = getSize(s);
  const srcContent = getContent(s);
  const dstContent = s.segment.allocate(getByteLength(dstSize));

  // Only copy the data section for now. The pointer section will need to be rewritten.
  dstContent.segment.copyWords(
    dstContent.byteOffset,
    srcContent.segment,
    srcContent.byteOffset,
    Math.min(getDataWordLength(srcSize), getDataWordLength(dstSize)),
  );

  const res = initPointer(dstContent.segment, dstContent.byteOffset, s);

  setStructPointer(res.offsetWords, dstSize, res.pointer);

  // Iterate through the new pointer section and update the offsets so they point to the right place. This is a bit
  // more complicated than it appears due to the fact that the original pointers could have been far pointers, and
  // the new pointers might need to be allocated as far pointers if the segment is full.

  for (
    let i = 0;
    i < Math.min(srcSize.pointerLength, dstSize.pointerLength);
    i++
  ) {
    const srcPtr = new Pointer(
      srcContent.segment,
      srcContent.byteOffset + srcSize.dataByteLength + i * 8,
    );
    if (isNull(srcPtr)) {
      // If source pointer is null, leave the destination pointer as default null.
      continue;
    }
    const srcPtrTarget = followFars(srcPtr);
    const srcPtrContent = getContent(srcPtr);
    const dstPtr = new Pointer(
      dstContent.segment,
      dstContent.byteOffset + dstSize.dataByteLength + i * 8,
    );

    // For composite lists the offset needs to point to the tag word, not the first element which is what getContent
    // returns.

    if (
      getTargetPointerType(srcPtr) === PointerType.LIST &&
      getTargetListElementSize(srcPtr) === ListElementSize.COMPOSITE
    ) {
      srcPtrContent.byteOffset -= 8;
    }

    const r = initPointer(
      srcPtrContent.segment,
      srcPtrContent.byteOffset,
      dstPtr,
    );

    // Read the old pointer data, but discard the original offset.
    const a = srcPtrTarget.segment.getUint8(srcPtrTarget.byteOffset) & 0x03;
    const b = srcPtrTarget.segment.getUint32(srcPtrTarget.byteOffset + 4);

    r.pointer.segment.setUint32(r.pointer.byteOffset, a | (r.offsetWords << 2));
    r.pointer.segment.setUint32(r.pointer.byteOffset + 4, b);
  }

  // Zero out the old data and pointer sections.
  srcContent.segment.fillZeroWords(
    srcContent.byteOffset,
    getWordLength(srcSize),
  );
}

/**
 * Convert a struct to a struct of the provided class. Particularly useful when casting to nested group types.
 *
 * @param StructClass The struct class to convert to. Not particularly useful if `Struct`.
 * @param s The struct to convert.
 * @returns A new instance of the desired struct class pointing to the same location.
 */
export function getAs<T extends Struct>(
  StructClass: StructCtor<T>,
  s: Struct,
): T {
  return new StructClass(
    s.segment,
    s.byteOffset,
    s._capnp.depthLimit,
    s._capnp.compositeIndex,
  );
}

/**
 * Read a boolean (bit) value out of a struct.
 *
 * @param bitOffset The offset in **bits** from the start of the data section.
 * @param s The struct to read from.
 * @param defaultMask The default value as a DataView.
 * @returns The value.
 */
export function getBit(
  bitOffset: number,
  s: Struct,
  defaultMask?: DataView,
): boolean {
  const byteOffset = Math.floor(bitOffset / 8);
  const bitMask = 1 << (bitOffset % 8);

  const ds = getCheckedDataSection(byteOffset, 1, s);
  const segment = typeof ds === "number" ? s.segment : ds.segment;
  const offset = (typeof ds === "number" ? ds : ds.byteOffset) + byteOffset;

  const v = segment.getUint8(offset);

  if (defaultMask === undefined) {
    return (v & bitMask) !== 0;
  }

  const defaultValue = defaultMask.getUint8(0);
  return ((v ^ defaultValue) & bitMask) !== 0;
}

export function getData(
  index: number,
  s: Struct,
  defaultValue?: Pointer,
): Data {
  const ps = getPointerSectionAt(index, s);

  const result = new Data(ps.segment, ps.byteOffset, s._capnp.depthLimit - 1);
  const l = getListTarget(result);

  if (isNull(l)) {
    if (defaultValue) {
      copyFrom(defaultValue, l);
    } else {
      _initList(ListElementSize.BYTE, 0, l);
    }
  }

  return result;
}

export function getDataSection(s: Struct): Pointer {
  return getContent(s);
}

// A near location is an offset in s.segment, avoiding a temporary Pointer and
// its metadata. Far locations retain the general resolver and its validation.
function getCheckedDataSection(
  byteOffset: number,
  byteLength: number,
  s: Struct,
): number | Pointer {
  const segment = s.segment;
  const word = segment.getInt32(s.byteOffset);
  const high = segment.getUint32(s.byteOffset + 4);
  const compositeIndex = s._capnp.compositeIndex;
  const composite =
    compositeIndex !== undefined &&
    (word & 3) === PointerType.LIST &&
    (high & 7) === ListElementSize.COMPOSITE;
  if (
    (compositeIndex === undefined && (word & 3) === PointerType.STRUCT) ||
    composite
  ) {
    const contentOffset = s.byteOffset + 8 + (word >> 2) * 8;
    let size = high;
    if (composite) {
      checkPointerOffset(segment, contentOffset);
      size = segment.getUint32(contentOffset + 4);
    }
    const dataByteLength = (size & 0xffff) * 8;
    if (
      byteOffset < 0 ||
      byteLength < 0 ||
      byteOffset + byteLength > dataByteLength
    ) {
      throw new Error(
        format(
          PTR_STRUCT_DATA_OUT_OF_BOUNDS,
          s,
          byteLength,
          byteOffset,
          dataByteLength,
        ),
      );
    }
    checkPointerOffset(segment, contentOffset);
    if (composite) {
      return (
        contentOffset +
        8 +
        compositeIndex! * (dataByteLength + (size >>> 16) * 8)
      );
    }
    return contentOffset;
  }
  checkDataBounds(byteOffset, byteLength, s);
  return getDataSection(s);
}

/**
 * Read a float32 value out of a struct.
 *
 * @param byteOffset The offset in bytes from the start of the data section.
 * @param s The struct to read from.
 * @param defaultMask The default value as a DataView.
 * @returns The value.
 */
export function getFloat32(
  byteOffset: number,
  s: Struct,
  defaultMask?: DataView,
): number {
  const ds = getCheckedDataSection(byteOffset, 4, s);
  const segment = typeof ds === "number" ? s.segment : ds.segment;
  const offset = (typeof ds === "number" ? ds : ds.byteOffset) + byteOffset;

  if (defaultMask === undefined) {
    return segment.getFloat32(offset);
  }

  const v = segment.getUint32(offset) ^ defaultMask.getUint32(0, true);
  TMP_WORD.setUint32(0, v, NATIVE_LITTLE_ENDIAN);
  return TMP_WORD.getFloat32(0, NATIVE_LITTLE_ENDIAN);
}

/**
 * Read a float64 value out of this segment.
 *
 * @param byteOffset The offset in bytes from the start of the data section.
 * @param s The struct to read from.
 * @param defaultMask The default value as a DataView.
 * @returns The value.
 */
export function getFloat64(
  byteOffset: number,
  s: Struct,
  defaultMask?: DataView,
): number {
  const ds = getCheckedDataSection(byteOffset, 8, s);
  const segment = typeof ds === "number" ? s.segment : ds.segment;
  const offset = (typeof ds === "number" ? ds : ds.byteOffset) + byteOffset;

  if (defaultMask !== undefined) {
    const lo = segment.getUint32(offset) ^ defaultMask.getUint32(0, true);
    const hi = segment.getUint32(offset + 4) ^ defaultMask.getUint32(4, true);
    TMP_WORD.setUint32(0, lo, NATIVE_LITTLE_ENDIAN);
    TMP_WORD.setUint32(4, hi, NATIVE_LITTLE_ENDIAN);
    return TMP_WORD.getFloat64(0, NATIVE_LITTLE_ENDIAN);
  }

  return segment.getFloat64(offset);
}

/**
 * Read an int16 value out of this segment.
 *
 * @param byteOffset The offset in bytes from the start of the data section.
 * @param s The struct to read from.
 * @param defaultMask The default value as a DataView.
 * @returns The value.
 */
export function getInt16(
  byteOffset: number,
  s: Struct,
  defaultMask?: DataView,
): number {
  const ds = getCheckedDataSection(byteOffset, 2, s);
  const segment = typeof ds === "number" ? s.segment : ds.segment;
  const offset = (typeof ds === "number" ? ds : ds.byteOffset) + byteOffset;

  if (defaultMask === undefined) {
    return segment.getInt16(offset);
  }

  const v = segment.getUint16(offset) ^ defaultMask.getUint16(0, true);
  TMP_WORD.setUint16(0, v, NATIVE_LITTLE_ENDIAN);
  return TMP_WORD.getInt16(0, NATIVE_LITTLE_ENDIAN);
}

/**
 * Read an int32 value out of this segment.
 *
 * @param byteOffset The offset in bytes from the start of the data section.
 * @param s The struct to read from.
 * @param defaultMask The default value as a DataView.
 * @returns The value.
 */
export function getInt32(
  byteOffset: number,
  s: Struct,
  defaultMask?: DataView,
): number {
  const ds = getCheckedDataSection(byteOffset, 4, s);
  const segment = typeof ds === "number" ? s.segment : ds.segment;
  const offset = (typeof ds === "number" ? ds : ds.byteOffset) + byteOffset;

  if (defaultMask === undefined) {
    return segment.getInt32(offset);
  }

  const v = segment.getUint32(offset) ^ defaultMask.getUint16(0, true);
  TMP_WORD.setUint32(0, v, NATIVE_LITTLE_ENDIAN);
  return TMP_WORD.getInt32(0, NATIVE_LITTLE_ENDIAN);
}

/**
 * Read an int64 value out of this segment.
 *
 * @param byteOffset The offset in bytes from the start of the data section.
 * @param s The struct to read from.
 * @param defaultMask The default value as a DataView.
 * @returns The value.
 */
export function getInt64(
  byteOffset: number,
  s: Struct,
  defaultMask?: DataView,
): bigint {
  const ds = getCheckedDataSection(byteOffset, 8, s);
  const segment = typeof ds === "number" ? s.segment : ds.segment;
  const offset = (typeof ds === "number" ? ds : ds.byteOffset) + byteOffset;

  if (defaultMask !== undefined) {
    const lo = segment.getUint32(offset) ^ defaultMask.getUint32(0, true);
    const hi = segment.getUint32(offset + 4) ^ defaultMask.getUint32(4, true);
    TMP_WORD.setUint32(NATIVE_LITTLE_ENDIAN ? 0 : 4, lo, NATIVE_LITTLE_ENDIAN);
    TMP_WORD.setUint32(NATIVE_LITTLE_ENDIAN ? 4 : 0, hi, NATIVE_LITTLE_ENDIAN);
    return TMP_WORD.getBigInt64(0, NATIVE_LITTLE_ENDIAN);
  }

  return segment.getInt64(offset);
}

/**
 * Read an int8 value out of this segment.
 *
 * @param byteOffset The offset in bytes from the start of the data section.
 * @param s The struct to read from.
 * @param defaultMask The default value as a DataView.
 * @returns The value.
 */
export function getInt8(
  byteOffset: number,
  s: Struct,
  defaultMask?: DataView,
): number {
  const ds = getCheckedDataSection(byteOffset, 1, s);
  const segment = typeof ds === "number" ? s.segment : ds.segment;
  const offset = (typeof ds === "number" ? ds : ds.byteOffset) + byteOffset;

  if (defaultMask === undefined) {
    return segment.getInt8(offset);
  }

  const v = segment.getUint8(offset) ^ defaultMask.getUint8(0);
  TMP_WORD.setUint8(0, v);
  return TMP_WORD.getInt8(0);
}

export function getList<T>(
  index: number,
  ListClass: ListCtor<T>,
  s: Struct,
  defaultValue?: Pointer,
): List<T> {
  const ps = getPointerSectionAt(index, s);

  const result = new ListClass(
    ps.segment,
    ps.byteOffset,
    s._capnp.depthLimit - 1,
  );
  const l = getListTarget(result);

  if (isNull(l)) {
    if (defaultValue) {
      copyFrom(defaultValue, l);
    } else {
      _initList(ListClass._capnp.size, 0, l, ListClass._capnp.compositeSize);
    }
  } else if (ListClass._capnp.compositeSize !== undefined) {
    // If this is a composite list we need to be sure the composite elements are big enough to hold everything as
    // specified in the schema. If the new schema has added fields we'll need to "resize" (shallow-copy) the list so
    // it has room for the new fields.

    const srcSize = getTargetCompositeListSize(l);
    const dstSize = ListClass._capnp.compositeSize;

    if (
      dstSize.dataByteLength > srcSize.dataByteLength ||
      dstSize.pointerLength > srcSize.pointerLength
    ) {
      const srcContent = getContent(l);
      const srcLength = getTargetListLength(l);

      // Allocate an extra 8 bytes for the tag.
      const dstContent = l.segment.allocate(
        getByteLength(dstSize) * srcLength + 8,
      );

      const res = initPointer(dstContent.segment, dstContent.byteOffset, l);

      setListPointer(
        res.offsetWords,
        ListClass._capnp.size,
        srcLength,
        res.pointer,
        dstSize,
      );

      // Write the new tag word.
      setStructPointer(srcLength, dstSize, dstContent);

      // Seek ahead past the tag word before copying the content.
      dstContent.byteOffset += 8;

      for (let i = 0; i < srcLength; i++) {
        const srcElementOffset =
          srcContent.byteOffset + i * getByteLength(srcSize);
        const dstElementOffset =
          dstContent.byteOffset + i * getByteLength(dstSize);

        // Copy the data section.
        dstContent.segment.copyWords(
          dstElementOffset,
          srcContent.segment,
          srcElementOffset,
          getWordLength(srcSize),
        );

        // Iterate through the pointers and update the offsets so they point to the right place.
        for (let j = 0; j < srcSize.pointerLength; j++) {
          const srcPtr = new Pointer(
            srcContent.segment,
            srcElementOffset + srcSize.dataByteLength + j * 8,
          );
          const dstPtr = new Pointer(
            dstContent.segment,
            dstElementOffset + dstSize.dataByteLength + j * 8,
          );

          const srcPtrTarget = followFars(srcPtr);
          const srcPtrContent = getContent(srcPtr);

          if (
            getTargetPointerType(srcPtr) === PointerType.LIST &&
            getTargetListElementSize(srcPtr) === ListElementSize.COMPOSITE
          ) {
            srcPtrContent.byteOffset -= 8;
          }

          const r = initPointer(
            srcPtrContent.segment,
            srcPtrContent.byteOffset,
            dstPtr,
          );

          // Read the old pointer data, but discard the original offset.
          const a =
            srcPtrTarget.segment.getUint8(srcPtrTarget.byteOffset) & 0x03;
          const b = srcPtrTarget.segment.getUint32(srcPtrTarget.byteOffset + 4);

          r.pointer.segment.setUint32(
            r.pointer.byteOffset,
            a | (r.offsetWords << 2),
          );
          r.pointer.segment.setUint32(r.pointer.byteOffset + 4, b);
        }
      }

      // Zero out the old content.

      srcContent.segment.fillZeroWords(
        srcContent.byteOffset,
        getWordLength(srcSize) * srcLength,
      );
    }
  }

  return result;
}

export function getPointer(index: number, s: Struct): Pointer {
  const ps = getPointerSectionAt(index, s);

  ps._capnp.depthLimit = s._capnp.depthLimit - 1;
  checkPointer(ps.segment, ps.byteOffset, ps._capnp.depthLimit, ps);
  return ps;
}

export function getPointerAs<T extends Pointer>(
  index: number,
  PointerClass: PointerCtor<T>,
  s: Struct,
): T {
  const ps = getPointerSectionAt(index, s);

  return new PointerClass(ps.segment, ps.byteOffset, s._capnp.depthLimit - 1);
}

export function getPointerSection(s: Struct): Pointer {
  const ps = getContent(s);

  ps.byteOffset += padToWord(getSize(s).dataByteLength);

  return ps;
}

export function getSize(s: Struct): ObjectSize {
  if (s._capnp.compositeIndex !== undefined) {
    // For composite lists the object size is stored in a tag word right before the content.

    const c = getContent(s, true);

    c.byteOffset -= 8;

    return getStructSize(c);
  }

  return getTargetStructSize(s);
}

export function getStruct<T extends Struct>(
  index: number,
  StructClass: StructCtor<T>,
  s: Struct,
  defaultValue?: Pointer,
): T {
  const t = getPointerAs(index, StructClass, s);

  if (isNull(t)) {
    if (defaultValue) {
      copyFrom(defaultValue, t);
    } else {
      initStruct(StructClass._capnp.size, t);
    }
  } else {
    validate(PointerType.STRUCT, t);

    const ts = getTargetStructSize(t);

    // This can happen when reading a struct that was constructed with an older version of the same schema, and new
    // fields were added to the struct. A shallow copy of the struct will be made so that there's enough room for the
    // data and pointer sections. This will unfortunately leave a "hole" of zeroes in the message, but that hole will
    // at least compress well.
    if (
      ts.dataByteLength < StructClass._capnp.size.dataByteLength ||
      ts.pointerLength < StructClass._capnp.size.pointerLength
    ) {
      resize(StructClass._capnp.size, t);
    }
  }

  return t;
}

export function getText(
  index: number,
  s: Struct,
  defaultValue?: string,
): string {
  const p = getPointer(index, s);

  // FIXME: This will perform an unnecessary string<>ArrayBuffer roundtrip.
  if (defaultValue && isNull(p)) {
    const t = Text.fromPointer(p, false);
    t.set(0, defaultValue);
    return t.get(0);
  }

  return readText(p);
}

/**
 * Read an uint16 value out of a struct..
 *
 * @param byteOffset The offset in bytes from the start of the data section.
 * @param s The struct to read from.
 * @param defaultMask The default value as a DataView.
 * @returns The value.
 */
export function getUint16(
  byteOffset: number,
  s: Struct,
  defaultMask?: DataView,
): number {
  const ds = getCheckedDataSection(byteOffset, 2, s);
  const segment = typeof ds === "number" ? s.segment : ds.segment;
  const offset = (typeof ds === "number" ? ds : ds.byteOffset) + byteOffset;

  if (defaultMask === undefined) {
    return segment.getUint16(offset);
  }

  return segment.getUint16(offset) ^ defaultMask.getUint16(0, true);
}

/**
 * Read an uint32 value out of a struct.
 *
 * @param byteOffset The offset in bytes from the start of the data section.
 * @param s The struct to read from.
 * @param defaultMask The default value as a DataView.
 * @returns The value.
 */
export function getUint32(
  byteOffset: number,
  s: Struct,
  defaultMask?: DataView,
): number {
  const ds = getCheckedDataSection(byteOffset, 4, s);
  const segment = typeof ds === "number" ? s.segment : ds.segment;
  const offset = (typeof ds === "number" ? ds : ds.byteOffset) + byteOffset;

  if (defaultMask === undefined) {
    return segment.getUint32(offset);
  }

  return segment.getUint32(offset) ^ defaultMask.getUint32(0, true);
}

/**
 * Read an uint64 value out of a struct.
 *
 * @param byteOffset The offset in bytes from the start of the data section.
 * @param s The struct to read from.
 * @param defaultMask The default value as a DataView.
 * @returns The value.
 */
export function getUint64(
  byteOffset: number,
  s: Struct,
  defaultMask?: DataView,
): bigint {
  const ds = getCheckedDataSection(byteOffset, 8, s);
  const segment = typeof ds === "number" ? s.segment : ds.segment;
  const offset = (typeof ds === "number" ? ds : ds.byteOffset) + byteOffset;

  if (defaultMask !== undefined) {
    const lo = segment.getUint32(offset) ^ defaultMask.getUint32(0, true);
    const hi = segment.getUint32(offset + 4) ^ defaultMask.getUint32(4, true);
    TMP_WORD.setUint32(NATIVE_LITTLE_ENDIAN ? 0 : 4, lo, NATIVE_LITTLE_ENDIAN);
    TMP_WORD.setUint32(NATIVE_LITTLE_ENDIAN ? 4 : 0, hi, NATIVE_LITTLE_ENDIAN);
    return TMP_WORD.getBigUint64(0, NATIVE_LITTLE_ENDIAN);
  }

  return segment.getUint64(offset);
}

/**
 * Read an uint8 value out of a struct.
 *
 * @param byteOffset The offset in bytes from the start of the data section.
 * @param s The struct to read from.
 * @param defaultMask The default value as a DataView.
 * @returns The value.
 */
export function getUint8(
  byteOffset: number,
  s: Struct,
  defaultMask?: DataView,
): number {
  const ds = getCheckedDataSection(byteOffset, 1, s);
  const segment = typeof ds === "number" ? s.segment : ds.segment;
  const offset = (typeof ds === "number" ? ds : ds.byteOffset) + byteOffset;

  if (defaultMask === undefined) {
    return segment.getUint8(offset);
  }

  return segment.getUint8(offset) ^ defaultMask.getUint8(0);
}

export function initData(index: number, length: number, s: Struct): Data {
  const ps = getPointerSectionAt(index, s);

  const result = new Data(ps.segment, ps.byteOffset, s._capnp.depthLimit - 1);
  const l = getListTarget(result);

  erase(l);

  _initList(ListElementSize.BYTE, length, l);

  return result;
}

export function initList<T>(
  index: number,
  ListClass: ListCtor<T>,
  length: number,
  s: Struct,
): List<T> {
  const ps = getPointerSectionAt(index, s);

  const result = new ListClass(
    ps.segment,
    ps.byteOffset,
    s._capnp.depthLimit - 1,
  );
  const l = getListTarget(result);

  erase(l);

  _initList(ListClass._capnp.size, length, l, ListClass._capnp.compositeSize);

  return result;
}

/**
 * Write a boolean (bit) value to the struct.
 *
 * @param bitOffset The offset in **bits** from the start of the data section.
 * @param value The value to write (writes a 0 for `false`, 1 for `true`).
 * @param s The struct to write to.
 * @param defaultMask The default value as a DataView.
 */

export function setBit(
  bitOffset: number,
  value: boolean,
  s: Struct,
  defaultMask?: DataView,
): void {
  const byteOffset = Math.floor(bitOffset / 8);
  const bitMask = 1 << (bitOffset % 8);

  const ds = getCheckedDataSection(byteOffset, 1, s);
  const segment = typeof ds === "number" ? s.segment : ds.segment;
  const offset = (typeof ds === "number" ? ds : ds.byteOffset) + byteOffset;

  const b = segment.getUint8(offset);

  // If the default mask bit is set, that means `true` values are actually written as `0`.

  if (defaultMask !== undefined) {
    value = (defaultMask.getUint8(0) & bitMask) === 0 ? value : !value;
  }

  segment.setUint8(offset, value ? b | bitMask : b & ~bitMask);
}

/**
 * Write a primitive float32 value to the struct.
 *
 * @param byteOffset The offset in bytes from the start of the data section.
 * @param value The value to write.
 * @param s The struct to write to.
 * @param defaultMask The default value as a DataView.
 */
export function setFloat32(
  byteOffset: number,
  value: number,
  s: Struct,
  defaultMask?: DataView,
): void {
  const ds = getCheckedDataSection(byteOffset, 4, s);
  const segment = typeof ds === "number" ? s.segment : ds.segment;
  const offset = (typeof ds === "number" ? ds : ds.byteOffset) + byteOffset;

  if (defaultMask !== undefined) {
    TMP_WORD.setFloat32(0, value, NATIVE_LITTLE_ENDIAN);
    const v =
      TMP_WORD.getUint32(0, NATIVE_LITTLE_ENDIAN) ^
      defaultMask.getUint32(0, true);
    segment.setUint32(offset, v);

    return;
  }

  segment.setFloat32(offset, value);
}

/**
 * Write a primitive float64 value to the struct.
 *
 * @param byteOffset The offset in bytes from the start of the data section.
 * @param value The value to write.
 * @param s The struct to write to.
 * @param defaultMask The default value as a DataView.
 */
export function setFloat64(
  byteOffset: number,
  value: number,
  s: Struct,
  defaultMask?: DataView,
): void {
  const ds = getCheckedDataSection(byteOffset, 8, s);
  const segment = typeof ds === "number" ? s.segment : ds.segment;
  const offset = (typeof ds === "number" ? ds : ds.byteOffset) + byteOffset;

  if (defaultMask !== undefined) {
    TMP_WORD.setFloat64(0, value, NATIVE_LITTLE_ENDIAN);
    const lo =
      TMP_WORD.getUint32(0, NATIVE_LITTLE_ENDIAN) ^
      defaultMask.getUint32(0, true);
    const hi =
      TMP_WORD.getUint32(4, NATIVE_LITTLE_ENDIAN) ^
      defaultMask.getUint32(4, true);
    segment.setUint32(offset, lo);
    segment.setUint32(offset + 4, hi);

    return;
  }

  segment.setFloat64(offset, value);
}

/**
 * Write a primitive int16 value to the struct.
 *
 * @param byteOffset The offset in bytes from the start of the data section.
 * @param value The value to write.
 * @param s The struct to write to.
 * @param defaultMask The default value as a DataView.
 */
export function setInt16(
  byteOffset: number,
  value: number,
  s: Struct,
  defaultMask?: DataView,
): void {
  const ds = getCheckedDataSection(byteOffset, 2, s);
  const segment = typeof ds === "number" ? s.segment : ds.segment;
  const offset = (typeof ds === "number" ? ds : ds.byteOffset) + byteOffset;

  if (defaultMask !== undefined) {
    TMP_WORD.setInt16(0, value, NATIVE_LITTLE_ENDIAN);
    const v =
      TMP_WORD.getUint16(0, NATIVE_LITTLE_ENDIAN) ^
      defaultMask.getUint16(0, true);
    segment.setUint16(offset, v);

    return;
  }

  segment.setInt16(offset, value);
}

/**
 * Write a primitive int32 value to the struct.
 *
 * @param byteOffset The offset in bytes from the start of the data section.
 * @param value The value to write.
 * @param s The struct to write to.
 * @param defaultMask The default value as a DataView.
 */
export function setInt32(
  byteOffset: number,
  value: number,
  s: Struct,
  defaultMask?: DataView,
): void {
  const ds = getCheckedDataSection(byteOffset, 4, s);
  const segment = typeof ds === "number" ? s.segment : ds.segment;
  const offset = (typeof ds === "number" ? ds : ds.byteOffset) + byteOffset;

  if (defaultMask !== undefined) {
    TMP_WORD.setInt32(0, value, NATIVE_LITTLE_ENDIAN);
    const v =
      TMP_WORD.getUint32(0, NATIVE_LITTLE_ENDIAN) ^
      defaultMask.getUint32(0, true);
    segment.setUint32(offset, v);

    return;
  }

  segment.setInt32(offset, value);
}

/**
 * Write a primitive int64 value to the struct.
 *
 * @param byteOffset The offset in bytes from the start of the data section.
 * @param value The value to write.
 * @param s The struct to write to.
 * @param defaultMask The default value as a DataView.
 */
export function setInt64(
  byteOffset: number,
  value: bigint,
  s: Struct,
  defaultMask?: DataView,
): void {
  const ds = getCheckedDataSection(byteOffset, 8, s);
  const segment = typeof ds === "number" ? s.segment : ds.segment;
  const offset = (typeof ds === "number" ? ds : ds.byteOffset) + byteOffset;

  if (defaultMask !== undefined) {
    TMP_WORD.setBigInt64(0, value, NATIVE_LITTLE_ENDIAN);
    const lo =
      TMP_WORD.getUint32(NATIVE_LITTLE_ENDIAN ? 0 : 4, NATIVE_LITTLE_ENDIAN) ^
      defaultMask.getUint32(0, true);
    const hi =
      TMP_WORD.getUint32(NATIVE_LITTLE_ENDIAN ? 4 : 0, NATIVE_LITTLE_ENDIAN) ^
      defaultMask.getUint32(4, true);
    segment.setUint32(offset, lo);
    segment.setUint32(offset + 4, hi);

    return;
  }

  segment.setInt64(offset, value);
}

/**
 * Write a primitive int8 value to the struct.
 *
 * @param byteOffset The offset in bytes from the start of the data section.
 * @param value The value to write.
 * @param s The struct to write to.
 * @param defaultMask The default value as a DataView.
 */
export function setInt8(
  byteOffset: number,
  value: number,
  s: Struct,
  defaultMask?: DataView,
): void {
  const ds = getCheckedDataSection(byteOffset, 1, s);
  const segment = typeof ds === "number" ? s.segment : ds.segment;
  const offset = (typeof ds === "number" ? ds : ds.byteOffset) + byteOffset;

  if (defaultMask !== undefined) {
    TMP_WORD.setInt8(0, value);
    const v = TMP_WORD.getUint8(0) ^ defaultMask.getUint8(0);
    segment.setUint8(offset, v);

    return;
  }

  segment.setInt8(offset, value);
}

export function setText(index: number, value: string, s: Struct): void {
  Text.fromPointer(getPointer(index, s), false).set(0, value);
}

/**
 * Write a primitive uint16 value to the struct.
 *
 * @param byteOffset The offset in bytes from the start of the data section.
 * @param value The value to write.
 * @param s The struct to write to.
 * @param defaultMask The default value as a DataView.
 */
export function setUint16(
  byteOffset: number,
  value: number,
  s: Struct,
  defaultMask?: DataView,
): void {
  const ds = getCheckedDataSection(byteOffset, 2, s);
  const segment = typeof ds === "number" ? s.segment : ds.segment;
  const offset = (typeof ds === "number" ? ds : ds.byteOffset) + byteOffset;

  if (defaultMask !== undefined) {
    value ^= defaultMask.getUint16(0, true);
  }

  segment.setUint16(offset, value);
}

/**
 * Write a primitive uint32 value to the struct.
 *
 * @param byteOffset The offset in bytes from the start of the data section.
 * @param value The value to write.
 * @param s The struct to write to.
 * @param defaultMask The default value as a DataView.
 */
export function setUint32(
  byteOffset: number,
  value: number,
  s: Struct,
  defaultMask?: DataView,
): void {
  const ds = getCheckedDataSection(byteOffset, 4, s);
  const segment = typeof ds === "number" ? s.segment : ds.segment;
  const offset = (typeof ds === "number" ? ds : ds.byteOffset) + byteOffset;

  if (defaultMask !== undefined) {
    value ^= defaultMask.getUint32(0, true);
  }

  segment.setUint32(offset, value);
}

/**
 * Write a primitive uint64 value to the struct.
 *
 * @param byteOffset The offset in bytes from the start of the data section.
 * @param value The value to write.
 * @param s The struct to write to.
 * @param defaultMask The default value as a DataView.
 */
export function setUint64(
  byteOffset: number,
  value: bigint,
  s: Struct,
  defaultMask?: DataView,
): void {
  const ds = getCheckedDataSection(byteOffset, 8, s);
  const segment = typeof ds === "number" ? s.segment : ds.segment;
  const offset = (typeof ds === "number" ? ds : ds.byteOffset) + byteOffset;

  if (defaultMask !== undefined) {
    TMP_WORD.setBigUint64(0, value, NATIVE_LITTLE_ENDIAN);
    const lo =
      TMP_WORD.getUint32(NATIVE_LITTLE_ENDIAN ? 0 : 4, NATIVE_LITTLE_ENDIAN) ^
      defaultMask.getUint32(0, true);
    const hi =
      TMP_WORD.getUint32(NATIVE_LITTLE_ENDIAN ? 4 : 0, NATIVE_LITTLE_ENDIAN) ^
      defaultMask.getUint32(4, true);
    segment.setUint32(offset, lo);
    segment.setUint32(offset + 4, hi);

    return;
  }

  segment.setUint64(offset, value);
}

/**
 * Write a primitive uint8 value to the struct.
 *
 * @param byteOffset The offset in bytes from the start of the data section.
 * @param value The value to write.
 * @param s The struct to write to.
 * @param defaultMask The default value as a DataView.
 */
export function setUint8(
  byteOffset: number,
  value: number,
  s: Struct,
  defaultMask?: DataView,
): void {
  const ds = getCheckedDataSection(byteOffset, 1, s);
  const segment = typeof ds === "number" ? s.segment : ds.segment;
  const offset = (typeof ds === "number" ? ds : ds.byteOffset) + byteOffset;

  if (defaultMask !== undefined) {
    value ^= defaultMask.getUint8(0);
  }
  segment.setUint8(offset, value);
}

export function testWhich(
  name: string,
  found: number,
  wanted: number,
  s: Struct,
): void {
  if (found !== wanted) {
    throw new Error(format(PTR_INVALID_UNION_ACCESS, s, name, found, wanted));
  }
}

export function checkDataBounds(
  byteOffset: number,
  byteLength: number,
  s: Struct,
): void {
  const { dataByteLength } = getSize(s);

  if (
    byteOffset < 0 ||
    byteLength < 0 ||
    byteOffset + byteLength > dataByteLength
  ) {
    throw new Error(
      format(
        PTR_STRUCT_DATA_OUT_OF_BOUNDS,
        s,
        byteLength,
        byteOffset,
        dataByteLength,
      ),
    );
  }
}
