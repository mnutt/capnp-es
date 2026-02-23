// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import { Answer } from "./answer";
import { Call, copyCall } from "./call";
import { Client } from "./client";
import { ErrorAnswer } from "./error-answer";
import { Fulfiller } from "./fulfiller/fulfiller";
import { joinAnswer } from "./join";
import { Struct } from "../serialization/pointers/struct";

export class PromiseExportClient implements Client {
  resolved?: Client;
  closed = false;
  queue: Array<{ call: Call<any, any>; f: Fulfiller<any> }> = [];

  call<P extends Struct, R extends Struct>(call: Call<P, R>): Answer<R> {
    if (this.closed) {
      return new ErrorAnswer(new Error("promise export closed"));
    }
    if (!this.resolved) {
      const f = new Fulfiller<R>();
      let copied: Call<P, R>;
      try {
        copied = copyCall(call);
      } catch (error_) {
        return new ErrorAnswer(error_ as Error);
      }
      this.queue.push({
        call: copied,
        f,
      });
      return f;
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
    for (const item of this.queue) {
      joinAnswer(item.f, client.call(item.call));
    }
    this.queue = [];
  }

  reject(err: Error): void {
    for (const item of this.queue) {
      item.f.reject(err);
    }
    this.queue = [];
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
