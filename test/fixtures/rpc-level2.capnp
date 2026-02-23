@0xe9c293d743721d93;

using SimpleInterface = import "simple-interface.capnp".SimpleInterface;

struct RpcLevel2Owner {
  id @0 :Text;
}

struct RpcLevel2SturdyRef {
  host @0 :Text;
  objectId @1 :Data;
}

interface RpcLevel2Restorer {
  restore @0 (sturdyRef :RpcLevel2SturdyRef, owner :RpcLevel2Owner)
      -> (capability :SimpleInterface);
}

interface RpcLevel2PersistenceService {
  save @0 (capability :SimpleInterface, sealFor :RpcLevel2Owner)
      -> (sturdyRef :RpcLevel2SturdyRef);
  restore @1 (sturdyRef :RpcLevel2SturdyRef, owner :RpcLevel2Owner)
      -> (capability :SimpleInterface);
}
