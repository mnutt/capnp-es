#include <capnp/ez-rpc.h>
#include <kj/debug.h>
#include <iostream>
#include "workloads.capnp.h"

class BenchImpl final: public Bench::Server {
public:
  kj::Promise<void> ping(PingContext context) override {
    KJ_REQUIRE(context.getParams().getSequence() != 0xffffffffu, "forced benchmark failure");
    context.getResults().setSequence(context.getParams().getSequence());
    return kj::READY_NOW;
  }

  kj::Promise<void> open(OpenContext context) override {
    KJ_REQUIRE(context.getParams().getParams().getBasePath().size() > 0);
    context.getResults().setSession(kj::heap<BenchImpl>());
    return kj::READY_NOW;
  }

  kj::Promise<void> write(WriteContext context) override {
    auto data = context.getParams().getData();
    KJ_REQUIRE(data.size() > 0 && data[0] == 0x5a && data[data.size() - 1] == 0x5a);
    context.getResults().setSize(data.size());
    return kj::READY_NOW;
  }

  kj::Promise<void> callback(CallbackContext context) override {
    auto request = context.getParams().getTarget().pingRequest();
    request.setSequence(context.getParams().getSequence());
    return request.send().then([context = kj::mv(context)](auto result) mutable {
      context.getResults().setSequence(result.getSequence());
    });
  }
};

int main(int argc, char** argv) {
  KJ_REQUIRE(argc == 2, "expected socket address");
  capnp::EzRpcServer server(kj::heap<BenchImpl>(), argv[1]);
  server.getPort().wait(server.getWaitScope());
  std::cout << "READY" << std::endl;
  kj::NEVER_DONE.wait(server.getWaitScope());
}
