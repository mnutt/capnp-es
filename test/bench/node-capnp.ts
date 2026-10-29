import { createRequire } from "node:module";
import { resolve } from "node:path";

export function loadNodeCapnp() {
  const require = createRequire(import.meta.url);
  let nodeCapnp;
  try {
    nodeCapnp = require(
      process.env.NODE_CAPNP_PATH
        ? resolve(process.env.NODE_CAPNP_PATH)
        : "capnp",
    );
  } catch (error_) {
    throw new Error(
      "Cannot load node-capnp. Run pnpm bench:setup or set NODE_CAPNP_PATH " +
        "to a built node-capnp checkout compatible with this Node version. " +
        "See test/bench/README.md.",
      { cause: error_ },
    );
  }
  if (
    typeof nodeCapnp?.import !== "function" ||
    typeof nodeCapnp?.parse !== "function"
  ) {
    throw new TypeError(
      "NODE_CAPNP_PATH must point to the node-capnp package directory or its " +
        "JavaScript wrapper (capnp.js), not the native capnp.node addon. " +
        "For a Sandstorm build, use node_modules/capnp.js.",
    );
  }
  return nodeCapnp;
}
