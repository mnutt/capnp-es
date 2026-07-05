#!/usr/bin/env node

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const PNPM_BIN = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const packageJson = JSON.parse(
  await readFile(path.join(rootDir, "package.json"), "utf8"),
);
const packageName = packageJson.name;
const packageVersion = packageJson.version;
const binName =
  typeof packageJson.bin === "string"
    ? packageName
    : Object.keys(packageJson.bin)[0];
const typescriptVersion = packageJson.devDependencies.typescript.replace(
  /^[~^]/,
  "",
);
const tarballName = `${packageName.replace(/^@/, "").replace("/", "-")}-${packageVersion}.tgz`;

const packDir = await mkdtemp(path.join(os.tmpdir(), "capnp-es-pack-"));
const projectDir = await mkdtemp(path.join(os.tmpdir(), "capnp-es-consumer-"));
const tarballPath = path.join(packDir, tarballName);

function run(cmd, args, cwd = rootDir) {
  const result = spawnSync(cmd, args, {
    cwd,
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

function runOutput(cmd, args, cwd = rootDir) {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
  });
  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === "number" && result.status !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exit(result.status);
  }
  if (result.signal) {
    process.kill(process.pid, result.signal);
  }
  return result.stdout;
}

try {
  run(PNPM_BIN, ["pack", "--pack-destination", packDir]);
  run(PNPM_BIN, ["exec", "publint", tarballPath]);

  await writeFile(
    path.join(projectDir, "package.json"),
    JSON.stringify(
      {
        name: "capnp-es-pack-smoke",
        version: "1.0.0",
        type: "module",
        packageManager: packageJson.packageManager,
      },
      null,
      2,
    ),
  );
  await mkdir(path.join(projectDir, "schemas"));
  await writeFile(
    path.join(projectDir, "schemas", "person.capnp"),
    `@0xe3c7bd344751b0f1;

struct Person {
  id @0 :UInt32;
  name @1 :Text;
}
`,
  );
  await writeFile(
    path.join(projectDir, "roundtrip.mjs"),
    `import assert from "node:assert/strict";
import { Message } from "${packageName}";
import { Person } from "./generated/schemas/person.js";

const message = new Message();
const person = message.initRoot(Person);
person.id = 42;
person.name = "Packed CLI";

const bytes = message.toUint8Array();
const decoded = new Message(bytes, false).getRoot(Person);

assert.equal(decoded.id, 42);
assert.equal(decoded.name, "Packed CLI");
console.log(\`roundtrip ok: \${bytes.byteLength} bytes\`);
`,
  );

  run(
    PNPM_BIN,
    ["add", tarballPath, `typescript@${typescriptVersion}`],
    projectDir,
  );

  const importChecks = [
    `import * as pkg from "${packageName}"; console.log(typeof pkg.Message)`,
    `import * as node from "${packageName}/node"; console.log(typeof node.connectNodeRpc)`,
    `import * as compiler from "${packageName}/compiler"; console.log(typeof compiler.compileAll)`,
  ];
  for (const source of importChecks) {
    const output = runOutput(
      "node",
      ["--input-type=module", "-e", source],
      projectDir,
    ).trim();
    if (output !== "function") {
      throw new Error(`Unexpected import check output: ${output}`);
    }
  }

  const generatedId = runOutput(PNPM_BIN, ["exec", binName, "-i"], projectDir);
  if (!/^@0x[0-9a-f]{16}\n$/i.test(generatedId)) {
    throw new Error(`Unexpected generated schema ID: ${generatedId}`);
  }

  run(
    PNPM_BIN,
    ["exec", binName, "-ots,js,dts:./generated", "schemas/person.capnp"],
    projectDir,
  );

  const generatedJs = await readFile(
    path.join(projectDir, "generated", "schemas", "person.js"),
    "utf8",
  );
  if (!generatedJs.includes(`import * as $ from "${packageName}"`)) {
    throw new Error(`Generated JS does not import ${packageName}`);
  }

  run("node", ["roundtrip.mjs"], projectDir);
  run(
    PNPM_BIN,
    [
      "exec",
      "tsc",
      "--allowJs",
      "false",
      "--checkJs",
      "false",
      "--noEmit",
      "--skipLibCheck",
      "--target",
      "ESNext",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "generated/schemas/person.ts",
    ],
    projectDir,
  );
} finally {
  if (process.env.CAPNP_ES_KEEP_PACK_TEST_DIRS === "1") {
    console.log(`[capnp-es] kept pack dir: ${packDir}`);
    console.log(`[capnp-es] kept consumer dir: ${projectDir}`);
  } else {
    await rm(packDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }
}
