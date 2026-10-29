import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { Session } from "node:inspector/promises";
import {
  Message,
  Struct,
  ObjectSize,
  CompositeList,
  Uint32List,
  utils,
} from "../../dist/index.mjs";

// Run each case in its own process, against the built package. Setup and warmup
// are excluded. Keep collected objects in the sample: a retained-heap snapshot
// would miss the short-lived pointer wrappers this benchmark investigates.
const [kind = "scalar", output] = process.argv.slice(2);
const iterations = Number(process.env.BENCH_ITERATIONS || 1_000_000);
if (
  !Number.isSafeInteger(iterations) ||
  iterations < 1 ||
  iterations > 10_000_000
)
  throw new Error("BENCH_ITERATIONS must be between 1 and 10000000");
class Scalar extends Struct {
  static _capnp = {
    displayName: "Scalar",
    id: "1",
    size: new ObjectSize(8, 0),
  };
  get value() {
    return utils.getUint32(0, this);
  }
}
class Container extends Struct {
  static _capnp = {
    displayName: "Container",
    id: "2",
    size: new ObjectSize(0, 1),
  };
}
const message = new Message();
let operation;
switch (kind) {
  case "scalar":
  case "control": {
    const root = message.initRoot(Scalar);
    utils.setUint32(0, 42, root);
    const { segment, byteOffset } = utils.getContent(root);
    operation =
      kind === "scalar"
        ? () => root.value
        : () => segment.getUint32(byteOffset);

    break;
  }
  case "composite": {
    const root = message.initRoot(Container);
    const element = utils.initList(0, CompositeList(Scalar), 2, root).get(1);
    utils.setUint32(0, 42, element);
    operation = () => element.value;

    break;
  }
  case "uint32-list": {
    const root = message.initRoot(Container);
    const list = utils.initList(0, Uint32List, 2, root);
    list.set(1, 42);
    operation = () => list.get(1);

    break;
  }
  default: {
    throw new Error("Case must be scalar, composite, uint32-list, or control");
  }
}
assert.equal(operation(), 42);
// A finite small-integer budget large enough for warmup and all measured reads.
message._capnp.traversalLimit = 0x3fffffff;
for (let i = 0; i < 100_000; i++) operation();
globalThis.gc?.();
const session = new Session();
session.connect();
try {
  await session.post("HeapProfiler.startSampling", {
    samplingInterval: 4096,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
  let sum = 0;
  for (let i = 0; i < iterations; i++) sum += operation();
  const { profile } = await session.post("HeapProfiler.stopSampling");
  assert.equal(sum, 42 * iterations);
  let charge = 8;
  if (kind === "control") charge = 0;
  if (kind === "composite") charge = 16;
  assert.equal(
    message._capnp.traversalLimit,
    0x3fffffff - charge * (100_000 + iterations),
  );
  const sites = [];
  function collect(node, stack = []) {
    const next = [...stack, node.callFrame.functionName];
    if (node.selfSize)
      sites.push({
        bytes: node.selfSize,
        stack: next,
        url: node.callFrame.url,
      });
    for (const child of node.children) collect(child, next);
  }
  collect(profile.head);
  sites.sort((a, b) => b.bytes - a.bytes);
  const sampledBytes = sites.reduce((total, site) => total + site.bytes, 0);
  console.log(
    JSON.stringify({
      kind,
      node: process.version,
      iterations,
      sampledBytes,
      estimatedBytesPerRead: sampledBytes / iterations,
      sites: sites.slice(0, 12),
    }),
  );
  if (output) await writeFile(output, JSON.stringify(profile));
} finally {
  session.disconnect();
}
