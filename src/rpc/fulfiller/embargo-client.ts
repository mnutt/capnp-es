// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import { Client } from "../client";
import { Struct } from "../../serialization/pointers/struct";
import { Answer } from "../answer";
import { Call } from "../call";
import { RPC_QUEUE_CALL_CANCEL } from "../../errors";
import { CallQueue } from "../call-queue";

export class EmbargoClient implements Client {
  _client: Client;

  queue: CallQueue;

  constructor(client: Client, queue: CallQueue) {
    this._client = client;
    this.queue = queue.copy();
    this.flushQueue();
  }

  flushQueue(): void {
    this.queue.flushTo(this._client);
  }

  // client returns the underlying client if the embargo has
  // been lifted and null otherwise
  client(): Client | null {
    return this.isPassthrough() ? this._client : null;
  }

  isPassthrough(): boolean {
    return this.queue.isEmpty;
  }

  normalize(): Client | undefined {
    return this.isPassthrough() ? this._client : undefined;
  }

  // call either queues a call to the underlying client or starts a
  // call if the embargo has been lifted
  call<P extends Struct, R extends Struct>(call: Call<P, R>): Answer<R> {
    // Fast path: queue is flushed
    if (this.isPassthrough()) {
      return this._client.call(call);
    }

    // Add to queue
    return this.push(call);
  }

  push<P extends Struct, R extends Struct>(_call: Call<P, R>): Answer<R> {
    return this.queue.push(_call);
  }

  close(): void {
    this.queue.rejectAll(new Error(RPC_QUEUE_CALL_CANCEL));
    this._client.close();
  }
}
