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

class RejectedNullAnswer {
  constructor(private err: Error) {}

  struct(): Promise<never> {
    return Promise.reject(this.err);
  }

  structSync(): never {
    throw this.err;
  }

  pipelineCall(): RejectedNullAnswer {
    return this;
  }

  pipelineClose(): void {
    throw this.err;
  }
}

class NullCapability implements CapabilitySlot {
  private err = new Error(RPC_NULL_CLIENT);

  call(): RejectedNullAnswer {
    return new RejectedNullAnswer(this.err);
  }

  close(): void {
    // Null capabilities do not own resources.
  }
}

let nullCapabilityFactory: () => CapabilitySlot = () => new NullCapability();

export function setNullCapabilityFactory(factory: () => CapabilitySlot): void {
  nullCapabilityFactory = factory;
}

export function capabilityOrNull<T extends CapabilitySlot>(slot: T | null): T {
  return (slot ?? nullCapabilityFactory()) as T;
}
