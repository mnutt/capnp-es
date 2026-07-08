// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import { Client } from "./client";
import { Conn } from "./conn";
import { AnswerQCall, Answer } from "./answer";
import { Struct } from "../serialization";
import { Call } from "./call";
import { RPC_CALL_QUEUE_FULL, RPC_QUEUE_CALL_CANCEL } from "../errors";
import { MessageTarget, Disembargo_Context_Which } from "../capnp/rpc";
import { newDisembargoMessage } from "./capability";
import { CallQueue } from "./call-queue";

export { callQueueSize } from "./call-queue";

export class QueueClient implements Client {
  _client: Client;
  queue: CallQueue;

  constructor(
    public conn: Conn,
    client: Client,
    calls: AnswerQCall[],
  ) {
    this._client = client;
    this.queue = CallQueue.fromAnswerQCalls(calls);
  }

  pushCall<P extends Struct, R extends Struct>(call: Call<P, R>): Answer<R> {
    return this.queue.push(call);
  }

  pushEmbargo(id: number, tgt: MessageTarget): void {
    if (!this.queue.pushDisembargo(id, tgt)) {
      throw new Error(RPC_CALL_QUEUE_FULL);
    }
  }

  flushQueue(): void {
    this.queue.flushTo(this._client, (id, target) => {
      const msg = newDisembargoMessage(
        Disembargo_Context_Which.RECEIVER_LOOPBACK,
        id,
      );
      msg.disembargo.target = target;
      this.conn.sendMessage(msg);
    });
  }

  isPassthrough(): boolean {
    return this.queue.isEmpty;
  }

  normalize(): Client | undefined {
    return this.isPassthrough() ? this._client : undefined;
  }

  call<P extends Struct, R extends Struct>(call: Call<P, R>): Answer<R> {
    // Fast path: queue is flushed
    if (this.isPassthrough()) {
      return this._client.call(call);
    }

    // Add to queue
    return this.pushCall(call);
  }

  // close releases any resources associated with this client.
  // No further calls to the client should be made after calling Close.
  close(): void {
    this.queue.rejectAll(new Error(RPC_QUEUE_CALL_CANCEL));
    this._client.close();
  }
}
