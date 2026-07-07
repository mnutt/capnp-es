import type ts from "typescript";

export interface RuntimeModuleSpecifierContext {
  readonly kind: "runtime";
  readonly fromPath: string;
  readonly originalSpecifier: string;
}

export interface SchemaModuleSpecifierContext {
  readonly kind: "schema";
  readonly fromPath: string;
  readonly toPath: string;
  readonly originalSpecifier: string;
  readonly schemaDisplayName: string;
}

export type ModuleSpecifierContext =
  | RuntimeModuleSpecifierContext
  | SchemaModuleSpecifierContext;

export type ModuleSpecifierResolver = (
  specifier: ModuleSpecifierContext,
) => string;

export interface CompileAllOptions {
  readonly ts?: boolean;
  readonly js?: boolean;
  readonly dts?: boolean;
  readonly tsconfig?: ts.CompilerOptions;
  readonly moduleSpecifier?: ModuleSpecifierResolver;
}
