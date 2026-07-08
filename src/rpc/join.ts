// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import { Struct } from "../serialization/pointers/struct";
import { Answer } from "./answer";

export interface FulfillerLike<R extends Struct> {
  fulfill(r: R): void;
  reject(err: Error): void;
  tryFulfill?(r: R): boolean;
  tryReject?(err: Error): boolean;
}

export function joinAnswer<R extends Struct>(
  fl: FulfillerLike<R>,
  answer: Answer<R>,
): void {
  Promise.resolve()
    .then(() => answer.struct())
    .then((obj) => {
      if (fl.tryFulfill) {
        if (fl.tryFulfill(obj) === false) {
          // Safe to ignore: another settlement path already owns the terminal answer state.
        }
        return;
      }
      try {
        fl.fulfill(obj);
      } catch {
        // Safe to ignore: another settlement path already owns the terminal answer state.
      }
    })
    .catch((error_) => {
      if (fl.tryReject) {
        if (fl.tryReject(error_) === false) {
          // Safe to ignore: another settlement path already owns the terminal answer state.
        }
        return;
      }
      try {
        fl.reject(error_);
      } catch {
        // Safe to ignore: another settlement path already owns the terminal answer state.
      }
    });
}
