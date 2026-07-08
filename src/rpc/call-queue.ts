// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import type { MessageTarget } from "../capnp/rpc";
import type { Struct } from "../serialization/pointers/struct";
import type { AnswerEntry, AnswerQCall } from "./answer";
import { Answer } from "./answer";
import { Call, copyCall } from "./call";
import { Client } from "./client";
import { ErrorAnswer } from "./error-answer";
import { Fulfiller } from "./fulfiller/fulfiller";
import { joinAnswer } from "./join";
import { Queue, QueueStorage } from "./queue";
import { RPC_CALL_QUEUE_FULL } from "../errors";

export const callQueueSize = 64;

export type CallQueueSlot =
  | {
      kind: "local";
      call: Call<any, any>;
      f: Fulfiller<any>;
    }
  | {
      kind: "remote";
      call: Call<any, any>;
      a: AnswerEntry<any>;
    }
  | {
      kind: "disembargo";
      embargoID: number;
      embargoTarget: MessageTarget;
    };

class CallQueueStorage implements QueueStorage {
  constructor(public data: Array<CallQueueSlot | null>) {}

  len(): number {
    return this.data.length;
  }

  clear(i: number): void {
    this.data[i] = null;
  }
}

export class CallQueue {
  private storage: CallQueueStorage;
  private q: Queue;

  constructor(
    private cap = callQueueSize,
    initial: CallQueueSlot[] = [],
  ) {
    this.cap = Math.max(cap, initial.length);
    this.storage = new CallQueueStorage(
      Array.from({ length: this.cap }, () => null),
    );
    for (const [i, slot] of initial.entries()) {
      this.storage.data[i] = slot;
    }
    this.q = new Queue(this.storage, initial.length);
  }

  static fromAnswerQCalls(calls: AnswerQCall[]): CallQueue {
    const slots = calls.map((call) => {
      if ("a" in call) {
        return {
          kind: "remote" as const,
          call: call.call,
          a: call.a,
        };
      }
      if ("f" in call) {
        return {
          kind: "local" as const,
          call: call.call,
          f: call.f,
        };
      }
      return {
        kind: "disembargo" as const,
        embargoID: call.embargoID,
        embargoTarget: call.embargoTarget,
      };
    });
    return new CallQueue(callQueueSize, slots);
  }

  get length(): number {
    return this.q.len();
  }

  get isEmpty(): boolean {
    return this.length === 0;
  }

  push<P extends Struct, R extends Struct>(call: Call<P, R>): Answer<R> {
    let copied: Call<P, R>;
    try {
      copied = copyCall(call);
    } catch (error_) {
      return new ErrorAnswer(error_ as Error);
    }
    const f = new Fulfiller<R>();
    if (!this.pushPreparedLocal(copied, f)) {
      return new ErrorAnswer(new Error(RPC_CALL_QUEUE_FULL));
    }
    return f;
  }

  pushPreparedLocal(call: Call<any, any>, f: Fulfiller<any>): boolean {
    return this.pushSlot({ kind: "local", call, f });
  }

  pushDisembargo(id: number, target: MessageTarget): boolean {
    return this.pushSlot({
      kind: "disembargo",
      embargoID: id,
      embargoTarget: target,
    });
  }

  flushTo(
    target: Client,
    handleDisembargo?: (id: number, target: MessageTarget) => void,
  ): void {
    while (this.length > 0) {
      const slot = this.front();
      if (!slot) {
        break;
      }
      switch (slot.kind) {
        case "local": {
          joinAnswer(slot.f, target.call(slot.call));
          break;
        }
        case "remote": {
          joinAnswer(slot.a, target.call(slot.call));
          break;
        }
        case "disembargo": {
          handleDisembargo?.(slot.embargoID, slot.embargoTarget);
          break;
        }
      }
      this.q.pop();
    }
  }

  rejectAll(err: Error): void {
    while (this.length > 0) {
      const slot = this.front();
      if (!slot) {
        break;
      }
      if (slot.kind === "local") {
        slot.f.tryReject(err);
      } else if (slot.kind === "remote") {
        slot.a.reject(err);
      }
      this.q.pop();
    }
  }

  clear(): void {
    while (this.length > 0) {
      this.q.pop();
    }
  }

  copy(): CallQueue {
    return new CallQueue(this.cap, this.snapshot());
  }

  private pushSlot(slot: CallQueueSlot): boolean {
    const i = this.q.push();
    if (i === -1) {
      return false;
    }
    this.storage.data[i] = slot;
    return true;
  }

  private front(): CallQueueSlot | null {
    const i = this.q.front();
    return i === -1 ? null : this.storage.data[i];
  }

  private snapshot(): CallQueueSlot[] {
    const slots: CallQueueSlot[] = [];
    for (let n = 0; n < this.length; n++) {
      const i = (this.q.start + n) % this.q.cap;
      const slot = this.storage.data[i];
      if (slot) {
        slots.push(slot);
      }
    }
    return slots;
  }
}
