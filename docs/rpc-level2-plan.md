# Cap'n Proto RPC Level 2 Plan

This document tracks the implementation plan to reach practical two-party
Level 2 conformance for `capnp-es` RPC.

## Status

- [x] Epic A: Level 2 scope + protocol contract
- [x] Epic B: Realm/SturdyRef abstractions
- [x] Epic C: `Persistent.save()` integration
- [x] Epic D: Restore-service flow over bootstrap
- [x] Epic E: Disconnect/reconnect lifecycle guarantees
- [x] Epic F: Sealing (`Owner`) and security policy
- [x] Epic G: Conformance tests + docs

## Epic A: Level 2 scope + protocol contract

- [x] PR A1: Define Level 2 conformance boundary for `capnp-es`.
  - Acceptance:
    - Level 2 is implemented via `persistent.capnp` (`Persistent.save()`),
      not `Message.obsoleteSave` / `Message.obsoleteDelete`.
    - Restore is modeled as an application restorer capability (typically
      obtained via `Bootstrap`) per `rpc.capnp` guidance.
    - Conformance statement explicitly targets two-party transport.
  - Tests:
    - [x] Runtime test: incoming `obsoleteSave` / `obsoleteDelete` receive
          deterministic `Unimplemented` handling.
    - [x] Integration smoke test: no regression in existing Level 1 behavior.
  - Progress:
    - `Conn.handleMessage()` now explicitly replies `Unimplemented` for
      unsupported but recognized message types:
      `obsoleteSave`, `obsoleteDelete`, `provide`, `accept`, and `join`.

- [x] PR A2: Add a Level 2 feature matrix and non-goals.
  - Acceptance:
    - Documented non-goals for this phase:
      - No Level 3 (`Provide`/`Accept`) work.
      - No Level 4 (`Join`) work.
      - No legacy Restore/Delete wire protocol resurrection.
    - Clarify that SturdyRef schema is app/realm-defined.
  - Progress:
    - README RPC matrix now explicitly marks unsupported legacy/level-3/4 wire
      message handling and Level 2 persistence as in progress.
    - This plan documents Level 2 non-goals and two-party conformance boundary.

## Epic B: Realm/SturdyRef abstractions

- [x] PR B1: Introduce runtime-facing persistence abstractions.
  - Acceptance:
    - Add interfaces/types for:
      - SturdyRef encode/decode (opaque payload in transport terms).
      - Optional realm transform hooks (same-realm no-op path first).
      - Restorer lookup contract.
    - Errors are typed and deterministic for malformed/unknown SturdyRefs.
  - Tests:
    - [x] Unit tests for codec round-trip and malformed input paths.
    - [x] Unit tests for unknown realm / unsupported transform behavior.
  - Progress:
    - Added `src/rpc/persistence.ts` with:
      - `SturdyRefCodec` + `JsonSturdyRefCodec`.
      - `RealmTransformRegistry` for optional realm transforms.
      - `RestorerLookup` + `MapRestorerLookup`.
      - Deterministic error types for malformed/unknown/unsupported paths.
    - Added runtime coverage in `test/runtime/rpc-persistence.spec.ts`.

- [x] PR B2: Add test fixture schema for Level 2 flow.
  - Acceptance:
    - Add dedicated test schema interfaces:
      - Restorer service (`restore(sturdyRef)` -> capability).
      - Persistent-capable service objects for `save()` coverage.
    - Reuse existing fixture SturdyRef structs where practical.
  - Tests:
    - [x] Schema compile + generated bindings covered in test build.
  - Progress:
    - Added fixture schema `test/fixtures/rpc-level2.capnp` with:
      - `RpcLevel2Restorer` (`restore(sturdyRef, owner)`).
      - `RpcLevel2PersistenceService` (`save` + `restore`).
      - `RpcLevel2SturdyRef` and `RpcLevel2Owner` structs.
    - Generated bindings in `test/fixtures/rpc-level2.ts`.
    - Added runtime coverage in
      `test/runtime/rpc-level2-fixture.spec.ts`.

## Epic C: `Persistent.save()` integration

- [x] PR C1: Server support for persistent-capable objects.
  - Acceptance:
    - Provide a server-side helper/pattern to expose `Persistent.save()`
      semantics for selected capabilities.
    - `save()` can return realm-defined SturdyRefs and reject unsupported
      capabilities cleanly.
  - Tests:
    - [x] Integration test: `save()` returns a SturdyRef that can later be
          restored.
    - [x] Integration test: non-persistent capability cast/save fails with
          deterministic exception.
  - Progress:
    - Added `src/rpc/persistent-interface.ts` helpers:
      - `createPersistentSaveServer()`.
      - `createUnsupportedPersistentServer()`.
    - Added integration coverage in `test/integration/rpc-level2.spec.ts` for
      successful `Persistent.save()` and deterministic non-persistent failure.
    - Added server dispatch hardening in `src/rpc/server.ts` to reject
      interface-ID mismatches (prevents cross-interface method-id collisions).

- [x] PR C2: Client ergonomics for `Persistent` casting/calling.
  - Acceptance:
    - Documented and tested cast flow from interface client to
      `Persistent$Client`.
    - No changes to Level 1 call/pipeline semantics.
  - Tests:
    - [x] Runtime test: `Persistent.save()` call wiring and exception
          propagation.
  - Progress:
    - Added `persistentClient()` helper in
      `src/rpc/persistent-interface.ts`.
    - Added runtime coverage in `test/runtime/rpc-persistence.spec.ts`.
    - Added integration cast-flow coverage in
      `test/integration/rpc-level2.spec.ts` where a capability typed as
      `SimpleInterface` is cast and called as `Persistent`.

## Epic D: Restore-service flow over bootstrap

- [x] PR D1: Implement reference restore flow through an app restorer service.
  - Acceptance:
    - Bootstrap can return a restorer capability.
    - `restore(sturdyRef)` returns live capabilities with normal Level 1
      semantics after restore.
    - Unknown/revoked SturdyRefs return deterministic exceptions.
  - Tests:
    - [x] Integration test: bootstrap -> restore -> call success path.
    - [x] Integration test: restore unknown SturdyRef failure path.
  - Progress:
    - Added integration coverage in `test/integration/rpc-level2.spec.ts`:
      - Bootstrap returns `RpcLevel2Restorer`.
      - `restore(sturdyRef, owner)` returns callable `SimpleInterface`.
      - Unknown sturdyRefs fail deterministically.

- [x] PR D2: Multi-hop proxy compatibility in two-party mode.
  - Acceptance:
    - Restored capabilities can still be proxied through existing Level 1
      forwarding paths.
    - SenderPromise/disembargo behavior remains correct post-restore.
  - Tests:
    - [x] Integration test: A -> B -> C forwarded restored capability.
  - Progress:
    - Added `A -> B -> C` forwarded restore coverage in
      `test/integration/rpc-level2.spec.ts`, validating that restored
      capabilities remain callable when proxied through a middle vat.

## Epic E: Disconnect/reconnect lifecycle guarantees

- [x] PR E1: Verify persistence contract under connection loss.
  - Acceptance:
    - Confirm and test that transient table state is lost on disconnect while
      SturdyRefs remain usable across new connections.
    - Reconnect+restore path is deterministic and leak-free.
  - Tests:
    - [x] Integration test: save -> disconnect -> reconnect -> restore.
    - [x] Bidirectional interop test: restore remains functional across
          reconnects (`capnp-es -> C++`, `C++ -> capnp-es`).
    - [x] Integration + bidirectional interop reconnect coverage demonstrate
          that post-disconnect behavior is driven by restored references rather
          than stale transient connection state.
  - Progress:
    - Added reconnect coverage in `test/integration/rpc-level2.spec.ts`
      (`save on one connection can be restored on a new connection`).
    - Added bidirectional reconnect restore interop in
      `test/interop/rpc-cpp-interop.spec.ts`:
      - `capnp-es client can restore across reconnects...`
      - `C++ client can restore across reconnects...`
    - Added shared interop Level 2 schema and fixture wiring in
      `test/interop/cpp/capnp/rpc-level2.capnp` and
      `test/interop/cpp/CMakeLists.txt`.

- [x] PR E2: Harden cleanup around persistence workflows.
  - Acceptance:
    - No refcount/table leaks when save/restore operations race shutdown.
    - Error paths preserve deterministic connection teardown behavior.
  - Tests:
    - [x] Runtime tests for save/restore during shutdown/cancel races.
  - Progress:
    - Added deterministic runtime race coverage in
      `test/runtime/rpc-level2-races.spec.ts`:
      - pending restore rejects when caller shuts down.
      - pending save rejects when caller shuts down.
    - Implemented using linked in-memory test transports (no background recv
      loop) to eliminate non-deterministic unhandled-rejection noise and isolate
      shutdown-race semantics.

## Epic F: Sealing (`Owner`) and security policy

- [x] PR F1: Define initial sealing policy.
  - Acceptance:
    - Document whether null `sealFor` is allowed in default test realm.
    - Owner validation/rejection behavior is deterministic.
    - Security model documented as defense-in-depth, not primary auth.
  - Tests:
    - [x] Integration test: sealed ref restore by allowed owner succeeds.
    - [x] Integration test: sealed ref restore by different owner fails.
    - [x] Bidirectional interop test: sealed restore allow/deny in both
          directions (`capnp-es -> C++`, `C++ -> capnp-es`).
  - Progress:
    - Added integration coverage in `test/integration/rpc-level2.spec.ts` for
      owner-allowed and owner-denied sealed restore paths.
    - Extended interop fixtures and tests in
      `test/interop/rpc-cpp-interop.spec.ts`,
      `test/interop/cpp/src/cpp_vat_server.cxx`, and
      `test/interop/cpp/src/cpp_vat_client.cxx` for sealed restore
      allow/deny behavior in both directions.

- [x] PR F2: Revocation/invalidity semantics.
  - Acceptance:
    - Define behavior for deleted/revoked backing resources:
      restored capability fails predictably.
    - Clarify that discarding a SturdyRef token does not imply object deletion.
  - Tests:
    - [x] Integration test: revoked resource yields restore-time failure.
    - [x] Bidirectional interop test: revoked restore fails in both
          directions (`capnp-es -> C++`, `C++ -> capnp-es`).
  - Progress:
    - Added integration coverage in `test/integration/rpc-level2.spec.ts`
      (`revoked sturdyRef fails restore-time`).
    - Added revoked restore interop coverage in
      `test/interop/rpc-cpp-interop.spec.ts` plus fixture support in
      `test/interop/cpp/src/cpp_vat_server.cxx` and
      `test/interop/cpp/src/cpp_vat_client.cxx`.

## Epic G: Conformance tests and docs

- [x] PR G1: Add Level 2 conformance-style test matrix.
  - Acceptance:
    - Add dedicated Level 2 integration spec covering:
      - Save/restore success.
      - Unknown/revoked refs.
      - Sealing policy.
      - Disconnect/reconnect restoration.
      - Forwarded restored capability path.
    - Test names map directly to Level 2 claims.
  - Progress:
    - Added dedicated Level 2 integration matrix in
      `test/integration/rpc-level2.spec.ts` with direct claim-mapped tests:
      - `Persistent.save returns a sturdyRef that can be restored locally`
      - `bootstrap restorer can restore sturdyRef and return callable capability`
      - `bootstrap restorer rejects unknown sturdyRef deterministically`
      - `revoked sturdyRef fails restore-time`
      - `sealed sturdyRef allows matching owner and rejects others`
      - `save on one connection can be restored on a new connection`
      - `forwarded restore (A->B->C) returns callable restored capability`
    - Added deterministic shutdown-race coverage in
      `test/runtime/rpc-level2-races.spec.ts`.
    - Added bidirectional interop conformance checks in
      `test/interop/rpc-cpp-interop.spec.ts` for restore success/failure,
      reconnect restore, sealing allow/deny, and revocation.

- [x] PR G2: Update README support matrix and authoring docs.
  - Acceptance:
    - README includes explicit Level 2 status and feature boundaries.
    - Link to this plan and to Level 1 plan for cross-reference.
    - Add short guidance on defining app-specific SturdyRef schemas and
      restorer bootstrap interfaces.
  - Progress:
    - Updated README RPC matrix to mark practical two-party Level 2
      persistence as implemented, with explicit boundaries.
    - Added README links to:
      - `docs/rpc-level1-plan.md`
      - `docs/rpc-level2-plan.md`
      - `test/integration/rpc-level2.spec.ts`
    - Updated interop docs (`test/interop/README.md`,
      `docs/rpc-cpp-interop.md`) to reflect current Level 1 + Level 2
      bidirectional coverage and current next-step focus areas.
