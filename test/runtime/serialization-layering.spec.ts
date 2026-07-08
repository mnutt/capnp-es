import { describe, test, assert as t } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Message } from "src/serialization";

function tsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      files.push(...tsFiles(path));
    } else if (path.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

describe("serialization layering", () => {
  test("serialization entry loads without RPC imports", () => {
    const message = new Message();
    t.equal(message.getSegment(0).id, 0);
  });

  test("serialization sources do not import rpc", () => {
    const offenders = tsFiles("src/serialization").filter((path) => {
      const source = readFileSync(path, "utf8");
      return (
        source.includes('from "../rpc') ||
        source.includes("from '../rpc") ||
        source.includes('from "../../rpc') ||
        source.includes("from '../../rpc") ||
        source.includes('from "src/rpc') ||
        source.includes("from 'src/rpc")
      );
    });

    t.deepEqual(offenders, []);
  });
});
