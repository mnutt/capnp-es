import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { compileAll } from "@mnutt/capnp-es/compiler";
import { test, assert as t } from "vitest";

const sandstormSrc =
  process.env.CAPNP_ES_SANDSTORM_SRC ?? "/home/michael/src/sandstorm/src";
const sandstormSchemaDir = join(sandstormSrc, "sandstorm");

test.skipIf(!existsSync(sandstormSchemaDir))(
  "compiler compiles top-level Sandstorm schemas",
  async () => {
    const sourceFiles = (await readdir(sandstormSchemaDir))
      .filter((fileName) => fileName.endsWith(".capnp"))
      .sort()
      .map((fileName) => join(sandstormSchemaDir, fileName));

    const stdout = await new Promise<Buffer>((resolve, reject) => {
      execFile(
        "capnpc",
        [
          "-o-",
          `--src-prefix=${sandstormSrc}`,
          `-I${sandstormSrc}`,
          ...sourceFiles,
        ],
        { encoding: "buffer" },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(error.message, { cause: stderr }));
          } else {
            resolve(stdout);
          }
        },
      );
    });

    const { files } = await compileAll(stdout, {
      ts: true,
      js: true,
      dts: true,
    });

    t.ok(files.has("sandstorm/backend.ts"));
    t.ok(files.has("sandstorm/backend.js"));
    t.ok(files.has("sandstorm/backend.d.ts"));
    t.ok(files.has("sandstorm/supervisor.ts"));
    t.ok(files.has("sandstorm/web-session.ts"));
    t.ok(files.has("sandstorm/util.ts"));
    t.include(
      files.get("sandstorm/util.ts") ?? "",
      "@mnutt/capnp-es/capnp/stream",
    );
  },
);
