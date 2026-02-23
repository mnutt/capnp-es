# C++ Interop E2E (Level 1)

This folder contains an end-to-end RPC interop harness between:

- `capnp-es` (TypeScript)
- Cap'n Proto C++ (`EzRpcServer` / `EzRpcClient`)

## What is covered

Current spec: `test/interop/rpc-cpp-interop.spec.ts`

- `capnp-es` client bootstraps C++ server main interface.
- Returned capability calls are executed end-to-end over TCP.
- Method exception propagation from C++ server to `capnp-es` client.
- C++ client bootstraps `capnp-es` server main interface.
- Method exception propagation from `capnp-es` server to C++ client.
- `Persistent.save()` cast fails on non-persistent capabilities in both
  directions.
- Restorer bootstrap (`restore(sturdyRef)`) success/failure checks in both
  directions.
- Restorer reconnect checks and sealed-owner allow/deny checks in both
  directions.
- Revoked-resource restore failure checks in both directions.

## Run in one command (recommended)

From repo root:

```bash
pnpm test:interop:cpp
```

This command:

- configures/builds the C++ fixtures with CMake
- runs only `test/interop/rpc-cpp-interop.spec.ts`
- sets `CAPNP_CPP_INTEROP=1` plus server/client binary paths

Optional env vars:

- `CAPNP_CPP_SKIP_BUILD=1` skip the CMake steps and only run vitest
- `CAPNP_CPP_BUILD_CONFIG` CMake build config (default: `Release`)
- `CAPNP_CPP_SERVER_BIN` override server binary path
- `CAPNP_CPP_CLIENT_BIN` override client binary path
- `CAPNP_CPP_INTEROP_TEST_FILE` override test file path

## Manual build/run

If you need direct control, run manually:

Prerequisites:

- CMake 3.20+
- Cap'n Proto C++ libraries and headers (`capnp`, `capnp-rpc`, `kj`, `kj-async`)

Build:

```bash
cmake -S test/interop/cpp -B test/interop/cpp/build
cmake --build test/interop/cpp/build --config Release
```

Expected output binary:

- `test/interop/cpp/build/cpp_vat_server`
- `test/interop/cpp/build/cpp_vat_client`

Then run the interop tests:

```bash
CAPNP_CPP_INTEROP=1 \
CAPNP_CPP_SERVER_BIN=./test/interop/cpp/build/cpp_vat_server \
CAPNP_CPP_CLIENT_BIN=./test/interop/cpp/build/cpp_vat_client \
pnpm -s vitest run test/interop/rpc-cpp-interop.spec.ts
```

Optional env vars:

- `CAPNP_CPP_STARTUP_TIMEOUT_MS` (default: `5000`)
- `CAPNP_INTEROP_HOST` (default: `127.0.0.1`)
- `CAPNP_INTEROP_PORT` (default: `0`; random port)
- `CAPNP_CPP_CLIENT_BIN` (default: `./test/interop/cpp/build/cpp_vat_client`)

## Notes

- Tests are gated behind `CAPNP_CPP_INTEROP=1` and skip by default.
- The C++ fixture currently implements only the minimal surface needed for Level 1 e2e smoke checks.
- Interop C++ schema inputs are vendored in `test/interop/cpp/capnp/` for CMake `capnp_generate_cpp` path compatibility.
