// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import { Message } from "../../serialization/message";
import { Message as RPCMessage } from "../../capnp/rpc";
import { Deferred } from "../deferred";
import { Transport } from "../transport";

export abstract class DeferredTransport implements Transport {
  protected d?: Deferred<RPCMessage>;
  protected closed = false;
  protected closeError?: unknown;
  protected queue: RPCMessage[] = [];

  abstract sendMessage(msg: RPCMessage): void;

  close(err?: unknown): void {
    this.closed = true;
    this.closeError = err;
    this.queue = [];
    this.d?.reject(err);
    this.d = undefined;
  }

  recvMessage(): Promise<RPCMessage> {
    if (this.closed) {
      return Promise.reject(this.closeError);
    }
    if (this.queue.length > 0) {
      return Promise.resolve(this.queue.shift()!);
    }
    if (this.d) {
      this.d.reject();
    }
    this.d = new Deferred();
    return this.d.promise;
  }

  protected reject = (err: unknown): void => {
    if (this.d) {
      this.d.reject(err);
      this.d = undefined;
    }
  };

  protected resolve = (buf: ArrayBuffer | ArrayBufferView): void => {
    try {
      const msg = new Message(buf, false).getRoot(RPCMessage);
      if (this.d) {
        this.d.resolve(msg);
        this.d = undefined;
        return;
      }
      this.queue.push(msg);
    } catch (error_) {
      this.d?.reject(error_);
      this.d = undefined;
    }
  };
}
