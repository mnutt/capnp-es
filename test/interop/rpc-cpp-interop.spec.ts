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
  return startCppServerWithMode("return");
}

async function startCppServerWithMode(
  mainType:
    | "return"
    | "restorer"
    | "persistence"
    | "sandstorm-bridge"
    | "tail-return",
): Promise<{
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
      CAPNP_INTEROP_MAIN: mainType,
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
  | "multiple-get-calls"
  | "parallel"
  | "persistent-nonpersistent"
  | "restore-success"
  | "restore-unknown"
  | "restore-sealed-success"
  | "restore-sealed-denied"
  | "restore-revoked"
  | "sandstorm-apphooks"
  | "web-session-get";

function dataFromText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function dataToText(data: { toUint8Array(): Uint8Array }): string {
  return new TextDecoder().decode(data.toUint8Array());
}

async function makeSandstormNode(label: string): Promise<any> {
  const { Node$Server } = await import("test/fixtures/sandstorm-powerbox-flow");
  return new Node$Server({
    async stat(_params: any, results: any): Promise<void> {
      results.isDir = true;
    },

    async save(_params: any, results: any): Promise<void> {
      const bytes = dataFromText(label);
      results._initObjectId(bytes.byteLength).copyBuffer(bytes);
    },
  }).client();
}

async function startTsSandstormAppHooksServer(): Promise<{
  host: string;
  port: number;
  seen: {
    getViewInfoCalls: number;
    restoreCalls: number;
    restoredObjectIds: string[];
  };
  stop: () => Promise<void>;
}> {
  const [{ Conn }, { AppHooks }] = await Promise.all([
    import("src/rpc"),
    import("test/fixtures/sandstorm-powerbox-flow"),
  ]);

  const host = process.env.CAPNP_INTEROP_HOST || "127.0.0.1";
  const conns: Conn[] = [];
  const seen = {
    getViewInfoCalls: 0,
    restoreCalls: 0,
    restoredObjectIds: [] as string[],
  };

  const server = net.createServer((socket) => {
    const conn = new Conn(TcpRPCTransport.fromSocket(socket));
    conn.onError = () => {};
    conn.initMain(AppHooks, {
      async getViewInfo(_params: any, results: any): Promise<void> {
        seen.getViewInfoCalls++;
        results.supportsNode = true;
      },

      async restore(params: any, results: any): Promise<void> {
        seen.restoreCalls++;
        const objectId = dataToText(params.objectId);
        seen.restoredObjectIds.push(objectId);
        results.cap = await makeSandstormNode(objectId);
      },

      async drop(_params: any, _results: any): Promise<void> {
        // No-op for interop coverage.
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
    seen,
    stop,
  };
}

async function startTsWebSessionServer(): Promise<{
  host: string;
  port: number;
  seen: {
    getCalls: number;
    paths: string[];
  };
  stop: () => Promise<void>;
}> {
  const [{ Conn }, { WebSession }] = await Promise.all([
    import("src/rpc"),
    import("test/fixtures/web-session-interop"),
  ]);

  const host = process.env.CAPNP_INTEROP_HOST || "127.0.0.1";
  const conns: Conn[] = [];
  const seen = {
    getCalls: 0,
    paths: [] as string[],
  };

  const server = net.createServer((socket) => {
    const conn = new Conn(TcpRPCTransport.fromSocket(socket));
    conn.onError = () => {};
    conn.initMain(WebSession, {
      async ping(_params: any, _results: any): Promise<void> {
        // Inherited UiSession method, included to mirror Sandstorm WebSession.
      },

      async get(params: any, _results: any): Promise<any> {
        seen.getCalls++;
        seen.paths.push(params.path);
        const text = `native export websession get ${params.path}`;
        return {
          content: {
            statusCode: 200,
            mimeType: "text/plain; charset=utf-8",
            body: { bytes: dataFromText(text) },
          },
        };
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
    seen,
    stop,
  };
}

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

async function startTsServer(
  mainType: "return" | "restorer" = "return",
): Promise<{
  host: string;
  port: number;
  stop: () => Promise<void>;
}> {
  const [
    { Conn },
    { ReturnCapability },
    { SimpleInterface },
    { RpcLevel2Restorer },
  ] = await Promise.all([
    import("src/rpc"),
    import("test/fixtures/import-interface"),
    import("test/fixtures/simple-interface"),
    import("test/fixtures/rpc-level2"),
  ]);

  const host = process.env.CAPNP_INTEROP_HOST || "127.0.0.1";
  const conns: Conn[] = [];

  const server = net.createServer((socket) => {
    const conn = new Conn(TcpRPCTransport.fromSocket(socket));
    conn.onError = () => {};
    if (process.env.CAPNP_CPP_TRACE === "1") {
      conn.onError = (error_) => {
        if (error_) {
          console.error(`[ts-server] onError: ${error_.message}`);
        }
      };
      const originalSendMessage = conn.sendMessage.bind(conn);
      conn.sendMessage = (m: any) => {
        const which = m.which();
        switch (which) {
          case 3: {
            let details = "";
            if (m.return.which() === 0) {
              const payload = m.return.results;
              const content = payload.content;
              const lo = content.segment.getUint32(content.byteOffset);
              const hi = content.segment.getUint32(content.byteOffset + 4);
              details = ` capTable=${payload.capTable.length} ptr=[${lo},${hi}]`;
            }
            console.error(
              `[ts-server->peer] RETURN a=${m.return.answerId} which=${m.return.which()} noFinishNeeded=${m.return.noFinishNeeded}${details}`,
            );

            break;
          }
          case 5: {
            console.error(
              `[ts-server->peer] RESOLVE p=${m.resolve.promiseId} which=${m.resolve.which()}`,
            );

            break;
          }
          case 6: {
            console.error(
              `[ts-server->peer] RELEASE id=${m.release.id} refs=${m.release.referenceCount}`,
            );

            break;
          }
          // No default
        }
        return originalSendMessage(m);
      };
      const originalHandleMessage = (conn as any).handleMessage.bind(conn);
      (conn as any).handleMessage = (m: any) => {
        const which = m.which();
        switch (which) {
          case 1: {
            console.error(`[ts-server] BOOTSTRAP q=${m.bootstrap.questionId}`);

            break;
          }
          case 2: {
            const targetWhich = m.call.target.which();
            if (targetWhich === 1) {
              console.error(
                `[ts-server] CALL q=${m.call.questionId} target=promised q=${m.call.target.promisedAnswer.questionId}`,
              );
            } else if (targetWhich === 0) {
              console.error(
                `[ts-server] CALL q=${m.call.questionId} target=imported id=${m.call.target.importedCap}`,
              );
            } else {
              console.error(
                `[ts-server] CALL q=${m.call.questionId} targetWhich=${targetWhich}`,
              );
            }

            break;
          }
          case 3: {
            console.error(
              `[ts-server] RETURN a=${m.return.answerId} which=${m.return.which()} noFinishNeeded=${m.return.noFinishNeeded}`,
            );

            break;
          }
          case 4: {
            console.error(
              `[ts-server] FINISH q=${m.finish.questionId} releaseResultCaps=${m.finish.releaseResultCaps}`,
            );

            break;
          }
          case 6: {
            console.error(
              `[ts-server] RELEASE id=${m.release.id} refs=${m.release.referenceCount}`,
            );

            break;
          }
          // No default
        }
        return originalHandleMessage(m);
      };
    }
    if (mainType === "restorer") {
      conn.initMain(RpcLevel2Restorer, {
        restore: async (p, r) => {
          const sturdyRef = p.sturdyRef;
          const objectId = new TextDecoder().decode(
            sturdyRef.objectId.toUint8Array(),
          );
          if (sturdyRef.host === "vat-cpp" && objectId === "calc-1") {
            r.capability = new SimpleInterface.Server({
              subtract: async (sp, out) => {
                out.result = sp.a - sp.b;
              },
            }).client();
            return;
          }
          if (sturdyRef.host === "vat-cpp" && objectId === "revk-1") {
            throw new Error("revoked sturdyRef");
          }
          if (sturdyRef.host === "sealed-cpp" && objectId === "seal-1") {
            if (p.owner.id !== "owner-ok") {
              throw new Error("owner not allowed");
            }
            r.capability = new SimpleInterface.Server({
              subtract: async (sp, out) => {
                out.result = sp.a - sp.b;
              },
            }).client();
            return;
          }
          throw new Error("unknown sturdyRef");
        },
      });
    } else {
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
    }
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
    "capnp-es client handles C++ tail-call resultsSentElsewhere",
    { timeout: 10000 },
    async () => {
      const [{ Conn }, { ReturnCapability }] = await Promise.all([
        import("src/rpc"),
        import("test/fixtures/import-interface"),
      ]);
      const server = await startCppServerWithMode("tail-return");
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
    "capnp-es client cast to Persistent fails for non-persistent C++ capability",
    { timeout: 10000 },
    async () => {
      const [{ Conn }, { ReturnCapability }, { Persistent }] =
        await Promise.all([
          import("src/rpc"),
          import("test/fixtures/import-interface"),
          import("src/capnp/persistent"),
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
        const persistent = new Persistent.Client(ret.capability.client);
        const error_ = await persistent
          .save()
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
    "capnp-es client can round-trip passed capability through C++ persistence service",
    { timeout: 10000 },
    async () => {
      const [{ Conn }, { RpcLevel2PersistenceService }, { SimpleInterface }] =
        await Promise.all([
          import("src/rpc"),
          import("test/fixtures/rpc-level2"),
          import("test/fixtures/simple-interface"),
        ]);
      const server = await startCppServerWithMode("persistence");
      let conn: Conn | undefined;

      try {
        const transport = await TcpRPCTransport.connect(
          server.host,
          server.port,
        );
        conn = new Conn(transport);
        conn.onError = () => {};

        const passedCap = new SimpleInterface.Server({
          subtract: async (p, r) => {
            r.result = p.a - p.b;
          },
        }).client();

        const saved = await conn
          .bootstrap(RpcLevel2PersistenceService)
          .save((p) => {
            p.capability = passedCap;
            p._initSealFor().id = "owner-ts";
          })
          .promise();

        const restored = await conn
          .bootstrap(RpcLevel2PersistenceService)
          .restore((p) => {
            p._initSturdyRef().host = saved.sturdyRef.host;
            const objectId = saved.sturdyRef.objectId.toUint8Array();
            p.sturdyRef._initObjectId(objectId.byteLength).copyBuffer(objectId);
            p._initOwner().id = "owner-ts";
          })
          .promise();

        const out = await restored.capability
          .subtract((p) => {
            p.a = 21;
            p.b = 8;
          })
          .promise();

        t.equal(out.result, 13);
      } finally {
        conn?.shutdown();
        await server.stop();
      }
    },
  );

  test(
    "capnp-es client can fulfill and claim a persistent Node through C++ Sandstorm bridge",
    { timeout: 10000 },
    async () => {
      const [{ Conn }, { AppPersistent$Client, SandstormBridge }] =
        await Promise.all([
          import("src/rpc"),
          import("test/fixtures/sandstorm-powerbox-flow"),
        ]);
      const server = await startCppServerWithMode("sandstorm-bridge");
      let conn: Conn | undefined;

      try {
        const transport = await TcpRPCTransport.connect(
          server.host,
          server.port,
        );
        conn = new Conn(transport);
        conn.onError = () => {};

        const session = await conn
          .bootstrap(SandstormBridge)
          .getSessionContext()
          .promise();
        const label = "/interop/cpp-bridge-node";
        const offeredCap = await makeSandstormNode(label);

        await session.context
          .fulfillRequest((p: any) => {
            p.cap = offeredCap;
          })
          .promise();

        const claim = await session.context.claimRequest().promise();
        const stat = await claim.cap.stat().promise();
        const saved = await new AppPersistent$Client(claim.cap.client)
          .save()
          .promise();

        t.equal(stat.isDir, true);
        t.equal(dataToText(saved.objectId), label);
      } finally {
        conn?.shutdown();
        await server.stop();
      }
    },
  );

  test(
    "capnp-es client can restore sturdyRef from C++ restorer bootstrap",
    { timeout: 10000 },
    async () => {
      const [{ Conn }, { RpcLevel2Restorer }] = await Promise.all([
        import("src/rpc"),
        import("test/fixtures/rpc-level2"),
      ]);
      const server = await startCppServerWithMode("restorer");
      let conn: Conn | undefined;

      try {
        const transport = await TcpRPCTransport.connect(
          server.host,
          server.port,
        );
        conn = new Conn(transport);
        conn.onError = () => {};

        const restored = await conn
          .bootstrap(RpcLevel2Restorer)
          .restore((p) => {
            p._initSturdyRef().host = "vat-cpp";
            const objectId = new TextEncoder().encode("calc-1");
            p.sturdyRef._initObjectId(objectId.byteLength).copyBuffer(objectId);
            p._initOwner().id = "owner-ts";
          })
          .promise();

        const out = await restored.capability
          .subtract((p: any) => {
            p.a = 11;
            p.b = 4;
          })
          .promise();
        t.equal(out.result, 7);
      } finally {
        conn?.shutdown();
        await server.stop();
      }
    },
  );

  test(
    "capnp-es client gets restore exception for unknown sturdyRef from C++ restorer",
    { timeout: 10000 },
    async () => {
      const [{ Conn }, { RpcLevel2Restorer }] = await Promise.all([
        import("src/rpc"),
        import("test/fixtures/rpc-level2"),
      ]);
      const server = await startCppServerWithMode("restorer");
      let conn: Conn | undefined;

      try {
        const transport = await TcpRPCTransport.connect(
          server.host,
          server.port,
        );
        conn = new Conn(transport);
        conn.onError = () => {};

        const error_ = await conn
          .bootstrap(RpcLevel2Restorer)
          .restore((p) => {
            p._initSturdyRef().host = "vat-cpp";
            const objectId = new TextEncoder().encode("bad-id");
            p.sturdyRef._initObjectId(objectId.byteLength).copyBuffer(objectId);
            p._initOwner().id = "owner-ts";
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
    "capnp-es client gets revoked exception from C++ restorer",
    { timeout: 10000 },
    async () => {
      const [{ Conn }, { RpcLevel2Restorer }] = await Promise.all([
        import("src/rpc"),
        import("test/fixtures/rpc-level2"),
      ]);
      const server = await startCppServerWithMode("restorer");
      let conn: Conn | undefined;

      try {
        const transport = await TcpRPCTransport.connect(
          server.host,
          server.port,
        );
        conn = new Conn(transport);
        conn.onError = () => {};

        const error_ = await conn
          .bootstrap(RpcLevel2Restorer)
          .restore((p) => {
            p._initSturdyRef().host = "vat-cpp";
            const objectId = new TextEncoder().encode("revk-1");
            p.sturdyRef._initObjectId(objectId.byteLength).copyBuffer(objectId);
            p._initOwner().id = "owner-ts";
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
    "capnp-es client can restore sealed sturdyRef from C++ restorer with allowed owner",
    { timeout: 10000 },
    async () => {
      const [{ Conn }, { RpcLevel2Restorer }] = await Promise.all([
        import("src/rpc"),
        import("test/fixtures/rpc-level2"),
      ]);
      const server = await startCppServerWithMode("restorer");
      let conn: Conn | undefined;

      try {
        const transport = await TcpRPCTransport.connect(
          server.host,
          server.port,
        );
        conn = new Conn(transport);
        conn.onError = () => {};

        const restored = await conn
          .bootstrap(RpcLevel2Restorer)
          .restore((p) => {
            p._initSturdyRef().host = "sealed-cpp";
            const objectId = new TextEncoder().encode("seal-1");
            p.sturdyRef._initObjectId(objectId.byteLength).copyBuffer(objectId);
            p._initOwner().id = "owner-ok";
          })
          .promise();

        const out = await restored.capability
          .subtract((p: any) => {
            p.a = 11;
            p.b = 4;
          })
          .promise();
        t.equal(out.result, 7);
      } finally {
        conn?.shutdown();
        await server.stop();
      }
    },
  );

  test(
    "capnp-es client gets owner rejection for sealed sturdyRef from C++ restorer",
    { timeout: 10000 },
    async () => {
      const [{ Conn }, { RpcLevel2Restorer }] = await Promise.all([
        import("src/rpc"),
        import("test/fixtures/rpc-level2"),
      ]);
      const server = await startCppServerWithMode("restorer");
      let conn: Conn | undefined;

      try {
        const transport = await TcpRPCTransport.connect(
          server.host,
          server.port,
        );
        conn = new Conn(transport);
        conn.onError = () => {};

        const error_ = await conn
          .bootstrap(RpcLevel2Restorer)
          .restore((p) => {
            p._initSturdyRef().host = "sealed-cpp";
            const objectId = new TextEncoder().encode("seal-1");
            p.sturdyRef._initObjectId(objectId.byteLength).copyBuffer(objectId);
            p._initOwner().id = "owner-bad";
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
    "capnp-es client can restore across reconnects from C++ restorer bootstrap",
    { timeout: 10000 },
    async () => {
      const [{ Conn }, { RpcLevel2Restorer }] = await Promise.all([
        import("src/rpc"),
        import("test/fixtures/rpc-level2"),
      ]);
      const server = await startCppServerWithMode("restorer");
      let conn1: Conn | undefined;
      let conn2: Conn | undefined;

      try {
        conn1 = new Conn(
          await TcpRPCTransport.connect(server.host, server.port),
        );
        conn1.onError = () => {};
        const restored1 = await conn1
          .bootstrap(RpcLevel2Restorer)
          .restore((p) => {
            p._initSturdyRef().host = "vat-cpp";
            const objectId = new TextEncoder().encode("calc-1");
            p.sturdyRef._initObjectId(objectId.byteLength).copyBuffer(objectId);
            p._initOwner().id = "owner-ts";
          })
          .promise();
        const out1 = await restored1.capability
          .subtract((p: any) => {
            p.a = 9;
            p.b = 2;
          })
          .promise();
        t.equal(out1.result, 7);
        conn1.shutdown();
        conn1 = undefined;

        conn2 = new Conn(
          await TcpRPCTransport.connect(server.host, server.port),
        );
        conn2.onError = () => {};
        const restored2 = await conn2
          .bootstrap(RpcLevel2Restorer)
          .restore((p) => {
            p._initSturdyRef().host = "vat-cpp";
            const objectId = new TextEncoder().encode("calc-1");
            p.sturdyRef._initObjectId(objectId.byteLength).copyBuffer(objectId);
            p._initOwner().id = "owner-ts";
          })
          .promise();
        const out2 = await restored2.capability
          .subtract((p: any) => {
            p.a = 11;
            p.b = 4;
          })
          .promise();
        t.equal(out2.result, 7);
      } finally {
        conn1?.shutdown();
        conn2?.shutdown();
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
    "C++ client supports multiple get calls to capnp-es server",
    { timeout: 10000 },
    async () => {
      const server = await startTsServer();
      try {
        const res = await runCppClient(
          server.host,
          server.port,
          "multiple-get-calls",
        );
        t.equal(
          res.code,
          0,
          `stdout=${res.stdout.trim()} stderr=${res.stderr.trim()}`,
        );
        t.equal(res.signal, null);
        t.ok(res.stdout.includes("OK multiple-get-calls=10"));
      } finally {
        await server.stop();
      }
    },
  );

  test(
    "C++ client supports multiple get calls to C++ server (control)",
    { timeout: 10000 },
    async () => {
      const server = await startCppServerWithMode("return");
      try {
        const res = await runCppClient(
          server.host,
          server.port,
          "multiple-get-calls",
        );
        t.equal(
          res.code,
          0,
          `stdout=${res.stdout.trim()} stderr=${res.stderr.trim()}`,
        );
        t.equal(res.signal, null);
        t.ok(res.stdout.includes("OK multiple-get-calls=10"));
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

  test(
    "C++ client can restore sturdyRef from capnp-es restorer bootstrap",
    { timeout: 10000 },
    async () => {
      const server = await startTsServer("restorer");
      try {
        const res = await runCppClient(
          server.host,
          server.port,
          "restore-success",
        );
        t.equal(res.code, 0);
        t.equal(res.signal, null);
        t.ok(res.stdout.includes("OK restore=7"));
      } finally {
        await server.stop();
      }
    },
  );

  test(
    "C++ client can restore and save inherited persistent Node from capnp-es AppHooks",
    { timeout: 10000 },
    async () => {
      const server = await startTsSandstormAppHooksServer();
      try {
        const res = await runCppClient(
          server.host,
          server.port,
          "sandstorm-apphooks",
        );
        t.equal(
          res.code,
          0,
          `stdout=${res.stdout.trim()} stderr=${res.stderr.trim()}`,
        );
        t.equal(res.signal, null);
        t.ok(res.stdout.includes("OK sandstorm-apphooks=/cpp/restored-node"));
        t.equal(server.seen.getViewInfoCalls, 1);
        t.equal(server.seen.restoreCalls, 1);
        t.deepEqual(server.seen.restoredObjectIds, ["/cpp/restored-node"]);
      } finally {
        await server.stop();
      }
    },
  );

  test(
    "C++ client can call capnp-es WebSession-like inherited data method",
    { timeout: 10000 },
    async () => {
      const server = await startTsWebSessionServer();
      try {
        const res = await runCppClient(
          server.host,
          server.port,
          "web-session-get",
        );
        t.equal(
          res.code,
          0,
          `stdout=${res.stdout.trim()} stderr=${res.stderr.trim()}`,
        );
        t.equal(res.signal, null);
        t.ok(
          res.stdout.includes(
            "OK web-session-get=native export websession get /native-export-websession?from=cpp-interop",
          ),
        );
        t.equal(server.seen.getCalls, 1);
        t.deepEqual(server.seen.paths, [
          "/native-export-websession?from=cpp-interop",
        ]);
      } finally {
        await server.stop();
      }
    },
  );

  test(
    "C++ client gets restore exception for unknown sturdyRef from capnp-es restorer",
    { timeout: 10000 },
    async () => {
      const server = await startTsServer("restorer");
      try {
        const res = await runCppClient(
          server.host,
          server.port,
          "restore-unknown",
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
    "C++ client gets revoked exception from capnp-es restorer",
    { timeout: 10000 },
    async () => {
      const server = await startTsServer("restorer");
      try {
        const res = await runCppClient(
          server.host,
          server.port,
          "restore-revoked",
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
    "C++ client can restore sealed sturdyRef from capnp-es restorer with allowed owner",
    { timeout: 10000 },
    async () => {
      const server = await startTsServer("restorer");
      try {
        const res = await runCppClient(
          server.host,
          server.port,
          "restore-sealed-success",
        );
        t.equal(res.code, 0);
        t.equal(res.signal, null);
        t.ok(res.stdout.includes("OK restore=7"));
      } finally {
        await server.stop();
      }
    },
  );

  test(
    "C++ client gets owner rejection for sealed sturdyRef from capnp-es restorer",
    { timeout: 10000 },
    async () => {
      const server = await startTsServer("restorer");
      try {
        const res = await runCppClient(
          server.host,
          server.port,
          "restore-sealed-denied",
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
    "C++ client can restore across reconnects from capnp-es restorer bootstrap",
    { timeout: 10000 },
    async () => {
      const server = await startTsServer("restorer");
      try {
        const first = await runCppClient(
          server.host,
          server.port,
          "restore-success",
        );
        t.equal(first.code, 0);
        t.equal(first.signal, null);
        t.ok(first.stdout.includes("OK restore=7"));

        const second = await runCppClient(
          server.host,
          server.port,
          "restore-success",
        );
        t.equal(second.code, 0);
        t.equal(second.signal, null);
        t.ok(second.stdout.includes("OK restore=7"));
      } finally {
        await server.stop();
      }
    },
  );

  test(
    "C++ client cast to Persistent fails for non-persistent capnp-es capability",
    { timeout: 10000 },
    async () => {
      const server = await startTsServer();
      try {
        const res = await runCppClient(
          server.host,
          server.port,
          "persistent-nonpersistent",
        );
        t.equal(res.code, 0);
        t.equal(res.signal, null);
        t.ok(res.stdout.includes("OK exception="));
      } finally {
        await server.stop();
      }
    },
  );
});
