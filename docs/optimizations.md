# capnp-es optimization catalogue

This records the optimizations retained on `perf/capnp-es-rpc` as of
2026-10-28, relative to library source
[1637aea6f](https://github.com/mnutt/capnp-es/commit/1637aea6f19947a258d53344d32f789c26a44691). It covers the serialization,
allocation, packing, RPC exception, and transport passes. Rejected experiments
and prototypes are listed separately at the end.

## Reading the measurements and complexity estimates

Times are medians in microseconds per operation unless stated otherwise; batch
RPC times are per batch of 16. A percentage reduction refers to elapsed time,
not an increase in throughput. Measurements used Node 24.22.2 /
V8 13.6.233.17-node.63, with pointer compression disabled, and a compiled
benchmark harness. RPC comparisons use a common C++ peer over local sockets.
These are fixture results, not estimates of whole-application Sandstorm speed.

An **isolated trial** changes one optimization; a **combined result** measures
several retained changes together. Neither makes a small difference immune to
JIT, GC, or scheduling noise. Where attribution is unavailable, the catalogue
says so: repeated combined numbers must not be added together or credited in
full to each contributing change. Early RPC runs used shorter warmup; later
runs use 1,000 ms and client/peer main-thread CPU affinity 2/3. Absolute timings
across those passes are not controlled comparisons.

Allocation figures are Inspector sampling estimates, not exact allocation
counts. They include the JavaScript harness and exclude native backing stores
and the C++ peer. Arena growth/copy counts are separately instrumented backing
buffer operations. CPU-profile percentages are diagnostic evidence, not timing
speedups.

Complexity scores estimate the **incremental maintenance burden** of each
change, including validation, ownership, and fallback paths. They are subjective
and are not a line count or a score to sum across dependent changes.

| Score | Interpretation                                                                |
| ----- | ----------------------------------------------------------------------------- |
| −1    | Small simplification: removes repeated logic or machinery.                    |
| 0     | Approximately neutral: substitutes a similarly simple implementation.         |
| +1    | Low added complexity: a local guard, policy, or helper.                       |
| +2    | Moderate: additional paths or invariants need dedicated coverage.             |
| +3    | High: several interacting paths or widely distributed validation/state rules. |

### Evidence index

The [benchmark notes](test/bench/README.md) contain the full chronology,
methodology, commands, validation, and comparisons with node-capnp.

| Reference                 | Raw results                                                                   | Main comparison labels                                                           |
| ------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| P1: first pass            | [2026-10-28.jsonl](test/bench/results/2026-10-28.jsonl)                       | `13-baseline-*` / `14-final-*`; longer short-case repeats `15-*`                 |
| P2: second pass           | [2026-10-28-round2.jsonl](test/bench/results/2026-10-28-round2.jsonl)         | `33-start-*` / `36-final-*`, including `*-repeat`                                |
| P3: third pass            | [2026-10-28-round3.jsonl](test/bench/results/2026-10-28-round3.jsonl)         | Serialization `40-start` / `64-final`; RPC `65-start-pinned` / `66-final-pinned` |
| E: exceptions             | [2026-10-28-exceptions.jsonl](test/bench/results/2026-10-28-exceptions.jsonl) | Full suite `70` / `71`; longer repeat `73` baseline / `72` optimized             |
| C: callbacks and Data RPC | Summary in benchmark notes; raw samples not committed                         | Full suite `82` / `83`; longer repeat `85` / `86`; individual trials `76`–`81`   |

## Pointer resolution and primitive access

### 1. Decode near pointers once and read composite strides directly

**Commit:** [fde53ab47](https://github.com/mnutt/capnp-es/commit/fde53ab476d3b923058e361a52ec512552a85aaf)

**What:** `getContent()` handles ordinary same-segment pointers directly from
their wire words. Composite-element offsets use the tag's data/pointer sizes
without repeatedly resolving layout. Far pointers retain the general resolver.

**Benefit:** Part of P1's combined AddressBook traversal reduction,
**18.59 → 9.27 µs, about 50%**. No independently established timing for this
change alone. It removes repeated pointer decoding and temporary layout work.

**Complexity: +2.** A common-case path sits beside the general resolver; signed
offsets, composite tags, and traversal charges must agree between them.
Source: [pointer.utils.ts](src/serialization/pointers/pointer.utils.ts).

### 2. Resolve field layout and bounds together

**Commit:** [df62439e8](https://github.com/mnutt/capnp-es/commit/df62439e8e95a0a8484d5c1facbfdd730b6858d7)

**What:** Scalar and pointer-field access combine the field bounds check with
near-pointer layout resolution, including composite-list elements. Layout is
read afresh on each access, so this introduces no cache invalidation protocol.

**Benefit:** Contributed to P2's combined **9.08 → 3.99 µs** AddressBook traversal
and **3.39 → 2.15 µs** for 100 scalar reads including message construction.
Individual attribution is unavailable. The scalar location representation was
subsequently improved further in item 4.

**Complexity: +2.** Fewer repeated resolutions, but specialized bounds/layout
logic must preserve error ordering, depth limits, and traversal accounting.
Source: [struct.utils.ts](src/serialization/pointers/struct.utils.ts).

### 3. Reuse the freshly resolved pointer-field temporary

**Commit:** [2e6ad4dbe](https://github.com/mnutt/capnp-es/commit/2e6ad4dbe53b1af975c016e0df53afec3e7e08b9)

**What:** `getPointer()` turns its freshly resolved location into the field
pointer instead of constructing another Pointer and metadata object.
`checkPointer()` retains the constructor's checks and traversal charge.

**Benefit:** Removes a temporary object pair on this path. Included in P2's
combined traversal gain above; no reliable separate latency estimate.

**Complexity: +1.** Small reuse of a local temporary, plus a shared validation
helper. The important restriction is that this is a fresh object, not a cached
or shared reader. Sources: [pointer.ts](src/serialization/pointers/pointer.ts),
[struct.utils.ts](src/serialization/pointers/struct.utils.ts).

### 4. Use numeric locations for successful near scalar reads and writes

**Commit:** [541702fea](https://github.com/mnutt/capnp-es/commit/541702fea1538b8e350accea8ff6e09f99368d8d)

**What:** `getCheckedDataSection()` returns a numeric offset for common locations
instead of a temporary Pointer. `checkPointerOffset()` validates and charges
that location without allocating on success. Far locations use Pointer objects;
the cold validation path constructs the original diagnostic Pointer.

**Benefit:** In P3, prepared UInt32 field and composite-element reads dropped
from **about 88 sampled bytes/read to the profiler overhead floor**. At ten
million reads, estimates were 0.00369 and 0.00345 bytes/read, respectively.
The 100-scalar-read workload, including construction, improved
**2.07 → 1.64 µs, about 21%**, across the pass.

**Complexity: +3.** The `number | Pointer` location representation reaches
22 scalar getters/setters. Bounds checks, composite-tag charges, fallback
behavior, and failure diagnostics must stay consistent. This is one of the
largest maintenance costs among the retained changes.
Sources: [pointer.ts](src/serialization/pointers/pointer.ts),
[struct.utils.ts](src/serialization/pointers/struct.utils.ts).

### 5. Use numeric locations for primitive-list and Data access

**Commit:** [c880a25b4](https://github.com/mnutt/capnp-es/commit/c880a25b49bcbf565f5ed05322a82c1ee29a90e7)

**What:** `getContentOffset()` provides the same allocation avoidance for simple
near list/Data locations. Primitive list getters/setters and Data methods use
the offset directly; composite and far locations keep the general resolver.

**Benefit:** Prepared `UInt32List.get()` fell from **87.956 sampled bytes/read
to 0.00361**, at the measurement floor in the long P3 probe. This does not make
returned BigInts, typed-array views, or newly constructed readers allocation-free.
No independently established whole-RPC speedup.

**Complexity: +2.** A shared helper limits duplication, but all primitive list
types and Data methods must select the correct segment/offset and preserve
fallback checks. Sources: [pointer.utils.ts](src/serialization/pointers/pointer.utils.ts),
[list implementations](src/serialization/pointers/list),
[data.ts](src/serialization/pointers/data.ts).

### 6. Apply the numeric-location path to `Data.copyBuffer()`

**Commit:** [560966853](https://github.com/mnutt/capnp-es/commit/5609668532740ef17edcc14baf717a6d2237c669)

**What:** Bulk copying also avoids the temporary Pointer/metadata pair. The
source and destination byte views, and the payload copy itself, remain.

**Benefit:** Isolated reuse of a 64 KiB destination measured
**1.139 → 1.109 µs, about 3%**. Fresh-message construction showed no reliable
gain. An apparent RPC slowdown was investigated and did not reproduce as a
change-specific regression: both implementations exhibited fast/slow modes.
The final matched P3 64 KiB RPC result was **36.00 → 36.05 µs**, effectively tied.

**Complexity: +1 incremental to item 5.** Reuses the same helper rather than
adding a second copying algorithm. Retained for allocation reduction, with no
claim of an established RPC latency benefit.
Source: [data.ts](src/serialization/pointers/data.ts).

## List and message bookkeeping

### 7. Reach list targets through a private Symbol for internal access

**Commit:** [263f5e058](https://github.com/mnutt/capnp-es/commit/263f5e058fe4891d3e0edb600b2f81fc2689033e)

**What:** Internal wire operations unwrap the list Proxy once through a private
Symbol, then access the underlying object. Public indexing, method overrides,
callback receivers, and snapshot iteration keep their existing behavior.

**Benefit:** Avoids repeated Proxy property traps. Contributed to P2's combined
AddressBook traversal **9.08 → 3.99 µs** and session decode **4.28 → 1.99 µs**;
no separately established share of those improvements. The earlier WeakMap
approach was rejected.

**Complexity: +2.** Introduces a distinction between the public receiver and
internal target across list implementations; receiver/override tests matter.
Source: [list.ts and neighboring implementations](src/serialization/pointers/list/list.ts).

### 8. Allocate snapshot arrays without initializing them twice

**Commit:** [f8630bd58](https://github.com/mnutt/capnp-es/commit/f8630bd5819c70c6d8ed489aa9eb8432ed8135ae)

**What:** `List.toArray()` creates an array of the required length and fills
every element, replacing `Array.from()` initialization followed by overwriting.
It still calls the public `at()` path and retains snapshot semantics.

**Benefit:** Included in P2 traversal gains. `toArray` sampled self-time fell
**11.2% → 2.5%** across the pass's profiles; this is contextual evidence, not
an isolated latency reduction.

**Complexity: 0.** A similarly simple loop with less initialization work; the
allocation clamps negative uninitialized-Text length to retain an empty snapshot.
Source: [list.ts](src/serialization/pointers/list/list.ts).

### 9. Allocate segment tables without initializing them twice

**Commit:** [2d2a79557](https://github.com/mnutt/capnp-es/commit/2d2a79557ba295e55bee8689fbb3d259674c2714)

**What:** Framed-segment and Segment-object arrays are reserved and filled
directly. Incoming header size is validated before allocating the array.

**Benefit:** Part of P2's combined parse result, **1.05 → 0.66 µs**.
No independent timing was established; unnecessary array initialization is
removed from each message construction.

**Complexity: 0.** Straightforward array construction, with explicit validation
before allocation. Source: [message.ts](src/serialization/message.ts).

## Text

### 10. Omit indexed Proxies for internal Text wrappers

**Commit:** [1991606b0](https://github.com/mnutt/capnp-es/commit/1991606b037d2a0cd5a2e347558f60b82a5a5a97)

**What:** Internal Text construction can skip the indexed-list Proxy. The first
pass used this to reduce text-access overhead; later direct reads superseded
most reader wrappers. The option remains used for writes and default handling.
Public construction remains indexed by default.

**Benefit:** Contributed to P1 traversal and text-building gains; no reliable
isolated timing. Its historical read benefit overlaps item 11 and must not be
counted as an additional current read-path win.

**Complexity: +1.** An optional construction flag distinguishes internal uses
from the public indexed interface. Sources: [text.ts](src/serialization/pointers/text.ts),
[list.ts](src/serialization/pointers/list/list.ts).

### 11. Decode internal text directly without a Text reader object

**Commit:** [226e35d5e](https://github.com/mnutt/capnp-es/commit/226e35d5edbde3c319896e6fd08b750accf2316b)

**What:** `readText()` resolves a near byte-list and decodes from its location
without constructing a Text wrapper. Validation and traversal charges remain;
other pointer layouts use the general decoding path.

**Benefit:** Part of P2's combined **9.08 → 3.99 µs** traversal and
**4.28 → 1.99 µs** session decode gains. Across the pass, `getContent` sampled
self-time fell **9.4% → 1.7%**, with no separate causal timing for text alone.

**Complexity: +2.** Specialized reading duplicates some general pointer/type
handling. Null/default values, lengths, validation, and fallback decoding need
to stay aligned. Source: [text.ts](src/serialization/pointers/text.ts).

### 12. Encode short UTF-8 strings directly into the segment

**Commit:** [8f3bc0370](https://github.com/mnutt/capnp-es/commit/8f3bc0370951d6566a57ed3d1bc66e4212893524)

**What:** For strings up to 256 UTF-16 code units, compute the byte length in JS
and call `TextEncoder.encodeInto()` on segment storage. This avoids an encoded
temporary buffer and its subsequent copy. Longer strings retain `encode()`:
the JS sizing scan regressed long-string performance.

**Benefit:** Longer P1 repeats confirmed improvements for short ASCII and
Unicode strings at 32 and 256 code units. Combined with other P1 changes,
session encoding fell **9.20 → 3.32 µs** and the 16,384-string builder fell
**40.81 → 8.18 ms**. Those totals are not isolated encoding gains.

**Complexity: +2.** Adds UTF-8 sizing with surrogate handling and a size cutoff.
The native encoder still writes the bytes; overwrite/prefix behavior needs
coverage. Source: [text.ts](src/serialization/pointers/text.ts).

### 13. Decode tiny ASCII strings without a decoder view

**Commit:** [b954b502e](https://github.com/mnutt/capnp-es/commit/b954b502e208102dd4e41d368e05f371113fb158)

**What:** Bounded ASCII strings of up to eight bytes use direct byte reads and
`String.fromCharCode()`. Longer or non-ASCII input uses TextDecoder, preserving
Unicode, BOM, and malformed-input behavior.

**Benefit:** The isolated P3 trial lowered AddressBook traversal
**4.04 → 3.65 µs, about 10%**, and session decode
**1.99 → 1.81 µs, about 9%**. It removes a temporary byte view and native decoder
call, but the resulting string is not guaranteed allocation-free.

**Complexity: +2.** A bounded, unrolled eight-byte path and length switch sit
beside the existing decoder. Tests cover the cutoff, malformed UTF-8, and BOMs.
Source: [text.ts](src/serialization/pointers/text.ts).

## Arena growth and packing

### 14. Grow single-segment arenas geometrically

**Commit:** [36bfd45ef](https://github.com/mnutt/capnp-es/commit/36bfd45eff241fa49f9a8f06f5224c76a27b9539)

**What:** Grow by at least the current capacity rather than repeatedly adding
only the minimum required increment. Existing handles continue to refer to the
Segment whose backing buffer is replaced.

**Benefit:** The isolated 16,384-string builder improved
**26.0 → 14.7 ms, about 43%**, before the short-text change. Instrumentation
counted **435 → 4 growths** and **153,212,672 → 919,552 bytes copied**, about
99.4% less copying. Used message bytes remained 575,392.

**Complexity: +1.** A simple growth policy, with a real space tradeoff: final
capacity increased **575,744 → 1,050,624 bytes** for that builder.
Source: [single-segment-arena.ts](src/serialization/arena/single-segment-arena.ts).

### 15. Pack into typed byte storage instead of a JS number array

**Commit:** [8f5e1cd3a](https://github.com/mnutt/capnp-es/commit/8f5e1cd3a8200c0ac538f72208a5d29033e3ac64)

**What:** Packing writes bytes into a typed output buffer with a cursor, avoiding
dynamic number-array accumulation and conversion. Later passes refined its
capacity policy and output ownership; see items 17–18.

**Benefit:** P1 dense 64 KiB packing fell **1132.40 → 80.74 µs** (about 14×),
and mixed input **1152.94 → 91.97 µs** (about 12.5×). The initial reservation
policy hurt zero-filled input; that policy was replaced, not retained unchanged.

**Complexity: +2.** Explicit capacity/cursor management replaces array growth.
Source: [packing.ts](src/serialization/packing.ts).

### 16. Scan zero runs by words and copy literal runs in bulk

**Commit:** [0044c2e73](https://github.com/mnutt/capnp-es/commit/0044c2e7397006207c66febba33ad1ba042041af)

**What:** Two 32-bit reads test a whole zero word; literal runs use bulk typed-array
copying instead of individual byte operations where possible.

**Benefit:** Together with item 17, P2 repeats measured dense 64 KiB packing
**83.51 → 49.75 µs**, mixed **91.13 → 50.24 µs**, and zeros
**45.85 → 6.93 µs**. These are combined reductions of about 40%, 45%, and 85%,
not separate estimates of the scanning change.

**Complexity: +2.** Additional run-handling paths must preserve tag semantics,
slice boundaries, and maximum run lengths. A 1,040-case differential check
matched the previous output. Source: [packing.ts](src/serialization/packing.ts).

### 17. Adapt packing capacity to input size

**Commit:** [14b233e6c](https://github.com/mnutt/capnp-es/commit/14b233e6cf145e67efccd337e97c9b057ae70e08)

**What:** Reserve the maximum output size for inputs up to 2 KiB. For larger
inputs, start at 256 bytes and grow as needed. This keeps small dense inputs
cheap without reserving a large buffer for highly compressible input.

**Benefit:** For 64 KiB of zeros, temporary capacity fell
**81,920 → 256 bytes**. The combined P2 zero-packing timing is
**45.85 → 6.93 µs**; small-zero packing was effectively unchanged,
**1.53 → 1.55 µs**. Growing from 256 bytes for every input size had regressed
small dense inputs, motivating the cutoff.

**Complexity: +2.** Adds a size-dependent allocation policy and growth checks.
Source: [packing.ts](src/serialization/packing.ts).

### 18. Consume packed views without intermediate trim copies

**Commit:** [a5d82dc61](https://github.com/mnutt/capnp-es/commit/a5d82dc614ed3e2c82b2a320b9e456243e954eb2)

**What:** Internal `packToView()` returns a view over temporary packed storage.
Message serialization copies it directly into the final output, avoiding an
exact-size intermediate ArrayBuffer for each packed header/segment. Public
`pack()` still returns its own exactly sized ArrayBuffer.

**Benefit:** Removes one intermediate trim copy per packed header/segment.
Combined P3 descriptor encoding improved **6.50 → 5.13 µs** for one tag and
**45.29 → 42.38 µs** for 16 tags. No isolated share of those gains is claimed.

**Complexity: +1.** A small internal/public output distinction; temporary views
are consumed synchronously and the final output remains independently owned.
Sources: [packing.ts](src/serialization/packing.ts),
[message.ts](src/serialization/message.ts).

### 19. Unpack bounded input views without a preliminary copy

**Commit:** [f6b5a4bf1](https://github.com/mnutt/capnp-es/commit/f6b5a4bf1e294dea30059458ca381be9e6b3a986)

**What:** Packed input can be an ArrayBuffer view, preserving its offset and
length through sizing and decoding. Message construction no longer first
copies ordinary packed views into a new ArrayBuffer. Shared or foreign-realm
backing storage takes the copy path; shared input is snapshotted before sizing.

**Benefit:** Removes an input-sized copy for eligible views. P3 combined
descriptor decoding improved **3.92 → 3.37 µs** for one tag and
**30.55 → 27.49 µs** for 16 tags, including other reader/text changes.
No isolated latency estimate.

**Complexity: +2.** View bounds, shared-memory consistency, and independent
output ownership require explicit handling. This is not a borrowed Message API.
Sources: [packing.ts](src/serialization/packing.ts),
[message.ts](src/serialization/message.ts).

## RPC errors and capability tables

### 20. Decode a remote exception reason once

**Commit:** [45fb03db1](https://github.com/mnutt/capnp-es/commit/45fb03db17d66f7f944f9ad4b36c389eaf1e06ea)

**What:** CapnpRpcError reads the wire reason once, and MethodError reuses
`remoteReason` instead of invoking the text getter again. The old path could
decode the same reason three times.

**Benefit:** Removes redundant decoding and its temporary work. P3 remote
exception latency was **32.93 → 33.07 µs**, effectively unchanged across the
whole pass. No independently established latency improvement.

**Complexity: −1.** Reuses an existing stored value and removes duplicate work.
Sources: [rpc-error.ts](src/rpc/rpc-error.ts),
[method-error.ts](src/rpc/method-error.ts).

### 21. Build fixed-format RPC error messages directly

**Commit:** [98f12d6c5](https://github.com/mnutt/capnp-es/commit/98f12d6c5849e3304eebcadb3d34c83de9ff2bb9)

**What:** Split the fixed message templates once, then concatenate their pieces
and current values. General-purpose `format()` remains unchanged. Error text,
metadata, causes, and native JS stack capture are preserved.

**Benefit:** Formatting alone measured **32.85 → 31.65 µs** for remote exceptions.
With item 22, the longer final comparison was **32.59 → 31.26 µs**, about 4%.
Sampled JS allocation fell **16,186 → 13,154 bytes/failed RPC**, about 19%;
the old formatter's allocation stacks disappeared. Isolated constructor probes
improved **2.64 → 2.02 µs** with stringification and **5.45 → 4.83 µs** with
stack access, for the combined exception changes.

**Complexity: 0.** Removes a generic parser from this path, but direct assembly
is coupled to the fixed templates' placeholder layout. Exact-format tests cover
that tradeoff. Sources: [rpc-error.ts](src/rpc/rpc-error.ts),
[method-error.ts](src/rpc/method-error.ts).

### 22. Avoid a default empty Error options object

**Commit:** [29c9cdabb](https://github.com/mnutt/capnp-es/commit/29c9cdabbbe0b677994bed293cad7312b3af44c7)

**What:** Leave omitted options undefined instead of constructing `{}` on every
CapnpRpcError call. Explicit options and cause behavior remain supported.

**Benefit:** Removes a source-level object creation. The incremental trial
**31.65 → 31.33 µs** was too small to establish a separate RPC benefit.
The allocation reduction above measures both exception changes, and does not
prove every eliminated `{}` would have been materialized by V8.

**Complexity: 0.** Optional property access replaces the default object without
adding an algorithm or state. Source: [rpc-error.ts](src/rpc/rpc-error.ts).

### 23. Skip getters for absent RPC capability tables

**Commit:** [5ad761256](https://github.com/mnutt/capnp-es/commit/5ad761256efaec2abada062ae331937475a628e3)

**What:** Check `_hasCapTable()` before import processing and sender-hosted
capability collection. The generated getter initializes a missing composite
list; on a fully allocated received frame, even that empty tag caused buffer
growth and copying. Present tables keep the existing processing.

**Benefit:** Isolated C trials `76` → `78` measured callbacks
**46.88 → 43.39 µs**, about 7%, and reused calls **19.94 → 17.37 µs**, about 13%.
Incoming `allocateSegment` stacks caused by these empty-table reads disappeared.
The final callback pass's allocation reduction also includes transport changes.

**Complexity: +1.** Two presence guards remove unnecessary mutation and
allocation. Coverage distinguishes absent, present-empty, and malformed tables.
Source: [conn.ts](src/rpc/conn.ts).

## Node transport

### 24. Queue fragmented input instead of repeatedly concatenating it

**Commit:** [c60fe275d](https://github.com/mnutt/capnp-es/commit/c60fe275d5366944666b782ff16298ae5eaec74c)

**What:** Retain incoming chunks until a complete frame is available. Contiguous
frames can be views; fragmented payloads are copied into the completed frame
once, rather than recopying the accumulated prefix on every arrival. Fragmented
headers may still need their own bounded copies.

**Benefit:** P1 receiving 64 KiB in 1,024-byte chunks improved
**229.05 → 19.46 µs**, about 92%. With 64-byte chunks it improved
**3337.42 → 84.77 µs**, about 97%. This addresses the scaling cost of repeated
prefix copies, not just a small constant overhead.

**Complexity: +3.** Replaces a single pending buffer with a queue, head/offset,
available-byte count, partial header/frame state, and queue compaction. Needs
fragmentation, coalescing, multiple-segment, and malformed-header coverage.
Source: [CapnpFrameDecoder in node/index.ts](src/node/index.ts).

### 25. Construct small outgoing frames directly in pooled Buffers

**Commit:** [b3a5d56f4](https://github.com/mnutt/capnp-es/commit/b3a5d56f48001bf79f0b0d8c986e541124b5fa5a)

**What:** For frames up to 1,024 bytes, write the header and segment bytes directly
into the final Buffer, avoiding an intermediate header ArrayBuffer and
concatenation. Large frames use a pooled header and retain segment views.

**Benefit:** Isolated C trials `78` → `79` measured callbacks
**43.39 → 41.71 µs**, about 4%, and 1 KiB writes **21.42 → 19.01 µs**, about 11%.
The latter is exploratory: final combined small-write improvements were only
2–4%. Transport `getStreamFrame` allocation/profile work disappears.

**Complexity: +2.** Two construction paths with explicit segment counts,
padding, lengths, and ownership. Tests ensure small frames contain independent
bytes and initialized padding. Source: [messageToBufferChunks in node/index.ts](src/node/index.ts).

### 26. Cork only multi-chunk writes and uncork immediately

**Commit:** [b8f29f677](https://github.com/mnutt/capnp-es/commit/b8f29f67747d644b03833826afaedae27178b448)

**What:** When multiple chunks are queued, cork for that flush so the socket can
use a vectored write. Uncork in the same call, including on backpressure and
failure. Single-buffer writes skip corking; there is no microtask delay.

**Benefit:** Enables header/segment batching, with tests observing a vectored
write. C trials `79` → `80` measured 64 KiB writes **38.54 → 36.04 µs**, but an
earlier trial was already 34.59 µs. **No independently established latency gain**;
final large-write results remain close and variable.

**Complexity: +2.** Adds flush lifecycle rules: cork/uncork balance, draining
buffered chunks under backpressure, and synchronous uncork errors. This has a
less compelling timing-to-complexity ratio than the larger measured wins.
Source: [flushWrites in node/index.ts](src/node/index.ts).

### 27. Read contiguous incoming headers without temporary subarrays

**Commit:** [74c7d221e](https://github.com/mnutt/capnp-es/commit/74c7d221efce0fd756d00bbc89c158c5b9e692f9)

**What:** Read counts and segment sizes directly from the queued Buffer at its
current offset. Fragmented headers retain the bounded-copy fallback.

**Benefit:** Removes temporary header view objects. No isolated timing win:
C trials `80` → `81` measured callbacks **41.61 → 42.37 µs**, reused calls
**16.86 → 16.81 µs**, and 64 KiB writes **36.04 → 35.41 µs**. Header subarray
allocation stacks disappear in the final profile; the total allocation gain
below cannot all be attributed to this change.

**Complexity: +1.** Extra offset/contiguity checks within the existing decoder,
without introducing more parser states.
Source: [CapnpFrameDecoder in node/index.ts](src/node/index.ts).

### Combined result of items 23 and 25–27

The full-suite and longer focused comparisons help distinguish the retained
group's benefit from noisy individual trials:

| Workload                             | Full suite: before → after | Longer focused: before → after |
| ------------------------------------ | -------------------------- | ------------------------------ |
| C++ callback into JS                 | 45.35 → 41.24 µs           | 46.31 → 41.17 µs               |
| 16 concurrent calls, per batch       | 139.91 → 101.64 µs         | Not repeated here              |
| Four acquisitions and pipelined call | 97.86 → 74.14 µs           | Not repeated here              |
| 1 KiB write + acknowledgement        | 21.78 → 20.92 µs           | 21.16 → 20.83 µs               |
| 64 KiB write + acknowledgement       | 35.61 → 35.98 µs           | 37.59 → 35.20 µs               |

Callbacks improved about **9–11%**, small writes about **2–4%**. Separate
sampling estimated **28,056 → 22,364 JS bytes/callback**, about **20% less**.
Large writes do not have a robust demonstrated gain or consistent lead over
node-capnp. Exception timings also varied between runs; a full-suite slowdown
was not reproduced by the focused repeat.

## Supporting correctness fix

### 28. Correct list erasure's byte/word count

**Commit:** [e8ca698b5](https://github.com/mnutt/capnp-es/commit/e8ca698b58c69b7a4ee5f7aa741eca971455fe4a)

**What:** Convert padded content bytes to words before passing the count to
word-based erasure. Text overwrite tests exposed the old unit mismatch, which
could overwrite adjacent data or throw out of bounds.

**Benefit:** Correctness, with **no performance claim**. Also fixes two existing
orphan/cross-message-copy failures.

**Complexity: 0.** A local unit conversion aligns the implementation with the
existing operation. Source: [erase in pointer.utils.ts](src/serialization/pointers/pointer.utils.ts).

## What remains allocating, and where complexity is concentrated

The strongest allocation result is successful near-pointer primitive reads on
prepared readers. The probes read UInt32 value 42; their post-change estimates
are comparable to the direct-segment control. This is evidence that those
temporary objects are gone, not proof of zero allocations for all values or
V8 optimization states. Message/reader construction, snapshot arrays, returned
strings/BigInts, views, far-pointer fallback, error construction, and RPC
bookkeeping still allocate.

The most substantial new maintenance burden is in scalar location/validation
handling (item 4) and fragmented-frame state (item 24). Both buy significant
allocation or scaling improvements. Local guards and value reuse (items 3,
20, 23) have a much smaller complexity cost. Conditional corking and direct
header reads (items 26–27) have the weakest isolated latency evidence; their
justification is reduced write/view overhead with regression coverage.

## Experiments not retained

These are not additional optimizations in the current implementation.

| Experiment                                  | Outcome                                                                                                                                               |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| WeakMap-based list Proxy unwrapping         | Reverted; four-acquisition RPC rose approximately 123 → 135 µs. The retained private-Symbol path is different.                                        |
| Uniform `_capnp` metadata shape             | Reverted; mixed results within run variation.                                                                                                         |
| Standalone numeric size decoder             | Reverted; no consistent gain. This is distinct from the retained numeric location helpers.                                                            |
| Indexed internal RPC capability-table loops | Reverted; no consistent gain. Public snapshot semantics remain.                                                                                       |
| Remove generated async promise wrapper      | Reverted; no consistent RPC improvement.                                                                                                              |
| Deferred microtask write batching           | Reverted; batch-of-16 RPC rose about 196 → 225 µs, four acquisitions 118 → 136 µs.                                                                    |
| Immediate corking on every flush            | Reverted; no consistent gain. Retained conditional multi-chunk corking is a later, narrower change.                                                   |
| Start every packing output at 256 bytes     | Replaced; regressed small dense inputs, so small inputs now reserve their maximum output once.                                                        |
| JS UTF-8 sizing for long strings            | Restricted to short strings; long strings retain the native encode path.                                                                              |
| Specialized composite-list `toArray()`      | Reverted; traversal only changed 3.65 → 3.59 µs and descriptor decode did not improve.                                                                |
| Async rewrite of `joinAnswer()`             | Reverted; callback trial 46.88 → 47.78 µs showed no win.                                                                                              |
| Cache layout in an owned reader             | Prototype only; 100 scalar reads including construction measured 3.49 → 1.19 µs. A general version needs an explicit immutability/ownership contract. |
| Borrow segment storage rather than copy it  | Prototype only; isolated 64 KiB copy/view measured 3.53/0.05 µs. This is not a full decoder/RPC comparison and adds no borrowed-message API.          |

## Benchmark and validation support

**Benchmark-support commit:** [1b0c9f938](https://github.com/mnutt/capnp-es/commit/1b0c9f938aa6eb9758f38962f4d479636cbd5de3)

The work also added isolated node-capnp setup, Sandstorm-shaped serialization
fixtures, RPC scenarios against the common C++ peer, scaling cases, a compiled
measurement harness, CPU profiles, and allocation probes. These make experiments
reviewable; they are not production runtime optimizations. Warmup, affinity,
individual samples, rejected trials, and profile metadata are retained in the
evidence files above.

Coverage was added for pointer bounds/depth/traversal accounting, far pointers,
list receiver/override semantics, text encoding and overwrites, arena growth
with live handles, packing equivalence, bounded/shared input, error metadata,
capability tables, and transport fragmentation/backpressure.

The latest recorded runtime validation is **248 passing, 26 skipped, and the
same seven pre-existing RPC failures**, with all 20 common-C++-peer RPC checks
passing. Types, changed-code lint, formatting, and whitespace checks passed.
This catalogue consolidates that recorded evidence; writing it did not involve
a new performance run.
