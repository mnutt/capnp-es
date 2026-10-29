import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { bench, group, run, summary } from "mitata";
import { connectNodeRpc } from "capnp-es/node";
import { Bench, type SessionParams } from "./data/sandstorm/workloads";
import { loadNodeCapnp } from "./node-capnp";
import { profileWorkload } from "./profile-workload";
import { measure, selected } from "./measure";

const params = {
  basePath: "https://grain.example.test",
  userAgent: "Sandstorm RPC benchmark",
  acceptableLanguages: ["en-US", "en"],
};
function fillParams(out: SessionParams) {
  out.basePath = params.basePath;
  out.userAgent = params.userAgent;
  const languages = out._initAcceptableLanguages(
    params.acceptableLanguages.length,
  );
  for (const [i, language] of params.acceptableLanguages.entries()) {
    languages.set(i, language);
  }
}

const native = loadNodeCapnp();
const nativeSchema = native.import(
  fileURLToPath(new URL("data/sandstorm/workloads.capnp", import.meta.url)),
);
const directory = await mkdtemp(join(tmpdir(), "capnp-rpc-bench-"));
const socketPath = join(directory, "rpc.sock");
const server = spawn(
  fileURLToPath(new URL("cpp/build/rpc_bench_server", import.meta.url)),
  [`unix:${socketPath}`],
  { stdio: ["ignore", "pipe", "inherit"] },
);
const exited = once(server, "exit");
// Attach a handler immediately: spawn errors also reject once(..., "exit").
// eslint-disable-next-line unicorn/prefer-top-level-await
void exited.catch(() => {});
const lines = createInterface({ input: server.stdout });
const ready = new Promise<void>((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error("C++ peer startup timed out")),
    10_000,
  );
  const cleanup = () => clearTimeout(timer);
  lines.on("line", (line) => {
    if (line === "READY") {
      cleanup();
      resolve();
    }
  });
  server.once("error", (error) => {
    cleanup();
    reject(error);
  });
  server.once("exit", () => {
    cleanup();
    reject(new Error("C++ peer exited"));
  });
});

let closeES = () => {};
let closeNative = () => {};
try {
  await ready;
  // Optional Linux diagnostic: fix client/peer placement so scheduler choices
  // do not obscure small library differences. Applied before any timed work.
  const affinity = process.env.CAPNP_BENCH_AFFINITY;
  if (affinity) {
    if (process.platform !== "linux" || !/^\d+,\d+$/.test(affinity)) {
      throw new Error(
        "CAPNP_BENCH_AFFINITY requires Linux and CLIENT_CPU,PEER_CPU",
      );
    }
    const [clientCpu, peerCpu] = affinity.split(",");
    execFileSync("taskset", ["-pc", clientCpu, String(process.pid)]);
    execFileSync("taskset", ["-pc", peerCpu, String(server.pid)]);
    console.log(`CPU affinity: client ${clientCpu}, C++ peer ${peerCpu}`);
  }
  const esConnection = await connectNodeRpc({ path: socketPath });
  esConnection.onError = (error) => console.error("capnp-es RPC:", error);
  closeES = () => esConnection.shutdown();
  const es = esConnection.bootstrap(Bench);
  const nativeConnection = native.connect(`unix:${socketPath}`);
  closeNative = () => nativeConnection.close();
  const nc = nativeConnection.restore(null, nativeSchema.Bench);

  const callbackES = new Bench.Server({
    async ping(p, r) {
      r.sequence = p.sequence;
    },
    async open() {
      throw new Error("unused callback method");
    },
    async write() {
      throw new Error("unused callback method");
    },
    async callback() {
      throw new Error("unused callback method");
    },
  }).client();
  const callbackNative = new native.Capability(
    {
      ping(sequence: number) {
        return { sequence };
      },
    },
    nativeSchema.Bench,
  );

  type Workload = {
    name: string;
    expected: number;
    es: () => Promise<number>;
    nc: () => Promise<number>;
  };
  const pingES = async (sequence: number) =>
    (
      await es
        .ping((p) => {
          p.sequence = sequence;
        })
        .promise()
    ).sequence;
  const pingNative = async (sequence: number) =>
    (await nc.ping(sequence)).sequence;
  async function expectedFailure(
    call: () => Promise<number>,
    readStack = false,
  ) {
    try {
      await call();
    } catch (error) {
      if (
        String(error).includes("forced benchmark failure") &&
        (!readStack ||
          (error instanceof Error &&
            error.stack?.includes("forced benchmark failure")))
      )
        return 1;
      throw error;
    }
    throw new Error("RPC unexpectedly succeeded");
  }
  const cases: Workload[] = [
    {
      name: "RPC: reused capability, one round trip",
      expected: 42,
      es: () => pingES(42),
      nc: () => pingNative(42),
    },
    {
      name: "RPC: 16 concurrent calls (time per batch)",
      expected: 120,
      es: async () =>
        (
          await Promise.all(Array.from({ length: 16 }, (_, i) => pingES(i)))
        ).reduce((a, b) => a + b, 0),
      nc: async () =>
        (
          await Promise.all(Array.from({ length: 16 }, (_, i) => pingNative(i)))
        ).reduce((a, b) => a + b, 0),
    },
    {
      name: "RPC: acquire capability, await, call, release",
      expected: 42,
      es: async () => {
        const result = await es
          .open((p) => fillParams(p._initParams()))
          .promise();
        const cap = result.session;
        try {
          return (
            await cap
              .ping((p) => {
                p.sequence = 42;
              })
              .promise()
          ).sequence;
        } finally {
          cap.client.close();
        }
      },
      nc: async () => {
        const { session } = await nc.open(params);
        try {
          return (await session.ping(42)).sequence;
        } finally {
          session.close();
        }
      },
    },
    {
      name: "RPC: acquire capability, pipeline call, release",
      expected: 42,
      es: async () => {
        const pending = es.open((p) => fillParams(p._initParams()));
        const cap = pending.getSession();
        try {
          const [, result] = await Promise.all([
            pending.promise(),
            cap
              .ping((p) => {
                p.sequence = 42;
              })
              .promise(),
          ]);
          return result.sequence;
        } finally {
          cap.client.close();
        }
      },
      nc: async () => {
        const pending = nc.open(params);
        const cap = pending.session;
        try {
          const [, result] = await Promise.all([pending, cap.ping(42)]);
          return result.sequence;
        } finally {
          cap.close();
        }
      },
    },
    {
      name: "RPC: C++ callback into exported JS capability",
      expected: 42,
      es: async () =>
        (
          await es
            .callback((p) => {
              p.target = callbackES;
              p.sequence = 42;
            })
            .promise()
        ).sequence,
      nc: async () => (await nc.callback(callbackNative, 42)).sequence,
    },
  ];
  cases.push(
    {
      name: "RPC: four dependent capability acquisitions, pipelined call, release",
      expected: 42,
      es: async () => {
        let cap = es;
        const caps = [];
        const pending: Promise<unknown>[] = [];
        try {
          for (let i = 0; i < 4; i++) {
            const opening = cap.open((p) => fillParams(p._initParams()));
            pending.push(opening.promise());
            cap = opening.getSession();
            caps.push(cap);
          }
          const result = cap
            .ping((p) => {
              p.sequence = 42;
            })
            .promise();
          await Promise.all([...pending, result]);
          return (await result).sequence;
        } finally {
          for (const c of caps) c.client.close();
        }
      },
      nc: async () => {
        let cap = nc;
        const caps = [];
        const pending = [];
        try {
          for (let i = 0; i < 4; i++) {
            const opening = cap.open(params);
            pending.push(opening);
            cap = opening.session;
            caps.push(cap);
          }
          const result = cap.ping(42);
          await Promise.all([...pending, result]);
          return (await result).sequence;
        } finally {
          for (const c of caps) c.close();
        }
      },
    },
    {
      name: "RPC: remote exception propagation",
      expected: 1,
      es: () => expectedFailure(() => pingES(0xffffffff)),
      nc: () => expectedFailure(() => pingNative(0xffffffff)),
    },
    {
      name: "RPC: remote exception propagation + stack access",
      expected: 1,
      es: () => expectedFailure(() => pingES(0xffffffff), true),
      nc: () => expectedFailure(() => pingNative(0xffffffff), true),
    },
  );
  for (const size of [1024, 64 * 1024]) {
    const data = Buffer.alloc(size, 0x5a);
    cases.push({
      name: `RPC: Data write ${size / 1024} KiB + acknowledgement`,
      expected: size,
      es: async () =>
        (await es.write((p) => p._initData(size).copyBuffer(data)).promise())
          .size,
      nc: async () => (await nc.write(data)).size,
    });
  }

  try {
    for (const c of cases) {
      assert.equal(await c.es(), c.expected, `${c.name}: capnp-es`);
      assert.equal(await c.nc(), c.expected, `${c.name}: node-capnp`);
      group(c.name, () =>
        summary(() => {
          bench("capnp-es", c.es);
          bench("node-capnp", c.nc);
        }),
      );
    }
    console.log(
      `All ${cases.length * 2} RPC checks passed (shared C++ peer, Unix socket).`,
    );
    const selection = process.env.CAPNP_BENCH_CASE;
    if (process.argv.includes("--measure")) {
      for (const c of cases.filter((c) => selected(c.name))) {
        await measure(`${c.name}: capnp-es`, c.es, true);
        await measure(`${c.name}: node-capnp`, c.nc, true);
      }
    } else if (process.argv.includes("--profile")) {
      const exact = cases.find((c) => c.name === selection);
      let selected = [cases[0]];
      if (exact) selected = [exact];
      else if (selection)
        selected = cases.filter((c) => c.name.includes(selection));
      if (selected.length !== 1)
        throw new Error("CAPNP_BENCH_CASE must match exactly one workload");
      await profileWorkload(selected[0].name, selected[0].es);
    } else if (!process.argv.includes("--check")) await run();
  } finally {
    callbackES.client.close();
    callbackNative.close();
    es.client.close();
    nc.close();
  }
} finally {
  closeES();
  closeNative();
  lines.close();
  server.kill();
  await exited.catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
