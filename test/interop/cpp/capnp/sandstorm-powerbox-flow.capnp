@0xdb9167bc4be31a1e;

interface AppPersistent {
  save @0 () -> (objectId :Data);
}

interface Node extends(AppPersistent) {
  stat @0 () -> (isDir :Bool);
}

interface AppHooks {
  getViewInfo @0 () -> (supportsNode :Bool);
  restore @1 (objectId :Data) -> (cap :Node);
  drop @2 (objectId :Data);
}

interface SessionContext {
  fulfillRequest @0 (cap :Node);
  claimRequest @1 () -> (cap :Node);
}

interface SandstormBridge {
  getSessionContext @0 () -> (context :SessionContext);
}
