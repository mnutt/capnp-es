import { appendFile } from "node:fs/promises";

export async function measure(
  name: string,
  operation: () => unknown,
  asynchronous = false,
) {
  const iterations = Number(
    process.env.BENCH_ITERATIONS || (asynchronous ? 2000 : 5000),
  );
  const samples = Number(process.env.BENCH_SAMPLES || 5);
  const warmupMs = Number(process.env.BENCH_WARMUP_MS || 200);
  if (
    !Number.isSafeInteger(iterations) ||
    iterations < 1 ||
    !Number.isSafeInteger(samples) ||
    samples < 1 ||
    !Number.isFinite(warmupMs) ||
    warmupMs < 0
  ) {
    throw new Error(
      "BENCH_ITERATIONS and BENCH_SAMPLES must be positive integers; BENCH_WARMUP_MS must be finite and nonnegative",
    );
  }
  const times: number[] = [];
  let result: unknown;
  const warmupUntil = performance.now() + warmupMs;
  for (let batch = -1; batch < samples; ) {
    const start = performance.now();
    if (asynchronous) {
      for (let i = 0; i < iterations; i++) result = await operation();
    } else {
      for (let i = 0; i < iterations; i++) result = operation();
    }
    if (batch >= 0)
      times.push(((performance.now() - start) * 1000) / iterations);
    if (batch >= 0 || performance.now() >= warmupUntil) batch++;
  }
  const sorted = [...times].sort((a, b) => a - b);
  const record = {
    name,
    node: process.version,
    iterations,
    warmupMs,
    ...(process.env.CAPNP_BENCH_AFFINITY
      ? { cpuAffinity: process.env.CAPNP_BENCH_AFFINITY }
      : {}),
    samplesUs: times,
    medianUs: sorted[Math.floor(samples / 2)],
    resultType: typeof result,
  };
  const line = JSON.stringify(record);
  console.log(line);
  if (process.env.BENCH_OUTPUT)
    await appendFile(process.env.BENCH_OUTPUT, line + "\n");
}

export function selected(name: string) {
  return (
    !process.env.BENCH_FILTER || new RegExp(process.env.BENCH_FILTER).test(name)
  );
}
