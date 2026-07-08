// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz and fasterthanlime)
import type { ObjectSize } from "../object-size";
import type { Segment } from "../segment";
import { format } from "../../util";
import { DEFAULT_DEPTH_LIMIT } from "../../constants";
import { Pointer, PointerType } from "./pointer";
import { getTargetPointerType } from "./pointer.utils";
import type { CapnpSchemaMetadata } from "../../metadata";
import type { CapabilityID, CapabilitySlot } from "../cap-table";

export type ServerTarget<S extends InterfaceCtor<unknown, unknown>> =
  ConstructorParameters<S["Server"]>[0];

export interface InterfaceCtor<C, S> {
  readonly _capnp: CapnpSchemaMetadata & { id: string; size: ObjectSize };
  readonly Client: { new (client: any): C };

  readonly Server: { new (target: any): S };

  new (segment: Segment, byteOffset: number, depthLimit?: number): Interface;
}

export class Interface extends Pointer {
  static readonly _capnp = {
    displayName: "Interface" as string,
  };
  static readonly getCapID = getCapID;
  static readonly getAsInterface = getAsInterface;
  static readonly isInterface = isInterface;
  static readonly getClient = getClient;

  constructor(
    segment: Segment,
    byteOffset: number,
    depthLimit = DEFAULT_DEPTH_LIMIT,
  ) {
    super(segment, byteOffset, depthLimit);
  }

  static fromPointer(p: Pointer): Interface | null {
    return getAsInterface(p);
  }

  getCapId(): CapabilityID {
    return getCapID(this);
  }

  getClient(): CapabilitySlot | null {
    return getClient(this);
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return format(
      "Interface_%d@%a,%d,limit:%x",
      this.segment.id,
      this.byteOffset,
      this.getCapId(),
      this._capnp.depthLimit,
    );
  }
}

export function getAsInterface(p: Pointer): Interface | null {
  if (getTargetPointerType(p) === PointerType.OTHER) {
    return new Interface(p.segment, p.byteOffset, p._capnp.depthLimit);
  }
  return null;
}

export function isInterface(p: Pointer): boolean {
  return getTargetPointerType(p) === PointerType.OTHER;
}

export function getCapID(i: Interface): CapabilityID {
  if (i.segment.getUint32(i.byteOffset) !== PointerType.OTHER) {
    return -1;
  }
  return i.segment.getUint32(i.byteOffset + 4);
}

export function getClient(i: Interface): CapabilitySlot | null {
  const capID = getCapID(i);
  const { capTable } = i.segment.message._capnp;
  if (!capTable) {
    return null;
  }
  return capTable[capID];
}
