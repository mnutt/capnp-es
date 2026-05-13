import type { ObjectSize } from "./serialization/object-size";
import type { Method } from "./rpc/method";

export type CapnpSchemaTypeKind =
  | "anyPointer"
  | "bool"
  | "data"
  | "enum"
  | "float32"
  | "float64"
  | "group"
  | "int16"
  | "int32"
  | "int64"
  | "int8"
  | "interface"
  | "list"
  | "struct"
  | "text"
  | "uint16"
  | "uint32"
  | "uint64"
  | "uint8"
  | "void";

export interface CapnpSchemaTypeMetadata {
  readonly kind: CapnpSchemaTypeKind;
  readonly typeId?: bigint;
  readonly typeIdHex?: string;
  readonly displayName?: string;
  readonly elementType?: CapnpSchemaTypeMetadata;
}

export interface CapnpFieldMetadata {
  readonly name: string;
  readonly codeOrder: number;
  readonly ordinal: number;
  readonly kind: "slot" | "group";
  readonly type: CapnpSchemaTypeMetadata;
  readonly offset?: number;
  readonly discriminantValue?: number;
}

export interface CapnpSchemaMetadata {
  readonly displayName: string;
  readonly id?: string;
  readonly typeId?: bigint;
  readonly typeIdHex?: string;
}

export interface StructSchemaMetadata extends CapnpSchemaMetadata {
  readonly id: string;
  readonly typeId: bigint;
  readonly typeIdHex: string;
  readonly size: ObjectSize;
  readonly fields: readonly CapnpFieldMetadata[];
  readonly [key: string]: unknown;
}

export interface InterfaceSchemaMetadata extends CapnpSchemaMetadata {
  readonly id: string;
  readonly typeId: bigint;
  readonly typeIdHex: string;
  readonly size: ObjectSize;
  readonly methods: readonly Method<any, any>[];
}
