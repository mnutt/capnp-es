import * as schema from "../../capnp/schema";
import { generateNode } from ".";
import type { CodeGeneratorFileContext } from ".";
import {
  compareCodeOrder,
  getFullClassName,
  getJsType,
  isLocalNode,
  lookupNode,
  lookupNodeSourceInfo,
} from "../node-util";
import { createBigInt, extractJSDocs } from "./helpers";
import * as util from "../util";
import * as E from "../errors";
import { format } from "../../util";

/**
 * Generates TypeScript classes for a Cap'n Proto RPC interface.
 *
 * This function creates all the necessary classes for an RPC interface:
 * - Parameter and result structs for each method
 * - Client class for making RPC calls
 * - Server class for implementing the interface
 *
 * The generated code follows the Cap'n Proto RPC protocol specification,
 * creating type-safe client/server implementations.
 *
 * @param ctx - The code generator context
 * @param node - The interface node to generate classes for
 */
export function generateInterfaceClasses(
  ctx: CodeGeneratorFileContext,
  node: schema.Node,
): void {
  generateMethodStructs(ctx, node);
  generateClient(ctx, node);
  generateServer(ctx, node);
}

/**
 * Generates TypeScript structs for RPC method parameters and results.
 *
 * This function generates the necessary struct classes for each method in a Cap'n Proto
 * RPC interface:
 * - Parameter structs that hold method arguments
 * - Result struct that hold method return values
 * - Promise wrappers for result struct to handle async responses
 *
 * @param ctx - The code generator context
 * @param node - The interface node containing the methods
 */
export function generateMethodStructs(
  ctx: CodeGeneratorFileContext,
  node: schema.Node,
): void {
  for (const method of node.interface.methods) {
    const paramNode = lookupNode(ctx, method.paramStructType);
    const resultNode = lookupNode(ctx, method.resultStructType);
    const localParamNode = isLocalNode(ctx, paramNode);
    const localResultNode = isLocalNode(ctx, resultNode);

    if (localParamNode) {
      generateNode(ctx, paramNode);
    }

    if (localResultNode) {
      generateNode(ctx, resultNode);
    }

    generateResultPromise(ctx, resultNode, {
      pipelineFields: localResultNode,
    });
  }
}

/**
 * Generates a TypeScript server implementation for a Cap'n Proto RPC interface.
 *
 * Creates a server class and target interface that implement the RPC service:
 * - Generates method signatures for all interface methods
 * - Creates a target interface that users implement to handle RPC calls
 * - Builds a server class that bridges between the RPC runtime and user implementation
 *
 * @param ctx - The code generator context
 * @param node - The interface node to generate server code for
 */
export function generateServer(
  ctx: CodeGeneratorFileContext,
  node: schema.Node,
): void {
  const fullClassName = getFullClassName(node);
  const serverName = `${fullClassName}$Server`;
  const serverTargetName = `${serverName}$Target`;
  const clientName = `${fullClassName}$Client`;
  const superclasses = getInterfaceSuperclasses(ctx, node);

  const methodSignatures = node.interface.methods
    .map((method) => {
      const paramTypeName = getFullClassName(
        lookupNode(ctx, method.paramStructType),
      );
      const resultTypeName = getFullClassName(
        lookupNode(ctx, method.resultStructType),
      );
      return `${method.name}(params: ${paramTypeName}, results: ${resultTypeName}): Promise<void>;`;
    })
    .join("\n");

  const extendsClause =
    superclasses.length === 0
      ? ""
      : ` extends ${superclasses.map((node) => `${getFullClassName(node)}$Server$Target`).join(", ")}`;

  ctx.codeParts.push(`
  export interface ${serverTargetName}${extendsClause} {
    ${methodSignatures}
  }`);

  const members: string[] = [];

  members.push(`readonly target: ${serverTargetName};`);

  // Generate server constructor
  const codeServerMethods: string[] = [];

  for (const superclass of superclasses) {
    const superClientName = `${getFullClassName(superclass)}$Client`;
    codeServerMethods.push(
      `...(${superClientName}.methods as $.Method<any, any>[]).map((method) => ({
        ...(method as any),
        impl: target[method.methodName as keyof ${serverTargetName}] as any
      }))`,
    );
  }

  const ownMethodsTable =
    superclasses.length === 0
      ? `${clientName}.methods`
      : `${clientName}.ownMethods`;
  let index = 0;
  for (const method of node.interface.methods) {
    codeServerMethods.push(`{
        ...${ownMethodsTable}[${index}],
        impl: target.${method.name}
      }`);

    index++;
  }

  members.push(`
      constructor(target: ${serverTargetName}) {
        super(target, [
          ${codeServerMethods.join(",\n")}
        ]);
        this.target = target;
      }
      client(): ${clientName} {
        return new ${clientName}(this);
      }
  `);

  ctx.codeParts.push(`
    export class ${serverName} extends $.Server {
      ${members.join("\n")}
    }
  `);
}

/**
 * Generates a TypeScript client class for a Cap'n Proto RPC interface.
 *
 * Creates a client class that provides type-safe method calls to a remote service:
 * - Generates method implementations for all interface methods
 * - Creates method metadata for the RPC runtime
 * - Handles parameter passing and promise resolution
 * - Registers the client class with the RPC registry
 *
 * @param ctx - The code generator context
 * @param node - The interface node to generate client code for
 */
export function generateClient(
  ctx: CodeGeneratorFileContext,
  node: schema.Node,
): void {
  const fullClassName = getFullClassName(node);
  const clientName = `${fullClassName}$Client`;
  const superclasses = getInterfaceSuperclasses(ctx, node);

  const members: string[] = [];

  // Add client property
  members.push(`
    client: $.Client;
    static readonly interfaceId: bigint = ${createBigInt(node.id)};
    constructor(client: $.Client) {
      this.client = client;
    }
  `);

  const methods: string[] = [];
  const methodDefs: string[] = [];
  const methodDefTypes: string[] = [];
  const inheritedMethodNames = new Set<string>();

  for (const superclass of superclasses) {
    generateInheritedClientMethods(
      ctx,
      superclass,
      methods,
      inheritedMethodNames,
    );
  }

  const ownMethodsName = superclasses.length === 0 ? "methods" : "ownMethods";
  for (let index = 0; index < node.interface.methods.length; index++) {
    generateClientMethod(
      ctx,
      node,
      clientName,
      methods,
      methodDefs,
      methodDefTypes,
      index,
      ownMethodsName,
    );
  }

  members.push(`
    static readonly ${ownMethodsName}: [
      ${methodDefTypes.join(",\n")}
    ] = [
      ${methodDefs.join(",\n")}
    ];
    ${
      superclasses.length === 0
        ? ""
        : `static readonly methods: $.Method<any, any>[] = [
      ${superclasses.map((node) => `...${getFullClassName(node)}$Client.methods`).join(",\n")},
      ...${clientName}.ownMethods
    ];`
    }
    ${methods.join("\n")}
    `);

  ctx.codeParts.push(`
    export class ${clientName} {
      ${members.join("\n")}
    }
    $.Registry.register(${clientName}.interfaceId, ${clientName});
  `);
}

function getInterfaceSuperclasses(
  ctx: CodeGeneratorFileContext,
  node: schema.Node,
): schema.Node[] {
  return node.interface.superclasses
    .toArray()
    .map((superclass) => lookupNode(ctx, superclass.id));
}

function generateInheritedClientMethods(
  ctx: CodeGeneratorFileContext,
  node: schema.Node,
  methodsCode: string[],
  seenNames = new Set<string>(),
): void {
  const superClientName = `${getFullClassName(node)}$Client`;
  for (const method of collectInterfaceMethods(ctx, node)) {
    if (seenNames.has(method.name)) {
      continue;
    }

    seenNames.add(method.name);
    methodsCode.push(`
      ${method.name}(
        ...args: Parameters<${superClientName}["${method.name}"]>
      ): ReturnType<${superClientName}["${method.name}"]> {
        return ${superClientName}.prototype.${method.name}.apply(this, args);
      }
    `);
  }
}

function collectInterfaceMethods(
  ctx: CodeGeneratorFileContext,
  node: schema.Node,
  methods: schema.Method[] = [],
  seenNodes = new Set<bigint>(),
): schema.Method[] {
  if (seenNodes.has(node.id)) {
    return methods;
  }

  seenNodes.add(node.id);
  for (const superclass of getInterfaceSuperclasses(ctx, node)) {
    collectInterfaceMethods(ctx, superclass, methods, seenNodes);
  }
  methods.push(...node.interface.methods.toArray().sort(compareCodeOrder));
  return methods;
}

/**
 * Generates a TypeScript Promise wrapper class for Cap'n Proto RPC method results.
 *
 * Creates a Promise class that handles asynchronous RPC results:
 * - Manages pipelined method calls on promised results
 * - Provides type-safe access to interface capabilities
 * - Handles promise resolution for final results
 *
 * @param ctx - The code generator context
 * @param node - The result struct node to generate promise wrapper for
 */
export function generateResultPromise(
  ctx: CodeGeneratorFileContext,
  node: schema.Node,
  options: { readonly pipelineFields?: boolean } = {},
): void {
  const nodeId = node.id;

  if (ctx.generatedResultsPromiseIds.has(nodeId)) {
    return;
  }

  ctx.generatedResultsPromiseIds.add(nodeId);

  const resultsClassName = getFullClassName(node);
  const fullClassName = `${resultsClassName}$Promise`;

  const members: string[] = [];

  members.push(`
    pipeline: $.Pipeline<any, any, ${resultsClassName}>;
    constructor(pipeline: $.Pipeline<any, any, ${resultsClassName}>) {
      this.pipeline = pipeline;
    }
  `);

  const { struct } = node;
  const fields =
    options.pipelineFields === false
      ? []
      : struct.fields.toArray().sort(compareCodeOrder);

  const generatePromiseFieldMethod = (field: schema.Field) => {
    let jsType: string;
    let isInterface = false;
    let slot: schema.Field_Slot;

    if (field._isSlot) {
      slot = field.slot;
      const slotType = slot.type;
      if (slotType.which() !== schema.Type.INTERFACE) {
        // TODO: return a Promise<jsType> for non-interface slots
        return;
      }
      isInterface = true;
      jsType = getJsType(ctx, slotType, false);
    } else if (field._isGroup) {
      // TODO: how should groups be handled?
      return;
    } else {
      throw new Error(format(E.GEN_UNKNOWN_STRUCT_FIELD, field.which()));
    }

    const promisedJsType = jsType;
    if (isInterface) {
      jsType = `${jsType}$Client`;
    }

    const { name } = field;
    const properName = util.c2t(name);

    members.push(`
      get${properName}(): ${jsType} {
        return new ${jsType}(this.pipeline.getPipeline(${promisedJsType}, ${slot.offset}).client());
      }
    `);
  };

  for (const field of fields) {
    generatePromiseFieldMethod(field);
  }

  members.push(`
    async promise(): Promise<${resultsClassName}> {
      return await this.pipeline.struct();
    }
  `);

  ctx.codeParts.push(`
    export class ${fullClassName} {
      ${members.join("\n")}
    }
  `);
}

/**
 * Generates a client method implementation for a Cap'n Proto RPC interface.
 *
 * Creates the method definition, type declaration, and implementation code for a single
 * RPC method in the client class. The generated code includes:
 * - Method type definition for TypeScript
 * - Method metadata for the RPC runtime
 * - Client-side implementation that handles parameter passing and promise resolution
 *
 * @param ctx - The code generator context
 * @param node - The interface node containing the method
 * @param clientName - Name of the client class being generated
 * @param methodsCode - Array to append method implementations to
 * @param methodDefs - Array to append method definitions to
 * @param methodDefTypes - Array to append method type declarations to
 * @param index - Index of this method in the interface's method list
 */
export function generateClientMethod(
  ctx: CodeGeneratorFileContext,
  node: schema.Node,
  clientName: string,
  methodsCode: string[],
  methodDefs: string[],
  methodDefTypes: string[],
  index: number,
  methodArrayName = "methods",
): void {
  const method = node.interface.methods[index];
  const { name } = method;

  const paramTypeName = getFullClassName(
    lookupNode(ctx, method.paramStructType),
  );
  const resultTypeName = getFullClassName(
    lookupNode(ctx, method.resultStructType),
  );

  // Add method type to methodDefTypes
  methodDefTypes.push(`$.Method<${paramTypeName}, ${resultTypeName}>`);

  // Add method definition to methodDefs
  methodDefs.push(`{
    ParamsClass: ${paramTypeName},
    ResultsClass: ${resultTypeName},
    interfaceId: ${clientName}.interfaceId,
    methodId: ${index},
    interfaceName: "${node.displayName}",
    methodName: "${method.name}",
    paramFields: ${paramTypeName}._capnp.fields,
    resultFields: ${resultTypeName}._capnp.fields
  }`);

  const docComment = extractJSDocs(
    lookupNodeSourceInfo(ctx, node)?.members.at(index),
  );

  // Add method implementation to members
  methodsCode.push(`
    ${docComment}
    ${name}(paramsFunc?: (params: ${paramTypeName}) => void): ${resultTypeName}$Promise {
      const answer = this.client.call({
        method: ${clientName}.${methodArrayName}[${index}],
        paramsFunc: paramsFunc
      });
      const pipeline = new $.Pipeline(${resultTypeName}, answer);
      return new ${resultTypeName}$Promise(pipeline);
    }
  `);
}
