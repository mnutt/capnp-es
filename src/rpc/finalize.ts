// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

export type Finalize = (obj: object, finalizer: Finalizer) => void;
export type Finalizer = () => void;
