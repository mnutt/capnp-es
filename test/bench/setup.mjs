import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The npm release predates modern V8 APIs. Pin upstream's node14 branch.
const revision = "18c54885f44c781eacc2f62dbe32cffc41fe29f5";
const directory = fileURLToPath(new URL(".", import.meta.url));
const env = {
  ...process.env,
  // Build with the same Node executable that runs this script.
  PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH || ""}`,
};

function npm(args) {
  const result = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    args,
    {
      env,
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `npm ${args[0]} failed (${result.signal || result.status})`,
    );
  }
}

console.log(`Installing node-capnp for Node ${process.versions.node}`);
npm([
  "install",
  "--prefix",
  directory,
  "--no-save",
  "--package-lock=false",
  "--ignore-scripts",
  `https://github.com/capnproto/node-capnp/archive/${revision}.tar.gz`,
]);

// Node 24 headers require C++20; upstream's build still requests C++14.
const bindingPath = join(directory, "node_modules/capnp/binding.gyp");
const binding = readFileSync(bindingPath, "utf8");
writeFileSync(bindingPath, binding.replaceAll("-std=c++14", "-std=c++20"));
npm(["rebuild", "--prefix", directory, "capnp"]);
