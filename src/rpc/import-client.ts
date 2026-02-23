// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import { Conn } from "./conn";
import { Client } from "./client";
import { Struct } from "../serialization/pointers/struct";
import { Call } from "./call";
import { Answer } from "./answer";
import { ErrorAnswer } from "./error-answer";
import { newMessage } from "./capability";
import { RPC_CALL_QUEUE_FULL, RPC_IMPORT_CLOSED } from "../errors";
import { Fulfiller } from "./fulfiller/fulfiller";
import { copyCall } from "./call";
import { joinAnswer } from "./join";

// An ImportClient implements Client for a remote capability.
export class ImportClient implements Client {
  closed = false;
  resolved?: Client;
  embargoId?: number;
  embargoQueue: Array<{ call: Call<any, any>; f: Fulfiller<any> }> = [];
  embargoQueueCap = 64;

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
      if (this.embargoQueue.length >= this.embargoQueueCap) {
        return new ErrorAnswer(new Error(RPC_CALL_QUEUE_FULL));
      }
      const f = new Fulfiller<CallResults>();
      this.embargoQueue.push({
        call: copyCall(cl),
        f,
      });
      return f;
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
    for (const item of this.embargoQueue) {
      joinAnswer(item.f, resolved.call(item.call));
    }
    this.embargoQueue = [];
    return true;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const item of this.embargoQueue) {
      item.f.reject(new Error(RPC_IMPORT_CLOSED));
    }
    this.embargoQueue = [];
    this.embargoId = undefined;
    this.resolved?.close();
    this.conn.releaseImportAll(this.id);
  }
}
