# Serialization benchmarks

Run `pnpm build` first, then `pnpm bench:node` (or `pnpm bench:bun`) to compare capnp-es, capnp-ts,
JSON, and protobufjs on the AddressBook fixture.

Node benchmark commands compile their TypeScript harness to ESM before running.
They import the built package in `dist`, avoiding Jiti's module-access overhead in
the measured path. Rebuild the library after changing its source. Compiled
`*.bench.mjs` files are ignored by Git.

## Comparing with node-capnp

Run `pnpm bench:node-capnp` to include [node-capnp](https://github.com/capnproto/node-capnp)
(the `capnp` npm package) in all three workloads: parsing, reading the people
list's length, and traversing nested properties. All implementations run the
same correctness checks before timing begins.

Install the optional native addon locally, then run the comparison:

```sh
pnpm bench:setup
pnpm bench:node-capnp
```

Setup installs node-capnp into `test/bench/node_modules`, without changing the
project's dependencies. It pins upstream's `node14` branch at commit
`18c54885f44c781eacc2f62dbe32cffc41fe29f5` and changes its compiler setting to C++20
for Node 24. The npm release uses older V8 APIs and does not build on modern Node.
Building requires a C++20 compiler, Python, and Cap'n Proto
C++ development libraries. The addon must match the Node version running the
benchmark, and its linked C++ libraries must be available at runtime. After
switching Node versions, rebuild it with `npm rebuild --prefix test/bench capnp`.

With Volta, check `pnpm exec node --version`: a separately installed pnpm may use
a different Node version from your shell. To explicitly use Node 24 for both:

```sh
volta run --node 24.22.2 pnpm bench:setup
volta run --node 24.22.2 pnpm bench:node-capnp
```

To use an existing built checkout instead, override the local package:

```sh
NODE_CAPNP_PATH=/absolute/path/to/node-capnp pnpm bench:node-capnp
```

The path must identify the package directory or its JavaScript wrapper, not the
raw `capnp.node` addon. For a Sandstorm build, use:

```sh
NODE_CAPNP_PATH=/path/to/sandstorm/node_modules/capnp.js pnpm bench:node-capnp
```

Without `NODE_CAPNP_PATH`, the benchmark resolves `capnp` normally. A missing or
incompatible addon fails the comparison with an error rather than silently
omitting node-capnp. The regular Node and Bun benchmarks do not load the addon.

Schema loading and Buffer setup happen outside the timed operations. All Cap'n
Proto implementations read the same unpacked, unframed segment; node-capnp uses
`{ packed: false, flat: true }`. Its public `parse()` eagerly converts the message
to JavaScript objects, whereas capnp-es and capnp-ts return readers with lazy
field access. Keep that difference in mind when interpreting parse and length
results. These AddressBook cases only measure reading a small message.

## Sandstorm-shaped serialization

```sh
pnpm bench:sandstorm
pnpm bench:sandstorm --check
```

This compares capnp-es and node-capnp for encoding and decoding/materializing:

- Framed, unpacked session startup parameters: text fields and a list of languages.
- Framed, packed Powerbox descriptors with 1 and 16 tags: full-width UInt64 IDs,
  AnyPointer values, text, and permission bit lists.

Both timed decoders receive the same bytes. Encoders start from equivalent JS
values and include message construction and nested AnyPointer serialization.
Cross-checks decode both implementations' output with both readers and compare
all values before timing. `--check` runs just these checks.

The wire shapes come from Sandstorm's `src/sandstorm/web-session.capnp` and
`src/sandstorm/powerbox.capnp`. Values and tag counts are synthetic, not sampled
from production. Relevant consumers in the inspected Sandstorm checkout:

- `shell/imports/server/gateway-router.js`: serializes `WebSession.Params`, calls
  `newSession()`, casts returned capabilities and pipelines `addRequirements()`.
- `shell/imports/sandstorm-ui-powerbox/powerbox-server.js`: parses packed
  descriptors and iterates tags. Driver modules parse the AnyPointer tag values.
- `shell/imports/server/core.js`: keeps a persistent connection to the C++
  backend over an inherited socket and exports callback capabilities.

## RPC library comparison

```sh
pnpm bench:rpc
pnpm bench:rpc --check
```

Requires CMake and Cap'n Proto C++ development libraries as well as `bench:setup`.
The command builds a Release-mode C++ Cap'n Proto peer, starts it on a temporary
Unix socket, and compares capnp-es and node-capnp clients against that same peer.
The peer implements only synthetic library-level operations; it does not start
Sandstorm, Meteor, a database, or an HTTP server.

Cases cover:

- One request/response on an established capability.
- A batch of 16 concurrent calls (reported time is per batch, not per call).
- Acquiring a capability, awaiting its return, calling it, and releasing it.
- The same operation with the call pipelined before the capability arrives.
- A chain of four dependent capability acquisitions followed by a pipelined call.
- Passing a JS capability to C++ and receiving a callback before the reply.
- Remote exception propagation, with and without reading the JS error stack.
- Sending 1 KiB and 64 KiB Data payloads with an acknowledgement.

Connections, bootstrap, schema loading, callback construction, and payload
allocation happen before timing. Per-call parameter encoding, framing, socket
I/O, C++ handling, result decoding, promises, and acquired-capability release are
inside timing. Each case validates results for both libraries first. Exported
callbacks are reused; the payload receiver validates length and boundary bytes,
without adding application-level processing of the whole payload.

These are library microbenchmarks, not a Sandstorm throughput prediction. This
checkout forwards ordinary HTTP requests in C++ (`gateway.c++` and
`web-session-bridge.c++`), so JS AddressBook traversal is not a proxy for that
traffic. The RPC suite models the shell's C++ boundary more closely, but doesn't
cover application work, real message-size distributions, long-lived stream
backpressure, reconnect/cancellation storms, or multi-vat routing. Loopback
pipelining results also don't predict savings at higher network latency.

Run timing suites separately on an otherwise idle machine. Mitata's memory
figures do not provide a complete accounting of C++ native allocations.

To regenerate the checked-in TypeScript fixture after editing its schema:

```sh
pnpm capnp-es test/bench/data/sandstorm/workloads.capnp -ots
```

## CPU profiling on Node

```sh
pnpm build
pnpm profile:rpc
```

This profiles capnp-es alone on the reused-capability RPC workload after 5,000
warmup iterations. It records 100,000 calls using Node's inspector profiler and
writes `test/bench/rpc.cpuprofile`. Schema loading, correctness checks, native
client checks, warmup, and Mitata's measurement machinery are outside the
capture. The C++ peer is a separate process and is not included in this profile.
Load the `.cpuprofile` file into a CPU profile viewer to inspect call stacks.

`pnpm profile:addressbook` profiles synchronous full AddressBook traversal and
writes `test/bench/addressbook.cpuprofile`. It uses the same iteration/path
environment variables below, without adding a Promise or `await` per traversal.

For allocation sampling after building the library:

```sh
pnpm profile:allocations scalar /tmp/scalar.heapprofile
pnpm profile:allocations composite /tmp/composite.heapprofile
pnpm profile:allocations uint32-list /tmp/list.heapprofile
pnpm profile:allocations control /tmp/control.heapprofile
BENCH_ITERATIONS=10000000 pnpm profile:allocations scalar /tmp/scalar-long.heapprofile
```

Run each case in a separate process. The probe performs one million UInt32 reads
by default, after constructing the message/readers and warming up 100,000 reads.
`composite` reads a field from an already-created struct-list element;
`uint32-list` calls the existing primitive list's `get()`; `control` reads the
segment directly. Results and traversal-budget consumption are checked.

The [Inspector sampling profiler](https://chromedevtools.github.io/devtools-protocol/tot/HeapProfiler/#method-startSampling)
uses a 4 KiB sampling interval and includes objects collected by both minor and
major GC. This captures transient allocations that a retained-heap snapshot
would miss. Printed byte counts are estimates and include harness/profiler
overhead; they are not exact allocation counts or timing measurements. Compare
the control and longer runs as well as the allocation stacks. This probe does
not measure construction, fresh struct/list readers, string/BigInt results, or
native buffer backing-store allocations.

Select a different case by its exact printed name or a unique substring:

```sh
CAPNP_BENCH_CASE='four dependent' \
CAPNP_PROFILE_ITERATIONS=50000 \
CAPNP_PROFILE_PATH=/tmp/pipeline.cpuprofile \
pnpm profile:rpc
```

To sample transient JavaScript allocations for an RPC workload instead of CPU
time, set `CAPNP_PROFILE_HEAP_PATH`. For example:

```sh
CAPNP_BENCH_CASE='RPC: remote exception propagation' \
CAPNP_PROFILE_ITERATIONS=50000 \
CAPNP_PROFILE_HEAP_PATH=/tmp/exceptions.heapprofile \
pnpm profile:rpc
```

This uses the same 4 KiB sampling interval and includes collected objects, as in
the primitive-read allocation probe above. The sample includes the JS client and
workload harness; it excludes the C++ peer and native buffer backing stores. The
stack-access workload forces `error.stack` to be read and checked on every call;
the original propagation workload checks `String(error)` only.

Profile files are ignored by Git. Rebuild after source changes: these benchmarks
import the built library from `dist`. Profile timings include instrumentation
overhead; use a separate, unprofiled `pnpm bench:rpc` run to measure improvements.
In particular, idle samples in a request/response profile are socket/event-loop
waiting time, not library CPU work. Do not interpret all elapsed time as a CPU
optimization opportunity.

## Repeatable measurements and scaling experiments

```sh
pnpm bench:rpc:build
pnpm bench:measure my-rpc-run rpc '.*'
pnpm bench:measure my-serialization-run sandstorm
pnpm bench:measure my-addressbook-run bench 'capnp-es|node-capnp'
pnpm bench:measure my-scaling-run scaling
```

The measurement runner rebuilds the library and compiles the harness, then writes
JSONL samples and a build/run log to `$TMPDIR/capnp-perf-branch` (normally
`/tmp/capnp-perf-branch`). Use a fresh label for each run; repeated labels append.
It does not install node-capnp or build the C++ peer. `rpc` defaults to the reused
capability, batch of 16, four dependent acquisitions, and 64 KiB write; the
optional regex selects other cases. `BENCH_FILTER` overrides that regex.

Each operation warms up for at least one iteration batch and a time minimum,
then records five batches and their median time per operation. The runner uses
1,000 ms for RPC and 200 ms for the other suites; `BENCH_WARMUP_MS` overrides this.
`BENCH_ITERATIONS` and `BENCH_SAMPLES` override the batch defaults. RPC uses 2,000 iterations, serialization
1,000, AddressBook 5,000, and scaling 100. Synchronous operations are timed without
an `await` per iteration. These are local microbenchmarks: inspect the individual
samples and repeat close results, especially socket timings.

On Linux, `CAPNP_BENCH_AFFINITY=2,3` optionally pins the Node main thread to CPU 2
and the C++ peer main thread to CPU 3 using `taskset`. Choose CPUs available on
your machine; this is a diagnostic control, not a production configuration.
Keep placement and warmup settings identical when comparing variants. Earlier
experiment runs without a `warmupMs` field used the original 200 ms minimum.

`pnpm bench:scaling` also runs the scaling suite directly. It covers zero, dense,
and mixed packing; growing text-list builders; short and long ASCII/Unicode
encoding; and 64 KiB frames delivered whole or in 1,024-/64-byte chunks. It also
contains two explicitly labeled architectural experiments: a cached scalar
location in a private message, and a borrowed segment view. These estimate
specific costs; they are not implementations of a public immutable reader or
zero-copy Message API. Borrowed storage and cached layout require explicit
ownership and mutation rules before they can replace current behavior.

## Optimization experiments, 2026-10-28

This section records the first pass. Later passes below supersede its final
timings, including the AddressBook traversal and all-zero packing results.

Branch: `perf/capnp-es-rpc`. Baseline library source:
`1637aea6f19947a258d53344d32f789c26a44691`. Both versions used the same compiled
harness on Node 24.22.2 / V8 13.6.233.17-node.63, with pointer compression disabled
in this Node build. Suites ran separately. The optional addon was unchanged.
[Raw samples and allocation-count metadata](results/2026-10-28.jsonl) include
exploratory runs, rejected variants, and the final comparisons.

The comparable final runs are `13-baseline-*` and `14-final-*`. Early exploratory
runs used one warmup batch; final runs use the 200 ms minimum described above.
Short scaling cases were repeated with 10,000 iterations (`15-*-small`) because
100-iteration samples were sensitive to JIT/GC transitions. Do not interpret
small differences between separate runs as established improvements.

| Experiment                                                | Decision and evidence                                                                                                                                                                        |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decode near pointers once; read composite stride directly | Retained. Preserves signed offsets, far-pointer fallback, and Pointer traversal-budget charges.                                                                                              |
| Omit indexed Proxy for internal Text wrappers             | Retained. Public lists and public Text retain indexing, callback identity, and snapshot iteration.                                                                                           |
| WeakMap lookup to unwrap public list Proxies              | Reverted. Four-acquisition RPC median rose from 123 to 135 µs in the isolated comparison.                                                                                                    |
| Uniform `_capnp` metadata shape                           | Reverted. Mixed results within run variation.                                                                                                                                                |
| Geometric single-segment growth                           | Retained. The isolated 16,384-string builder fell from 26.0 to 14.7 ms before the short-text change.                                                                                         |
| Typed packing output                                      | Retained with a zero-filled-input tradeoff. Dense/mixed large buffers improve substantially; see below. A growing typed buffer was also tested and reverted because it slowed dense packing. |
| Queue incoming chunks until a complete frame arrives      | Retained. Avoids repeatedly copying the accumulated prefix; tests cover fragmented headers, multiple segments, and coalesced frames.                                                         |
| Indexed iteration in internal RPC capability-table loops  | Reverted. No consistent gain across RPC cases. Public lazy iteration would also change existing snapshot semantics.                                                                          |
| Remove generated async promise wrapper                    | Reverted. No consistent RPC improvement.                                                                                                                                                     |
| Microtask write batching with cork/uncork                 | Reverted. Batch-of-16 RPC rose from about 196 to 225 µs; four acquisitions rose from 118 to 136 µs.                                                                                          |
| Direct UTF-8 encoding into the segment                    | Retained only for strings up to 256 UTF-16 units. Short ASCII/Unicode cases improved; sizing long strings in JS regressed, so larger strings retain the native encoder path.                 |
| Cache field layout in an owned reader                     | Prototype only. One hundred reads of one scalar fell from 3.49 to 1.19 µs, including message construction. Generalizing this needs explicit immutable-reader semantics.                      |
| Borrow a segment view instead of copying it               | Prototype only. Isolated 64 KiB copy/view cost was 3.53/0.05 µs. This does not measure a complete RPC or decoder; current public ownership semantics are unchanged.                          |

Times below are microseconds per operation; batch timing is per batch of 16.
The node-capnp column is from the final comparison run.

| Workload                                   | capnp-es before | capnp-es after | node-capnp |
| ------------------------------------------ | --------------: | -------------: | ---------: |
| AddressBook parse                          |            0.93 |           1.00 |       7.59 |
| AddressBook list length                    |            2.32 |           1.61 |       7.44 |
| AddressBook full traversal                 |           18.59 |           9.27 |       7.65 |
| Session params encode                      |            9.20 |           3.32 |       5.61 |
| Session params decode                      |            8.74 |           4.32 |       1.99 |
| One-tag descriptor encode                  |            8.84 |           7.05 |      13.46 |
| One-tag descriptor decode                  |            9.74 |           6.72 |       5.13 |
| 16-tag descriptor encode                   |          104.18 |          62.71 |     128.82 |
| 16-tag descriptor decode                   |           95.11 |          57.62 |      62.89 |
| Reused-capability RPC                      |           28.51 |          26.93 |      22.54 |
| 16 concurrent RPCs                         |          211.83 |         197.93 |     168.67 |
| Acquire, await, call, release              |           69.09 |          61.63 |      70.24 |
| Acquire, pipeline call, release            |           51.16 |          44.23 |      53.83 |
| C++ callback into JS                       |           66.11 |          61.01 |      49.31 |
| Four acquisitions, pipelined call, release |          145.24 |         116.67 |     138.67 |
| Remote exception                           |           43.57 |          43.38 |      32.99 |
| 1 KiB write + acknowledgement              |           28.33 |          27.54 |      23.15 |
| 64 KiB write + acknowledgement             |           43.43 |          45.98 |      37.34 |

The large-payload RPC did not improve. A repeat measured 48.67 µs for capnp-es
and 39.71 µs for node-capnp, with substantial variation within the run. The
retained changes do **not** make capnp-es faster than node-capnp across all cases.

| Scaling workload                    | Before (µs) | After (µs) |
| ----------------------------------- | ----------: | ---------: |
| Pack dense 64 KiB                   |     1132.40 |      80.74 |
| Pack mixed 64 KiB                   |     1152.94 |      91.97 |
| Pack all-zero 64 KiB                |       39.01 |      43.95 |
| Build 16,384-string list            |    40812.03 |    8180.95 |
| Receive 64 KiB in 1,024-byte chunks |      229.05 |      19.46 |
| Receive 64 KiB in 64-byte chunks    |     3337.42 |      84.77 |

All-zero packing is a real tradeoff: the typed output buffer reserves up to
1.25 times the input size even when compression is excellent. The longer repeat
also measured all-zero 1 KiB packing at 0.95 → 1.59 µs, while dense/mixed 1 KiB
packing improved from 3.05 → 2.29 and 4.13 → 2.44 µs. Short text repeats confirmed
improvements for both ASCII and Unicode at 32 and 256 UTF-16 units.

For the large builder, instrumenting arena allocation counted 435 → 4 growths
and 153,212,672 → 919,552 bytes copied. Used message bytes were identical
(575,392), while final buffer capacity increased from 575,744 to 1,050,624 bytes.
These count backing-buffer growth and copying, not V8 heap allocations.

A final inspector profile of 50,000 four-acquisition operations still shows
socket writes, pointer/layout access, Proxy reads, wrapper construction, and
framing/copying. Approximate sampled self-time: `writeBuffer` 15%, `getContent`
4.1%, the list Proxy getter 3.9%, `Struct` construction 3.9%, and GC 2.0%.
Allocation costs extend beyond the samples attributed directly to GC. The
profile is a diagnostic capture, not an uninstrumented timing comparison.

Validation: 18 AddressBook checks, 12 serialization cross-checks, and 18 RPC
checks against the common C++ peer pass. Type checking, formatting, and lint of
changed code pass. The full Vitest run has 224 passing, 26 skipped, and seven
pre-existing RPC failures (pipeline close, level-1 capability bookkeeping, and
remote error wording). Whole-repository ESLint also has two pre-existing catch
parameter naming errors in `src/rpc/server.ts`.

The new overwrite tests exposed a pre-existing byte/word-count error in list
erasure that could overwrite adjacent data or throw out of bounds. Correcting
that count is included; it also fixes the two old orphan/cross-message-copy test
failures. New coverage checks signed near offsets and traversal accounting,
public list behavior, text/default/Unicode overwrites, growth with live handles,
packing tags and runs, and fragmented/coalesced multi-segment transport frames.

## Second optimization pass, 2026-10-28

The baseline for this pass is the first pass above. Fresh comparisons use
`33-start-*` and `36-final-*`, with the same Node/V8 build, addon, compiled harness,
and sequential execution. [Raw samples and experiment decisions](results/2026-10-28-round2.jsonl)
include all trials in this pass. Packing and short scaling measurements were
repeated with 10,000 iterations (`33-start-repeat` / `36-final-repeat`).

Full AddressBook traversal is now **2.27× faster than the start of this pass**
and **1.89× faster than node-capnp**. Parse-only results still compare a lazy
reader against native eager conversion; the traversal result includes reading
all fixture fields. Times below are µs per operation; concurrency is per batch.

| Workload                                   | capnp-es before this pass | capnp-es after | node-capnp |
| ------------------------------------------ | ------------------------: | -------------: | ---------: |
| AddressBook parse                          |                      1.05 |           0.66 |       7.50 |
| AddressBook list length                    |                      1.57 |           0.98 |       7.29 |
| AddressBook full traversal                 |                      9.08 |           3.99 |       7.55 |
| Session params encode                      |                      3.35 |           2.65 |       5.64 |
| Session params decode                      |                      4.28 |           1.99 |       1.98 |
| One-tag descriptor encode                  |                      7.08 |           6.45 |      13.79 |
| One-tag descriptor decode                  |                      6.68 |           3.91 |       5.12 |
| 16-tag descriptor encode                   |                     61.54 |          46.08 |     128.61 |
| 16-tag descriptor decode                   |                     56.69 |          30.86 |      62.69 |
| Reused-capability RPC                      |                     28.87 |          22.90 |      22.07 |
| 16 concurrent RPCs                         |                    195.36 |         136.38 |     175.48 |
| Acquire, await, call, release              |                     59.64 |          48.94 |      71.34 |
| Acquire, pipeline call, release            |                     45.50 |          37.95 |      49.43 |
| C++ callback into JS                       |                     66.83 |          52.98 |      51.75 |
| Four acquisitions, pipelined call, release |                    111.57 |          92.29 |     137.30 |
| Remote exception                           |                     40.69 |          36.30 |      30.60 |
| 1 KiB write + acknowledgement              |                     27.73 |          23.93 |      23.09 |
| 64 KiB write + acknowledgement             |                     42.61 |          41.50 |      36.13 |

Session decoding is effectively tied with node-capnp. Native remains faster on
remote exceptions and the 64 KiB RPC write. Reused calls, callbacks, and 1 KiB
writes are close and vary between runs. The concurrent and capability-acquisition
cases improve, but these local socket timings are not production throughput
estimates.

| Scaling workload          | Before (µs) | After (µs) |
| ------------------------- | ----------: | ---------: |
| Read one scalar 100 times |        3.39 |       2.15 |
| Pack zero 1 KiB           |        1.53 |       1.55 |
| Pack dense 1 KiB          |        2.21 |       1.97 |
| Pack mixed 1 KiB          |        2.36 |       1.91 |
| Pack zero 64 KiB          |       45.85 |       6.93 |
| Pack dense 64 KiB         |       83.51 |      49.75 |
| Pack mixed 64 KiB         |       91.13 |      50.24 |
| Build 16,384-string list  |     8319.97 |    5741.54 |

Short text encoding is broadly unchanged in the longer repeats; the 100-iteration
runs have misleading JIT/GC spikes in several short cases. The transport and
borrowed/cached prototypes were unchanged in this pass.

Retained changes:

- Combine bounds checks and near-pointer layout resolution for scalar and pointer
  fields, including composite-list elements. Keep far-pointer fallbacks and the
  previous depth, bounds, and traversal-budget charges. Read layout on each
  access so mutation and segment growth remain supported.
- Reuse a fresh pointer temporary and decode internal text directly from its byte
  view, avoiding intermediate wrappers and repeated pointer decoding.
- Let internal list wire access reach the underlying object through a private
  Symbol. Public methods, overridden methods, callbacks, bracket access, and
  snapshot iterators keep their existing receiver/behavior. This avoids repeated
  Proxy property traps without a WeakMap lookup for every field access.
- Allocate list snapshots and segment tables once without `Array.from` filling
  entries that are immediately overwritten. Validate segment-table size before
  allocating its array; uninitialized Text still produces an empty snapshot.
- Scan zero runs using two 32-bit reads per word and copy literal runs in bulk.
  Reserve small outputs in one allocation; grow larger ones from 256 bytes.
  For 64 KiB of zeros, temporary output capacity falls from 81,920 to 256 bytes,
  before trimming to the final output. This fixes the first pass's large-zero
  packing tradeoff. The final small-zero repeat is effectively unchanged.

A standalone numeric size decoder and immediate socket cork/uncork were tested
and reverted because their timings did not consistently improve. Growing every
packing output from 256 bytes regressed small dense inputs; reserving the maximum
for inputs up to 2 KiB recovered that cost. A differential check of 1,040 packing
inputs/slices matched the previous implementation byte for byte, covering sparse,
dense, mixed, empty, unaligned slices, and run-length boundaries.

A second 500,000-traversal inspector capture moves `toArray` from 11.2% to 2.5%
of sampled self-time and `getContent` from 9.4% to 1.7%. Remaining contributors
include the public list Proxy getter (11.6%), input copying (9.6%), native UTF-8
decoding (7.5%), and Struct construction (5.5%). These are fractions of a shorter
profile, not allocation counts or uninstrumented timing measurements. The raw
results metadata includes the top samples for both captures.

Validation: all 18 AddressBook, 12 serialization, and 18 common-C++-peer RPC
checks pass. The full Vitest run has **229 passing, 26 skipped, and the same seven
pre-existing RPC failures**. After the final packing allocation adjustment,
all 17 packing/performance regression tests pass again. Type checking and lint
of changed code pass. New regression coverage compares near/composite/far field
access against the previous validation paths, including exhausted budgets,
invalid offsets, and depth limits; it also checks public receiver overrides and
invalid segment tables. Whole-repository lint retains the existing unrelated
errors noted above.

## Third optimization pass, 2026-10-28

This pass starts from the second pass above. [Raw samples, allocation estimates,
and diagnostic summaries](results/2026-10-28-round3.jsonl) retain the tested
variants and their decisions. Serialization compares `40-start` with `64-final`.
The final RPC comparison uses `65-start-pinned` / `66-final-pinned`, with the same
1,000 ms warmup and client/peer main-thread CPUs 2/3 on both versions. These RPC
numbers should not be compared directly with the earlier unpinned 200 ms runs.

The main allocation result is for **successful near-pointer primitive reads on
already-created readers**. Their temporary Pointer and `_capnp` objects are gone.
Numeric locations still receive the previous bounds and traversal-budget checks;
errors construct the original diagnostic Pointer, and far pointers use the
existing resolver. This also applies to scalar writes and primitive list elements.
No mutable location cache or shared scratch reader was introduced.

The sampling probe estimates roughly 88 allocated bytes/read before. Afterward,
ten million reads produce only tens of kilobytes of sampled traffic, comparable
to the direct-segment control and not proportional to the number of reads:

| Prepared read                       | Before: estimated bytes/read, 1M reads | After: estimated bytes/read, 10M reads |
| ----------------------------------- | -------------------------------------: | -------------------------------------: |
| UInt32 field                        |                                 88.158 |                                0.00369 |
| UInt32 field in a composite element |                                 88.344 |                                0.00345 |
| UInt32List.get                      |                                 87.956 |                                0.00361 |
| Direct segment control              |                                  0.030 |                                0.00200 |

The small nonzero estimates include profiler/harness allocations. Sampling is
not proof of literally zero engine allocations for every value or optimization
state. These cases read UInt32 value 42; they exclude message construction,
creating each struct/list reader, snapshot iteration, string/BigInt results, and
far-pointer fallback. General traversal is still allocating; this pass does not
add a cursor API.

Other retained changes remove per-segment packed-output trim copies, unpack
bounded input views directly while retaining independent output, decode remote
error reasons once, and handle ASCII strings up to eight bytes without allocating
a decoder byte view. Shared packed input is snapshotted before sizing/decoding.
Unicode, BOM handling, malformed UTF-8, and longer text retain TextDecoder.

Times below are µs per operation. Packing itself remains broadly unchanged;
the packed-message gains come from avoiding copies around it.

| Workload                   | Before this pass | After | node-capnp |
| -------------------------- | ---------------: | ----: | ---------: |
| AddressBook parse          |             0.82 |  0.68 |       7.52 |
| AddressBook list length    |             0.95 |  1.00 |       7.24 |
| AddressBook full traversal |             3.98 |  3.62 |       7.48 |
| Session params encode      |             2.58 |  2.68 |       5.82 |
| Session params decode      |             1.98 |  1.85 |       1.96 |
| One-tag descriptor encode  |             6.50 |  5.13 |      13.65 |
| One-tag descriptor decode  |             3.92 |  3.37 |       6.36 |
| 16-tag descriptor encode   |            45.29 | 42.38 |     127.49 |
| 16-tag descriptor decode   |            30.55 | 27.49 |      64.07 |

The 100-scalar-read workload, including message construction, falls from 2.07 to 1.64 µs.
The short-ASCII trial alone lowered AddressBook traversal from 4.04 to 3.65 µs
and session decoding from 1.99 to 1.81 µs. A composite-list snapshot specialization
only changed traversal from 3.65 to 3.59 µs and did not improve descriptor decode;
it was reverted rather than retaining extra method-dispatch logic for that result.

| RPC workload                               | Before this pass |  After | node-capnp |
| ------------------------------------------ | ---------------: | -----: | ---------: |
| Reused capability                          |            20.02 |  19.89 |      22.70 |
| 16 concurrent calls (per batch)            |           138.47 | 139.79 |     161.35 |
| Acquire, await, call, release              |            50.80 |  47.74 |      58.72 |
| Acquire, pipeline call, release            |            37.11 |  38.78 |      46.25 |
| C++ callback into JS                       |            52.43 |  47.14 |      45.75 |
| Four acquisitions, pipelined call, release |            94.06 |  91.32 |     133.05 |
| Remote exception                           |            32.93 |  33.07 |      29.15 |
| 1 KiB write + acknowledgement              |            22.62 |  21.71 |      20.93 |
| 64 KiB write + acknowledgement             |            36.00 |  36.05 |      36.73 |

RPC gains are mixed; close changes are not established wins. The final large
write is effectively unchanged. No claim is made that all RPC cases improve.

### Bulk-copy regression investigation

The allocation-reducing `Data.copyBuffer()` change is **retained**. Initial short
RPC samples suggested a regression (46.55 µs optimized versus 43.70–43.92 µs
original), so it was temporarily rolled back. Subsequent tests did not reproduce
a meaningful regression attributable to that change:

- Isolated reuse of a 64 KiB Data destination: 1.139 → 1.109 µs. Creating a fresh
  message and destination was noisier and did not show a reliable improvement.
- Both 50,000-call CPU/JIT traces optimize `copyBuffer` to TurboFan without a
  `copyBuffer` deoptimization. Its sampled self-time was lower in the optimized
  trace. GC events before the end of profiling, including setup/warmup, fell
  from 284 to 264; reported pauses were 33.2 versus 31.5 ms. These diagnostic
  profiles are not uninstrumented timing comparisons.
- With 1,000 ms warmup, seven 10,000-call samples, and reversed variant order,
  optimized medians were 34.13 and 46.30 µs; original medians were 33.95 and
  47.14 µs. Both versions exhibit the same fast/slow modes.
- With client/peer main threads fixed to CPUs 2/3, the corresponding isolated
  medians were 49.61 and 49.29 µs, effectively tied. Moving both to CPU 2 did
  not recover the fast capnp-es mode, so placement alone does not explain it.
- JIT traces show further tiering around 650–690 ms after process startup;
  the old 200 ms warmup is insufficient for some RPC paths. The runner now
  defaults to 1,000 ms for RPC and records warmup/optional affinity settings.

The exact cause of the unpinned bimodality is unresolved. The evidence supports
keeping the allocation reduction, not attributing a single short-run timing
difference to the copy implementation. The new `Data.copyBuffer reuse/build`
scaling cases separate copying from message allocation and socket work.

Validation: **234 tests pass, 26 are skipped, and the same seven pre-existing RPC
failures remain**. All 18 AddressBook, 12 serialization cross-checks, and 18 RPC
checks pass. Type checking, changed-code lint, formatting, and diff whitespace
checks pass. Added tests cover near/far primitive-list accounting, malformed
scalar locations, bounded packed views with independent output (including shared
storage), and short-text decoding against TextDecoder over ASCII, malformed
UTF-8, BOMs, and the fast-path length boundary.

## Remote exception pass, 2026-10-28

This pass retains two changes to `CapnpRpcError` / `MethodError`: build their
fixed-format messages by concatenating pre-split fragments, and omit the default
empty options object when no error options were supplied. Error wording, codes,
remote reason/trace, exception identity, causes, and native JS stack capture are
preserved. The general-purpose `format()` implementation is unchanged.

[Raw timing samples and profile summaries](results/2026-10-28-exceptions.jsonl)
include the individual trials and both final comparison pairs. All RPC timing
runs use a 1,000 ms warmup and client/peer main-thread affinity 2/3. The full-suite
pair (`70` baseline / `71` optimized) uses five batches of 2,000 calls; the focused
pair reverses order (`72` optimized / `73` baseline) and uses seven batches of
20,000 calls.

| Workload / comparison            | Before (µs) | After (µs) | node-capnp in after run (µs) |
| -------------------------------- | ----------: | ---------: | ---------------------------: |
| Propagation, full-suite pair     |       32.11 |      31.87 |                        31.12 |
| Propagation, longer focused pair |       32.59 |      31.26 |                        30.29 |
| Read stack, full-suite pair      |       38.30 |      37.27 |                        30.96 |
| Read stack, longer focused pair  |       38.61 |      41.53 |                        31.45 |

The initial formatting-only trial measured 32.85 → 31.65 µs, and the additional
options change measured 31.33 µs. These are small improvements in total RPC
latency: the longer final comparison is about 4% faster, still about 3% behind
node-capnp in the optimized run. The options change's individual timing effect
is not established independently of run variation.

The allocation evidence is clearer. Separate Inspector sampling runs over
50,000 failed calls estimate **16,186 → 13,154 JavaScript bytes per RPC**, a
reduction of about **19%**. The old formatter accounts for approximately 3,168
bytes/call in its allocation stacks; those stacks disappear afterward. These
estimates include the JS harness and exclude native backing stores and the C++
peer. The CPU profile also loses the `format()` hotspot. Its idle samples are
waiting time, not library CPU work.

The new stack-access case exposes a diagnostic difference: in this workload,
capnp-es's error contains four JS frames (`Conn.handleReturnMessage`,
`Conn.handleMessage`, `Conn.work`, and `processTicksAndRejections`); node-capnp's
native-created error contains none. This was inspected in a separate untimed
run using `Error.prepareStackTrace`; timed runs use the normal stack formatter.
Capnp-es retains its stack information. Neither comparison is an equal-output
stack-formatting benchmark.

End-to-end stack-reading timings disagree between comparison pairs, so there is
no established gain or regression for that case. An isolated constructor probe
improves from 2.64 to 2.02 µs when stringifying the error, and 5.45 to 4.83 µs when
reading its stack. Its source and samples are included in the raw results. The
scaling suite now has equivalent constructor-only cases through the built
library, allowing error construction to be studied independently of sockets:

```sh
BENCH_ITERATIONS=20000 BENCH_SAMPLES=7 BENCH_WARMUP_MS=1000 \
pnpm bench:measure error-construction scaling MethodError
```

Stack frames depend on the harness; compare variants within the same harness,
not absolute constructor timings across the exploratory probe and scaling suite.
The RPC suite now checks both propagation and stack-reading paths for both
libraries (20 cross-checks). `CAPNP_PROFILE_HEAP_PATH` enables transient-allocation
sampling of either RPC case, as described above.

Validation: **237 tests pass, 26 are skipped, and the same seven pre-existing
RPC failures remain**. New tests cover exact formatting (including empty,
Unicode, newline, and percent-containing reasons), missing/mutated method names,
error identity and metadata, causes, non-enumerable message/cause properties, and
readable stacks. Type checking and changed-code lint/format checks pass.

## Callback and Data RPC pass, 2026-10-28

This pass starts from the exception pass above. The results below summarize
the individual experiments, full-suite comparison (`82` baseline / `83` optimized),
and focused repeat (`85` baseline / `86` optimized). Raw samples for this pass
are not committed. All use 1,000 ms warmup and client/peer
main-thread CPUs 2/3. The full suite uses five batches of 2,000 calls; the
focused repeat uses seven batches of 10,000 calls. Timing runs are separate
from profiling and tests.

Four changes are retained:

- Check for an absent RPC capability table before invoking its generated getter.
  The getter initializes a missing composite list, allocating its tag word.
  Received messages have no spare capacity, so this used to grow and copy the
  incoming buffer merely to read an empty table. Both import processing and
  sender-hosted capability collection now skip absent tables. Present tables
  retain their decoding, validation, positions, and reference bookkeeping.
- Construct outgoing small frames directly in their final pooled Buffer,
  eliminating the intermediate header ArrayBuffer and concatenation. Large
  frames retain views of their segments and use a pooled header Buffer.
- Cork/uncork only when multiple chunks are queued, letting sockets send a
  header and its segments through a vectored write. There is no deferred flush;
  the transport uncorks in the same call, including on backpressure or failure.
  Single-buffer messages do not call cork/uncork. This differs from the earlier
  experiments that corked every flush or deferred writes to a microtask.
- Read contiguous incoming headers directly at their offsets, without creating
  subarray wrappers. Fragmented headers keep the existing bounded-copy fallback.

An async rewrite of `joinAnswer()` was tested independently and reverted: it
did not show a timing win. The original promise chain remains. The isolated
timing benefits of conditional corking and direct header reads are small or
uncertain; their reduced write calls / temporary views are retained, with
backpressure and framing coverage.

Full-suite comparison, in µs (batch timing is per batch of 16):

| Workload                          | Before |  After | node-capnp after |
| --------------------------------- | -----: | -----: | ---------------: |
| Reused capability                 |  18.90 |  17.98 |            24.15 |
| 16 concurrent calls               | 139.91 | 101.64 |           158.01 |
| Acquire, await, call, release     |  45.82 |  40.46 |            65.67 |
| Acquire, pipeline call, release   |  39.74 |  34.55 |            53.58 |
| C++ callback into JS              |  45.35 |  41.24 |            49.36 |
| Four acquisitions, pipelined call |  97.86 |  74.14 |           142.40 |
| Remote exception                  |  32.21 |  34.14 |            29.82 |
| Remote exception + stack access   |  41.99 |  35.02 |            31.92 |
| 1 KiB write + acknowledgement     |  21.78 |  20.92 |            21.33 |
| 64 KiB write + acknowledgement    |  35.61 |  35.98 |            34.55 |

Longer focused repeat, in µs:

| Workload                        | Before | After | node-capnp after |
| ------------------------------- | -----: | ----: | ---------------: |
| C++ callback into JS            |  46.31 | 41.17 |            49.20 |
| Remote exception                |  37.04 | 28.04 |            32.94 |
| Remote exception + stack access |  41.28 | 41.00 |            31.72 |
| 1 KiB write + acknowledgement   |  21.16 | 20.83 |            25.89 |
| 64 KiB write + acknowledgement  |  37.59 | 35.20 |            35.74 |

Callbacks improve about 9–11% across these two comparisons. Small writes improve
about 2–4%; the native small-write timings vary considerably between runs.
The batch and deep-pipeline cases also improve substantially in the full suite.
Large writes remain near parity: the comparisons do not establish a robust
latency improvement or a consistent lead over node-capnp. Exception timings
fluctuate; the focused repeat does not reproduce the full-run slowdown, so that
single result is not treated as a demonstrated regression.

Separate Inspector allocation samples over 50,000 callbacks estimate **28,056 →
22,364 JavaScript bytes/callback**, about **20% less**. The old allocation stacks
show incoming capability-table reads calling `allocateSegment`, along with
header subarray wrappers. The optimized code avoids those operations. These
estimates include the JS harness, but not native backing-store allocations or
the C++ peer. They do not imply allocation-free RPC.

The 100,000-operation callback CPU profiles no longer show `getStreamFrame` as
a transport hotspot. A separate large-write profile still spends substantial
active time allocating the payload's backing buffer, copying data into it, and
performing `writev`. Socket-profile idle time is waiting, not library CPU work;
instrumented timings are not used as speed comparisons.

Validation: **248 tests pass, 26 are skipped, and the same seven pre-existing
RPC failures remain**. All 20 C++-peer RPC cross-checks pass. Type checking,
changed-code lint, formatting, and whitespace checks pass. New tests cover
non-mutating absent/empty capability-table reads, present and malformed
descriptors, owned small frames with 1–4 segments and zero header padding,
ordered writes under backpressure, queue limits, and synchronous write failures
during uncork. The final transport and capability-table subset passes all 24
tests.
