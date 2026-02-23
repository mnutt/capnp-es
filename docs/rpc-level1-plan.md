# Cap'n Proto RPC Level 1 Plan

This document tracks the implementation plan to reach practical Level 1
conformance for `capnp-es` RPC.

## Status

- [x] Epic A: Core protocol completeness (Level 1 dispatch/handlers)
- [x] Epic B: Capability refcount correctness (`Release`)
- [x] Epic C: Promise capability resolution (`senderPromise` + `Resolve`)
- [x] Epic D: E-order and embargo (`Disembargo`)
- [x] Epic E: Tail-call mechanics (`yourself` / `takeFromOtherQuestion`)
- [x] Epic F: Lifecycle hardening and cancellation
- [x] Epic G: Conformance tests + docs

## Epic A: Core protocol completeness

- [x] PR A1: Add `resolve` / `release` / `disembargo` dispatch in
      `src/rpc/conn.ts`.
  - Acceptance:
    - Incoming Level 1 messages are routed to dedicated handlers.
    - `resolve`/`disembargo` are handled safely (currently via unimplemented
      echo while features are incomplete).
    - `release` is routed to release bookkeeping.
  - Tests:
    - [x] Add runtime test that verifies dispatch and handler effects.

- [x] PR A2: Define connection table state models and invariants.
  - Acceptance:
    - Explicit state transitions for question/answer/import/export entries.
    - Guard invalid ID reuse and illegal transitions.
  - Tests:
    - [x] Add runtime tests for table lifecycle and invalid transitions.
  - Progress:
    - Unknown `Finish` is now safely ignored (race-tolerant behavior).
    - Incoming call error branches now clean answer-table entries before
      returning `unimplemented` (no leaked answer slots).
    - `Return.results` decode failures now emit `unimplemented` and reject the
      waiting question deterministically.
    - `joinAnswer()` is now race-safe against late double-settlement, avoiding
      unhandled errors when asynchronous deliveries arrive after cancellation.
    - Added runtime coverage that duplicate incoming call question IDs trigger
      deterministic connection shutdown (invalid transition guard).
    - Incoming `Return` for unknown question IDs now triggers deterministic
      connection shutdown instead of throwing.
    - `Server.startCall()` now normalizes sync throws and async rejections
      through a single rejection path; runtime coverage added for synchronous
      server-method throw behavior.

## Epic B: Capability refcount correctness (`Release`)

- [x] PR B1: Outgoing release accounting for imports.
  - Acceptance:
    - Import close/ref-finalize paths produce `Release(id, count)` messages.
    - Batched release count behavior is deterministic.
  - Tests:
    - [x] Integration tests for outgoing release behavior.
  - Progress:
    - Import close now releases full tracked wire refcount for that import ID
      in a single `Release(id, count)` message.
    - Runtime tests cover both single-reference and multi-reference release
      counts.
    - Outgoing wire release count is now clamped to actually-held import refs
      to avoid over-release in edge/race paths.
    - Local import refcount handling on over-release is now saturating (no
      negative local refcount state), while preserving warning diagnostics.
    - Non-positive import release requests are now ignored with warning
      diagnostics (no state mutation / no wire `Release` emission).
    - Integration test now verifies that closing an imported capability causes
      remote export-table growth to return to baseline (release/cleanup path).

- [x] PR B2: Incoming release handling for exports.
  - Acceptance:
    - Incoming `Release` decrements wire refcounts and reclaims exports.
  - Tests:
    - [x] Integration tests for export cleanup and ID reuse.
  - Progress:
    - Export release handling is now saturating on over-release requests and
      ignores non-positive release counts with warning diagnostics.
    - Runtime coverage validates both overrun clamping and non-positive
      release-request ignore behavior.

- [x] PR B3: Correct `releaseParamCaps` / `releaseResultCaps` bookkeeping.
  - Acceptance:
    - Correct cap IDs are released (no wrong-index release).
    - `Question.paramCaps` and `AnswerEntry.resultCaps` are populated.
  - Tests:
    - [x] Capability-in-params/results coverage with leak checks.
  - Progress:
    - Runtime coverage now includes real serialized interface-pointer params and
      results, validating `releaseParamCaps` and `releaseResultCaps` cleanup
      against cap-table-derived export IDs.

## Epic C: Promise capability resolution (`Resolve`)

- [x] PR C1: Track `senderPromise` as promise-import entries.
  - Acceptance:
    - Promise imports are distinct from settled imports.
    - Queued calls may await resolution.
  - Tests:
    - [x] Integration tests for unresolved promise imports.
  - Progress:
    - Integration coverage now verifies unresolved promise imports are present
      (`isPromise=true`) before settlement and transition to settled imports
      (`isPromise=false`) after resolve in the forwarded senderPromise flow.

- [x] PR C2: Implement incoming `Resolve`.
  - Acceptance:
    - Resolve-to-cap retargets queued/future calls.
    - Resolve-to-exception rejects queued/future calls.
    - Forwarding rule for resolved promises is preserved.
  - Tests:
    - [x] Resolve-to-cap and resolve-to-exception tests.
  - Progress:
    - Runtime coverage verifies `Resolve.exception` rejects repeated future
      calls deterministically for the resolved import.
    - Runtime coverage now also verifies full `Resolve.cap` import flow:
      sender-loopback disembargo start, embargoed calls held, and forwarding
      only after receiver-loopback.
    - Runtime coverage now includes unknown-promise resolve races across
      descriptor variants (`senderHosted`, `senderPromise`,
      `receiverHosted`) to verify introduced references are cleaned up.
    - Duplicate/late resolve for already-settled imports is now ignored, with
      introduced-cap cleanup to avoid leaks.
    - Runtime coverage now verifies duplicate `Resolve.cap` after
      `Resolve.exception` is ignored, introduced cap is released, and exception
      behavior remains stable for future calls.
    - Malformed/unknown `Resolve.cap` descriptors are now fail-safe:
      emit `Unimplemented` and settle/cleanup deterministically without
      throwing.

- [x] PR C3: Implement outgoing `Resolve` for exported promises.
  - Acceptance:
    - Exactly one resolve per exported promise lifecycle.
  - Tests:
    - [x] Integration test for resolve emission.
  - Progress:
    - `Conn.descriptorForClient()` now exports cross-connection in-flight
      pipelined question clients as `senderPromise` capabilities.
    - Added sender-promise lifecycle in `Conn` that emits one outgoing
      `Resolve(cap|exception)` when the source question settles.
    - Release-before-settle path now suppresses late resolve emission.
    - Runtime coverage added for resolve-cap, resolve-exception, and
      release-before-resolve behavior.
    - Added dedicated `PromiseExportClient` runtime tests for unresolved call
      queuing, resolve-forwarding, and queued-call rejection on close/reject.
    - Added integration test (`A -> B -> C`) for forwarded unresolved pipeline
      capability export, verifying middle-conn `senderPromise` export creation
      and settlement after upstream resolution.
    - Promise-export table entries are now reused for identical
      `(question, transform)` exports, preserving wire-refcount semantics and
      reducing duplicate promise-export allocations.
    - Added runtime coverage that reused senderPromise exports emit exactly one
      outgoing `Resolve` on both success and exception settlement.
    - Runtime coverage now also verifies outgoing `Resolve.exception` preserves
      the upstream rejection reason on reused senderPromise exports.
    - `PromiseExportClient` unresolved call queue is now bounded with
      `RPC_CALL_QUEUE_FULL` backpressure behavior, with runtime coverage.
    - Runtime protocol-level coverage now verifies senderPromise queue overflow
      produces immediate `Return.exception` during incoming call handling.

## Epic D: E-order and embargo (`Disembargo`)

- [x] PR D1: Implement disembargo state machine and handlers.
  - Acceptance:
    - Sender/receiver loopback contexts are handled in two-party mode.
  - Tests:
    - [x] Integration tests for embargo queue release behavior.
  - Progress:
    - Loopback disembargo message handling is implemented in `Conn`:
      `senderLoopback -> receiverLoopback` echo and receiver no-op hook.
    - Level-3 disembargo contexts currently return `unimplemented`.
    - Integration coverage now verifies sender-loopback disembargo is echoed as
      receiver-loopback over real `MessagePort` transport with preserved target.
    - Integration coverage now also verifies unsupported level-3 disembargo
      contexts receive `Unimplemented` responses over transport.

- [x] PR D2: Integrate embargo with promise-resolution flow.
  - Acceptance:
    - No call reordering across resolution boundaries.
  - Tests:
    - [x] Deterministic ordering/race tests.
  - Progress:
    - Import-side embargo queue is now wired to disembargo loopback IDs.
    - `Resolve(cap)` on promise imports starts sender-loopback disembargo and
      holds direct calls until receiver-loopback arrives.
    - Runtime test now exercises this path through `Conn.handleResolveMessage()`
      and verifies forwarding occurs only after receiver-loopback.

## Epic E: Tail-call mechanics (`yourself` / `takeFromOtherQuestion`)

- [x] PR E1: Support `Call.sendResultsTo.yourself`.
  - Acceptance:
    - Redirected result flow can hold/send `resultsSentElsewhere`.
  - Tests:
    - [x] Integration test for basic `yourself` path.
  - Progress:
    - Incoming calls with `sendResultsTo.yourself` now return
      `Return.resultsSentElsewhere` instead of embedding results.
    - Incoming calls with unsupported `sendResultsTo` variants remain
      unimplemented.
    - Integration coverage now includes raw-RPC `sendResultsTo.yourself`
      behavior over real `TestRPC` transport flow.

- [x] PR E2: Support `Return.takeFromOtherQuestion`.
  - Acceptance:
    - Question can resolve from another question's result.
  - Tests:
    - [x] End-to-end tail-call scenario tests.
  - Progress:
    - Incoming `Return.takeFromOtherQuestion` now links a waiting question to
      an in-flight incoming call result (answer-table entry).
    - When the source answer resolves (success/error), linked waiters resolve
      with the same outcome.
    - `Return.resultsSentElsewhere` is now handled explicitly (rejects pending
      question instead of hanging).
    - Integration coverage now includes a deterministic transport-level
      `takeFromOtherQuestion` redirect that follows an in-flight source answer.

## Epic F: Lifecycle hardening and cancellation

- [x] PR F1: Implement `Question.start()` and `pipelineClose()`.
  - Acceptance:
    - Cancellation and close semantics are functional (no stub throw).
  - Tests:
    - [x] Cancellation and pipeline-close tests.
  - Progress:
    - `Question.pipelineClose()` now sends `Finish`, releases question table
      entry, and rejects with cancellation.
    - `Question.pipelineClose()` is now idempotent; repeated calls do not emit
      duplicate `Finish` messages.
    - `Question.cancel()` now always releases the question table entry (with
      `Finish` only when started) and is covered for pre-start cancel and
      repeated-cancel idempotence.
    - Runtime test added for pipeline-close behavior.
    - Integration coverage now verifies pipeline-close emits `Finish` for an
      unresolved parent question over real transport.

- [x] PR F2: Implement robust `Conn.shutdown()` cleanup.
  - Acceptance:
    - Deterministic cleanup/rejection of all in-flight state.
  - Tests:
    - [x] Shutdown behavior tests.
  - Progress:
    - `Conn.shutdown()` now performs deterministic table cleanup, rejects
      in-flight questions/answers/waiters, clears embargo state, and closes
      transport.
    - Shutdown now also rejects embargo-queued import calls so pending callers
      do not hang during connection teardown.
    - Embargo-queue rejection in shutdown is now best-effort and race-tolerant
      against already-settled fulfillers.
    - Runtime coverage now includes tail-answer waiter rejection on shutdown
      and idempotent double-shutdown behavior.
    - Runtime coverage now explicitly verifies shutdown clears disembargo,
      import, and export table state.
    - Shutdown now releases tracked disembargo IDs from the allocator so
      disembargo IDs are reusable after teardown.
    - Runtime shutdown behavior test added.

- [x] PR F3: Complete remaining close stubs (`ImportClient`, `QueueClient`,
      `LocalAnswerClient`, `Server`).
  - Acceptance:
    - No noop/stub close paths remain in RPC runtime.
  - Tests:
    - [x] Close-path tests.
  - Progress:
    - `QueueClient.close()` now cancels queued calls and closes underlying
      client.
    - `ImportClient.close()` now rejects embargo-queued calls and clears
      embargo state before releasing the import.
    - Embargo-queue rejection in `ImportClient.close()` is best-effort and
      race-tolerant against already-settled fulfillers.
    - `LocalAnswerClient.close()` now closes resolved target when available.
    - `Server.close()` and `ErrorClient.close()` no longer throw.
    - Runtime close-path test coverage added for queue cancellation plus
      `ErrorClient`, `Server`, and `LocalAnswerClient` close behaviors.
    - Runtime coverage now also verifies `ImportClient.close()` idempotence
      (single release emission across repeated close calls).

## Epic G: Conformance tests and docs

- [x] PR G1: Expand Level 1 conformance-style test matrix.
  - Acceptance:
    - All Level 1-supported behaviors are covered by integration tests.
  - Progress:
    - Added additional Level 1 conformance-style runtime cases for cap-bearing
      payload release semantics (`Return.releaseParamCaps` and
      `Finish.releaseResultCaps`) using real interface-pointer serialization.
    - Integration coverage matrix (current):
      - Basic bootstrap/call flow: `test/integration/rpc.spec.ts` (`SimpleInterface`).
      - Capability return + pipelining: `test/integration/rpc.spec.ts` (`HashFactory`).
      - Outgoing senderPromise resolve over forwarding path:
        `test/integration/rpc.spec.ts` (`senderPromise resolves across forwarded pipeline`) with transport-observed `RESOLVE.cap`.
      - Incoming `Resolve.exception` on unresolved promise-import:
        `test/integration/rpc.spec.ts` (`incoming resolve.exception settles senderPromise import over integration transport`).
      - Outgoing `Resolve.exception` from exported senderPromise:
        `test/integration/rpc.spec.ts` (`senderPromise emits outgoing resolve.exception over integration transport`) via transport-observed `RESOLVE.exception` message and client-side error-settlement checks.
      - Import close emits remote release cleanup:
        `test/integration/rpc.spec.ts` (`closing imported capability releases remote export`).
      - `sendResultsTo.yourself`/`resultsSentElsewhere` behavior:
        `test/integration/rpc.spec.ts` (`sendResultsTo.yourself returns resultsSentElsewhere in integration flow`).
      - `takeFromOtherQuestion` redirect behavior:
        `test/integration/rpc.spec.ts` (`takeFromOtherQuestion follows source answer over integration transport`).
      - Disembargo loopback echo and unsupported-context handling:
        `test/integration/rpc.spec.ts` (`disembargo senderLoopback...`, `disembargo level-3 contexts...`).
      - Pipeline-close cancellation sends `Finish`:
        `test/integration/rpc.spec.ts` (`pipeline close sends finish for unresolved parent question`).
      - Invalid transition guard (`Return` for unknown question):
        `test/integration/rpc.spec.ts` (`return for unknown question id closes receiver connection`).
      - `Return.canceled` handling:
        `test/integration/rpc.spec.ts` (`return.canceled rejects pending question over integration transport`).
      - Duplicate incoming call question-ID guard:
        `test/integration/rpc.spec.ts` (`duplicate incoming call question id closes receiver connection`).

- [x] PR G2: Update README support claims with a feature matrix.
  - Acceptance:
    - Explicitly documents implemented, partial, and unsupported features.
