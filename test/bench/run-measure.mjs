import { spawnSync } from "node:child_process";
import { mkdirSync, openSync, closeSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const [label, suite = "rpc", filter] = process.argv.slice(2);
if (
  !label ||
  !/^[\w-]+$/.test(label) ||
  !["rpc", "sandstorm", "scaling", "bench"].includes(suite)
) {
  throw new Error(
    "Usage: node test/bench/run-measure.mjs LABEL [rpc|sandstorm|scaling|bench] [FILTER]",
  );
}
const directory = join(tmpdir(), "capnp-perf-branch");
const defaultIterations = {
  rpc: 2000,
  sandstorm: 1000,
  scaling: 100,
  bench: 5000,
};
mkdirSync(directory, { recursive: true });
function run(args, env = process.env) {
  const log = openSync(join(directory, `${label}-${suite}.log`), "a");
  try {
    const result = spawnSync(process.execPath, args, {
      env,
      stdio: ["ignore", log, log],
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(
        `Failed: ${args.join(" ")}; see ${directory}/${label}-${suite}.log`,
      );
  } finally {
    closeSync(log);
  }
}
run(["node_modules/unbuild/dist/cli.mjs"]);
run(["test/bench/compile.mjs"]);
run(
  [
    `test/bench/${suite}.bench.mjs`,
    "--measure",
    ...(suite === "bench" ? ["--node-capnp"] : []),
  ],
  {
    ...process.env,
    BENCH_FILTER:
      process.env.BENCH_FILTER ||
      filter ||
      (suite === "rpc"
        ? "reused capability|16 concurrent|four dependent|64 KiB"
        : ".*"),
    BENCH_ITERATIONS:
      process.env.BENCH_ITERATIONS || String(defaultIterations[suite]),
    BENCH_WARMUP_MS:
      process.env.BENCH_WARMUP_MS || (suite === "rpc" ? "1000" : "200"),
    BENCH_OUTPUT: join(directory, `${label}-${suite}.jsonl`),
  },
);
console.log(`Results: ${directory}/${label}-${suite}.jsonl`);
