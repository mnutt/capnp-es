#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const schemaDir = path.join(rootDir, "src", "capnp", "_capnp");
const generatedDir = path.join(rootDir, "src", "capnp");
const distDir = path.join(rootDir, "dist");
const cppSourceFile = path.join("src", "capnp", "_capnp", "c++.capnp");
const PNPM_BIN = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: rootDir,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }
  if (result.signal) {
    process.kill(process.pid, result.signal);
  }
}

async function main() {
  run("unbuild", ["--stub"]);

  const files = await readdir(schemaDir);
  const sourceFiles = files
    .filter((fileName) => fileName.endsWith(".capnp"))
    .map((fileName) => path.join("src", "capnp", "_capnp", fileName))
    .sort();
  const nonCppSourceFiles = sourceFiles.filter(
    (file) => file !== cppSourceFile,
  );

  const includeRoot = await mkdtemp(path.join(os.tmpdir(), "capnp-es-std-"));
  const capnpIncludeDir = path.join(includeRoot, "capnp");
  await mkdir(capnpIncludeDir, { recursive: true });

  try {
    // Mirror vendored schemas under /capnp/* so absolute imports resolve without
    // pulling in system standard includes (which can cause duplicate file IDs).
    for (const fileName of files) {
      if (!fileName.endsWith(".capnp")) {
        continue;
      }
      const sourcePath = path.join(schemaDir, fileName);
      const sourceStat = await stat(sourcePath);
      if (!sourceStat.isFile()) {
        continue;
      }
      await copyFile(sourcePath, path.join(capnpIncludeDir, fileName));
    }

    run(PNPM_BIN, [
      "capnp-es",
      ...nonCppSourceFiles,
      "--no-standard-import",
      `--import-path=${includeRoot}`,
      "--src-prefix=src/capnp/_capnp",
      "-ots:./src/capnp",
    ]);
    await rm(path.join(generatedDir, "cpp.ts"), { force: true });
    await rm(path.join(generatedDir, "cpp.js"), { force: true });
    await rm(path.join(generatedDir, "cpp.d.ts"), { force: true });
    await rm(path.join(generatedDir, "cpp.mjs"), { force: true });
    await rm(path.join(generatedDir, "cpp.d.mts"), { force: true });
    run(PNPM_BIN, ["exec", "prettier", "-w", generatedDir]);
  } finally {
    await rm(includeRoot, { recursive: true, force: true });
    await rm(distDir, { recursive: true, force: true });
  }
}

await main();
