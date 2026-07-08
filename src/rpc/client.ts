// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import { Struct } from "../serialization/pointers/struct";
import { Call } from "./call";
import { Answer } from "./answer";
import { PipelineOp } from "./pipeline-op";
import { ErrorClient } from "./error-client";
import { transformPtr } from "./transform-ptr";
import { getInterfaceClientOrNull } from "../serialization/pointers/struct.utils";

// A Client represents an Cap'n Proto interface type.
export interface Client {
  // call starts executing a method and returns an answer that will hold
  // the resulting struct.  The call's parameters must be placed before
  // call() returns.
  //
  // Calls are delivered to the capability in the order they are made.
  // This guarantee is based on the concept of a capability
  // acknowledging delivery of a call: this is specific to an
  // implementation of Client.  A type that implements Client must
  // guarantee that if foo() then bar() is called on a client, that
  // acknowledging foo() happens before acknowledging bar().
  call<P extends Struct, R extends Struct>(call: Call<P, R>): Answer<R>;

  // close releases any resources associated with this client.
  // No further calls to the client should be made after calling Close.
  close(): void;

  // normalize returns the client this instance transparently delegates to.
  // It is used only for capability identity checks; queued/unresolved wrappers
  // should return undefined until calls can pass through without reordering.
  normalize?(): Client | undefined;
}

export function isSameClient(c: Client, d: Client): boolean {
  const norm = (client: Client): Client => {
    let cur = client;
    for (let hops = 0; hops < 64; hops++) {
      const next = cur.normalize?.();
      if (!next || next === cur) {
        return cur;
      }
      cur = next;
    }
    return cur;
  };

  return norm(c) === norm(d);
}

/*
 * clientFromResolution retrieves a client from a resolved question or answer
 * by applying a transform.
 */
export function clientFromResolution(
  transform: PipelineOp[],
  obj?: Struct,
  err?: Error,
): Client {
  if (err) {
    return new ErrorClient(err);
  }

  if (!obj) {
    return new ErrorClient(new Error(`null obj!`));
  }

  const out = transformPtr(obj, transform);
  return getInterfaceClientOrNull(out);
  // return clientOrNull(Interface.fromPointer(out)!.getClient());
}
