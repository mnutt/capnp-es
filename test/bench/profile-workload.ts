import { writeFile } from "node:fs/promises";
import { Session } from "node:inspector/promises";

// Keep schema loading, correctness checks, warmup, and benchmark harness out of
// the profile. Profile timings themselves must not be used as benchmark results.
export async function profileWorkload(
  name: string,
  operation: () => unknown,
  asynchronous = true,
  defaultPath = "test/bench/rpc.cpuprofile",
) {
  const iterations = Number(process.env.CAPNP_PROFILE_ITERATIONS || 100_000);
  if (!Number.isSafeInteger(iterations) || iterations < 1) {
    throw new Error("CAPNP_PROFILE_ITERATIONS must be a positive integer");
  }
  const output = process.env.CAPNP_PROFILE_PATH || defaultPath;
  const heapOutput = process.env.CAPNP_PROFILE_HEAP_PATH;
  console.log(`Warming up ${name}`);
  if (asynchronous) {
    for (let i = 0; i < 5000; i++) await operation();
  } else {
    for (let i = 0; i < 5000; i++) operation();
  }
  const session = new Session();
  session.connect();
  try {
    if (heapOutput) {
      await session.post("HeapProfiler.startSampling", {
        samplingInterval: 4096,
        includeObjectsCollectedByMajorGC: true,
        includeObjectsCollectedByMinorGC: true,
      });
    } else {
      await session.post("Profiler.enable");
      await session.post("Profiler.start");
    }
    if (asynchronous) {
      for (let i = 0; i < iterations; i++) await operation();
    } else {
      for (let i = 0; i < iterations; i++) operation();
    }
    if (heapOutput) {
      const { profile } = await session.post("HeapProfiler.stopSampling");
      await writeFile(heapOutput, JSON.stringify(profile));
    } else {
      const { profile } = await session.post("Profiler.stop");
      await writeFile(output, JSON.stringify(profile));
    }
    console.log(
      `Saved ${iterations} iterations of ${name} to ${heapOutput || output}`,
    );
  } finally {
    session.disconnect();
  }
}
