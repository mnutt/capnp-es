#include <capnp/ez-rpc.h>
#include <kj/async-io.h>

#include <cstdlib>
#include <iostream>
#include <memory>
#include <string>

#include "capnp/simple-interface.capnp.h"
#include "capnp/import-interface.capnp.h"

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

static std::string getEnvOr(const char* key, const char* fallback) {
  const char* value = std::getenv(key);
  return value == nullptr ? std::string(fallback) : std::string(value);
}

int main() {
  const auto host = getEnvOr("CAPNP_INTEROP_HOST", "127.0.0.1");
  const auto portStr = getEnvOr("CAPNP_INTEROP_PORT", "0");
  const auto bindAddr = host + ":" + portStr;

  capnp::EzRpcServer server(kj::heap<ReturnCapabilityImpl>(), bindAddr);
  auto& waitScope = server.getWaitScope();
  auto actualPort = server.getPort().wait(waitScope);

  std::cout << "READY " << actualPort << std::endl;
  std::cout.flush();

  kj::NEVER_DONE.wait(waitScope);
  return 0;
}
