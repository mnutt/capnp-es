import { describe, test, assert as t } from "vitest";
import { spawn, ChildProcessByStdio } from "node:child_process";
import net from "node:net";
import type { Readable } from "node:stream";
import type { AddressInfo } from "node:net";
import type { Conn } from "src/rpc";
import { TcpRPCTransport } from "./tcp-rpc-transport";

const ENABLE_INTEROP = process.env.CAPNP_CPP_INTEROP === "1";
const SERVER_BIN =
  process.env.CAPNP_CPP_SERVER_BIN || "./test/interop/cpp/build/cpp_vat_server";
const CLIENT_BIN =
  process.env.CAPNP_CPP_CLIENT_BIN || "./test/interop/cpp/build/cpp_vat_client";
const STARTUP_TIMEOUT_MS = Number(
  process.env.CAPNP_CPP_STARTUP_TIMEOUT_MS || 5000,
);

function parseReadyPort(line: string): number | null {
  const match = line.trim().match(/^READY\s+(\d+)$/);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

async function startCppServer(): Promise<{
  child: ChildProcessByStdio<null, Readable, Readable>;
  host: string;
  port: number;
  stop: () => Promise<void>;
}> {
  const child = spawn(SERVER_BIN, [], {
    env: {
      ...process.env,
      CAPNP_INTEROP_HOST: process.env.CAPNP_INTEROP_HOST || "127.0.0.1",
      CAPNP_INTEROP_PORT: process.env.CAPNP_INTEROP_PORT || "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(`timed out waiting for cpp server READY line: ${stderr}`),
      );
    }, STARTUP_TIMEOUT_MS);

    child.on("error", (error_) => {
      clearTimeout(timer);
      reject(error_);
    });

    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      reject(
        new Error(
          `cpp server exited before READY (code=${code}, signal=${signal}): ${stderr}`,
        ),
      );
    });

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      for (const line of text.split(/\r?\n/)) {
        const p = parseReadyPort(line);
        if (p !== null) {
          clearTimeout(timer);
          resolve(p);
          return;
        }
      }
    });
  });

  const stop = async () => {
    if (child.killed) {
      return;
    }
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      child.once("exit", done);
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 1000);
    });
  };

  return {
    child,
    host: process.env.CAPNP_INTEROP_HOST || "127.0.0.1",
    port,
    stop,
  };
}

type CppClientMode =
  | "success"
  | "exception"
  | "pipeline-success"
  | "pipeline-exception"
  | "parallel";

async function runCppClient(
  host: string,
  port: number,
  mode: CppClientMode,
): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}> {
  const child = spawn(CLIENT_BIN, [host, String(port), mode], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  const [code, signal] = await new Promise<
    [number | null, NodeJS.Signals | null]
  >((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(`cpp client timed out: stdout=${stdout} stderr=${stderr}`),
      );
    }, STARTUP_TIMEOUT_MS);
    child.on("error", (error_) => {
      clearTimeout(timer);
      reject(error_);
    });
    child.on("exit", (c, s) => {
      clearTimeout(timer);
      resolve([c, s]);
    });
  });

  return { code, signal, stdout, stderr };
}

async function startTsServer(): Promise<{
  host: string;
  port: number;
  stop: () => Promise<void>;
}> {
  const [{ Conn }, { ReturnCapability }, { SimpleInterface }] =
    await Promise.all([
      import("src/rpc"),
      import("test/fixtures/import-interface"),
      import("test/fixtures/simple-interface"),
    ]);

  const host = process.env.CAPNP_INTEROP_HOST || "127.0.0.1";
  const conns: Conn[] = [];

  const server = net.createServer((socket) => {
    const conn = new Conn(TcpRPCTransport.fromSocket(socket));
    conn.onError = () => {};
    conn.initMain(ReturnCapability, {
      get: (p, r) => {
        if (p.index === 1) {
          throw new Error(
            "forced get() exception from capnp-es interop server",
          );
        }
        r.capability = new SimpleInterface.Server({
          subtract: async (sp, out) => {
            out.result = sp.a - sp.b;
          },
        }).client();
        return Promise.resolve();
      },
    });
    conns.push(conn);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => resolve());
  });

  const addr = server.address() as AddressInfo;
  const stop = async () => {
    for (const conn of conns) {
      conn.shutdown();
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return {
    host,
    port: addr.port,
    stop,
  };
}

describe.runIf(ENABLE_INTEROP)("rpc cpp interop", () => {
  test(
    "capnp-es client can bootstrap and call C++ capability",
    { timeout: 10000 },
    async () => {
      const [{ Conn }, { ReturnCapability }] = await Promise.all([
        import("src/rpc"),
        import("test/fixtures/import-interface"),
      ]);
      const server = await startCppServer();
      let conn: Conn | undefined;

      try {
        const transport = await TcpRPCTransport.connect(
          server.host,
          server.port,
        );
        conn = new Conn(transport);
        conn.onError = () => {};

        const ret = await conn
          .bootstrap(ReturnCapability)
          .get((p) => {
            p.index = 0;
          })
          .promise();

        const result = await ret.capability
          .subtract((p: any) => {
            p.a = 11;
            p.b = 4;
          })
          .promise();

        t.equal(result.result, 7);
      } finally {
        conn?.shutdown();
        await server.stop();
      }
    },
  );

  test(
    "capnp-es client receives method exception from C++ server",
    { timeout: 10000 },
    async () => {
      const [{ Conn }, { ReturnCapability }] = await Promise.all([
        import("src/rpc"),
        import("test/fixtures/import-interface"),
      ]);
      const server = await startCppServer();
      let conn: Conn | undefined;

      try {
        const transport = await TcpRPCTransport.connect(
          server.host,
          server.port,
        );
        conn = new Conn(transport);
        conn.onError = () => {};

        const error_ = await conn
          .bootstrap(ReturnCapability)
          .get((p) => {
            p.index = 1;
          })
          .promise()
          .then(() => null)
          .catch((error__: unknown) => error__ as Error);

        t.ok(error_ instanceof Error);
        t.ok(error_.message.length > 0);
      } finally {
        conn?.shutdown();
        await server.stop();
      }
    },
  );

  test(
    "capnp-es client supports pipelined capability call to C++ server",
    { timeout: 10000 },
    async () => {
      const [{ Conn }, { ReturnCapability }] = await Promise.all([
        import("src/rpc"),
        import("test/fixtures/import-interface"),
      ]);
      const server = await startCppServer();
      let conn: Conn | undefined;

      try {
        const transport = await TcpRPCTransport.connect(
          server.host,
          server.port,
        );
        conn = new Conn(transport);
        conn.onError = () => {};

        const getPromise = conn.bootstrap(ReturnCapability).get((p) => {
          p.index = 0;
        });
        const subtractPromise = getPromise
          .getCapability()
          .subtract((p: any) => {
            p.a = 11;
            p.b = 4;
          });

        const out = await subtractPromise.promise();
        t.equal(out.result, 7);
        await getPromise.promise();
      } finally {
        conn?.shutdown();
        await server.stop();
      }
    },
  );

  test(
    "capnp-es client supports parallel in-flight calls to C++ server",
    { timeout: 10000 },
    async () => {
      const [{ Conn }, { ReturnCapability }] = await Promise.all([
        import("src/rpc"),
        import("test/fixtures/import-interface"),
      ]);
      const server = await startCppServer();
      let conn: Conn | undefined;

      try {
        const transport = await TcpRPCTransport.connect(
          server.host,
          server.port,
        );
        conn = new Conn(transport);
        conn.onError = () => {};

        const ret = await conn
          .bootstrap(ReturnCapability)
          .get((p) => {
            p.index = 0;
          })
          .promise();

        const p1 = ret.capability
          .subtract((p: any) => {
            p.a = 11;
            p.b = 4;
          })
          .promise();
        const p2 = ret.capability
          .subtract((p: any) => {
            p.a = 31;
            p.b = 9;
          })
          .promise();

        const [r1, r2] = await Promise.all([p1, p2]);
        t.equal(r1.result, 7);
        t.equal(r2.result, 22);
      } finally {
        conn?.shutdown();
        await server.stop();
      }
    },
  );

  test(
    "C++ client can bootstrap and call capnp-es capability",
    { timeout: 10000 },
    async () => {
      const server = await startTsServer();
      try {
        const res = await runCppClient(server.host, server.port, "success");
        t.equal(res.code, 0);
        t.equal(res.signal, null);
        t.ok(res.stdout.includes("OK result=7"));
      } finally {
        await server.stop();
      }
    },
  );

  test(
    "C++ client receives method exception from capnp-es server",
    { timeout: 10000 },
    async () => {
      const server = await startTsServer();
      try {
        const res = await runCppClient(server.host, server.port, "exception");
        t.equal(res.code, 0);
        t.equal(res.signal, null);
        t.ok(res.stdout.includes("OK exception="));
      } finally {
        await server.stop();
      }
    },
  );

  test(
    "C++ client supports pipelined capability call to capnp-es server",
    { timeout: 10000 },
    async () => {
      const server = await startTsServer();
      try {
        const res = await runCppClient(
          server.host,
          server.port,
          "pipeline-success",
        );
        t.equal(res.code, 0);
        t.equal(res.signal, null);
        t.ok(res.stdout.includes("OK pipeline=7"));
      } finally {
        await server.stop();
      }
    },
  );

  test(
    "C++ client receives pipelined method exception from capnp-es server",
    { timeout: 10000 },
    async () => {
      const server = await startTsServer();
      try {
        const res = await runCppClient(
          server.host,
          server.port,
          "pipeline-exception",
        );
        t.equal(res.code, 0);
        t.equal(res.signal, null);
        t.ok(res.stdout.includes("OK exception="));
      } finally {
        await server.stop();
      }
    },
  );

  test(
    "C++ client supports parallel in-flight calls to capnp-es server",
    { timeout: 10000 },
    async () => {
      const server = await startTsServer();
      try {
        const res = await runCppClient(server.host, server.port, "parallel");
        t.equal(res.code, 0);
        t.equal(res.signal, null);
        t.ok(res.stdout.includes("OK parallel=7,22"));
      } finally {
        await server.stop();
      }
    },
  );
});
