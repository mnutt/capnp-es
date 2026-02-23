#include <capnp/ez-rpc.h>

#include <cstdlib>
#include <iostream>
#include <string>

#include "capnp/simple-interface.capnp.h"
#include "capnp/import-interface.capnp.h"

static std::string getArg(int argc, char* argv[], int idx, const char* fallback) {
  if (idx < argc) {
    return std::string(argv[idx]);
  }
  return std::string(fallback);
}

int main(int argc, char* argv[]) {
  const auto host = getArg(argc, argv, 1, "127.0.0.1");
  const auto port = getArg(argc, argv, 2, "0");
  const auto mode = getArg(argc, argv, 3, "success");
  const auto addr = host + ":" + port;

  capnp::EzRpcClient client(addr);
  auto& waitScope = client.getWaitScope();
  const bool expectException = mode == "exception" || mode == "pipeline-exception";

  try {
    auto mainCap = client.getMain<ReturnCapability>();
    if (mode == "parallel") {
      auto req = mainCap.getRequest();
      req.setIndex(0);
      auto cap = req.send().wait(waitScope).getCapability();

      auto subA = cap.subtractRequest();
      subA.setA(11);
      subA.setB(4);
      auto subB = cap.subtractRequest();
      subB.setA(31);
      subB.setB(9);

      const auto outA = subA.send().wait(waitScope).getResult();
      const auto outB = subB.send().wait(waitScope).getResult();
      if (outA != 7 || outB != 22) {
        std::cerr << "unexpected parallel results=" << outA << "," << outB << std::endl;
        return 5;
      }
      std::cout << "OK parallel=" << outA << "," << outB << std::endl;
      return 0;
    }

    auto req = mainCap.getRequest();
    req.setIndex(expectException ? 1 : 0);

    if (mode == "pipeline-success" || mode == "pipeline-exception") {
      auto getPromise = req.send();
      auto sub = getPromise.getCapability().subtractRequest();
      sub.setA(11);
      sub.setB(4);
      const auto out = sub.send().wait(waitScope).getResult();
      if (expectException) {
        std::cerr << "expected pipeline exception but got result=" << out << std::endl;
        return 2;
      }
      if (out != 7) {
        std::cerr << "unexpected pipeline result=" << out << std::endl;
        return 3;
      }
      std::cout << "OK pipeline=" << out << std::endl;
      return 0;
    }

    auto resp = req.send().wait(waitScope);
    auto cap = resp.getCapability();

    auto sub = cap.subtractRequest();
    sub.setA(11);
    sub.setB(4);
    const auto out = sub.send().wait(waitScope).getResult();

    if (expectException) {
      std::cerr << "expected exception but got result=" << out << std::endl;
      return 2;
    }

    if (out != 7) {
      std::cerr << "unexpected result=" << out << std::endl;
      return 3;
    }

    std::cout << "OK result=" << out << std::endl;
    return 0;
  } catch (const kj::Exception& e) {
    if (expectException) {
      std::cout << "OK exception=" << e.getDescription().cStr() << std::endl;
      return 0;
    }
    std::cerr << "unexpected exception=" << e.getDescription().cStr() << std::endl;
    return 4;
  }
}
