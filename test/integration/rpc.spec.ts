// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import { test, describe, assert as t, afterEach, beforeEach } from "vitest";
import { Hash, HashFactory } from "test/fixtures/hash-factory";
import { ReturnCapability } from "test/fixtures/import-interface";
import { SimpleInterface } from "test/fixtures/simple-interface";
import { createHash } from "node:crypto";
import { TestRPC } from "./rpc.utils";
import { bufferToHex } from "src/util.js";

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 500,
  intervalMs = 5,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("timeout waiting for condition");
}

describe("rpc", () => {
  let rpc: TestRPC;

  beforeEach(() => {
    rpc = new TestRPC();
  });

  afterEach(() => {
    rpc.close();
  });

  test("SimpleInterface", { timeout: 1000 }, async () => {
    const server = async () => {
      const s = await rpc.accept();
      s.initMain(SimpleInterface, {
        subtract: async (p, r) => {
          r.result = p.a - p.b;
        },
      });
      return s;
    };

    const client = async () => {
      const res = await rpc
        .connect()
        .bootstrap(SimpleInterface)
        .subtract((p) => {
          p.a = 9;
          p.b = -1;
        })
        .promise();
      return res.result;
    };

    const [, result] = await Promise.all([server(), client()]);
    t.equal(result, 10);
  });

  test("HashFactory", { timeout: 1000 }, async () => {
    const server = async () => {
      const s = await rpc.accept();
      s.initMain(HashFactory, {
        newSha1: async (_, r) => {
          const hash = createHash("sha1");
          const hs = new Hash.Server({
            async sum(_, r) {
              const digest = hash.digest();
              return r._initHash(digest.length).copyBuffer(digest);
            },

            write: (p) =>
              new Promise((resolve, reject) =>
                hash.write(p.data.toUint8Array(), "utf8", (err) =>
                  err ? reject(err) : resolve(),
                ),
              ),
          });
          r.hash = hs.client();
        },
      });
      return s;
    };

    const client = async () => {
      const hash = rpc.connect().bootstrap(HashFactory).newSha1().getHash();
      hash.write((p) => {
        const buf = new TextEncoder().encode("hello ");
        p._initData(buf.byteLength).copyBuffer(buf);
      });
      hash.write((p) => {
        const buf = new TextEncoder().encode("world");
        p._initData(buf.byteLength).copyBuffer(buf);
      });
      const sum = await hash.sum().promise();
      return sum.hash.toUint8Array();
    };

    const [, result] = await Promise.all([server(), client()]);
    t.equal(
      // @ts-expect-error
      bufferToHex(result),
      "[2a ae 6c 35 c9 4f cf b4 15 db e9 5f 40 8b 9c e9 1e e8 46 ed]",
    );
  });

  test("senderPromise resolves across forwarded pipeline", { timeout: 4000 }, async () => {
    const upstream = new TestRPC();
    let releaseUpstream: (() => void) | undefined;
    const upstreamGate = new Promise<void>((resolve) => {
      releaseUpstream = resolve;
    });

    const upstreamServer = async () => {
      const s = await upstream.accept();
      s.initMain(ReturnCapability, {
        get: async (_, r) => {
          await upstreamGate;
          r.capability = new SimpleInterface.Server({
            subtract: async (p, out) => {
              out.result = p.a - p.b;
            },
          }).client();
        },
      });
      return s;
    };

    const middleServer = async () => {
      const s = await rpc.accept();
      s.initMain(ReturnCapability, {
        get: async (_, r) => {
          const forwarded = upstream.connect().bootstrap(ReturnCapability);
          r.capability = forwarded.get().getCapability();
        },
      });
      return s;
    };

    const middlePromise = middleServer();
    const upstreamPromise = upstreamServer();

    let getPromise: Promise<any> | undefined;
    let middleConn: any;
    let upstreamConn: any;
    try {
      const clientConn = rpc.connect();
      middleConn = await middlePromise;
      getPromise = clientConn.bootstrap(ReturnCapability).get().promise();
      upstreamConn = await upstreamPromise;

      await waitUntil(
        () => Object.keys((middleConn as any).exportPromises).length > 0,
        1000,
      );

      releaseUpstream?.();
      const result = await getPromise;
      t.ok(result.capability);

      await waitUntil(
        () =>
          Object.values((middleConn as any).exportPromises).every(
            (entry: any) => entry.settled === true,
          ),
        1000,
      );
    } finally {
      if (getPromise) {
        await getPromise.catch(() => {});
      }
      if (middleConn) {
        middleConn.shutdown();
      }
      if (upstreamConn) {
        upstreamConn.shutdown();
      }
      upstream.close();
    }
  });
});
