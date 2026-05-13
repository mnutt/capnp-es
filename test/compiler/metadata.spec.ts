import { exec } from "node:child_process";
import { compileAll } from "capnp-es/compiler";
import { test, assert as t } from "vitest";

async function compileFixtures(
  ...sources: string[]
): Promise<Map<string, string>> {
  const stdout = await new Promise<Buffer>((resolve, reject) => {
    exec(
      `capnpc -o- ${sources.join(" ")}`,
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
    js: false,
    dts: false,
  });

  return files;
}

test("compiler emits stable struct schema metadata", async () => {
  const files = await compileFixtures("test/fixtures/test.capnp");
  const source = files.get("test/fixtures/test.ts");

  t.ok(source);
  t.include(source, 'displayName: "TestAllTypes"');
  t.include(source, "typeId: 0xa0a8f314b80b63fdn");
  t.include(source, 'typeIdHex: "a0a8f314b80b63fd"');
  t.include(source, 'name: "int32Field"');
  t.include(source, 'kind: "slot"');
  t.include(source, 'type: { kind: "int32" }');
  t.include(source, 'name: "structList"');
  t.include(source, 'kind: "list"');
  t.include(source, 'elementType: { kind: "struct"');
});

test("compiler emits stable interface method metadata", async () => {
  const files = await compileFixtures("test/fixtures/simple-interface.capnp");
  const source = files.get("test/fixtures/simple-interface.ts");

  t.ok(source);
  t.include(
    source,
    "paramFields: SimpleInterface_Subtract$Params._capnp.fields",
  );
  t.include(
    source,
    "resultFields: SimpleInterface_Subtract$Results._capnp.fields",
  );
  t.include(source, "methods: SimpleInterface$Client.methods");
  t.include(source, 'name: "a"');
  t.include(source, 'name: "result"');
});
