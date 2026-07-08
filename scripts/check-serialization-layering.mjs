#!/usr/bin/env node

import { readFileSync } from "node:fs";

const graph = JSON.parse(readFileSync(0, "utf8"));
const offenders = [];

for (const [modulePath, deps] of Object.entries(graph)) {
  for (const dep of deps) {
    if (
      dep === "../rpc" ||
      dep.startsWith("../rpc/") ||
      dep === "src/rpc" ||
      dep.startsWith("src/rpc/")
    ) {
      offenders.push(`${modulePath} -> ${dep}`);
    }
  }
}

if (offenders.length > 0) {
  console.error("Serialization must not import RPC modules:");
  for (const offender of offenders) {
    console.error(`- ${offender}`);
  }
  process.exit(1);
}
