import ts from 'typescript';
import { CodeGeneratorRequest, Node, Node_SourceInfo, CodeGeneratorRequest_RequestedFile, CodeGeneratorRequest_RequestedFile_Import, Field } from '../capnp/schema.js';
import '../shared/capnp-es.DGklrAbf.js';
import '../shared/capnp-es.Dg18XjiA.js';

declare class CodeGeneratorContext {
    readonly req: CodeGeneratorRequest;
    readonly nodes: Node[];
    readonly nodeById: Map<bigint, Node>;
    readonly nodesByScopeId: Map<bigint, Node[]>;
    readonly sourceInfo: Node_SourceInfo[];
    readonly sourceInfoById: Map<bigint, Node_SourceInfo>;
    files: CodeGeneratorFileContext[];
    constructor(req: CodeGeneratorRequest);
}
declare class CodeGeneratorFileContext {
    readonly context: CodeGeneratorContext;
    readonly file: CodeGeneratorRequest_RequestedFile;
    readonly nodes: Node[];
    readonly nodeById: Map<bigint, Node>;
    readonly nodesByScopeId: Map<bigint, Node[]>;
    readonly localNodeIds: Set<bigint>;
    readonly schemaDisplayName: string;
    readonly sourceInfo: Node_SourceInfo[];
    readonly sourceInfoById: Map<bigint, Node_SourceInfo>;
    readonly imports: CodeGeneratorRequest_RequestedFile_Import[];
    concreteLists: Array<[string, Field]>;
    generatedNodeIds: Set<string>;
    generatedResultsPromiseIds: Set<bigint>;
    tsPath: string;
    codeParts: string[];
    constructor(context: CodeGeneratorContext, file: CodeGeneratorRequest_RequestedFile);
    get req(): CodeGeneratorRequest;
    toString(): string;
}

/**
 * Compiles Cap'n Proto schema files into TypeScript/JavaScript code.
 *
 * @see `src/capnp/_capnp/schema.capnp`
 *
 * @param codeGenRequest - Buffer containing the Cap'n Proto CodeGeneratorRequest message
 * @param opts - Compilation options
 * @param opts.ts - Whether to generate TypeScript (.ts) files
 * @param opts.js - Whether to generate JavaScript (.js) files
 * @param opts.dts - Whether to generate TypeScript declaration (.d.ts) files
 * @param opts.tsconfig - Custom TypeScript compiler options
 * @returns Object containing the compilation context and generated files
 * @returns.ctx - The CodeGeneratorContext used during compilation
 * @returns.files - Map of file paths to their generated content
 */
declare function compileAll(codeGenRequest: Buffer, opts?: {
    ts?: boolean;
    js?: boolean;
    dts?: boolean;
    tsconfig?: ts.CompilerOptions;
}): Promise<{
    ctx: CodeGeneratorContext;
    files: Map<string, string>;
}>;

export { compileAll };
