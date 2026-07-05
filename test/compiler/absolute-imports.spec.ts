import { exec } from "node:child_process";
import { compileAll } from "@mnutt/capnp-es/compiler";
import { test, assert as t } from "vitest";

test("compiler maps absolute non-standard imports to relative ESM imports", async () => {
  const stdout = await new Promise<Buffer>((resolve, reject) => {
    exec(
      [
        "capnpc",
        "-o-",
        "--src-prefix=test/fixtures/absolute-imports",
        "-Itest/fixtures/absolute-imports",
        "test/fixtures/absolute-imports/sandstorm/base.capnp",
        "test/fixtures/absolute-imports/sandstorm/leaf.capnp",
      ].join(" "),
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

  const leaf = files.get("sandstorm/leaf.ts");
  t.ok(leaf);
  t.ok(files.has("sandstorm/base.ts"));
  t.include(
    leaf,
    'import { BackendApi, BackendApi$Client, BackendConfig } from "./base.js";',
  );
  t.notInclude(leaf, 'from "/sandstorm/base.js"');
  t.include(leaf, "getConfig");
  t.include(leaf, "BackendConfig$Promise");
  t.notInclude(leaf, "export class BackendConfig extends");
  t.ok(files.has("sandstorm/leaf.js"));
  t.ok(files.has("sandstorm/leaf.d.ts"));
});
