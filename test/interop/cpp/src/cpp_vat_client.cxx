#include <capnp/ez-rpc.h>

#include <cstdlib>
#include <iostream>
#include <string>

#include "capnp/simple-interface.capnp.h"
#include "capnp/import-interface.capnp.h"
#include <capnp/persistent.capnp.h>
#include "capnp/rpc-level2.capnp.h"

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
  std::string stage = "startup";
  const bool expectException =
      mode == "exception" ||
      mode == "pipeline-exception" ||
      mode == "persistent-nonpersistent" ||
      mode == "restore-unknown" ||
      mode == "restore-sealed-denied" ||
      mode == "restore-revoked";

  try {
    if (
        mode == "restore-success" ||
        mode == "restore-unknown" ||
        mode == "restore-sealed-success" ||
        mode == "restore-sealed-denied" ||
        mode == "restore-revoked") {
      auto restorer = client.getMain<RpcLevel2Restorer>();
      auto req = restorer.restoreRequest();
      auto sturdyRef = req.initSturdyRef();

      const bool sealedMode =
          mode == "restore-sealed-success" ||
          mode == "restore-sealed-denied";
      sturdyRef.setHost(sealedMode ? "sealed-cpp" : "vat-cpp");
      const char* object =
          mode == "restore-success" ? "calc-1" :
          mode == "restore-unknown" ? "bad-id" :
          mode == "restore-revoked" ? "revk-1" :
          "seal-1";
      auto objectId = sturdyRef.initObjectId(6);
      for (uint i = 0; i < 6; i++) {
        objectId[i] = object[i];
      }
      const char* owner =
          mode == "restore-sealed-success" ? "owner-ok" :
          mode == "restore-sealed-denied" ? "owner-bad" :
          "owner-cpp";
      req.initOwner().setId(owner);

      auto resp = req.send().wait(waitScope);
      auto cap = resp.getCapability();
      auto sub = cap.subtractRequest();
      sub.setA(11);
      sub.setB(4);
      const auto out = sub.send().wait(waitScope).getResult();
      if (
          mode == "restore-unknown" ||
          mode == "restore-sealed-denied" ||
          mode == "restore-revoked") {
        std::cerr << "expected restore exception but got result=" << out << std::endl;
        return 7;
      }
      if (out != 7) {
        std::cerr << "unexpected restored result=" << out << std::endl;
        return 8;
      }
      std::cout << "OK restore=" << out << std::endl;
      return 0;
    }

    auto mainCap = client.getMain<ReturnCapability>();
    if (mode == "multiple-get-calls") {
      for (int i = 0; i < 10; i++) {
        stage = "multiple-get-calls:getRequest:" + std::to_string(i);
        auto req = mainCap.getRequest();
        req.setIndex(0);
        stage = "multiple-get-calls:send:" + std::to_string(i);
        auto cap = req.send().wait(waitScope).getCapability();
        stage = "multiple-get-calls:subtract:" + std::to_string(i);
        auto sub = cap.subtractRequest();
        sub.setA(11 + i);
        sub.setB(4);
        const auto out = sub.send().wait(waitScope).getResult();
        if (out != (7 + i)) {
          std::cerr << "unexpected multiple-get result i=" << i << " out=" << out << std::endl;
          return 9;
        }
      }
      std::cout << "OK multiple-get-calls=10" << std::endl;
      return 0;
    }

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

    if (mode == "persistent-nonpersistent") {
      auto persistent =
          cap.template castAs<capnp::Persistent<capnp::AnyPointer, capnp::AnyPointer>>();
      auto saveReq = persistent.saveRequest();
      saveReq.send().wait(waitScope);
      std::cerr << "expected Persistent.save() exception but call succeeded" << std::endl;
      return 6;
    }

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
    std::cerr << "unexpected exception at stage=" << stage
              << " error=" << e.getDescription().cStr() << std::endl;
    return 4;
  }
}
