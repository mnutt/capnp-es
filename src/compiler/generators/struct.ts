import * as schema from "../../capnp/schema";
import {
  getDisplayNamePrefix,
  getFullClassName,
  lookupNode,
  getUnnamedUnionFields,
  compareCodeOrder,
  needsConcreteListClass,
  lookupNodeSourceInfo,
  getJsType,
} from "../node-util";
import * as util from "../util";
import { generateEnumNode } from "./enum";
import type { CodeGeneratorFileContext } from ".";
import { createBigInt, extractJSDocs } from "./helpers";
import { Primitives, ConcreteListType } from "../constants";
import * as E from "../errors";
import {
  testWhich,
  getUint16,
  getPointer,
} from "../../serialization/pointers/struct.utils";
import * as capnp from "../..";
import { format, pad } from "../../util";

/**
 * Generates TypeScript class definition for a Cap'n Proto struct.
 * Creates class members, properties, methods and nested type definitions.
 *
 * @param ctx - The file context containing schema information and output statements
 * @param node - The schema node to generate code for
 *
 * @remarks
 * - Generates enum definitions for unnamed unions if present
 * - Creates static properties for constants and nested types
 * - Generates getter/setter methods for all fields
 * - Preserves documentation comments from schema
 */
export function generateStructNode(
  ctx: CodeGeneratorFileContext,
  node: schema.Node,
): void {
  const displayNamePrefix = getDisplayNamePrefix(node);
  const fullClassName = getFullClassName(node);
  const nestedNodes = node.nestedNodes
    .map(({ id }) => lookupNode(ctx, id))
    .filter((node) => !node._isConst && !node._isAnnotation);
  const nodeId = node.id;
  const nodeIdHex = nodeId.toString(16);
  const unionFields = getUnnamedUnionFields(node);

  const { struct } = node;
  const { dataWordCount, discriminantCount, discriminantOffset, pointerCount } =
    struct;
  const dataByteLength = dataWordCount * 8;
  const fields = struct.fields.toArray();

  // List of field indexes in code order
  const fieldIndexInCodeOrder = fields
    .map(({ codeOrder }, fieldIndex) => ({ fieldIndex, codeOrder }))
    .sort(compareCodeOrder)
    .map(({ fieldIndex }) => fieldIndex);

  const concreteLists = fields
    .filter((field) => needsConcreteListClass(field))
    .sort(compareCodeOrder);
  const consts = ctx.nodes.filter(
    (node) => node.scopeId === nodeId && node._isConst,
  );
  const hasUnnamedUnion = discriminantCount !== 0;

  if (hasUnnamedUnion) {
    generateEnumNode(ctx, fullClassName + "_Which", node, unionFields);
  }

  const members: string[] = [];

  // static readonly CONSTANT = 'foo';
  members.push(
    ...consts.map((node) => {
      const name = util.c2s(getDisplayNamePrefix(node));
      const value = createValue(node.const.value);
      return `static readonly ${name} = ${value}`;
    }),
    ...unionFields
      .sort(compareCodeOrder)
      .map((field) => createUnionConstProperty(fullClassName, field)),
    ...nestedNodes.map((node) => createNestedNodeProperty(node)),
  );

  const defaultValues: string[] = [];
  for (const index of fieldIndexInCodeOrder) {
    const field = fields[index];
    if (
      field._isSlot &&
      field.slot.hadExplicitDefault &&
      field.slot.type.which() !== schema.Type.VOID
    ) {
      defaultValues.push(generateDefaultValue(field));
    }
  }

  members.push(
    `
      static readonly _capnp = {
        displayName: "${displayNamePrefix}",
        id: "${nodeIdHex}",
        typeId: ${createBigInt(nodeId)},
        typeIdHex: "${nodeIdHex}",
        size: new $.ObjectSize(${dataByteLength}, ${pointerCount}),
        fields: [
          ${fieldIndexInCodeOrder.map((index) => createFieldMetadata(ctx, node, fields[index], index)).join(",\n")}
        ] as const,
        ${defaultValues.join(",")}
      }`,
    ...concreteLists.map((field) => createConcreteListProperty(ctx, field)),
    createApplyInitMethod(
      ctx,
      fullClassName,
      fieldIndexInCodeOrder.map((index) => fields[index]),
    ),
  );

  for (const index of fieldIndexInCodeOrder) {
    const field = fields[index];
    generateStructFieldMethods(ctx, members, node, field, index);
  }

  // toString(): string { return 'MyStruct_' + super.toString(); }
  members.push(
    `toString(): string { return "${fullClassName}_" + super.toString(); }`,
  );

  if (hasUnnamedUnion) {
    members.push(`
      which(): ${fullClassName}_Which {
        return $.utils.getUint16(${discriminantOffset * 2}, this) as ${fullClassName}_Which;
      }
    `);
    members.push(createUnionHelpers(ctx, unionFields, fullClassName));
  }

  const docComment = extractJSDocs(lookupNodeSourceInfo(ctx, node));

  const classCode = `
  ${docComment}
  export class ${fullClassName} extends $.Struct {
    ${members.join("\n")}
  }`;

  ctx.codeParts.push(classCode);

  // Write out the concrete list type initializer after all the class definitions. It can't be initialized within the
  // class's static initializer because the nested type might not be defined yet.
  // FIXME: This might be solvable with topological sorting?
  ctx.concreteLists.push(
    ...concreteLists.map((field): [string, schema.Field] => [
      fullClassName,
      field,
    ]),
  );
} /**
 * Generates TypeScript code for struct field methods.
 *
 * This function creates accessor methods and properties for a Cap'n Proto struct field:
 * - Getters and setters for the field value
 * - Adoption and disowning methods for pointer fields
 * - Initialization methods for lists and structs
 * - Union discriminant handling for fields in unnamed unions
 *
 * @param ctx - The code generator context
 * @param members - Array of code parts to append the generated methods to
 * @param node - The struct node containing the field
 * @param field - The field to generate methods for
 * @param fieldIndex - Index of the field in the struct's field list (for documentation lookup)
 */

export function generateStructFieldMethods(
  ctx: CodeGeneratorFileContext,
  members: string[],
  node: schema.Node,
  field: schema.Field,
  fieldIndex: number,
): void {
  let jsType: string;
  let whichType: schema.Type_Which | "group";

  if (field._isSlot) {
    const slotType = field.slot.type;
    jsType = getJsType(ctx, slotType, false);
    whichType = slotType.which();
  } else if (field._isGroup) {
    jsType = getFullClassName(lookupNode(ctx, field.group.typeId));
    whichType = "group";
  } else {
    throw new Error(format(E.GEN_UNKNOWN_STRUCT_FIELD, field.which()));
  }

  const isInterface = whichType === schema.Type.INTERFACE;
  if (isInterface) {
    jsType = `${jsType}$Client`;
  }

  const { discriminantOffset } = node.struct;
  const { name } = field;
  // `constructor` is not a valid accessor, use `$constructor` instead
  const accessorName = name === "constructor" ? "$constructor" : name;
  const capitalizedName = util.c2t(name);
  const { discriminantValue } = field;
  const fullClassName = getFullClassName(node);
  const hadExplicitDefault = field._isSlot && field.slot.hadExplicitDefault;
  const maybeDefaultArg = hadExplicitDefault
    ? `, ${fullClassName}._capnp.default${capitalizedName}`
    : "";
  const union = discriminantValue !== schema.Field.NO_DISCRIMINANT;
  const offset = field._isSlot ? field.slot.offset : 0;

  let adopt = false;
  let disown = false;
  let has = false;
  let init;
  let get;
  let set;

  switch (whichType) {
    case schema.Type.ANY_POINTER: {
      adopt = true;
      disown = true;
      has = true;
      get = `$.utils.getPointer(${offset}, this${maybeDefaultArg})`;
      set = `$.utils.copyFrom(value, ${get})`;
      break;
    }

    case schema.Type.BOOL:
    case schema.Type.ENUM:
    case schema.Type.FLOAT32:
    case schema.Type.FLOAT64:
    case schema.Type.INT16:
    case schema.Type.INT32:
    case schema.Type.INT64:
    case schema.Type.INT8:
    case schema.Type.UINT16:
    case schema.Type.UINT32:
    case schema.Type.UINT64:
    case schema.Type.UINT8: {
      const { byteLength, getter, setter } = Primitives[whichType];
      // NOTE: For a BOOL type this is actually a bit offset; `byteLength` will be `1` in that case.
      const byteOffset = offset * byteLength;
      get = `$.utils.${getter}(${byteOffset}, this${maybeDefaultArg})`;
      set = `$.utils.${setter}(${byteOffset}, value, this${maybeDefaultArg})`;
      if (whichType === schema.Type.ENUM) {
        get = `${get} as ${jsType}`;
      }
      break;
    }

    case schema.Type.DATA: {
      adopt = true;
      disown = true;
      has = true;
      get = `$.utils.getData(${offset}, this${maybeDefaultArg})`;
      set = `$.utils.copyFrom(value, $.utils.getPointer(${offset}, this))`;
      init = `$.utils.initData(${offset}, length, this)`;
      break;
    }

    case schema.Type.INTERFACE: {
      get = `new ${jsType}($.utils.getInterfaceClientOrNullAt(${offset}, this))`;
      set = `$.utils.setInterfacePointer(this.segment.message.addCap(value.client), $.utils.getPointer(${offset}, this))`;
      break;
    }

    case schema.Type.LIST: {
      const elementType = field.slot.type.list.elementType.which();
      let listClass = ConcreteListType[elementType];

      if (
        elementType === schema.Type.LIST ||
        elementType === schema.Type.STRUCT
      ) {
        listClass = `${fullClassName}._${capitalizedName}`;
      } else if (listClass === undefined) {
        throw new Error(
          format(E.GEN_UNSUPPORTED_LIST_ELEMENT_TYPE, elementType),
        );
      }

      adopt = true;
      disown = true;
      has = true;
      get = `$.utils.getList(${offset}, ${listClass}, this${maybeDefaultArg})`;
      set = `$.utils.copyFrom(value, $.utils.getPointer(${offset}, this))`;
      init = `$.utils.initList(${offset}, ${listClass}, length, this)`;
      if (elementType === schema.Type.ENUM) {
        get = `${get} as ${jsType}`;
        init = `${init} as ${jsType}`;
      }
      break;
    }

    case schema.Type.STRUCT: {
      adopt = true;
      disown = true;
      has = true;
      get = `$.utils.getStruct(${offset}, ${jsType}, this${maybeDefaultArg})`;
      set = `$.utils.copyFrom(value, $.utils.getPointer(${offset}, this))`;
      init = `$.utils.initStructAt(${offset}, ${jsType}, this)`;
      break;
    }

    case schema.Type.TEXT: {
      get = `$.utils.getText(${offset}, this${maybeDefaultArg})`;
      set = `$.utils.setText(${offset}, value, this)`;
      break;
    }

    case schema.Type.VOID: {
      break;
    }

    case "group": {
      if (hadExplicitDefault) {
        throw new Error(format(E.GEN_EXPLICIT_DEFAULT_NON_PRIMITIVE, "group"));
      }
      get = `$.utils.getAs(${jsType}, this)`;
      init = get;
      break;
    }

    default: {
      // TODO Maybe this should be an error?
      break;
    }
  }

  if (adopt) {
    members.push(`
      _adopt${capitalizedName}(value: $.Orphan<${jsType}>): void {
        ${union ? `$.utils.setUint16(${discriminantOffset * 2}, ${discriminantValue}, this);` : ""}
        $.utils.adopt(value, $.utils.getPointer(${offset}, this));
      }
    `);
  }

  if (disown) {
    members.push(`
      _disown${capitalizedName}(): $.Orphan<${jsType}> {
        return $.utils.disown(this.${name === "constructor" ? `$${name}` : name});
      }
    `);
  }

  if (get) {
    const docComment = extractJSDocs(
      lookupNodeSourceInfo(ctx, node)?.members.at(fieldIndex),
    );

    members.push(`
      ${docComment}
      get ${accessorName}(): ${jsType} {
        ${union ? `$.utils.testWhich(${JSON.stringify(name)}, $.utils.getUint16(${discriminantOffset * 2}, this), ${discriminantValue}, this);` : ""}
        return ${get};
      }
    `);
  }

  if (has) {
    members.push(`
      _has${capitalizedName}(): boolean {
        return !$.utils.isNull($.utils.getPointer(${offset}, this));
      }
    `);
  }

  if (isInterface) {
    members.push(`
      get ${accessorName}OrNull(): ${jsType} | null {
        const client = $.Interface.fromPointer($.utils.getPointer(${offset}, this))?.getClient() ?? null;
        return client === null ? null : new ${jsType}(client);
      }
      set ${accessorName}OrNull(value: ${jsType} | null) {
        if (value === null) {
          $.utils.erase($.utils.getPointer(${offset}, this));
        } else {
          this.${accessorName} = value;
        }
      }
    `);
  }

  if (init) {
    const params =
      whichType === schema.Type.DATA || whichType === schema.Type.LIST
        ? `length: number`
        : "";
    members.push(`
      _init${capitalizedName}(${params}): ${jsType} {
        ${union ? `$.utils.setUint16(${discriminantOffset * 2}, ${discriminantValue}, this);` : ""}
        return ${init};
      }
    `);
  }

  if (union) {
    members.push(`
      get _is${capitalizedName}(): boolean {
        return $.utils.getUint16(${discriminantOffset * 2}, this) === ${discriminantValue};
      }
    `);
  }

  if (set || union) {
    const param = set ? `value: ${jsType}` : `_: true`;
    members.push(`
      set ${accessorName}(${param}) {
        ${union ? `$.utils.setUint16(${discriminantOffset * 2}, ${discriminantValue}, this);` : ""}
        ${set ? `${set};` : ""}
      }
    `);
  }
}
/**
 * Generates a string representation of a default value expression for a Cap'n Proto field.
 *
 * This function handles different field types and their default value representations:
 * - Pointers (ANY_POINTER, DATA, LIST, STRUCT, INTERFACE)
 * - Text fields
 * - Boolean fields (with bit offset)
 * - Numeric types (ENUM, FLOAT32/64, INT8/16/32/64, UINT8/16/32/64)
 *
 * @param field - The Cap'n Proto field definition containing type and default value information
 * @returns A string containing the default value expression
 * @throws {Error} If the field type is not supported for default values
 */

export function generateDefaultValue(field: schema.Field): string {
  const { name, slot } = field;
  const whichSlotType = slot.type.which();
  const primitive = Primitives[whichSlotType];
  let initializer: string;

  switch (whichSlotType) {
    case schema.Type_Which.ANY_POINTER:
    case schema.Type_Which.DATA:
    case schema.Type_Which.LIST:
    case schema.Type_Which.STRUCT:
    case schema.Type_Which.INTERFACE: {
      initializer = createValue(slot.defaultValue);
      break;
    }

    case schema.Type_Which.TEXT: {
      initializer = JSON.stringify(slot.defaultValue.text);
      break;
    }

    case schema.Type_Which.BOOL: {
      const value = createValue(slot.defaultValue);
      const bitOffset = slot.offset % 8;
      initializer = `$.${primitive.mask}(${value}, ${bitOffset})`;
      break;
    }

    case schema.Type_Which.ENUM:
    case schema.Type_Which.FLOAT32:
    case schema.Type_Which.FLOAT64:
    case schema.Type_Which.INT16:
    case schema.Type_Which.INT32:
    case schema.Type_Which.INT64:
    case schema.Type_Which.INT8:
    case schema.Type_Which.UINT16:
    case schema.Type_Which.UINT32:
    case schema.Type_Which.UINT64:
    case schema.Type_Which.UINT8: {
      const value = createValue(slot.defaultValue);
      initializer = `$.${primitive.mask}(${value})`;

      break;
    }

    default: {
      throw new Error(
        format(
          E.GEN_UNKNOWN_DEFAULT,
          whichSlotType /* s.Type_Which[whichSlotType] */,
        ),
      );
    }
  }

  return `default${util.c2t(name)}: ${initializer}`;
}

export function createConcreteListProperty(
  ctx: CodeGeneratorFileContext,
  field: schema.Field,
): string {
  const name = `_${util.c2t(field.name)}`;
  const type = getJsType(ctx, field.slot.type, true);
  return `static ${name}: ${type};`;
}

export function createUnionConstProperty(
  fullClassName: string,
  field: schema.Field,
): string {
  const name = util.c2s(field.name);
  const initializer = `${fullClassName}_Which.${name}`;

  return `static readonly ${name} = ${initializer};`;
}

function createApplyInitMethod(
  ctx: CodeGeneratorFileContext,
  fullClassName: string,
  fields: schema.Field[],
): string {
  const body = fields
    .map((field) => createApplyInitField(ctx, field))
    .filter(Boolean)
    .join("\n");

  return `
    static _applyInit(target: ${fullClassName}, value: $.Init<${fullClassName}>): void {
      const init = value as any;
      ${body}
    }
  `;
}

function createApplyInitField(
  ctx: CodeGeneratorFileContext,
  field: schema.Field,
): string {
  const initName = `_init${util.c2t(field.name)}`;
  const accessorName =
    field.name === "constructor" ? "$constructor" : field.name;
  const valueKey = JSON.stringify(accessorName);
  const valueRef = `init[${valueKey}]`;
  const discriminant =
    field.discriminantValue === schema.Field.NO_DISCRIMINANT
      ? ""
      : `target.${accessorName} = true;`;

  if (field._isGroup) {
    const groupClassName = getFullClassName(
      lookupNode(ctx, field.group.typeId),
    );
    return `
      if (${valueRef} !== undefined) {
        ${groupClassName}._applyInit(target.${initName}(), ${valueRef} as $.Init<${groupClassName}>);
      }
    `;
  }

  if (!field._isSlot) {
    throw new Error(format(E.GEN_UNKNOWN_STRUCT_FIELD, field.which()));
  }

  const slotType = field.slot.type;
  switch (slotType.which()) {
    case schema.Type.VOID: {
      return `
        if (${valueRef} !== undefined) {
          ${discriminant}
        }
      `;
    }

    case schema.Type.DATA: {
      return `
        if (${valueRef} !== undefined) {
          if (${valueRef} instanceof $.Data) {
            target.${accessorName} = ${valueRef} as $.Data;
          } else {
            const bytes = $.dataBytes(${valueRef});
            target.${initName}(bytes.byteLength).copyBuffer(bytes);
          }
        }
      `;
    }

    case schema.Type.LIST: {
      return createApplyInitListField(
        ctx,
        field,
        accessorName,
        initName,
        valueRef,
      );
    }

    case schema.Type.STRUCT: {
      const structClassName = getFullClassName(
        lookupNode(ctx, slotType.struct.typeId),
      );
      return `
        if (${valueRef} !== undefined) {
          if (${valueRef} instanceof ${structClassName}) {
            target.${accessorName} = ${valueRef} as ${structClassName};
          } else {
            ${structClassName}._applyInit(target.${initName}(), ${valueRef} as $.Init<${structClassName}>);
          }
        }
      `;
    }

    case schema.Type.INTERFACE:
    case schema.Type.ANY_POINTER:
    case schema.Type.TEXT:
    case schema.Type.BOOL:
    case schema.Type.ENUM:
    case schema.Type.FLOAT32:
    case schema.Type.FLOAT64:
    case schema.Type.INT16:
    case schema.Type.INT32:
    case schema.Type.INT64:
    case schema.Type.INT8:
    case schema.Type.UINT16:
    case schema.Type.UINT32:
    case schema.Type.UINT64:
    case schema.Type.UINT8: {
      return `
        if (${valueRef} !== undefined) {
          target.${accessorName} = ${valueRef} as any;
        }
      `;
    }

    default: {
      return "";
    }
  }
}

function createApplyInitListField(
  ctx: CodeGeneratorFileContext,
  field: schema.Field,
  accessorName: string,
  initName: string,
  valueRef: string,
): string {
  const elementType = field.slot.type.list.elementType;
  const listSet = createApplyInitListElement(ctx, elementType);

  return `
    if (${valueRef} !== undefined) {
      if (${valueRef} instanceof $.List) {
        target.${accessorName} = ${valueRef} as any;
      } else {
        const values = Array.isArray(${valueRef}) ? ${valueRef} : Array.from(${valueRef} as Iterable<any>);
        const list = target.${initName}(values.length);
        for (let index = 0; index < values.length; index++) {
          const item = values[index];
          ${listSet}
        }
      }
    }
  `;
}

function createApplyInitListElement(
  ctx: CodeGeneratorFileContext,
  elementType: schema.Type,
): string {
  switch (elementType.which()) {
    case schema.Type.STRUCT: {
      const structClassName = getFullClassName(
        lookupNode(ctx, elementType.struct.typeId),
      );
      return `
        if (item instanceof ${structClassName}) {
          list.set(index, item);
        } else {
          ${structClassName}._applyInit(list.get(index), item as $.Init<${structClassName}>);
        }
      `;
    }

    case schema.Type.DATA: {
      return `
        if (item instanceof $.Data) {
          list.set(index, item);
        } else {
          const bytes = $.dataBytes(item);
          $.initDataValue(list.get(index), bytes.byteLength).copyBuffer(bytes);
        }
      `;
    }

    case schema.Type.LIST: {
      const nestedListSet = createApplyInitListElement(
        ctx,
        elementType.list.elementType,
      );
      return `
        if (item instanceof $.List) {
          list.set(index, item);
        } else {
          const nestedValues = Array.isArray(item) ? item : Array.from(item as Iterable<any>);
          const nested = list.get(index);
          $.initListValue(nested, nestedValues.length);
          for (let nestedIndex = 0; nestedIndex < nestedValues.length; nestedIndex++) {
            const item = nestedValues[nestedIndex];
            const index = nestedIndex;
            const list = nested;
            ${nestedListSet}
          }
        }
      `;
    }

    default: {
      return `list.set(index, item);`;
    }
  }
}

function createUnionHelpers(
  ctx: CodeGeneratorFileContext,
  unionFields: schema.Field[],
  fullClassName: string,
): string {
  const fields = [...unionFields].sort(compareCodeOrder);
  const valueType = fields
    .map((field) => {
      if (isSetOnlyUnionField(field)) {
        return `{ which: ${JSON.stringify(field.name)} }`;
      }
      return `{ which: ${JSON.stringify(field.name)}, value: ${getFieldValueTsType(ctx, field)} }`;
    })
    .join(" | ");
  const casesType = fields
    .map((field) => {
      const value = isVoidField(field)
        ? ""
        : `value: ${getFieldValueTsType(ctx, field)}`;
      return `${JSON.stringify(field.name)}?: (${value}) => R`;
    })
    .join(",\n");
  const setCases = fields
    .map((field) => {
      const accessorName =
        field.name === "constructor" ? "$constructor" : field.name;
      const assignment = isSetOnlyUnionField(field)
        ? `this.${accessorName} = true;`
        : `this.${accessorName} = value.value;`;
      return `case ${JSON.stringify(field.name)}: {
        ${assignment}
        return;
      }`;
    })
    .join("\n");
  const matchCases = fields
    .map((field) => {
      const accessorName =
        field.name === "constructor" ? "$constructor" : field.name;
      return `case ${field.discriminantValue}: {
        const callback = cases[${JSON.stringify(field.name)}];
        if (callback) {
          ${isVoidField(field) ? `return callback();` : `return callback(this.${accessorName});`}
        }
        break;
      }`;
    })
    .join("\n");

  return `
    _set(value: ${valueType}): void {
      switch (value.which) {
        ${setCases}
      }
    }
    _match<R>(cases: {
      ${casesType},
      _?: (which: ${fullClassName}_Which) => R
    }): R {
      const which = this.which();
      switch (which) {
        ${matchCases}
      }
      if (cases._) {
        return cases._(which);
      }
      throw new Error("Unhandled ${fullClassName} union case: " + which);
    }
  `;
}

function isVoidField(field: schema.Field): boolean {
  return field._isSlot && field.slot.type.which() === schema.Type.VOID;
}

function isSetOnlyUnionField(field: schema.Field): boolean {
  return isVoidField(field) || field._isGroup;
}

function getFieldValueTsType(
  ctx: CodeGeneratorFileContext,
  field: schema.Field,
): string {
  if (field._isGroup) {
    return getFullClassName(lookupNode(ctx, field.group.typeId));
  }

  if (!field._isSlot) {
    throw new Error(format(E.GEN_UNKNOWN_STRUCT_FIELD, field.which()));
  }

  const type = field.slot.type;
  const jsType = getJsType(ctx, type, false);
  return type.which() === schema.Type.INTERFACE ? `${jsType}$Client` : jsType;
}

function createFieldMetadata(
  ctx: CodeGeneratorFileContext,
  node: schema.Node,
  field: schema.Field,
  fieldIndex: number,
): string {
  const discriminant =
    field.discriminantValue === schema.Field.NO_DISCRIMINANT
      ? ""
      : `, discriminantValue: ${field.discriminantValue}`;
  const common = `name: ${JSON.stringify(field.name)}, codeOrder: ${field.codeOrder}, ordinal: ${getFieldOrdinal(field, fieldIndex)}${discriminant}`;

  if (field._isSlot) {
    return `{ ${common}, kind: "slot", offset: ${field.slot.offset}, type: ${createTypeMetadata(ctx, field.slot.type)} }`;
  }

  if (field._isGroup) {
    const groupNode = lookupNode(ctx, field.group.typeId);
    const groupType = createNodeTypeMetadata("group", groupNode);
    return `{ ${common}, kind: "group", type: ${groupType} }`;
  }

  throw new Error(format(E.GEN_UNKNOWN_STRUCT_FIELD, field.which()));
}

function getFieldOrdinal(field: schema.Field, fallback: number): number {
  return field.ordinal.which() === schema.Field_Ordinal.EXPLICIT
    ? field.ordinal.explicit
    : fallback;
}

function createTypeMetadata(
  ctx: CodeGeneratorFileContext,
  type: schema.Type,
): string {
  switch (type.which()) {
    case schema.Type.ANY_POINTER: {
      return `{ kind: "anyPointer" }`;
    }
    case schema.Type.BOOL: {
      return `{ kind: "bool" }`;
    }
    case schema.Type.DATA: {
      return `{ kind: "data" }`;
    }
    case schema.Type.ENUM: {
      return createNodeTypeMetadata("enum", lookupNode(ctx, type.enum.typeId));
    }
    case schema.Type.FLOAT32: {
      return `{ kind: "float32" }`;
    }
    case schema.Type.FLOAT64: {
      return `{ kind: "float64" }`;
    }
    case schema.Type.INT16: {
      return `{ kind: "int16" }`;
    }
    case schema.Type.INT32: {
      return `{ kind: "int32" }`;
    }
    case schema.Type.INT64: {
      return `{ kind: "int64" }`;
    }
    case schema.Type.INT8: {
      return `{ kind: "int8" }`;
    }
    case schema.Type.INTERFACE: {
      return createNodeTypeMetadata(
        "interface",
        lookupNode(ctx, type.interface.typeId),
      );
    }
    case schema.Type.LIST: {
      return `{ kind: "list", elementType: ${createTypeMetadata(ctx, type.list.elementType)} }`;
    }
    case schema.Type.STRUCT: {
      return createNodeTypeMetadata(
        "struct",
        lookupNode(ctx, type.struct.typeId),
      );
    }
    case schema.Type.TEXT: {
      return `{ kind: "text" }`;
    }
    case schema.Type.UINT16: {
      return `{ kind: "uint16" }`;
    }
    case schema.Type.UINT32: {
      return `{ kind: "uint32" }`;
    }
    case schema.Type.UINT64: {
      return `{ kind: "uint64" }`;
    }
    case schema.Type.UINT8: {
      return `{ kind: "uint8" }`;
    }
    case schema.Type.VOID: {
      return `{ kind: "void" }`;
    }
    default: {
      throw new Error(format(E.GEN_UNKNOWN_TYPE, type.which()));
    }
  }
}

function createNodeTypeMetadata(
  kind: "enum" | "group" | "interface" | "struct",
  node: schema.Node,
): string {
  const idHex = node.id.toString(16);
  return `{ kind: "${kind}", typeId: ${createBigInt(node.id)}, typeIdHex: "${idHex}", displayName: ${JSON.stringify(getDisplayNamePrefix(node))} }`;
}

export function createValue(value: schema.Value): string {
  let p: capnp.Pointer;

  switch (value.which()) {
    case schema.Value.BOOL: {
      return value.bool ? `true` : `false`;
    }

    case schema.Value.ENUM: {
      return String(value.enum);
    }

    case schema.Value.FLOAT32: {
      return String(value.float32);
    }

    case schema.Value.FLOAT64: {
      return String(value.float64);
    }

    case schema.Value.INT8: {
      return String(value.int8);
    }

    case schema.Value.INT16: {
      return String(value.int16);
    }

    case schema.Value.INT32: {
      return String(value.int32);
    }

    case schema.Value.INT64: {
      return createBigInt(value.int64);
    }

    case schema.Value.UINT8: {
      return String(value.uint8);
    }

    case schema.Value.UINT16: {
      return String(value.uint16);
    }

    case schema.Value.UINT32: {
      return String(value.uint32);
    }

    case schema.Value.UINT64: {
      return createBigInt(value.uint64);
    }

    case schema.Value.TEXT: {
      return JSON.stringify(value.text);
    }

    case schema.Value.VOID: {
      return "undefined";
    }

    case schema.Value.ANY_POINTER: {
      p = value.anyPointer;
      break;
    }

    case schema.Value.DATA: {
      p = value.data;
      break;
    }

    case schema.Value.LIST: {
      p = value.list;
      break;
    }

    case schema.Value.STRUCT: {
      p = value.struct;
      break;
    }

    case schema.Value.INTERFACE: {
      testWhich("interface", getUint16(0, value), 17, value);
      p = getPointer(0, value);
      break;
    }
    default: {
      throw new Error(format(E.GEN_SERIALIZE_UNKNOWN_VALUE, value.which()));
    }
  }

  const message = new capnp.Message();
  message.setRoot(p);

  const buf = new Uint8Array(message.toPackedArrayBuffer());

  const values: string[] = [];
  for (let i = 0; i < buf.byteLength; i++) {
    values.push(`0x${pad(buf[i].toString(16), 2)}`);
  }

  return `$.readRawPointer(new Uint8Array([${values.join(",")}]).buffer)`;
}

export function createNestedNodeProperty(node: schema.Node): string {
  const name = getDisplayNamePrefix(node);
  const initializer = getFullClassName(node);
  return `static readonly ${name} = ${initializer};`;
}
