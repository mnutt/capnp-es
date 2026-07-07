import * as schema from "../../capnp/schema";
import { format } from "../../util";
import * as E from "../errors";
import type { CompileAllOptions, ModuleSpecifierContext } from "../options";
import { lookupNode, getFullClassName } from "../node-util";
import { generateEnumNode } from "./enum";
import { generateInterfaceNode } from "./interface";
import { generateStructNode } from "./struct";

/**
 * Generates TypeScript code for a Cap'n Proto schema node.
 * Handles different node types (struct, enum, interface) and their nested definitions.
 *
 * @param ctx - The file context containing schema information and output statements
 * @param node - The schema node to generate code for
 *
 * @remarks
 * - Generates nested nodes first to ensure proper symbol references
 * - Handles group nodes that appear before struct nodes
 * - Skips already generated nodes to avoid duplicates
 * - Throws error for unknown node types
 */
export function generateNode(
  ctx: CodeGeneratorFileContext,
  node: schema.Node,
): void {
  const nodeId = node.id;
  const nodeIdHex = nodeId.toString(16);

  if (ctx.generatedNodeIds.has(nodeIdHex)) {
    // skip already generated nodes
    return;
  }

  ctx.generatedNodeIds.add(nodeIdHex);

  // An array of nodes that are nested within this node;
  // these must appear first since those symbols will be
  // referenced in the node's class definition.
  const nestedNodes = node.nestedNodes.map((node) => lookupNode(ctx, node));

  for (const nestedNode of nestedNodes) {
    generateNode(ctx, nestedNode);
  }

  // An array of group structs formed as children of this struct.
  // They appear before the struct node in the file.
  const groupNodes = ctx.nodes.filter(
    (node) => node.scopeId === nodeId && node._isStruct && node.struct.isGroup,
  );
  for (const groupNode of groupNodes) {
    generateNode(ctx, groupNode);
  }

  const nodeType = node.which();

  switch (nodeType) {
    case schema.Node.STRUCT: {
      generateStructNode(ctx, node);
      break;
    }

    case schema.Node.CONST: {
      // Const nodes are generated along with the containing class, ignore these.
      break;
    }

    case schema.Node.ENUM: {
      generateEnumNode(
        ctx,
        getFullClassName(node),
        node,
        node.enum.enumerants.toArray(),
      );
      break;
    }

    case schema.Node.INTERFACE: {
      generateInterfaceNode(ctx, node);
      break;
    }

    case schema.Node.ANNOTATION: {
      break;
    }

    // case s.Node.FILE:
    default: {
      throw new Error(
        format(E.GEN_NODE_UNKNOWN_TYPE, nodeType /* s.Node_Which[whichNode] */),
      );
    }
  }
}

export class CodeGeneratorContext {
  readonly nodes: schema.Node[];
  readonly nodeById: Map<bigint, schema.Node>;
  readonly nodesByScopeId: Map<bigint, schema.Node[]>;
  readonly sourceInfo: schema.Node_SourceInfo[];
  readonly sourceInfoById: Map<bigint, schema.Node_SourceInfo>;
  readonly moduleSpecifierResolutions = new Map<
    string,
    ModuleSpecifierResolution
  >();
  files: CodeGeneratorFileContext[] = [];

  constructor(
    public readonly req: schema.CodeGeneratorRequest,
    private readonly options: Pick<CompileAllOptions, "moduleSpecifier"> = {},
  ) {
    this.nodes = req.nodes.toArray();
    this.nodeById = new Map(this.nodes.map((node) => [node.id, node]));
    this.nodesByScopeId = new Map();
    for (const node of this.nodes) {
      const siblings = this.nodesByScopeId.get(node.scopeId);
      if (siblings === undefined) {
        this.nodesByScopeId.set(node.scopeId, [node]);
      } else {
        siblings.push(node);
      }
    }
    this.sourceInfo = req.sourceInfo.toArray();
    this.sourceInfoById = new Map(
      this.sourceInfo.map((sourceInfo) => [sourceInfo.id, sourceInfo]),
    );
  }

  resolveModuleSpecifier(
    context: ModuleSpecifierContext,
    resolution: ModuleSpecifierResolution,
  ): string {
    const specifier =
      this.options.moduleSpecifier?.(context) ?? context.originalSpecifier;
    this.moduleSpecifierResolutions.set(
      moduleSpecifierResolutionKey(context.fromPath, specifier),
      resolution,
    );
    return specifier;
  }
}

export type ModuleSpecifierResolution =
  | {
      readonly kind: "runtime";
      readonly originalSpecifier: string;
    }
  | {
      readonly kind: "schema";
      readonly toPath: string;
    };

export function moduleSpecifierResolutionKey(
  fromPath: string,
  specifier: string,
): string {
  return `${fromPath}\0${specifier}`;
}

export class CodeGeneratorFileContext {
  // inputs
  readonly nodes: schema.Node[];
  readonly nodeById: Map<bigint, schema.Node>;
  readonly nodesByScopeId: Map<bigint, schema.Node[]>;
  readonly localNodeIds: Set<bigint>;
  readonly schemaDisplayName: string;
  readonly sourceInfo: schema.Node_SourceInfo[];
  readonly sourceInfoById: Map<bigint, schema.Node_SourceInfo>;
  readonly imports: schema.CodeGeneratorRequest_RequestedFile_Import[];

  // outputs
  concreteLists: Array<[string, schema.Field]> = [];
  generatedNodeIds = new Set<string>();
  generatedResultsPromiseIds = new Set<bigint>();
  tsPath = "";
  codeParts: string[] = [];

  constructor(
    public readonly context: CodeGeneratorContext,
    public readonly file: schema.CodeGeneratorRequest_RequestedFile,
  ) {
    this.nodes = context.nodes;
    this.nodeById = context.nodeById;
    this.nodesByScopeId = context.nodesByScopeId;
    this.localNodeIds = collectLocalNodeIds(context.nodesByScopeId, file.id);
    this.schemaDisplayName =
      context.nodeById.get(file.id)?.displayName ?? file.filename;
    this.sourceInfo = context.sourceInfo;
    this.sourceInfoById = context.sourceInfoById;
    this.imports = file.imports.toArray();
  }

  get req(): schema.CodeGeneratorRequest {
    return this.context.req;
  }

  toString(): string {
    return this.file?.filename ?? "CodeGeneratorFileContext()";
  }
}

function collectLocalNodeIds(
  nodesByScopeId: Map<bigint, schema.Node[]>,
  fileId: bigint,
): Set<bigint> {
  const localNodeIds = new Set<bigint>();
  const visit = (id: bigint) => {
    if (localNodeIds.has(id)) {
      return;
    }

    localNodeIds.add(id);
    for (const child of nodesByScopeId.get(id) ?? []) {
      visit(child.id);
    }
  };

  visit(fileId);
  return localNodeIds;
}
