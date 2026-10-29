import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));
await build({
  entryPoints: ["bench", "rpc", "sandstorm", "scaling"].map(
    (name) => `${directory}${name}.ts`,
  ),
  outdir: directory,
  outExtension: { ".js": ".bench.mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  external: ["./data/capnp/schema-legacy.cjs"],
  // Benchmark the published build, not tsconfig's source aliases.
  tsconfigRaw: { compilerOptions: {} },
});
