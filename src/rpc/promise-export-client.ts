// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import { Answer } from "./answer";
import { Call } from "./call";
import { Client } from "./client";
import { ErrorAnswer } from "./error-answer";
import { Fulfiller } from "./fulfiller/fulfiller";
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
      this.queue.push({
        call,
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
      const ans = client.call(item.call);
      ans.struct().then(
        (r) => item.f.fulfill(r),
        (e: unknown) => item.f.reject(e as Error),
      );
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
