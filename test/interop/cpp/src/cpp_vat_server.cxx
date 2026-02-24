#include <capnp/ez-rpc.h>
#include <kj/async-io.h>

#include <cstdlib>
#include <iostream>
#include <memory>
#include <string>

#include "capnp/simple-interface.capnp.h"
#include "capnp/import-interface.capnp.h"
#include "capnp/rpc-level2.capnp.h"

class SimpleImpl final: public SimpleInterface::Server {
public:
  kj::Promise<void> subtract(SubtractContext context) override {
    auto params = context.getParams();
    auto results = context.getResults();
    results.setResult(params.getA() - params.getB());
    return kj::READY_NOW;
  }
};

class ReturnCapabilityImpl final: public ReturnCapability::Server {
public:
  kj::Promise<void> get(GetContext context) override {
    auto params = context.getParams();
    auto index = params.getIndex();

    if (index == 1) {
      throw KJ_EXCEPTION(FAILED, "forced get() exception from C++ interop server");
    }

    context.getResults().setCapability(kj::heap<SimpleImpl>());
    return kj::READY_NOW;
  }
};

class RpcLevel2RestorerImpl final: public RpcLevel2Restorer::Server {
public:
  kj::Promise<void> restore(RestoreContext context) override {
    auto params = context.getParams();
    auto sturdyRef = params.getSturdyRef();
    auto owner = params.getOwner();
    auto objectId = sturdyRef.getObjectId();

    const auto host = sturdyRef.getHost();
    const bool openHostOk = host == "vat-cpp";
    const bool openRevokedObject =
        objectId.size() == 6 &&
        objectId[0] == 'r' &&
        objectId[1] == 'e' &&
        objectId[2] == 'v' &&
        objectId[3] == 'k' &&
        objectId[4] == '-' &&
        objectId[5] == '1';
    const bool openObjectOk =
        objectId.size() == 6 &&
        objectId[0] == 'c' &&
        objectId[1] == 'a' &&
        objectId[2] == 'l' &&
        objectId[3] == 'c' &&
        objectId[4] == '-' &&
        objectId[5] == '1';

    const bool sealedHostOk = host == "sealed-cpp";
    const bool sealedObjectOk =
        objectId.size() == 6 &&
        objectId[0] == 's' &&
        objectId[1] == 'e' &&
        objectId[2] == 'a' &&
        objectId[3] == 'l' &&
        objectId[4] == '-' &&
        objectId[5] == '1';
    const bool sealedOwnerOk = owner.getId() == "owner-ok";

    if ((openHostOk && openObjectOk) || (sealedHostOk && sealedObjectOk && sealedOwnerOk)) {
      context.getResults().setCapability(kj::heap<SimpleImpl>());
      return kj::READY_NOW;
    }

    if (openHostOk && openRevokedObject) {
      throw KJ_EXCEPTION(FAILED, "revoked sturdyRef");
    }

    if (sealedHostOk && sealedObjectOk && !sealedOwnerOk) {
      throw KJ_EXCEPTION(FAILED, "owner not allowed");
    }

    {
      throw KJ_EXCEPTION(FAILED, "unknown sturdyRef");
    }
  }
};

class RpcLevel2PersistenceImpl final: public RpcLevel2PersistenceService::Server {
public:
  kj::Promise<void> save(SaveContext context) override {
    auto params = context.getParams();
    auto owner = params.getSealFor();
    auto key = std::string("persisted:") + std::string(owner.getId().cStr());
    storedKey = key;
    storedCap = params.getCapability();

    auto results = context.getResults();
    auto sturdyRef = results.initSturdyRef();
    sturdyRef.setHost("vat-cpp");
    auto objectId = sturdyRef.initObjectId(key.size());
    for (uint i = 0; i < key.size(); i++) {
      objectId[i] = key[i];
    }

    return kj::READY_NOW;
  }

  kj::Promise<void> restore(RestoreContext context) override {
    auto params = context.getParams();
    auto sturdyRef = params.getSturdyRef();
    auto objectId = sturdyRef.getObjectId();
    std::string key;
    key.reserve(objectId.size());
    for (auto c : objectId) {
      key.push_back(static_cast<char>(c));
    }

    if (key != storedKey) {
      throw KJ_EXCEPTION(FAILED, "unknown sturdyRef");
    }

    KJ_IF_MAYBE(cap, storedCap) {
      context.getResults().setCapability(*cap);
      return kj::READY_NOW;
    } else {
      throw KJ_EXCEPTION(FAILED, "unknown sturdyRef");
    }
  }

private:
  std::string storedKey;
  kj::Maybe<SimpleInterface::Client> storedCap;
};

static std::string getEnvOr(const char* key, const char* fallback) {
  const char* value = std::getenv(key);
  return value == nullptr ? std::string(fallback) : std::string(value);
}

int main() {
  const auto host = getEnvOr("CAPNP_INTEROP_HOST", "127.0.0.1");
  const auto portStr = getEnvOr("CAPNP_INTEROP_PORT", "0");
  const auto mainType = getEnvOr("CAPNP_INTEROP_MAIN", "return");
  const auto bindAddr = host + ":" + portStr;
  if (mainType == "restorer") {
    capnp::EzRpcServer server(kj::heap<RpcLevel2RestorerImpl>(), bindAddr);
    auto& waitScope = server.getWaitScope();
    auto actualPort = server.getPort().wait(waitScope);
    std::cout << "READY " << actualPort << std::endl;
    std::cout.flush();
    kj::NEVER_DONE.wait(waitScope);
    return 0;
  } else if (mainType == "persistence") {
    capnp::EzRpcServer server(kj::heap<RpcLevel2PersistenceImpl>(), bindAddr);
    auto& waitScope = server.getWaitScope();
    auto actualPort = server.getPort().wait(waitScope);
    std::cout << "READY " << actualPort << std::endl;
    std::cout.flush();
    kj::NEVER_DONE.wait(waitScope);
    return 0;
  } else {
    capnp::EzRpcServer server(kj::heap<ReturnCapabilityImpl>(), bindAddr);
    auto& waitScope = server.getWaitScope();
    auto actualPort = server.getPort().wait(waitScope);
    std::cout << "READY " << actualPort << std::endl;
    std::cout.flush();
    kj::NEVER_DONE.wait(waitScope);
    return 0;
  }
}
