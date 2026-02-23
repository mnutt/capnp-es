#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const cmakeSourceDir = path.join("test", "interop", "cpp");
const cmakeBuildDir = path.join(cmakeSourceDir, "build");
const testFile =
  process.env.CAPNP_CPP_INTEROP_TEST_FILE ||
  "test/interop/rpc-cpp-interop.spec.ts";
const buildConfig = process.env.CAPNP_CPP_BUILD_CONFIG || "Release";
const skipBuild = process.env.CAPNP_CPP_SKIP_BUILD === "1";

const serverBin =
  process.env.CAPNP_CPP_SERVER_BIN ||
  path.join(".", cmakeBuildDir, "cpp_vat_server");
const clientBin =
  process.env.CAPNP_CPP_CLIENT_BIN ||
  path.join(".", cmakeBuildDir, "cpp_vat_client");

const PNPM_BIN = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(cmd, args, env = process.env) {
  const r = spawnSync(cmd, args, {
    cwd: rootDir,
    env,
    stdio: "inherit",
  });
  if (r.error) {
    throw r.error;
  }
  if (typeof r.status === "number" && r.status !== 0) {
    process.exit(r.status);
  }
  if (r.signal) {
    process.kill(process.pid, r.signal);
  }
}

if (!skipBuild) {
  run("cmake", ["-S", cmakeSourceDir, "-B", cmakeBuildDir]);
  run("cmake", ["--build", cmakeBuildDir, "--config", buildConfig]);
}

run(PNPM_BIN, ["-s", "vitest", "run", testFile], {
  ...process.env,
  CAPNP_CPP_INTEROP: "1",
  CAPNP_CPP_SERVER_BIN: serverBin,
  CAPNP_CPP_CLIENT_BIN: clientBin,
});
