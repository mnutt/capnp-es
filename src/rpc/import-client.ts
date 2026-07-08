// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import { Conn } from "./conn";
import { Client } from "./client";
import { Struct } from "../serialization/pointers/struct";
import { Call } from "./call";
import { Answer } from "./answer";
import { ErrorAnswer } from "./error-answer";
import { newMessage } from "./capability";
import { RPC_IMPORT_CLOSED } from "../errors";
import { CallQueue, callQueueSize } from "./call-queue";

// An ImportClient implements Client for a remote capability.
export class ImportClient implements Client {
  closed = false;
  resolved?: Client;
  embargoId?: number;
  embargoQueue = new CallQueue(callQueueSize);
  embargoQueueCap = callQueueSize;

  constructor(
    public conn: Conn,
    public id: number,
  ) {}

  call<CallParams extends Struct, CallResults extends Struct>(
    cl: Call<CallParams, CallResults>,
  ): Answer<CallResults> {
    if (this.closed) {
      return new ErrorAnswer(new Error(RPC_IMPORT_CLOSED));
    }
    if (this.embargoId !== undefined && this.resolved) {
      return this.embargoQueue.push(cl);
    }
    if (this.resolved) {
      return this.resolved.call(cl);
    }

    const q = this.conn.newQuestion(cl.method);
    try {
      const msg = newMessage();
      const msgCall = msg._initCall();
      msgCall.questionId = q.id;
      msgCall.interfaceId = cl.method.interfaceId;
      msgCall.methodId = cl.method.methodId;
      const target = msgCall._initTarget();
      target.importedCap = this.id;
      const payload = msgCall._initParams();
      q.paramCaps = this.conn.fillParams(payload, cl);
      this.conn.sendMessage(msg);
      q.start();
      return q;
    } catch (error_) {
      this.conn.popQuestion(q.id);
      return new ErrorAnswer(error_ as Error);
    }
  }

  setResolved(client: Client): void {
    if (this.closed) {
      client.close();
      return;
    }
    this.resolved?.close();
    this.resolved = client;
  }

  normalize(): Client | undefined {
    return this.resolved;
  }

  activateEmbargo(id: number): void {
    this.embargoId = id;
  }

  liftEmbargo(id: number): boolean {
    if (this.embargoId !== id) {
      return false;
    }
    this.embargoId = undefined;
    const resolved = this.resolved;
    if (!resolved) {
      return true;
    }
    this.embargoQueue.flushTo(resolved);
    return true;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.embargoQueue.rejectAll(new Error(RPC_IMPORT_CLOSED));
    this.embargoId = undefined;
    this.resolved?.close();
    this.conn.releaseImportAll(this.id);
  }
}
