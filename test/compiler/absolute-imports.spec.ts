import { exec } from "node:child_process";
import { compileAll, type ModuleSpecifierContext } from "capnp-es/compiler";
import { test, assert as t } from "vitest";

async function compileAbsoluteImportFixtures(): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
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
}

test("compiler maps absolute non-standard imports to relative ESM imports", async () => {
  const stdout = await compileAbsoluteImportFixtures();

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

test("compiler supports custom generated module specifiers", async () => {
  const stdout = await compileAbsoluteImportFixtures();
  const seen: ModuleSpecifierContext[] = [];

  const { files } = await compileAll(stdout, {
    ts: true,
    js: true,
    dts: true,
    moduleSpecifier(specifier) {
      seen.push(specifier);
      if (specifier.kind === "runtime") {
        return `/vendor/${specifier.originalSpecifier}.js`;
      }
      return `capnp:/${specifier.toPath.replace(/\.ts$/, ".js")}`;
    },
  });

  const leafTs = files.get("sandstorm/leaf.ts");
  const leafJs = files.get("sandstorm/leaf.js");
  const leafDts = files.get("sandstorm/leaf.d.ts");

  t.ok(leafTs);
  t.ok(leafJs);
  t.ok(leafDts);
  t.include(leafTs, 'import * as $ from "/vendor/capnp-es.js";');
  t.include(
    leafTs,
    'import { BackendApi, BackendApi$Client, BackendConfig } from "capnp:/sandstorm/base.js";',
  );
  t.include(leafJs, 'from "capnp:/sandstorm/base.js"');
  t.include(leafDts, 'from "capnp:/sandstorm/base.js"');
  t.deepInclude(seen, {
    kind: "schema",
    fromPath: "sandstorm/leaf.ts",
    toPath: "sandstorm/base.ts",
    originalSpecifier: "./base.js",
    schemaDisplayName: "sandstorm/base.capnp",
  });
});
