import { S as Struct, O as ObjectSize, L as ListCtor, b as Orphan, f as List, P as Pointer } from '../shared/capnp-es.DGklrAbf.js';
import { D as Data } from '../shared/capnp-es.Dg18XjiA.js';

declare const _capnpFileId = 12195682960037147353n;
/**
* Information about one of the node's parameters.
*
*/
declare class Node_Parameter extends Struct {
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "name";
            readonly codeOrder: 0;
            readonly ordinal: 0;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "text";
            };
        }];
    };
    get name(): string;
    set name(value: string);
    toString(): string;
}
declare class Node_NestedNode extends Struct {
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "name";
            readonly codeOrder: 0;
            readonly ordinal: 0;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "text";
            };
        }, {
            readonly name: "id";
            readonly codeOrder: 1;
            readonly ordinal: 1;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "uint64";
            };
        }];
    };
    /**
  * Unqualified symbol name.  Unlike Node.displayName, this *can* be used programmatically.
  *
  * (On Zooko's triangle, this is the node's petname according to its parent scope.)
  *
  */
    get name(): string;
    set name(value: string);
    /**
  * ID of the nested node.  Typically, the target node's scopeId points back to this node, but
  * robust code should avoid relying on this.
  *
  */
    get id(): bigint;
    set id(value: bigint);
    toString(): string;
}
declare class Node_SourceInfo_Member extends Struct {
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "docComment";
            readonly codeOrder: 0;
            readonly ordinal: 0;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "text";
            };
        }];
    };
    /**
  * Doc comment on the member.
  *
  */
    get docComment(): string;
    set docComment(value: string);
    toString(): string;
}
/**
* Additional information about a node which is not needed at runtime, but may be useful for
* documentation or debugging purposes. This is kept in a separate struct to make sure it
* doesn't accidentally get included in contexts where it is not needed. The
* `CodeGeneratorRequest` includes this information in a separate array.
*
*/
declare class Node_SourceInfo extends Struct {
    static readonly Member: typeof Node_SourceInfo_Member;
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "id";
            readonly codeOrder: 0;
            readonly ordinal: 0;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "uint64";
            };
        }, {
            readonly name: "docComment";
            readonly codeOrder: 1;
            readonly ordinal: 1;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "text";
            };
        }, {
            readonly name: "members";
            readonly codeOrder: 2;
            readonly ordinal: 2;
            readonly kind: "slot";
            readonly offset: 1;
            readonly type: {
                readonly kind: "list";
                readonly elementType: {
                    readonly kind: "struct";
                    readonly typeId: 14031686161526562722n;
                    readonly typeIdHex: "c2ba9038898e1fa2";
                    readonly displayName: "Member";
                };
            };
        }];
    };
    static _Members: ListCtor<Node_SourceInfo_Member>;
    /**
  * ID of the Node which this info describes.
  *
  */
    get id(): bigint;
    set id(value: bigint);
    /**
  * The top-level doc comment for the Node.
  *
  */
    get docComment(): string;
    set docComment(value: string);
    _adoptMembers(value: Orphan<List<Node_SourceInfo_Member>>): void;
    _disownMembers(): Orphan<List<Node_SourceInfo_Member>>;
    /**
  * Information about each member -- i.e. fields (for structs), enumerants (for enums), or
  * methods (for interfaces).
  *
  * This list is the same length and order as the corresponding list in the Node, i.e.
  * Node.struct.fields, Node.enum.enumerants, or Node.interface.methods.
  *
  */
    get members(): List<Node_SourceInfo_Member>;
    _hasMembers(): boolean;
    _initMembers(length: number): List<Node_SourceInfo_Member>;
    set members(value: List<Node_SourceInfo_Member>);
    toString(): string;
}
declare class Node_Struct extends Struct {
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "dataWordCount";
            readonly codeOrder: 0;
            readonly ordinal: 7;
            readonly kind: "slot";
            readonly offset: 7;
            readonly type: {
                readonly kind: "uint16";
            };
        }, {
            readonly name: "pointerCount";
            readonly codeOrder: 1;
            readonly ordinal: 8;
            readonly kind: "slot";
            readonly offset: 12;
            readonly type: {
                readonly kind: "uint16";
            };
        }, {
            readonly name: "preferredListEncoding";
            readonly codeOrder: 2;
            readonly ordinal: 9;
            readonly kind: "slot";
            readonly offset: 13;
            readonly type: {
                readonly kind: "enum";
                readonly typeId: 15102134695616452902n;
                readonly typeIdHex: "d1958f7dba521926";
                readonly displayName: "ElementSize";
            };
        }, {
            readonly name: "isGroup";
            readonly codeOrder: 3;
            readonly ordinal: 10;
            readonly kind: "slot";
            readonly offset: 224;
            readonly type: {
                readonly kind: "bool";
            };
        }, {
            readonly name: "discriminantCount";
            readonly codeOrder: 4;
            readonly ordinal: 11;
            readonly kind: "slot";
            readonly offset: 15;
            readonly type: {
                readonly kind: "uint16";
            };
        }, {
            readonly name: "discriminantOffset";
            readonly codeOrder: 5;
            readonly ordinal: 12;
            readonly kind: "slot";
            readonly offset: 8;
            readonly type: {
                readonly kind: "uint32";
            };
        }, {
            readonly name: "fields";
            readonly codeOrder: 6;
            readonly ordinal: 13;
            readonly kind: "slot";
            readonly offset: 3;
            readonly type: {
                readonly kind: "list";
                readonly elementType: {
                    readonly kind: "struct";
                    readonly typeId: 11145653318641710175n;
                    readonly typeIdHex: "9aad50a41f4af45f";
                    readonly displayName: "Field";
                };
            };
        }];
    };
    static _Fields: ListCtor<Field>;
    /**
  * Size of the data section, in words.
  *
  */
    get dataWordCount(): number;
    set dataWordCount(value: number);
    /**
  * Size of the pointer section, in pointers (which are one word each).
  *
  */
    get pointerCount(): number;
    set pointerCount(value: number);
    /**
  * The preferred element size to use when encoding a list of this struct.  If this is anything
  * other than `inlineComposite` then the struct is one word or less in size and is a candidate
  * for list packing optimization.
  *
  */
    get preferredListEncoding(): ElementSize;
    set preferredListEncoding(value: ElementSize);
    /**
  * If true, then this "struct" node is actually not an independent node, but merely represents
  * some named union or group within a particular parent struct.  This node's scopeId refers
  * to the parent struct, which may itself be a union/group in yet another struct.
  *
  * All group nodes share the same dataWordCount and pointerCount as the top-level
  * struct, and their fields live in the same ordinal and offset spaces as all other fields in
  * the struct.
  *
  * Note that a named union is considered a special kind of group -- in fact, a named union
  * is exactly equivalent to a group that contains nothing but an unnamed union.
  *
  */
    get isGroup(): boolean;
    set isGroup(value: boolean);
    /**
  * Number of fields in this struct which are members of an anonymous union, and thus may
  * overlap.  If this is non-zero, then a 16-bit discriminant is present indicating which
  * of the overlapping fields is active.  This can never be 1 -- if it is non-zero, it must be
  * two or more.
  *
  * Note that the fields of an unnamed union are considered fields of the scope containing the
  * union -- an unnamed union is not its own group.  So, a top-level struct may contain a
  * non-zero discriminant count.  Named unions, on the other hand, are equivalent to groups
  * containing unnamed unions.  So, a named union has its own independent schema node, with
  * `isGroup` = true.
  *
  */
    get discriminantCount(): number;
    set discriminantCount(value: number);
    /**
  * If `discriminantCount` is non-zero, this is the offset of the union discriminant, in
  * multiples of 16 bits.
  *
  */
    get discriminantOffset(): number;
    set discriminantOffset(value: number);
    _adoptFields(value: Orphan<List<Field>>): void;
    _disownFields(): Orphan<List<Field>>;
    /**
  * Fields defined within this scope (either the struct's top-level fields, or the fields of
  * a particular group; see `isGroup`).
  *
  * The fields are sorted by ordinal number, but note that because groups share the same
  * ordinal space, the field's index in this list is not necessarily exactly its ordinal.
  * On the other hand, the field's position in this list does remain the same even as the
  * protocol evolves, since it is not possible to insert or remove an earlier ordinal.
  * Therefore, for most use cases, if you want to identify a field by number, it may make the
  * most sense to use the field's index in this list rather than its ordinal.
  *
  */
    get fields(): List<Field>;
    _hasFields(): boolean;
    _initFields(length: number): List<Field>;
    set fields(value: List<Field>);
    toString(): string;
}
declare class Node_Enum extends Struct {
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "enumerants";
            readonly codeOrder: 0;
            readonly ordinal: 14;
            readonly kind: "slot";
            readonly offset: 3;
            readonly type: {
                readonly kind: "list";
                readonly elementType: {
                    readonly kind: "struct";
                    readonly typeId: 10919677598968879693n;
                    readonly typeIdHex: "978a7cebdc549a4d";
                    readonly displayName: "Enumerant";
                };
            };
        }];
    };
    static _Enumerants: ListCtor<Enumerant>;
    _adoptEnumerants(value: Orphan<List<Enumerant>>): void;
    _disownEnumerants(): Orphan<List<Enumerant>>;
    /**
  * Enumerants ordered by numeric value (ordinal).
  *
  */
    get enumerants(): List<Enumerant>;
    _hasEnumerants(): boolean;
    _initEnumerants(length: number): List<Enumerant>;
    set enumerants(value: List<Enumerant>);
    toString(): string;
}
declare class Node_Interface extends Struct {
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "methods";
            readonly codeOrder: 0;
            readonly ordinal: 15;
            readonly kind: "slot";
            readonly offset: 3;
            readonly type: {
                readonly kind: "list";
                readonly elementType: {
                    readonly kind: "struct";
                    readonly typeId: 10736806783679155584n;
                    readonly typeIdHex: "9500cce23b334d80";
                    readonly displayName: "Method";
                };
            };
        }, {
            readonly name: "superclasses";
            readonly codeOrder: 1;
            readonly ordinal: 31;
            readonly kind: "slot";
            readonly offset: 4;
            readonly type: {
                readonly kind: "list";
                readonly elementType: {
                    readonly kind: "struct";
                    readonly typeId: 12220001500510083064n;
                    readonly typeIdHex: "a9962a9ed0a4d7f8";
                    readonly displayName: "Superclass";
                };
            };
        }];
    };
    static _Methods: ListCtor<Method>;
    static _Superclasses: ListCtor<Superclass>;
    _adoptMethods(value: Orphan<List<Method>>): void;
    _disownMethods(): Orphan<List<Method>>;
    /**
  * Methods ordered by ordinal.
  *
  */
    get methods(): List<Method>;
    _hasMethods(): boolean;
    _initMethods(length: number): List<Method>;
    set methods(value: List<Method>);
    _adoptSuperclasses(value: Orphan<List<Superclass>>): void;
    _disownSuperclasses(): Orphan<List<Superclass>>;
    /**
  * Superclasses of this interface.
  *
  */
    get superclasses(): List<Superclass>;
    _hasSuperclasses(): boolean;
    _initSuperclasses(length: number): List<Superclass>;
    set superclasses(value: List<Superclass>);
    toString(): string;
}
declare class Node_Const extends Struct {
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "type";
            readonly codeOrder: 0;
            readonly ordinal: 16;
            readonly kind: "slot";
            readonly offset: 3;
            readonly type: {
                readonly kind: "struct";
                readonly typeId: 15020482145304562784n;
                readonly typeIdHex: "d07378ede1f9cc60";
                readonly displayName: "Type";
            };
        }, {
            readonly name: "value";
            readonly codeOrder: 1;
            readonly ordinal: 17;
            readonly kind: "slot";
            readonly offset: 4;
            readonly type: {
                readonly kind: "struct";
                readonly typeId: 14853958794117909659n;
                readonly typeIdHex: "ce23dcd2d7b00c9b";
                readonly displayName: "Value";
            };
        }];
    };
    _adoptType(value: Orphan<Type>): void;
    _disownType(): Orphan<Type>;
    get type(): Type;
    _hasType(): boolean;
    _initType(): Type;
    set type(value: Type);
    _adoptValue(value: Orphan<Value>): void;
    _disownValue(): Orphan<Value>;
    get value(): Value;
    _hasValue(): boolean;
    _initValue(): Value;
    set value(value: Value);
    toString(): string;
}
declare class Node_Annotation extends Struct {
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "type";
            readonly codeOrder: 0;
            readonly ordinal: 18;
            readonly kind: "slot";
            readonly offset: 3;
            readonly type: {
                readonly kind: "struct";
                readonly typeId: 15020482145304562784n;
                readonly typeIdHex: "d07378ede1f9cc60";
                readonly displayName: "Type";
            };
        }, {
            readonly name: "targetsFile";
            readonly codeOrder: 1;
            readonly ordinal: 19;
            readonly kind: "slot";
            readonly offset: 112;
            readonly type: {
                readonly kind: "bool";
            };
        }, {
            readonly name: "targetsConst";
            readonly codeOrder: 2;
            readonly ordinal: 20;
            readonly kind: "slot";
            readonly offset: 113;
            readonly type: {
                readonly kind: "bool";
            };
        }, {
            readonly name: "targetsEnum";
            readonly codeOrder: 3;
            readonly ordinal: 21;
            readonly kind: "slot";
            readonly offset: 114;
            readonly type: {
                readonly kind: "bool";
            };
        }, {
            readonly name: "targetsEnumerant";
            readonly codeOrder: 4;
            readonly ordinal: 22;
            readonly kind: "slot";
            readonly offset: 115;
            readonly type: {
                readonly kind: "bool";
            };
        }, {
            readonly name: "targetsStruct";
            readonly codeOrder: 5;
            readonly ordinal: 23;
            readonly kind: "slot";
            readonly offset: 116;
            readonly type: {
                readonly kind: "bool";
            };
        }, {
            readonly name: "targetsField";
            readonly codeOrder: 6;
            readonly ordinal: 24;
            readonly kind: "slot";
            readonly offset: 117;
            readonly type: {
                readonly kind: "bool";
            };
        }, {
            readonly name: "targetsUnion";
            readonly codeOrder: 7;
            readonly ordinal: 25;
            readonly kind: "slot";
            readonly offset: 118;
            readonly type: {
                readonly kind: "bool";
            };
        }, {
            readonly name: "targetsGroup";
            readonly codeOrder: 8;
            readonly ordinal: 26;
            readonly kind: "slot";
            readonly offset: 119;
            readonly type: {
                readonly kind: "bool";
            };
        }, {
            readonly name: "targetsInterface";
            readonly codeOrder: 9;
            readonly ordinal: 27;
            readonly kind: "slot";
            readonly offset: 120;
            readonly type: {
                readonly kind: "bool";
            };
        }, {
            readonly name: "targetsMethod";
            readonly codeOrder: 10;
            readonly ordinal: 28;
            readonly kind: "slot";
            readonly offset: 121;
            readonly type: {
                readonly kind: "bool";
            };
        }, {
            readonly name: "targetsParam";
            readonly codeOrder: 11;
            readonly ordinal: 29;
            readonly kind: "slot";
            readonly offset: 122;
            readonly type: {
                readonly kind: "bool";
            };
        }, {
            readonly name: "targetsAnnotation";
            readonly codeOrder: 12;
            readonly ordinal: 30;
            readonly kind: "slot";
            readonly offset: 123;
            readonly type: {
                readonly kind: "bool";
            };
        }];
    };
    _adoptType(value: Orphan<Type>): void;
    _disownType(): Orphan<Type>;
    get type(): Type;
    _hasType(): boolean;
    _initType(): Type;
    set type(value: Type);
    get targetsFile(): boolean;
    set targetsFile(value: boolean);
    get targetsConst(): boolean;
    set targetsConst(value: boolean);
    get targetsEnum(): boolean;
    set targetsEnum(value: boolean);
    get targetsEnumerant(): boolean;
    set targetsEnumerant(value: boolean);
    get targetsStruct(): boolean;
    set targetsStruct(value: boolean);
    get targetsField(): boolean;
    set targetsField(value: boolean);
    get targetsUnion(): boolean;
    set targetsUnion(value: boolean);
    get targetsGroup(): boolean;
    set targetsGroup(value: boolean);
    get targetsInterface(): boolean;
    set targetsInterface(value: boolean);
    get targetsMethod(): boolean;
    set targetsMethod(value: boolean);
    get targetsParam(): boolean;
    set targetsParam(value: boolean);
    get targetsAnnotation(): boolean;
    set targetsAnnotation(value: boolean);
    toString(): string;
}
declare const Node_Which: {
    readonly FILE: 0;
    /**
  * Name to present to humans to identify this Node.  You should not attempt to parse this.  Its
  * format could change.  It is not guaranteed to be unique.
  *
  * (On Zooko's triangle, this is the node's nickname.)
  *
  */
    readonly STRUCT: 1;
    /**
  * If you want a shorter version of `displayName` (just naming this node, without its surrounding
  * scope), chop off this many characters from the beginning of `displayName`.
  *
  */
    readonly ENUM: 2;
    /**
  * ID of the lexical parent node.  Typically, the scope node will have a NestedNode pointing back
  * at this node, but robust code should avoid relying on this (and, in fact, group nodes are not
  * listed in the outer struct's nestedNodes, since they are listed in the fields).  `scopeId` is
  * zero if the node has no parent, which is normally only the case with files, but should be
  * allowed for any kind of node (in order to make runtime type generation easier).
  *
  */
    readonly INTERFACE: 3;
    /**
  * List of nodes nested within this node, along with the names under which they were declared.
  *
  */
    readonly CONST: 4;
    /**
  * Annotations applied to this node.
  *
  */
    readonly ANNOTATION: 5;
};
type Node_Which = (typeof Node_Which)[keyof typeof Node_Which];
declare class Node extends Struct {
    static readonly FILE: 0;
    static readonly STRUCT: 1;
    static readonly ENUM: 2;
    static readonly INTERFACE: 3;
    static readonly CONST: 4;
    static readonly ANNOTATION: 5;
    static readonly Parameter: typeof Node_Parameter;
    static readonly NestedNode: typeof Node_NestedNode;
    static readonly SourceInfo: typeof Node_SourceInfo;
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "id";
            readonly codeOrder: 0;
            readonly ordinal: 0;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "uint64";
            };
        }, {
            readonly name: "displayName";
            readonly codeOrder: 1;
            readonly ordinal: 1;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "text";
            };
        }, {
            readonly name: "displayNamePrefixLength";
            readonly codeOrder: 2;
            readonly ordinal: 2;
            readonly kind: "slot";
            readonly offset: 2;
            readonly type: {
                readonly kind: "uint32";
            };
        }, {
            readonly name: "scopeId";
            readonly codeOrder: 3;
            readonly ordinal: 3;
            readonly kind: "slot";
            readonly offset: 2;
            readonly type: {
                readonly kind: "uint64";
            };
        }, {
            readonly name: "parameters";
            readonly codeOrder: 4;
            readonly ordinal: 32;
            readonly kind: "slot";
            readonly offset: 5;
            readonly type: {
                readonly kind: "list";
                readonly elementType: {
                    readonly kind: "struct";
                    readonly typeId: 13353766412138554289n;
                    readonly typeIdHex: "b9521bccf10fa3b1";
                    readonly displayName: "Parameter";
                };
            };
        }, {
            readonly name: "isGeneric";
            readonly codeOrder: 5;
            readonly ordinal: 33;
            readonly kind: "slot";
            readonly offset: 288;
            readonly type: {
                readonly kind: "bool";
            };
        }, {
            readonly name: "nestedNodes";
            readonly codeOrder: 6;
            readonly ordinal: 4;
            readonly kind: "slot";
            readonly offset: 1;
            readonly type: {
                readonly kind: "list";
                readonly elementType: {
                    readonly kind: "struct";
                    readonly typeId: 16050641862814319170n;
                    readonly typeIdHex: "debf55bbfa0fc242";
                    readonly displayName: "NestedNode";
                };
            };
        }, {
            readonly name: "annotations";
            readonly codeOrder: 7;
            readonly ordinal: 5;
            readonly kind: "slot";
            readonly offset: 2;
            readonly type: {
                readonly kind: "list";
                readonly elementType: {
                    readonly kind: "struct";
                    readonly typeId: 17422339044421236034n;
                    readonly typeIdHex: "f1c8950dab257542";
                    readonly displayName: "Annotation";
                };
            };
        }, {
            readonly name: "file";
            readonly codeOrder: 8;
            readonly ordinal: 6;
            readonly discriminantValue: 0;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "void";
            };
        }, {
            readonly name: "struct";
            readonly codeOrder: 9;
            readonly ordinal: 7;
            readonly discriminantValue: 1;
            readonly kind: "group";
            readonly type: {
                readonly kind: "group";
                readonly typeId: 11430331134483579957n;
                readonly typeIdHex: "9ea0b19b37fb4435";
                readonly displayName: "struct";
            };
        }, {
            readonly name: "enum";
            readonly codeOrder: 10;
            readonly ordinal: 8;
            readonly discriminantValue: 2;
            readonly kind: "group";
            readonly type: {
                readonly kind: "group";
                readonly typeId: 13063450714778629528n;
                readonly typeIdHex: "b54ab3364333f598";
                readonly displayName: "enum";
            };
        }, {
            readonly name: "interface";
            readonly codeOrder: 11;
            readonly ordinal: 9;
            readonly discriminantValue: 3;
            readonly kind: "group";
            readonly type: {
                readonly kind: "group";
                readonly typeId: 16728431493453586831n;
                readonly typeIdHex: "e82753cff0c2218f";
                readonly displayName: "interface";
            };
        }, {
            readonly name: "const";
            readonly codeOrder: 12;
            readonly ordinal: 10;
            readonly discriminantValue: 4;
            readonly kind: "group";
            readonly type: {
                readonly kind: "group";
                readonly typeId: 12793219851699983392n;
                readonly typeIdHex: "b18aa5ac7a0d9420";
                readonly displayName: "const";
            };
        }, {
            readonly name: "annotation";
            readonly codeOrder: 13;
            readonly ordinal: 11;
            readonly discriminantValue: 5;
            readonly kind: "group";
            readonly type: {
                readonly kind: "group";
                readonly typeId: 17011813041836786320n;
                readonly typeIdHex: "ec1619d4400a0290";
                readonly displayName: "annotation";
            };
        }];
    };
    static _Parameters: ListCtor<Node_Parameter>;
    static _NestedNodes: ListCtor<Node_NestedNode>;
    static _Annotations: ListCtor<Annotation>;
    get id(): bigint;
    set id(value: bigint);
    /**
  * Name to present to humans to identify this Node.  You should not attempt to parse this.  Its
  * format could change.  It is not guaranteed to be unique.
  *
  * (On Zooko's triangle, this is the node's nickname.)
  *
  */
    get displayName(): string;
    set displayName(value: string);
    /**
  * If you want a shorter version of `displayName` (just naming this node, without its surrounding
  * scope), chop off this many characters from the beginning of `displayName`.
  *
  */
    get displayNamePrefixLength(): number;
    set displayNamePrefixLength(value: number);
    /**
  * ID of the lexical parent node.  Typically, the scope node will have a NestedNode pointing back
  * at this node, but robust code should avoid relying on this (and, in fact, group nodes are not
  * listed in the outer struct's nestedNodes, since they are listed in the fields).  `scopeId` is
  * zero if the node has no parent, which is normally only the case with files, but should be
  * allowed for any kind of node (in order to make runtime type generation easier).
  *
  */
    get scopeId(): bigint;
    set scopeId(value: bigint);
    _adoptParameters(value: Orphan<List<Node_Parameter>>): void;
    _disownParameters(): Orphan<List<Node_Parameter>>;
    /**
  * If this node is parameterized (generic), the list of parameters. Empty for non-generic types.
  *
  */
    get parameters(): List<Node_Parameter>;
    _hasParameters(): boolean;
    _initParameters(length: number): List<Node_Parameter>;
    set parameters(value: List<Node_Parameter>);
    /**
  * True if this node is generic, meaning that it or one of its parent scopes has a non-empty
  * `parameters`.
  *
  */
    get isGeneric(): boolean;
    set isGeneric(value: boolean);
    _adoptNestedNodes(value: Orphan<List<Node_NestedNode>>): void;
    _disownNestedNodes(): Orphan<List<Node_NestedNode>>;
    /**
  * List of nodes nested within this node, along with the names under which they were declared.
  *
  */
    get nestedNodes(): List<Node_NestedNode>;
    _hasNestedNodes(): boolean;
    _initNestedNodes(length: number): List<Node_NestedNode>;
    set nestedNodes(value: List<Node_NestedNode>);
    _adoptAnnotations(value: Orphan<List<Annotation>>): void;
    _disownAnnotations(): Orphan<List<Annotation>>;
    /**
  * Annotations applied to this node.
  *
  */
    get annotations(): List<Annotation>;
    _hasAnnotations(): boolean;
    _initAnnotations(length: number): List<Annotation>;
    set annotations(value: List<Annotation>);
    get _isFile(): boolean;
    set file(_: true);
    get struct(): Node_Struct;
    _initStruct(): Node_Struct;
    get _isStruct(): boolean;
    set struct(_: true);
    get enum(): Node_Enum;
    _initEnum(): Node_Enum;
    get _isEnum(): boolean;
    set enum(_: true);
    get interface(): Node_Interface;
    _initInterface(): Node_Interface;
    get _isInterface(): boolean;
    set interface(_: true);
    get const(): Node_Const;
    _initConst(): Node_Const;
    get _isConst(): boolean;
    set const(_: true);
    get annotation(): Node_Annotation;
    _initAnnotation(): Node_Annotation;
    get _isAnnotation(): boolean;
    set annotation(_: true);
    toString(): string;
    which(): Node_Which;
}
/**
* A regular, non-group, non-fixed-list field.
*
*/
declare class Field_Slot extends Struct {
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "offset";
            readonly codeOrder: 0;
            readonly ordinal: 4;
            readonly kind: "slot";
            readonly offset: 1;
            readonly type: {
                readonly kind: "uint32";
            };
        }, {
            readonly name: "type";
            readonly codeOrder: 1;
            readonly ordinal: 5;
            readonly kind: "slot";
            readonly offset: 2;
            readonly type: {
                readonly kind: "struct";
                readonly typeId: 15020482145304562784n;
                readonly typeIdHex: "d07378ede1f9cc60";
                readonly displayName: "Type";
            };
        }, {
            readonly name: "defaultValue";
            readonly codeOrder: 2;
            readonly ordinal: 6;
            readonly kind: "slot";
            readonly offset: 3;
            readonly type: {
                readonly kind: "struct";
                readonly typeId: 14853958794117909659n;
                readonly typeIdHex: "ce23dcd2d7b00c9b";
                readonly displayName: "Value";
            };
        }, {
            readonly name: "hadExplicitDefault";
            readonly codeOrder: 3;
            readonly ordinal: 10;
            readonly kind: "slot";
            readonly offset: 128;
            readonly type: {
                readonly kind: "bool";
            };
        }];
    };
    /**
  * Offset, in units of the field's size, from the beginning of the section in which the field
  * resides.  E.g. for a UInt32 field, multiply this by 4 to get the byte offset from the
  * beginning of the data section.
  *
  */
    get offset(): number;
    set offset(value: number);
    _adoptType(value: Orphan<Type>): void;
    _disownType(): Orphan<Type>;
    get type(): Type;
    _hasType(): boolean;
    _initType(): Type;
    set type(value: Type);
    _adoptDefaultValue(value: Orphan<Value>): void;
    _disownDefaultValue(): Orphan<Value>;
    get defaultValue(): Value;
    _hasDefaultValue(): boolean;
    _initDefaultValue(): Value;
    set defaultValue(value: Value);
    /**
  * Whether the default value was specified explicitly.  Non-explicit default values are always
  * zero or empty values.  Usually, whether the default value was explicit shouldn't matter.
  * The main use case for this flag is for structs representing method parameters:
  * explicitly-defaulted parameters may be allowed to be omitted when calling the method.
  *
  */
    get hadExplicitDefault(): boolean;
    set hadExplicitDefault(value: boolean);
    toString(): string;
}
/**
* A group.
*
*/
declare class Field_Group extends Struct {
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "typeId";
            readonly codeOrder: 0;
            readonly ordinal: 7;
            readonly kind: "slot";
            readonly offset: 2;
            readonly type: {
                readonly kind: "uint64";
            };
        }];
    };
    /**
  * The ID of the group's node.
  *
  */
    get typeId(): bigint;
    set typeId(value: bigint);
    toString(): string;
}
declare const Field_Ordinal_Which: {
    readonly IMPLICIT: 0;
    /**
  * The original ordinal number given to the field.  You probably should NOT use this; if you need
  * a numeric identifier for a field, use its position within the field array for its scope.
  * The ordinal is given here mainly just so that the original schema text can be reproduced given
  * the compiled version -- i.e. so that `capnp compile -ocapnp` can do its job.
  *
  */
    readonly EXPLICIT: 1;
};
type Field_Ordinal_Which = (typeof Field_Ordinal_Which)[keyof typeof Field_Ordinal_Which];
declare class Field_Ordinal extends Struct {
    static readonly IMPLICIT: 0;
    static readonly EXPLICIT: 1;
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "implicit";
            readonly codeOrder: 0;
            readonly ordinal: 8;
            readonly discriminantValue: 0;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "void";
            };
        }, {
            readonly name: "explicit";
            readonly codeOrder: 1;
            readonly ordinal: 9;
            readonly discriminantValue: 1;
            readonly kind: "slot";
            readonly offset: 6;
            readonly type: {
                readonly kind: "uint16";
            };
        }];
    };
    get _isImplicit(): boolean;
    set implicit(_: true);
    /**
  * The original ordinal number given to the field.  You probably should NOT use this; if you need
  * a numeric identifier for a field, use its position within the field array for its scope.
  * The ordinal is given here mainly just so that the original schema text can be reproduced given
  * the compiled version -- i.e. so that `capnp compile -ocapnp` can do its job.
  *
  */
    get explicit(): number;
    get _isExplicit(): boolean;
    set explicit(value: number);
    toString(): string;
    which(): Field_Ordinal_Which;
}
declare const Field_Which: {
    readonly SLOT: 0;
    /**
  * Indicates where this member appeared in the code, relative to other members.
  * Code ordering may have semantic relevance -- programmers tend to place related fields
  * together.  So, using code ordering makes sense in human-readable formats where ordering is
  * otherwise irrelevant, like JSON.  The values of codeOrder are tightly-packed, so the maximum
  * value is count(members) - 1.  Fields that are members of a union are only ordered relative to
  * the other members of that union, so the maximum value there is count(union.members).
  *
  */
    readonly GROUP: 1;
};
type Field_Which = (typeof Field_Which)[keyof typeof Field_Which];
/**
* Schema for a field of a struct.
*
*/
declare class Field extends Struct {
    static readonly NO_DISCRIMINANT = 65535;
    static readonly SLOT: 0;
    static readonly GROUP: 1;
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "name";
            readonly codeOrder: 0;
            readonly ordinal: 0;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "text";
            };
        }, {
            readonly name: "codeOrder";
            readonly codeOrder: 1;
            readonly ordinal: 1;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "uint16";
            };
        }, {
            readonly name: "annotations";
            readonly codeOrder: 2;
            readonly ordinal: 2;
            readonly kind: "slot";
            readonly offset: 1;
            readonly type: {
                readonly kind: "list";
                readonly elementType: {
                    readonly kind: "struct";
                    readonly typeId: 17422339044421236034n;
                    readonly typeIdHex: "f1c8950dab257542";
                    readonly displayName: "Annotation";
                };
            };
        }, {
            readonly name: "discriminantValue";
            readonly codeOrder: 3;
            readonly ordinal: 3;
            readonly kind: "slot";
            readonly offset: 1;
            readonly type: {
                readonly kind: "uint16";
            };
        }, {
            readonly name: "slot";
            readonly codeOrder: 4;
            readonly ordinal: 4;
            readonly discriminantValue: 0;
            readonly kind: "group";
            readonly type: {
                readonly kind: "group";
                readonly typeId: 14133145859926553711n;
                readonly typeIdHex: "c42305476bb4746f";
                readonly displayName: "slot";
            };
        }, {
            readonly name: "group";
            readonly codeOrder: 5;
            readonly ordinal: 5;
            readonly discriminantValue: 1;
            readonly kind: "group";
            readonly type: {
                readonly kind: "group";
                readonly typeId: 14626792032033250577n;
                readonly typeIdHex: "cafccddb68db1d11";
                readonly displayName: "group";
            };
        }, {
            readonly name: "ordinal";
            readonly codeOrder: 6;
            readonly ordinal: 6;
            readonly kind: "group";
            readonly type: {
                readonly kind: "group";
                readonly typeId: 13515537513213004774n;
                readonly typeIdHex: "bb90d5c287870be6";
                readonly displayName: "ordinal";
            };
        }];
        defaultDiscriminantValue: DataView<ArrayBufferLike>;
    };
    static _Annotations: ListCtor<Annotation>;
    get name(): string;
    set name(value: string);
    /**
  * Indicates where this member appeared in the code, relative to other members.
  * Code ordering may have semantic relevance -- programmers tend to place related fields
  * together.  So, using code ordering makes sense in human-readable formats where ordering is
  * otherwise irrelevant, like JSON.  The values of codeOrder are tightly-packed, so the maximum
  * value is count(members) - 1.  Fields that are members of a union are only ordered relative to
  * the other members of that union, so the maximum value there is count(union.members).
  *
  */
    get codeOrder(): number;
    set codeOrder(value: number);
    _adoptAnnotations(value: Orphan<List<Annotation>>): void;
    _disownAnnotations(): Orphan<List<Annotation>>;
    get annotations(): List<Annotation>;
    _hasAnnotations(): boolean;
    _initAnnotations(length: number): List<Annotation>;
    set annotations(value: List<Annotation>);
    /**
  * If the field is in a union, this is the value which the union's discriminant should take when
  * the field is active.  If the field is not in a union, this is 0xffff.
  *
  */
    get discriminantValue(): number;
    set discriminantValue(value: number);
    /**
  * A regular, non-group, non-fixed-list field.
  *
  */
    get slot(): Field_Slot;
    _initSlot(): Field_Slot;
    get _isSlot(): boolean;
    set slot(_: true);
    /**
  * A group.
  *
  */
    get group(): Field_Group;
    _initGroup(): Field_Group;
    get _isGroup(): boolean;
    set group(_: true);
    get ordinal(): Field_Ordinal;
    _initOrdinal(): Field_Ordinal;
    toString(): string;
    which(): Field_Which;
}
/**
* Schema for member of an enum.
*
*/
declare class Enumerant extends Struct {
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "name";
            readonly codeOrder: 0;
            readonly ordinal: 0;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "text";
            };
        }, {
            readonly name: "codeOrder";
            readonly codeOrder: 1;
            readonly ordinal: 1;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "uint16";
            };
        }, {
            readonly name: "annotations";
            readonly codeOrder: 2;
            readonly ordinal: 2;
            readonly kind: "slot";
            readonly offset: 1;
            readonly type: {
                readonly kind: "list";
                readonly elementType: {
                    readonly kind: "struct";
                    readonly typeId: 17422339044421236034n;
                    readonly typeIdHex: "f1c8950dab257542";
                    readonly displayName: "Annotation";
                };
            };
        }];
    };
    static _Annotations: ListCtor<Annotation>;
    get name(): string;
    set name(value: string);
    /**
  * Specifies order in which the enumerants were declared in the code.
  * Like utils.Field.codeOrder.
  *
  */
    get codeOrder(): number;
    set codeOrder(value: number);
    _adoptAnnotations(value: Orphan<List<Annotation>>): void;
    _disownAnnotations(): Orphan<List<Annotation>>;
    get annotations(): List<Annotation>;
    _hasAnnotations(): boolean;
    _initAnnotations(length: number): List<Annotation>;
    set annotations(value: List<Annotation>);
    toString(): string;
}
declare class Superclass extends Struct {
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "id";
            readonly codeOrder: 0;
            readonly ordinal: 0;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "uint64";
            };
        }, {
            readonly name: "brand";
            readonly codeOrder: 1;
            readonly ordinal: 1;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "struct";
                readonly typeId: 10391024731148337707n;
                readonly typeIdHex: "903455f06065422b";
                readonly displayName: "Brand";
            };
        }];
    };
    get id(): bigint;
    set id(value: bigint);
    _adoptBrand(value: Orphan<Brand>): void;
    _disownBrand(): Orphan<Brand>;
    get brand(): Brand;
    _hasBrand(): boolean;
    _initBrand(): Brand;
    set brand(value: Brand);
    toString(): string;
}
/**
* Schema for method of an interface.
*
*/
declare class Method extends Struct {
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "name";
            readonly codeOrder: 0;
            readonly ordinal: 0;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "text";
            };
        }, {
            readonly name: "codeOrder";
            readonly codeOrder: 1;
            readonly ordinal: 1;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "uint16";
            };
        }, {
            readonly name: "implicitParameters";
            readonly codeOrder: 2;
            readonly ordinal: 7;
            readonly kind: "slot";
            readonly offset: 4;
            readonly type: {
                readonly kind: "list";
                readonly elementType: {
                    readonly kind: "struct";
                    readonly typeId: 13353766412138554289n;
                    readonly typeIdHex: "b9521bccf10fa3b1";
                    readonly displayName: "Parameter";
                };
            };
        }, {
            readonly name: "paramStructType";
            readonly codeOrder: 3;
            readonly ordinal: 2;
            readonly kind: "slot";
            readonly offset: 1;
            readonly type: {
                readonly kind: "uint64";
            };
        }, {
            readonly name: "paramBrand";
            readonly codeOrder: 4;
            readonly ordinal: 5;
            readonly kind: "slot";
            readonly offset: 2;
            readonly type: {
                readonly kind: "struct";
                readonly typeId: 10391024731148337707n;
                readonly typeIdHex: "903455f06065422b";
                readonly displayName: "Brand";
            };
        }, {
            readonly name: "resultStructType";
            readonly codeOrder: 5;
            readonly ordinal: 3;
            readonly kind: "slot";
            readonly offset: 2;
            readonly type: {
                readonly kind: "uint64";
            };
        }, {
            readonly name: "resultBrand";
            readonly codeOrder: 6;
            readonly ordinal: 6;
            readonly kind: "slot";
            readonly offset: 3;
            readonly type: {
                readonly kind: "struct";
                readonly typeId: 10391024731148337707n;
                readonly typeIdHex: "903455f06065422b";
                readonly displayName: "Brand";
            };
        }, {
            readonly name: "annotations";
            readonly codeOrder: 7;
            readonly ordinal: 4;
            readonly kind: "slot";
            readonly offset: 1;
            readonly type: {
                readonly kind: "list";
                readonly elementType: {
                    readonly kind: "struct";
                    readonly typeId: 17422339044421236034n;
                    readonly typeIdHex: "f1c8950dab257542";
                    readonly displayName: "Annotation";
                };
            };
        }];
    };
    static _ImplicitParameters: ListCtor<Node_Parameter>;
    static _Annotations: ListCtor<Annotation>;
    get name(): string;
    set name(value: string);
    /**
  * Specifies order in which the methods were declared in the code.
  * Like utils.Field.codeOrder.
  *
  */
    get codeOrder(): number;
    set codeOrder(value: number);
    _adoptImplicitParameters(value: Orphan<List<Node_Parameter>>): void;
    _disownImplicitParameters(): Orphan<List<Node_Parameter>>;
    /**
  * The parameters listed in [] (typically, type / generic parameters), whose bindings are intended
  * to be inferred rather than specified explicitly, although not all languages support this.
  *
  */
    get implicitParameters(): List<Node_Parameter>;
    _hasImplicitParameters(): boolean;
    _initImplicitParameters(length: number): List<Node_Parameter>;
    set implicitParameters(value: List<Node_Parameter>);
    /**
  * ID of the parameter struct type.  If a named parameter list was specified in the method
  * declaration (rather than a single struct parameter type) then a corresponding struct type is
  * auto-generated.  Such an auto-generated type will not be listed in the interface's
  * `nestedNodes` and its `scopeId` will be zero -- it is completely detached from the namespace.
  * (Awkwardly, it does of course inherit generic parameters from the method's scope, which makes
  * this a situation where you can't just climb the scope chain to find where a particular
  * generic parameter was introduced. Making the `scopeId` zero was a mistake.)
  *
  */
    get paramStructType(): bigint;
    set paramStructType(value: bigint);
    _adoptParamBrand(value: Orphan<Brand>): void;
    _disownParamBrand(): Orphan<Brand>;
    /**
  * Brand of param struct type.
  *
  */
    get paramBrand(): Brand;
    _hasParamBrand(): boolean;
    _initParamBrand(): Brand;
    set paramBrand(value: Brand);
    /**
  * ID of the return struct type; similar to `paramStructType`.
  *
  */
    get resultStructType(): bigint;
    set resultStructType(value: bigint);
    _adoptResultBrand(value: Orphan<Brand>): void;
    _disownResultBrand(): Orphan<Brand>;
    /**
  * Brand of result struct type.
  *
  */
    get resultBrand(): Brand;
    _hasResultBrand(): boolean;
    _initResultBrand(): Brand;
    set resultBrand(value: Brand);
    _adoptAnnotations(value: Orphan<List<Annotation>>): void;
    _disownAnnotations(): Orphan<List<Annotation>>;
    get annotations(): List<Annotation>;
    _hasAnnotations(): boolean;
    _initAnnotations(length: number): List<Annotation>;
    set annotations(value: List<Annotation>);
    toString(): string;
}
declare class Type_List extends Struct {
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "elementType";
            readonly codeOrder: 0;
            readonly ordinal: 14;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "struct";
                readonly typeId: 15020482145304562784n;
                readonly typeIdHex: "d07378ede1f9cc60";
                readonly displayName: "Type";
            };
        }];
    };
    _adoptElementType(value: Orphan<Type>): void;
    _disownElementType(): Orphan<Type>;
    get elementType(): Type;
    _hasElementType(): boolean;
    _initElementType(): Type;
    set elementType(value: Type);
    toString(): string;
}
declare class Type_Enum extends Struct {
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "typeId";
            readonly codeOrder: 0;
            readonly ordinal: 15;
            readonly kind: "slot";
            readonly offset: 1;
            readonly type: {
                readonly kind: "uint64";
            };
        }, {
            readonly name: "brand";
            readonly codeOrder: 1;
            readonly ordinal: 21;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "struct";
                readonly typeId: 10391024731148337707n;
                readonly typeIdHex: "903455f06065422b";
                readonly displayName: "Brand";
            };
        }];
    };
    get typeId(): bigint;
    set typeId(value: bigint);
    _adoptBrand(value: Orphan<Brand>): void;
    _disownBrand(): Orphan<Brand>;
    get brand(): Brand;
    _hasBrand(): boolean;
    _initBrand(): Brand;
    set brand(value: Brand);
    toString(): string;
}
declare class Type_Struct extends Struct {
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "typeId";
            readonly codeOrder: 0;
            readonly ordinal: 16;
            readonly kind: "slot";
            readonly offset: 1;
            readonly type: {
                readonly kind: "uint64";
            };
        }, {
            readonly name: "brand";
            readonly codeOrder: 1;
            readonly ordinal: 22;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "struct";
                readonly typeId: 10391024731148337707n;
                readonly typeIdHex: "903455f06065422b";
                readonly displayName: "Brand";
            };
        }];
    };
    get typeId(): bigint;
    set typeId(value: bigint);
    _adoptBrand(value: Orphan<Brand>): void;
    _disownBrand(): Orphan<Brand>;
    get brand(): Brand;
    _hasBrand(): boolean;
    _initBrand(): Brand;
    set brand(value: Brand);
    toString(): string;
}
declare class Type_Interface extends Struct {
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "typeId";
            readonly codeOrder: 0;
            readonly ordinal: 17;
            readonly kind: "slot";
            readonly offset: 1;
            readonly type: {
                readonly kind: "uint64";
            };
        }, {
            readonly name: "brand";
            readonly codeOrder: 1;
            readonly ordinal: 23;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "struct";
                readonly typeId: 10391024731148337707n;
                readonly typeIdHex: "903455f06065422b";
                readonly displayName: "Brand";
            };
        }];
    };
    get typeId(): bigint;
    set typeId(value: bigint);
    _adoptBrand(value: Orphan<Brand>): void;
    _disownBrand(): Orphan<Brand>;
    get brand(): Brand;
    _hasBrand(): boolean;
    _initBrand(): Brand;
    set brand(value: Brand);
    toString(): string;
}
declare const Type_AnyPointer_Unconstrained_Which: {
    /**
  * truly AnyPointer
  *
  */
    readonly ANY_KIND: 0;
    /**
  * AnyStruct
  *
  */
    readonly STRUCT: 1;
    /**
  * AnyList
  *
  */
    readonly LIST: 2;
    /**
  * Capability
  *
  */
    readonly CAPABILITY: 3;
};
type Type_AnyPointer_Unconstrained_Which = (typeof Type_AnyPointer_Unconstrained_Which)[keyof typeof Type_AnyPointer_Unconstrained_Which];
/**
* A regular AnyPointer.
*
* The name "unconstrained" means as opposed to constraining it to match a type parameter.
* In retrospect this name is probably a poor choice given that it may still be constrained
* to be a struct, list, or capability.
*
*/
declare class Type_AnyPointer_Unconstrained extends Struct {
    static readonly ANY_KIND: 0;
    static readonly STRUCT: 1;
    static readonly LIST: 2;
    static readonly CAPABILITY: 3;
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "anyKind";
            readonly codeOrder: 0;
            readonly ordinal: 18;
            readonly discriminantValue: 0;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "void";
            };
        }, {
            readonly name: "struct";
            readonly codeOrder: 1;
            readonly ordinal: 25;
            readonly discriminantValue: 1;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "void";
            };
        }, {
            readonly name: "list";
            readonly codeOrder: 2;
            readonly ordinal: 26;
            readonly discriminantValue: 2;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "void";
            };
        }, {
            readonly name: "capability";
            readonly codeOrder: 3;
            readonly ordinal: 27;
            readonly discriminantValue: 3;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "void";
            };
        }];
    };
    get _isAnyKind(): boolean;
    set anyKind(_: true);
    get _isStruct(): boolean;
    set struct(_: true);
    get _isList(): boolean;
    set list(_: true);
    get _isCapability(): boolean;
    set capability(_: true);
    toString(): string;
    which(): Type_AnyPointer_Unconstrained_Which;
}
/**
* This is actually a reference to a type parameter defined within this scope.
*
*/
declare class Type_AnyPointer_Parameter extends Struct {
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "scopeId";
            readonly codeOrder: 0;
            readonly ordinal: 19;
            readonly kind: "slot";
            readonly offset: 2;
            readonly type: {
                readonly kind: "uint64";
            };
        }, {
            readonly name: "parameterIndex";
            readonly codeOrder: 1;
            readonly ordinal: 20;
            readonly kind: "slot";
            readonly offset: 5;
            readonly type: {
                readonly kind: "uint16";
            };
        }];
    };
    /**
  * ID of the generic type whose parameter we're referencing. This should be a parent of the
  * current scope.
  *
  */
    get scopeId(): bigint;
    set scopeId(value: bigint);
    /**
  * Index of the parameter within the generic type's parameter list.
  *
  */
    get parameterIndex(): number;
    set parameterIndex(value: number);
    toString(): string;
}
/**
* This is actually a reference to an implicit (generic) parameter of a method. The only
* legal context for this type to appear is inside Method.paramBrand or Method.resultBrand.
*
*/
declare class Type_AnyPointer_ImplicitMethodParameter extends Struct {
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "parameterIndex";
            readonly codeOrder: 0;
            readonly ordinal: 24;
            readonly kind: "slot";
            readonly offset: 5;
            readonly type: {
                readonly kind: "uint16";
            };
        }];
    };
    get parameterIndex(): number;
    set parameterIndex(value: number);
    toString(): string;
}
declare const Type_AnyPointer_Which: {
    /**
  * A regular AnyPointer.
  *
  * The name "unconstrained" means as opposed to constraining it to match a type parameter.
  * In retrospect this name is probably a poor choice given that it may still be constrained
  * to be a struct, list, or capability.
  *
  */
    readonly UNCONSTRAINED: 0;
    /**
  * This is actually a reference to a type parameter defined within this scope.
  *
  */
    readonly PARAMETER: 1;
    /**
  * This is actually a reference to an implicit (generic) parameter of a method. The only
  * legal context for this type to appear is inside Method.paramBrand or Method.resultBrand.
  *
  */
    readonly IMPLICIT_METHOD_PARAMETER: 2;
};
type Type_AnyPointer_Which = (typeof Type_AnyPointer_Which)[keyof typeof Type_AnyPointer_Which];
declare class Type_AnyPointer extends Struct {
    static readonly UNCONSTRAINED: 0;
    static readonly PARAMETER: 1;
    static readonly IMPLICIT_METHOD_PARAMETER: 2;
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "unconstrained";
            readonly codeOrder: 0;
            readonly ordinal: 0;
            readonly discriminantValue: 0;
            readonly kind: "group";
            readonly type: {
                readonly kind: "group";
                readonly typeId: 10248890354574636630n;
                readonly typeIdHex: "8e3b5f79fe593656";
                readonly displayName: "unconstrained";
            };
        }, {
            readonly name: "parameter";
            readonly codeOrder: 1;
            readonly ordinal: 1;
            readonly discriminantValue: 1;
            readonly kind: "group";
            readonly type: {
                readonly kind: "group";
                readonly typeId: 11372142272178113157n;
                readonly typeIdHex: "9dd1f724f4614a85";
                readonly displayName: "parameter";
            };
        }, {
            readonly name: "implicitMethodParameter";
            readonly codeOrder: 2;
            readonly ordinal: 2;
            readonly discriminantValue: 2;
            readonly kind: "group";
            readonly type: {
                readonly kind: "group";
                readonly typeId: 13470206089842057844n;
                readonly typeIdHex: "baefc9120c56e274";
                readonly displayName: "implicitMethodParameter";
            };
        }];
    };
    /**
  * A regular AnyPointer.
  *
  * The name "unconstrained" means as opposed to constraining it to match a type parameter.
  * In retrospect this name is probably a poor choice given that it may still be constrained
  * to be a struct, list, or capability.
  *
  */
    get unconstrained(): Type_AnyPointer_Unconstrained;
    _initUnconstrained(): Type_AnyPointer_Unconstrained;
    get _isUnconstrained(): boolean;
    set unconstrained(_: true);
    /**
  * This is actually a reference to a type parameter defined within this scope.
  *
  */
    get parameter(): Type_AnyPointer_Parameter;
    _initParameter(): Type_AnyPointer_Parameter;
    get _isParameter(): boolean;
    set parameter(_: true);
    /**
  * This is actually a reference to an implicit (generic) parameter of a method. The only
  * legal context for this type to appear is inside Method.paramBrand or Method.resultBrand.
  *
  */
    get implicitMethodParameter(): Type_AnyPointer_ImplicitMethodParameter;
    _initImplicitMethodParameter(): Type_AnyPointer_ImplicitMethodParameter;
    get _isImplicitMethodParameter(): boolean;
    set implicitMethodParameter(_: true);
    toString(): string;
    which(): Type_AnyPointer_Which;
}
declare const Type_Which: {
    readonly VOID: 0;
    readonly BOOL: 1;
    readonly INT8: 2;
    readonly INT16: 3;
    readonly INT32: 4;
    readonly INT64: 5;
    readonly UINT8: 6;
    readonly UINT16: 7;
    readonly UINT32: 8;
    readonly UINT64: 9;
    readonly FLOAT32: 10;
    readonly FLOAT64: 11;
    readonly TEXT: 12;
    readonly DATA: 13;
    readonly LIST: 14;
    readonly ENUM: 15;
    readonly STRUCT: 16;
    readonly INTERFACE: 17;
    readonly ANY_POINTER: 18;
};
type Type_Which = (typeof Type_Which)[keyof typeof Type_Which];
/**
* Represents a type expression.
*
*/
declare class Type extends Struct {
    static readonly VOID: 0;
    static readonly BOOL: 1;
    static readonly INT8: 2;
    static readonly INT16: 3;
    static readonly INT32: 4;
    static readonly INT64: 5;
    static readonly UINT8: 6;
    static readonly UINT16: 7;
    static readonly UINT32: 8;
    static readonly UINT64: 9;
    static readonly FLOAT32: 10;
    static readonly FLOAT64: 11;
    static readonly TEXT: 12;
    static readonly DATA: 13;
    static readonly LIST: 14;
    static readonly ENUM: 15;
    static readonly STRUCT: 16;
    static readonly INTERFACE: 17;
    static readonly ANY_POINTER: 18;
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "void";
            readonly codeOrder: 0;
            readonly ordinal: 0;
            readonly discriminantValue: 0;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "void";
            };
        }, {
            readonly name: "bool";
            readonly codeOrder: 1;
            readonly ordinal: 1;
            readonly discriminantValue: 1;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "void";
            };
        }, {
            readonly name: "int8";
            readonly codeOrder: 2;
            readonly ordinal: 2;
            readonly discriminantValue: 2;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "void";
            };
        }, {
            readonly name: "int16";
            readonly codeOrder: 3;
            readonly ordinal: 3;
            readonly discriminantValue: 3;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "void";
            };
        }, {
            readonly name: "int32";
            readonly codeOrder: 4;
            readonly ordinal: 4;
            readonly discriminantValue: 4;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "void";
            };
        }, {
            readonly name: "int64";
            readonly codeOrder: 5;
            readonly ordinal: 5;
            readonly discriminantValue: 5;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "void";
            };
        }, {
            readonly name: "uint8";
            readonly codeOrder: 6;
            readonly ordinal: 6;
            readonly discriminantValue: 6;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "void";
            };
        }, {
            readonly name: "uint16";
            readonly codeOrder: 7;
            readonly ordinal: 7;
            readonly discriminantValue: 7;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "void";
            };
        }, {
            readonly name: "uint32";
            readonly codeOrder: 8;
            readonly ordinal: 8;
            readonly discriminantValue: 8;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "void";
            };
        }, {
            readonly name: "uint64";
            readonly codeOrder: 9;
            readonly ordinal: 9;
            readonly discriminantValue: 9;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "void";
            };
        }, {
            readonly name: "float32";
            readonly codeOrder: 10;
            readonly ordinal: 10;
            readonly discriminantValue: 10;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "void";
            };
        }, {
            readonly name: "float64";
            readonly codeOrder: 11;
            readonly ordinal: 11;
            readonly discriminantValue: 11;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "void";
            };
        }, {
            readonly name: "text";
            readonly codeOrder: 12;
            readonly ordinal: 12;
            readonly discriminantValue: 12;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "void";
            };
        }, {
            readonly name: "data";
            readonly codeOrder: 13;
            readonly ordinal: 13;
            readonly discriminantValue: 13;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "void";
            };
        }, {
            readonly name: "list";
            readonly codeOrder: 14;
            readonly ordinal: 14;
            readonly discriminantValue: 14;
            readonly kind: "group";
            readonly type: {
                readonly kind: "group";
                readonly typeId: 9792858745991129751n;
                readonly typeIdHex: "87e739250a60ea97";
                readonly displayName: "list";
            };
        }, {
            readonly name: "enum";
            readonly codeOrder: 15;
            readonly ordinal: 15;
            readonly discriminantValue: 15;
            readonly kind: "group";
            readonly type: {
                readonly kind: "group";
                readonly typeId: 11389172934837766057n;
                readonly typeIdHex: "9e0e78711a7f87a9";
                readonly displayName: "enum";
            };
        }, {
            readonly name: "struct";
            readonly codeOrder: 16;
            readonly ordinal: 16;
            readonly discriminantValue: 16;
            readonly kind: "group";
            readonly type: {
                readonly kind: "group";
                readonly typeId: 12410354185295152851n;
                readonly typeIdHex: "ac3a6f60ef4cc6d3";
                readonly displayName: "struct";
            };
        }, {
            readonly name: "interface";
            readonly codeOrder: 17;
            readonly ordinal: 17;
            readonly discriminantValue: 17;
            readonly kind: "group";
            readonly type: {
                readonly kind: "group";
                readonly typeId: 17116997365232503999n;
                readonly typeIdHex: "ed8bca69f7fb0cbf";
                readonly displayName: "interface";
            };
        }, {
            readonly name: "anyPointer";
            readonly codeOrder: 18;
            readonly ordinal: 18;
            readonly discriminantValue: 18;
            readonly kind: "group";
            readonly type: {
                readonly kind: "group";
                readonly typeId: 14003731834718800369n;
                readonly typeIdHex: "c2573fe8a23e49f1";
                readonly displayName: "anyPointer";
            };
        }];
    };
    get _isVoid(): boolean;
    set void(_: true);
    get _isBool(): boolean;
    set bool(_: true);
    get _isInt8(): boolean;
    set int8(_: true);
    get _isInt16(): boolean;
    set int16(_: true);
    get _isInt32(): boolean;
    set int32(_: true);
    get _isInt64(): boolean;
    set int64(_: true);
    get _isUint8(): boolean;
    set uint8(_: true);
    get _isUint16(): boolean;
    set uint16(_: true);
    get _isUint32(): boolean;
    set uint32(_: true);
    get _isUint64(): boolean;
    set uint64(_: true);
    get _isFloat32(): boolean;
    set float32(_: true);
    get _isFloat64(): boolean;
    set float64(_: true);
    get _isText(): boolean;
    set text(_: true);
    get _isData(): boolean;
    set data(_: true);
    get list(): Type_List;
    _initList(): Type_List;
    get _isList(): boolean;
    set list(_: true);
    get enum(): Type_Enum;
    _initEnum(): Type_Enum;
    get _isEnum(): boolean;
    set enum(_: true);
    get struct(): Type_Struct;
    _initStruct(): Type_Struct;
    get _isStruct(): boolean;
    set struct(_: true);
    get interface(): Type_Interface;
    _initInterface(): Type_Interface;
    get _isInterface(): boolean;
    set interface(_: true);
    get anyPointer(): Type_AnyPointer;
    _initAnyPointer(): Type_AnyPointer;
    get _isAnyPointer(): boolean;
    set anyPointer(_: true);
    toString(): string;
    which(): Type_Which;
}
declare const Brand_Scope_Which: {
    /**
  * ID of the scope to which these params apply.
  *
  */
    readonly BIND: 0;
    /**
  * List of parameter bindings.
  *
  */
    readonly INHERIT: 1;
};
type Brand_Scope_Which = (typeof Brand_Scope_Which)[keyof typeof Brand_Scope_Which];
declare class Brand_Scope extends Struct {
    static readonly BIND: 0;
    static readonly INHERIT: 1;
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "scopeId";
            readonly codeOrder: 0;
            readonly ordinal: 0;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "uint64";
            };
        }, {
            readonly name: "bind";
            readonly codeOrder: 1;
            readonly ordinal: 1;
            readonly discriminantValue: 0;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "list";
                readonly elementType: {
                    readonly kind: "struct";
                    readonly typeId: 14439610327179913212n;
                    readonly typeIdHex: "c863cd16969ee7fc";
                    readonly displayName: "Binding";
                };
            };
        }, {
            readonly name: "inherit";
            readonly codeOrder: 2;
            readonly ordinal: 2;
            readonly discriminantValue: 1;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "void";
            };
        }];
    };
    static _Bind: ListCtor<Brand_Binding>;
    /**
  * ID of the scope to which these params apply.
  *
  */
    get scopeId(): bigint;
    set scopeId(value: bigint);
    _adoptBind(value: Orphan<List<Brand_Binding>>): void;
    _disownBind(): Orphan<List<Brand_Binding>>;
    /**
  * List of parameter bindings.
  *
  */
    get bind(): List<Brand_Binding>;
    _hasBind(): boolean;
    _initBind(length: number): List<Brand_Binding>;
    get _isBind(): boolean;
    set bind(value: List<Brand_Binding>);
    get _isInherit(): boolean;
    set inherit(_: true);
    toString(): string;
    which(): Brand_Scope_Which;
}
declare const Brand_Binding_Which: {
    readonly UNBOUND: 0;
    readonly TYPE: 1;
};
type Brand_Binding_Which = (typeof Brand_Binding_Which)[keyof typeof Brand_Binding_Which];
declare class Brand_Binding extends Struct {
    static readonly UNBOUND: 0;
    static readonly TYPE: 1;
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "unbound";
            readonly codeOrder: 0;
            readonly ordinal: 0;
            readonly discriminantValue: 0;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "void";
            };
        }, {
            readonly name: "type";
            readonly codeOrder: 1;
            readonly ordinal: 1;
            readonly discriminantValue: 1;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "struct";
                readonly typeId: 15020482145304562784n;
                readonly typeIdHex: "d07378ede1f9cc60";
                readonly displayName: "Type";
            };
        }];
    };
    get _isUnbound(): boolean;
    set unbound(_: true);
    _adoptType(value: Orphan<Type>): void;
    _disownType(): Orphan<Type>;
    get type(): Type;
    _hasType(): boolean;
    _initType(): Type;
    get _isType(): boolean;
    set type(value: Type);
    toString(): string;
    which(): Brand_Binding_Which;
}
/**
* Specifies bindings for parameters of generics. Since these bindings turn a generic into a
* non-generic, we call it the "brand".
*
*/
declare class Brand extends Struct {
    static readonly Scope: typeof Brand_Scope;
    static readonly Binding: typeof Brand_Binding;
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "scopes";
            readonly codeOrder: 0;
            readonly ordinal: 0;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "list";
                readonly elementType: {
                    readonly kind: "struct";
                    readonly typeId: 12382423449155627977n;
                    readonly typeIdHex: "abd73485a9636bc9";
                    readonly displayName: "Scope";
                };
            };
        }];
    };
    static _Scopes: ListCtor<Brand_Scope>;
    _adoptScopes(value: Orphan<List<Brand_Scope>>): void;
    _disownScopes(): Orphan<List<Brand_Scope>>;
    /**
  * For each of the target type and each of its parent scopes, a parameterization may be included
  * in this list. If no parameterization is included for a particular relevant scope, then either
  * that scope has no parameters or all parameters should be considered to be `AnyPointer`.
  *
  */
    get scopes(): List<Brand_Scope>;
    _hasScopes(): boolean;
    _initScopes(length: number): List<Brand_Scope>;
    set scopes(value: List<Brand_Scope>);
    toString(): string;
}
declare const Value_Which: {
    readonly VOID: 0;
    readonly BOOL: 1;
    readonly INT8: 2;
    readonly INT16: 3;
    readonly INT32: 4;
    readonly INT64: 5;
    readonly UINT8: 6;
    readonly UINT16: 7;
    readonly UINT32: 8;
    readonly UINT64: 9;
    readonly FLOAT32: 10;
    readonly FLOAT64: 11;
    readonly TEXT: 12;
    readonly DATA: 13;
    readonly LIST: 14;
    readonly ENUM: 15;
    readonly STRUCT: 16;
    /**
  * The only interface value that can be represented statically is "null", whose methods always
  * throw exceptions.
  *
  */
    readonly INTERFACE: 17;
    readonly ANY_POINTER: 18;
};
type Value_Which = (typeof Value_Which)[keyof typeof Value_Which];
/**
* Represents a value, e.g. a field default value, constant value, or annotation value.
*
*/
declare class Value extends Struct {
    static readonly VOID: 0;
    static readonly BOOL: 1;
    static readonly INT8: 2;
    static readonly INT16: 3;
    static readonly INT32: 4;
    static readonly INT64: 5;
    static readonly UINT8: 6;
    static readonly UINT16: 7;
    static readonly UINT32: 8;
    static readonly UINT64: 9;
    static readonly FLOAT32: 10;
    static readonly FLOAT64: 11;
    static readonly TEXT: 12;
    static readonly DATA: 13;
    static readonly LIST: 14;
    static readonly ENUM: 15;
    static readonly STRUCT: 16;
    static readonly INTERFACE: 17;
    static readonly ANY_POINTER: 18;
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "void";
            readonly codeOrder: 0;
            readonly ordinal: 0;
            readonly discriminantValue: 0;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "void";
            };
        }, {
            readonly name: "bool";
            readonly codeOrder: 1;
            readonly ordinal: 1;
            readonly discriminantValue: 1;
            readonly kind: "slot";
            readonly offset: 16;
            readonly type: {
                readonly kind: "bool";
            };
        }, {
            readonly name: "int8";
            readonly codeOrder: 2;
            readonly ordinal: 2;
            readonly discriminantValue: 2;
            readonly kind: "slot";
            readonly offset: 2;
            readonly type: {
                readonly kind: "int8";
            };
        }, {
            readonly name: "int16";
            readonly codeOrder: 3;
            readonly ordinal: 3;
            readonly discriminantValue: 3;
            readonly kind: "slot";
            readonly offset: 1;
            readonly type: {
                readonly kind: "int16";
            };
        }, {
            readonly name: "int32";
            readonly codeOrder: 4;
            readonly ordinal: 4;
            readonly discriminantValue: 4;
            readonly kind: "slot";
            readonly offset: 1;
            readonly type: {
                readonly kind: "int32";
            };
        }, {
            readonly name: "int64";
            readonly codeOrder: 5;
            readonly ordinal: 5;
            readonly discriminantValue: 5;
            readonly kind: "slot";
            readonly offset: 1;
            readonly type: {
                readonly kind: "int64";
            };
        }, {
            readonly name: "uint8";
            readonly codeOrder: 6;
            readonly ordinal: 6;
            readonly discriminantValue: 6;
            readonly kind: "slot";
            readonly offset: 2;
            readonly type: {
                readonly kind: "uint8";
            };
        }, {
            readonly name: "uint16";
            readonly codeOrder: 7;
            readonly ordinal: 7;
            readonly discriminantValue: 7;
            readonly kind: "slot";
            readonly offset: 1;
            readonly type: {
                readonly kind: "uint16";
            };
        }, {
            readonly name: "uint32";
            readonly codeOrder: 8;
            readonly ordinal: 8;
            readonly discriminantValue: 8;
            readonly kind: "slot";
            readonly offset: 1;
            readonly type: {
                readonly kind: "uint32";
            };
        }, {
            readonly name: "uint64";
            readonly codeOrder: 9;
            readonly ordinal: 9;
            readonly discriminantValue: 9;
            readonly kind: "slot";
            readonly offset: 1;
            readonly type: {
                readonly kind: "uint64";
            };
        }, {
            readonly name: "float32";
            readonly codeOrder: 10;
            readonly ordinal: 10;
            readonly discriminantValue: 10;
            readonly kind: "slot";
            readonly offset: 1;
            readonly type: {
                readonly kind: "float32";
            };
        }, {
            readonly name: "float64";
            readonly codeOrder: 11;
            readonly ordinal: 11;
            readonly discriminantValue: 11;
            readonly kind: "slot";
            readonly offset: 1;
            readonly type: {
                readonly kind: "float64";
            };
        }, {
            readonly name: "text";
            readonly codeOrder: 12;
            readonly ordinal: 12;
            readonly discriminantValue: 12;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "text";
            };
        }, {
            readonly name: "data";
            readonly codeOrder: 13;
            readonly ordinal: 13;
            readonly discriminantValue: 13;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "data";
            };
        }, {
            readonly name: "list";
            readonly codeOrder: 14;
            readonly ordinal: 14;
            readonly discriminantValue: 14;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "anyPointer";
            };
        }, {
            readonly name: "enum";
            readonly codeOrder: 15;
            readonly ordinal: 15;
            readonly discriminantValue: 15;
            readonly kind: "slot";
            readonly offset: 1;
            readonly type: {
                readonly kind: "uint16";
            };
        }, {
            readonly name: "struct";
            readonly codeOrder: 16;
            readonly ordinal: 16;
            readonly discriminantValue: 16;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "anyPointer";
            };
        }, {
            readonly name: "interface";
            readonly codeOrder: 17;
            readonly ordinal: 17;
            readonly discriminantValue: 17;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "void";
            };
        }, {
            readonly name: "anyPointer";
            readonly codeOrder: 18;
            readonly ordinal: 18;
            readonly discriminantValue: 18;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "anyPointer";
            };
        }];
    };
    get _isVoid(): boolean;
    set void(_: true);
    get bool(): boolean;
    get _isBool(): boolean;
    set bool(value: boolean);
    get int8(): number;
    get _isInt8(): boolean;
    set int8(value: number);
    get int16(): number;
    get _isInt16(): boolean;
    set int16(value: number);
    get int32(): number;
    get _isInt32(): boolean;
    set int32(value: number);
    get int64(): bigint;
    get _isInt64(): boolean;
    set int64(value: bigint);
    get uint8(): number;
    get _isUint8(): boolean;
    set uint8(value: number);
    get uint16(): number;
    get _isUint16(): boolean;
    set uint16(value: number);
    get uint32(): number;
    get _isUint32(): boolean;
    set uint32(value: number);
    get uint64(): bigint;
    get _isUint64(): boolean;
    set uint64(value: bigint);
    get float32(): number;
    get _isFloat32(): boolean;
    set float32(value: number);
    get float64(): number;
    get _isFloat64(): boolean;
    set float64(value: number);
    get text(): string;
    get _isText(): boolean;
    set text(value: string);
    _adoptData(value: Orphan<Data>): void;
    _disownData(): Orphan<Data>;
    get data(): Data;
    _hasData(): boolean;
    _initData(length: number): Data;
    get _isData(): boolean;
    set data(value: Data);
    _adoptList(value: Orphan<Pointer>): void;
    _disownList(): Orphan<Pointer>;
    get list(): Pointer;
    _hasList(): boolean;
    get _isList(): boolean;
    set list(value: Pointer);
    get enum(): number;
    get _isEnum(): boolean;
    set enum(value: number);
    _adoptStruct(value: Orphan<Pointer>): void;
    _disownStruct(): Orphan<Pointer>;
    get struct(): Pointer;
    _hasStruct(): boolean;
    get _isStruct(): boolean;
    set struct(value: Pointer);
    get _isInterface(): boolean;
    set interface(_: true);
    _adoptAnyPointer(value: Orphan<Pointer>): void;
    _disownAnyPointer(): Orphan<Pointer>;
    get anyPointer(): Pointer;
    _hasAnyPointer(): boolean;
    get _isAnyPointer(): boolean;
    set anyPointer(value: Pointer);
    toString(): string;
    which(): Value_Which;
}
/**
* Describes an annotation applied to a declaration.  Note AnnotationNode describes the
* annotation's declaration, while this describes a use of the annotation.
*
*/
declare class Annotation extends Struct {
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "id";
            readonly codeOrder: 0;
            readonly ordinal: 0;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "uint64";
            };
        }, {
            readonly name: "brand";
            readonly codeOrder: 1;
            readonly ordinal: 2;
            readonly kind: "slot";
            readonly offset: 1;
            readonly type: {
                readonly kind: "struct";
                readonly typeId: 10391024731148337707n;
                readonly typeIdHex: "903455f06065422b";
                readonly displayName: "Brand";
            };
        }, {
            readonly name: "value";
            readonly codeOrder: 2;
            readonly ordinal: 1;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "struct";
                readonly typeId: 14853958794117909659n;
                readonly typeIdHex: "ce23dcd2d7b00c9b";
                readonly displayName: "Value";
            };
        }];
    };
    /**
  * ID of the annotation node.
  *
  */
    get id(): bigint;
    set id(value: bigint);
    _adoptBrand(value: Orphan<Brand>): void;
    _disownBrand(): Orphan<Brand>;
    /**
  * Brand of the annotation.
  *
  * Note that the annotation itself is not allowed to be parameterized, but its scope might be.
  *
  */
    get brand(): Brand;
    _hasBrand(): boolean;
    _initBrand(): Brand;
    set brand(value: Brand);
    _adoptValue(value: Orphan<Value>): void;
    _disownValue(): Orphan<Value>;
    get value(): Value;
    _hasValue(): boolean;
    _initValue(): Value;
    set value(value: Value);
    toString(): string;
}
declare const ElementSize: {
    /**
  * aka "void", but that's a keyword.
  *
  */
    readonly EMPTY: 0;
    readonly BIT: 1;
    readonly BYTE: 2;
    readonly TWO_BYTES: 3;
    readonly FOUR_BYTES: 4;
    readonly EIGHT_BYTES: 5;
    readonly POINTER: 6;
    readonly INLINE_COMPOSITE: 7;
};
type ElementSize = (typeof ElementSize)[keyof typeof ElementSize];
declare class CapnpVersion extends Struct {
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "major";
            readonly codeOrder: 0;
            readonly ordinal: 0;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "uint16";
            };
        }, {
            readonly name: "minor";
            readonly codeOrder: 1;
            readonly ordinal: 1;
            readonly kind: "slot";
            readonly offset: 2;
            readonly type: {
                readonly kind: "uint8";
            };
        }, {
            readonly name: "micro";
            readonly codeOrder: 2;
            readonly ordinal: 2;
            readonly kind: "slot";
            readonly offset: 3;
            readonly type: {
                readonly kind: "uint8";
            };
        }];
    };
    get major(): number;
    set major(value: number);
    get minor(): number;
    set minor(value: number);
    get micro(): number;
    set micro(value: number);
    toString(): string;
}
declare class CodeGeneratorRequest_RequestedFile_Import extends Struct {
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "id";
            readonly codeOrder: 0;
            readonly ordinal: 0;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "uint64";
            };
        }, {
            readonly name: "name";
            readonly codeOrder: 1;
            readonly ordinal: 1;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "text";
            };
        }];
    };
    /**
  * ID of the imported file.
  *
  */
    get id(): bigint;
    set id(value: bigint);
    /**
  * Name which *this* file used to refer to the foreign file.  This may be a relative name.
  * This information is provided because it might be useful for code generation, e.g. to
  * generate #include directives in C++.  We don't put this in Node.file because this
  * information is only meaningful at compile time anyway.
  *
  * (On Zooko's triangle, this is the import's petname according to the importing file.)
  *
  */
    get name(): string;
    set name(value: string);
    toString(): string;
}
declare class CodeGeneratorRequest_RequestedFile extends Struct {
    static readonly Import: typeof CodeGeneratorRequest_RequestedFile_Import;
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "id";
            readonly codeOrder: 0;
            readonly ordinal: 0;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "uint64";
            };
        }, {
            readonly name: "filename";
            readonly codeOrder: 1;
            readonly ordinal: 1;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "text";
            };
        }, {
            readonly name: "imports";
            readonly codeOrder: 2;
            readonly ordinal: 2;
            readonly kind: "slot";
            readonly offset: 1;
            readonly type: {
                readonly kind: "list";
                readonly elementType: {
                    readonly kind: "struct";
                    readonly typeId: 12560611460656617445n;
                    readonly typeIdHex: "ae504193122357e5";
                    readonly displayName: "Import";
                };
            };
        }];
    };
    static _Imports: ListCtor<CodeGeneratorRequest_RequestedFile_Import>;
    /**
  * ID of the file.
  *
  */
    get id(): bigint;
    set id(value: bigint);
    /**
  * Name of the file as it appeared on the command-line (minus the src-prefix).  You may use
  * this to decide where to write the output.
  *
  */
    get filename(): string;
    set filename(value: string);
    _adoptImports(value: Orphan<List<CodeGeneratorRequest_RequestedFile_Import>>): void;
    _disownImports(): Orphan<List<CodeGeneratorRequest_RequestedFile_Import>>;
    /**
  * List of all imported paths seen in this file.
  *
  */
    get imports(): List<CodeGeneratorRequest_RequestedFile_Import>;
    _hasImports(): boolean;
    _initImports(length: number): List<CodeGeneratorRequest_RequestedFile_Import>;
    set imports(value: List<CodeGeneratorRequest_RequestedFile_Import>);
    toString(): string;
}
declare class CodeGeneratorRequest extends Struct {
    static readonly RequestedFile: typeof CodeGeneratorRequest_RequestedFile;
    static readonly _capnp: {
        displayName: string;
        id: string;
        typeId: bigint;
        typeIdHex: string;
        size: ObjectSize;
        fields: readonly [{
            readonly name: "capnpVersion";
            readonly codeOrder: 0;
            readonly ordinal: 2;
            readonly kind: "slot";
            readonly offset: 2;
            readonly type: {
                readonly kind: "struct";
                readonly typeId: 15590670654532458851n;
                readonly typeIdHex: "d85d305b7d839963";
                readonly displayName: "CapnpVersion";
            };
        }, {
            readonly name: "nodes";
            readonly codeOrder: 1;
            readonly ordinal: 0;
            readonly kind: "slot";
            readonly offset: 0;
            readonly type: {
                readonly kind: "list";
                readonly elementType: {
                    readonly kind: "struct";
                    readonly typeId: 16610026722781537303n;
                    readonly typeIdHex: "e682ab4cf923a417";
                    readonly displayName: "Node";
                };
            };
        }, {
            readonly name: "sourceInfo";
            readonly codeOrder: 2;
            readonly ordinal: 3;
            readonly kind: "slot";
            readonly offset: 3;
            readonly type: {
                readonly kind: "list";
                readonly elementType: {
                    readonly kind: "struct";
                    readonly typeId: 17549997658772559790n;
                    readonly typeIdHex: "f38e1de3041357ae";
                    readonly displayName: "SourceInfo";
                };
            };
        }, {
            readonly name: "requestedFiles";
            readonly codeOrder: 3;
            readonly ordinal: 1;
            readonly kind: "slot";
            readonly offset: 1;
            readonly type: {
                readonly kind: "list";
                readonly elementType: {
                    readonly kind: "struct";
                    readonly typeId: 14981803260258615394n;
                    readonly typeIdHex: "cfea0eb02e810062";
                    readonly displayName: "RequestedFile";
                };
            };
        }];
    };
    static _Nodes: ListCtor<Node>;
    static _SourceInfo: ListCtor<Node_SourceInfo>;
    static _RequestedFiles: ListCtor<CodeGeneratorRequest_RequestedFile>;
    _adoptCapnpVersion(value: Orphan<CapnpVersion>): void;
    _disownCapnpVersion(): Orphan<CapnpVersion>;
    /**
  * Version of the `capnp` executable. Generally, code generators should ignore this, but the code
  * generators that ship with `capnp` itself will print a warning if this mismatches since that
  * probably indicates something is misconfigured.
  *
  * The first version of 'capnp' to set this was 0.6.0. So, if it's missing, the compiler version
  * is older than that.
  *
  */
    get capnpVersion(): CapnpVersion;
    _hasCapnpVersion(): boolean;
    _initCapnpVersion(): CapnpVersion;
    set capnpVersion(value: CapnpVersion);
    _adoptNodes(value: Orphan<List<Node>>): void;
    _disownNodes(): Orphan<List<Node>>;
    /**
  * All nodes parsed by the compiler, including for the files on the command line and their
  * imports.
  *
  */
    get nodes(): List<Node>;
    _hasNodes(): boolean;
    _initNodes(length: number): List<Node>;
    set nodes(value: List<Node>);
    _adoptSourceInfo(value: Orphan<List<Node_SourceInfo>>): void;
    _disownSourceInfo(): Orphan<List<Node_SourceInfo>>;
    /**
  * Information about the original source code for each node, where available. This array may be
  * omitted or may be missing some nodes if no info is available for them.
  *
  */
    get sourceInfo(): List<Node_SourceInfo>;
    _hasSourceInfo(): boolean;
    _initSourceInfo(length: number): List<Node_SourceInfo>;
    set sourceInfo(value: List<Node_SourceInfo>);
    _adoptRequestedFiles(value: Orphan<List<CodeGeneratorRequest_RequestedFile>>): void;
    _disownRequestedFiles(): Orphan<List<CodeGeneratorRequest_RequestedFile>>;
    /**
  * Files which were listed on the command line.
  *
  */
    get requestedFiles(): List<CodeGeneratorRequest_RequestedFile>;
    _hasRequestedFiles(): boolean;
    _initRequestedFiles(length: number): List<CodeGeneratorRequest_RequestedFile>;
    set requestedFiles(value: List<CodeGeneratorRequest_RequestedFile>);
    toString(): string;
}

export { Annotation, Brand, Brand_Binding, Brand_Binding_Which, Brand_Scope, Brand_Scope_Which, CapnpVersion, CodeGeneratorRequest, CodeGeneratorRequest_RequestedFile, CodeGeneratorRequest_RequestedFile_Import, ElementSize, Enumerant, Field, Field_Group, Field_Ordinal, Field_Ordinal_Which, Field_Slot, Field_Which, Method, Node, Node_Annotation, Node_Const, Node_Enum, Node_Interface, Node_NestedNode, Node_Parameter, Node_SourceInfo, Node_SourceInfo_Member, Node_Struct, Node_Which, Superclass, Type, Type_AnyPointer, Type_AnyPointer_ImplicitMethodParameter, Type_AnyPointer_Parameter, Type_AnyPointer_Unconstrained, Type_AnyPointer_Unconstrained_Which, Type_AnyPointer_Which, Type_Enum, Type_Interface, Type_List, Type_Struct, Type_Which, Value, Value_Which, _capnpFileId };
