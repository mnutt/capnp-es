import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { compileAll } from "capnp-es/compiler";
import { test, expect, assert as t } from "vitest";

const sandstormSrc =
  process.env.CAPNP_ES_SANDSTORM_SRC ?? "/home/michael/src/sandstorm/src";
const sandstormSchemaDir = join(sandstormSrc, "sandstorm");

test.skipIf(!existsSync(sandstormSchemaDir))(
  "compiler compiles all Sandstorm schemas recursively",
  async () => {
    const sourceFiles = (await readdir(sandstormSchemaDir, { recursive: true }))
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
      // The shell consumes TypeScript directly; include every requested schema.
    });

    t.ok(files.has("sandstorm/app-index/app-index.ts"));
    t.ok(files.has("sandstorm/test-app/test-app.ts"));
    await expect(
      compileAll(stdout, { ts: true, traversalLimit: 8 }),
    ).rejects.toThrow(/Traversal limit exceeded/);
    t.ok(files.has("sandstorm/backend.ts"));
    t.ok(files.has("sandstorm/supervisor.ts"));
    t.ok(files.has("sandstorm/web-session.ts"));
    t.ok(files.has("sandstorm/util.ts"));
    t.include(files.get("sandstorm/util.ts") ?? "", "capnp-es/capnp/stream");
  },
);
