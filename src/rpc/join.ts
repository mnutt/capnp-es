// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import { Struct } from "../serialization/pointers/struct";
import { Answer } from "./answer";

export interface FulfillerLike<R extends Struct> {
  fulfill(r: R): void;
  reject(err: Error): void;
}

export function joinAnswer<R extends Struct>(
  fl: FulfillerLike<R>,
  answer: Answer<R>,
): void {
  Promise.resolve()
    .then(() => answer.struct())
    .then((obj) => {
      try {
        fl.fulfill(obj);
      } catch {
        // Races can double-settle fulfillers; ignore late delivery.
      }
    })
    .catch((error_) => {
      try {
        fl.reject(error_);
      } catch {
        // Races can double-settle fulfillers; ignore late delivery.
      }
    });
}
