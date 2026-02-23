import { Persistent$Client, Persistent$Server } from "../capnp/persistent";
import { Pointer } from "../serialization";
import { Client } from "./client";

export function persistentClient(client: Client): Persistent$Client {
  return new Persistent$Client(client);
}

export type PersistentSaveHandler = (
  sealFor: Pointer,
) => Promise<Pointer> | Pointer;

export function createPersistentSaveServer(
  save: PersistentSaveHandler,
): Persistent$Server {
  return new Persistent$Server({
    async save(params, results): Promise<void> {
      results.sturdyRef = await save(params.sealFor);
    },
  });
}

export function createUnsupportedPersistentServer(
  reason = "capability is not persistent",
): Persistent$Server {
  return createPersistentSaveServer(() => {
    throw new Error(reason);
  });
}
