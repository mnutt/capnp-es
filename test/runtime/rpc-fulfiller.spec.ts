import { describe, test, assert as t } from "vitest";
import { Fulfiller } from "src/rpc/fulfiller/fulfiller";
import { ImmediateAnswer } from "src/rpc/immediate-answer";
import { joinAnswer } from "src/rpc/join";
import { RefCount } from "src/rpc/refcount";
import { Client } from "src/rpc/client";
import { Call } from "src/rpc/call";
import { Answer } from "src/rpc/answer";
import { RPC_ZERO_REF } from "src/errors";
import {
  getFinalizerLeakSnapshot,
  resetFinalizerLeakSnapshot,
  runTrackedFinalizer,
} from "src/rpc/finalize";
import { Message } from "src/serialization/message";
import { AnyStruct, Struct } from "src/serialization/pointers/struct";

function makeStruct(): AnyStruct {
  return new Message().initRoot(AnyStruct);
}

class NoopClient implements Client {
  call<P extends Struct, R extends Struct>(_call: Call<P, R>): Answer<R> {
    throw new Error("not used");
  }

  close(): void {
    // no-op
  }
}

function expectRejection(promise: Promise<unknown>): Promise<Error> {
  return promise.then(
    () => {
      throw new Error("expected rejection");
    },
    (error_) => error_ as Error,
  );
}

describe("Fulfiller settlement", () => {
  test("reject is terminal and rejects queued pipeline calls", async () => {
    const f = new Fulfiller<AnyStruct>();
    const queued = f.pipelineCall([], {
      method: {
        interfaceId: 1n,
        methodId: 0,
        ParamsClass: AnyStruct,
        ResultsClass: AnyStruct,
      },
      params: makeStruct(),
    } as any);
    const parentWait = expectRejection(f.struct());
    const queuedWait = expectRejection(queued.struct());

    const err = new Error("closed");
    t.equal(f.tryReject(err), true);
    t.equal(f.tryFulfill(makeStruct()), false);
    t.throws(() => f.fulfill(makeStruct()), /after settlement/);
    t.match((await parentWait).message, /closed/);
    t.match((await queuedWait).message, /closed/);
    t.equal(f.peek(), undefined);
  });

  test("joinAnswer ignores late delivery after another settlement wins", async () => {
    const f = new Fulfiller<AnyStruct>();
    const wait = expectRejection(f.struct());
    const err = new Error("already closed");
    t.equal(f.tryReject(err), true);

    joinAnswer(f, new ImmediateAnswer(makeStruct()));
    await Promise.resolve();
    await Promise.resolve();

    t.match((await wait).message, /already closed/);
    t.equal(f.peek(), undefined);
  });
});

describe("finalizer leak detector", () => {
  test("tracked finalizer callback increments only when opt-in env is set", () => {
    const old = process.env.CAPNP_ES_TRACK_FINALIZER_LEAKS;
    try {
      resetFinalizerLeakSnapshot();
      delete process.env.CAPNP_ES_TRACK_FINALIZER_LEAKS;
      let ran = 0;
      runTrackedFinalizer(() => {
        ran++;
      });
      t.equal(ran, 1);
      t.equal(getFinalizerLeakSnapshot().count, 0);

      process.env.CAPNP_ES_TRACK_FINALIZER_LEAKS = "1";
      runTrackedFinalizer(() => {
        ran++;
      });
      t.equal(ran, 2);
      t.equal(getFinalizerLeakSnapshot().count, 1);
    } finally {
      if (old === undefined) {
        delete process.env.CAPNP_ES_TRACK_FINALIZER_LEAKS;
      } else {
        process.env.CAPNP_ES_TRACK_FINALIZER_LEAKS = old;
      }
      resetFinalizerLeakSnapshot();
    }
  });
});

describe("RefCount lifecycle", () => {
  test("ref after zero refs fails loudly", () => {
    const [rc, ref] = RefCount.new(new NoopClient(), () => {});
    ref.close();

    try {
      rc.ref();
      throw new Error("expected ref after zero refs to throw");
    } catch (error_) {
      t.equal((error_ as Error).message, RPC_ZERO_REF);
    }
  });
});
