import { RPC_NULL_CLIENT } from "../errors";

// A CapabilityID is an index into a message's capability table.
export type CapabilityID = number;

// Serialization treats capabilities as opaque slots. The RPC layer provides the
// concrete Client implementation and narrows this interface at RPC boundaries.
export interface CapabilitySlot {
  call(call: any): any;
  close(): void;
  normalize?(): any;
}

class ThrowingNullCapability implements CapabilitySlot {
  call(): never {
    throw new Error(RPC_NULL_CLIENT);
  }

  close(): void {
    // Null capabilities do not own resources.
  }
}

let nullCapabilityFactory: () => CapabilitySlot = () =>
  new ThrowingNullCapability();

export function setNullCapabilityFactory(factory: () => CapabilitySlot): void {
  nullCapabilityFactory = factory;
}

export function capabilityOrNull<T extends CapabilitySlot>(slot: T | null): T {
  return (slot ?? nullCapabilityFactory()) as T;
}
