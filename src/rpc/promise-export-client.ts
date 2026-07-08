// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import { Answer } from "./answer";
import { Call } from "./call";
import { CallQueue, callQueueSize } from "./call-queue";
import { Client } from "./client";
import { ErrorAnswer } from "./error-answer";
import { Struct } from "../serialization/pointers/struct";

const promiseExportQueueCap = callQueueSize;

export class PromiseExportClient implements Client {
  resolved?: Client;
  closed = false;
  queue = new CallQueue(promiseExportQueueCap);

  call<P extends Struct, R extends Struct>(call: Call<P, R>): Answer<R> {
    if (this.closed) {
      return new ErrorAnswer(new Error("promise export closed"));
    }
    if (!this.resolved) {
      return this.queue.push(call);
    }
    return this.resolved.call(call);
  }

  resolve(client: Client): void {
    if (this.closed) {
      client.close();
      return;
    }
    this.resolved?.close();
    this.resolved = client;
    this.queue.flushTo(client);
  }

  normalize(): Client | undefined {
    return this.resolved;
  }

  reject(err: Error): void {
    this.queue.rejectAll(err);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.resolved?.close();
    this.reject(new Error("promise export closed"));
  }
}
