// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

export type Finalize = (obj: object, finalizer: Finalizer) => void;
export type Finalizer = () => void;

export interface FinalizerLeakSnapshot {
  count: number;
}

let finalizerLeakCount = 0;

function shouldTrackFinalizerLeaks(): boolean {
  return (
    (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process?.env?.CAPNP_ES_TRACK_FINALIZER_LEAKS === "1"
  );
}

export function recordFinalizerLeak(): void {
  if (shouldTrackFinalizerLeaks()) {
    finalizerLeakCount++;
  }
}

export function runTrackedFinalizer(finalizer: Finalizer): void {
  recordFinalizerLeak();
  finalizer();
}

export function getFinalizerLeakSnapshot(): FinalizerLeakSnapshot {
  return { count: finalizerLeakCount };
}

export function resetFinalizerLeakSnapshot(): void {
  finalizerLeakCount = 0;
}
