# 🔥 capnp-es

<!-- automd:badges bundlephobia codecov -->

[![npm version](https://img.shields.io/npm/v/@mnutt/capnp-es)](https://npmjs.com/package/@mnutt/capnp-es)
[![npm downloads](https://img.shields.io/npm/dm/@mnutt/capnp-es)](https://npm.chart.dev/@mnutt/capnp-es)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@mnutt/capnp-es)](https://bundlephobia.com/package/@mnutt/capnp-es)
[![codecov](https://img.shields.io/codecov/c/gh/unjs/capnp-es)](https://codecov.io/gh/unjs/capnp-es)

<!-- /automd -->

> [!WARNING]
> This is an alpha-quality software. please use at your own risk ([project status](#status)).

TypeScript implementation of the [Cap'n Proto](https://capnproto.org) serialization protocol.

[Cap’n Proto](https://capnproto.org/) is an insanely fast data interchange format and capability-based RPC system. Think JSON, except binary. Or think [Protocol Buffers](https://github.com/protocolbuffers/protobuf), except faster. Cap’n Proto was built by [Kenton Varda](https://github.com/kentonv) to be used in [Sandstorm](https://capnproto.org/faq.html#sandstorm) and is now heavily used in [Cloudflare](https://capnproto.org/faq.html#cloudflare).

## Usage

### Compiling schema

> [!NOTE]
> Make sure `capnpc` command is available. You can find install instructions [here](https://capnproto.org/install.html) to install it.

Install `@mnutt/capnp-es` dependency:

```sh
npx nypm install @mnutt/capnp-es
```

You can use `capnp-es` to compile a schema file into typeScript/javascript source code:

```shell
npx --package @mnutt/capnp-es capnp-es path/to/myschema.capnp -ojs,ts,dts
```

This will generate `path/to/myschema.{js,ts,dts}`.

Use `npx --package @mnutt/capnp-es capnp-es --help` for full usage info.

See [playground](./playground/) for examples and learn more about `.capnp` schema in [language docs](https://capnproto.org/language.html).

### Reading Messages

Here's a quick usage example:

```ts
import * as capnp from "@mnutt/capnp-es";
import { MyStruct } from "./myschema.js";

const message = new capnp.Message(buffer);
const struct = message.getRoot(MyStruct);
```

`Message` accepts `ArrayBuffer` and array-buffer views such as `Uint8Array`, `DataView`, and Node `Buffer`. Array-buffer views are copied on read so Node `Buffer` backing-store slack is not exposed to the message.

Messages can be serialized as `ArrayBuffer` or `Uint8Array`:

```ts
const bytes = message.toUint8Array();
const packedBytes = message.toPackedUint8Array();
```

For `Data` pointers, copy and view semantics are explicit:

```ts
const copy = struct.dataField.copyToUint8Array(); // copy
const view = struct.dataField.toUint8Array(); // live segment view
```

### Generated Schema Metadata

Generated struct and interface classes expose stable schema metadata on `_capnp`:

```ts
console.log(MyStruct._capnp.typeId);
console.log(MyStruct._capnp.typeIdHex);
console.log(MyStruct._capnp.fields);
console.log(MyInterface._capnp.methods);
```

RPC method metadata includes the generated param/result classes and field metadata, which is useful for generic tooling without reaching into compiler internals.

### RPC Protocol

Experimental [RPC protocol](https://capnproto.org/rpc.html) support is implemented with complete two-party [level 1](https://capnproto.org/rpc.html#protocol-features) coverage.

Current support matrix:

| Feature                                                                               | Status                  | Notes                                                                                                                                   |
| ------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Core call/return/bootstrap/finish                                                     | Implemented             | Two-party RPC baseline.                                                                                                                 |
| `Release` refcounting                                                                 | Implemented             | Import/export release accounting and cleanup paths covered by runtime tests.                                                            |
| Incoming `Resolve`                                                                    | Implemented             | Resolve-to-cap and resolve-to-exception supported, including race-safe unknown-promise handling.                                        |
| Outgoing `Resolve` (`senderPromise`)                                                  | Implemented             | Exported unresolved pipelines emit exactly one `Resolve(cap \| exception)` on settlement.                                               |
| `Disembargo` loopback (two-party)                                                     | Implemented             | Sender/receiver loopback contexts are supported.                                                                                        |
| `Disembargo` level-3 contexts                                                         | Unsupported             | Currently responds with `Unimplemented`.                                                                                                |
| Unsupported wire messages (`obsoleteSave`/`obsoleteDelete`/`provide`/`accept`/`join`) | Unsupported             | Deterministically echoed as `Unimplemented`.                                                                                            |
| Tail call: `sendResultsTo.yourself`                                                   | Partial                 | Returns `resultsSentElsewhere`; broader forwarding cases remain incomplete.                                                             |
| Tail call: `takeFromOtherQuestion`                                                    | Implemented             | Waiting questions can resolve from in-flight incoming answers.                                                                          |
| Full Level 1 conformance (two-party)                                                  | Implemented             | See `docs/rpc-level1-plan.md` for coverage matrix and known non-level-1 limits.                                                         |
| Level 2 persistence (`Persistent.save()` + restore flow)                              | Implemented (two-party) | `Persistent.save()` + app-defined restorer bootstrap + reconnect/sealing/revocation flows are covered in integration and interop tests. |

See [tests](./test/integration/rpc.spec.ts) and [Level 2 integration tests](./test/integration/rpc-level2.spec.ts) for examples.

Planning and conformance notes:

- Level 1: `docs/rpc-level1-plan.md`
- Level 2: `docs/rpc-level2-plan.md`

Level 2 authoring guidance:

- Define an app/realm-specific SturdyRef schema.
- Expose a bootstrap restorer interface that accepts that SturdyRef (+ optional owner/sealing context) and returns a live capability.
- Treat SturdyRefs as durable app-level tokens; transient per-connection tables are not durable.

### Node RPC Transport

Node-specific RPC transport helpers are available from `@mnutt/capnp-es/node`:

```ts
import { connectNodeRpc, transportFromDuplex } from "@mnutt/capnp-es/node";

const conn = await connectNodeRpc({ path: "/tmp/service.sock" });
const fdConn = await connectNodeRpc({ fd: 3 });
const transport = transportFromDuplex(duplexStream);
```

Supported inputs are Unix socket paths, connected file descriptors, TCP host/port pairs, and existing `Duplex` streams. Transport writes respect stream backpressure, `AbortSignal` is supported, and disconnects are surfaced as typed RPC errors.

Node Buffer helpers are also exported:

```ts
import {
  copyDataToBuffer,
  messageToBuffer,
  viewDataAsBuffer,
} from "@mnutt/capnp-es/node";

const frame = messageToBuffer(message);
const packedFrame = messageToBuffer(message, { packed: true });
const dataCopy = copyDataToBuffer(struct.dataField);
const dataView = viewDataAsBuffer(struct.dataField);
```

`copyDataToBuffer()` returns an independent copy. `viewDataAsBuffer()` returns a live view over the message segment.

### RPC Errors

RPC failures use `CapnpRpcError`:

```ts
import { CapnpRpcError } from "@mnutt/capnp-es";

try {
  await cap
    .method((params) => {
      // fill params
    })
    .promise();
} catch (error) {
  if (error instanceof CapnpRpcError) {
    console.error(error.code, error.remoteReason);
  }
}
```

`code` is one of `"failed"`, `"overloaded"`, `"disconnected"`, or `"unimplemented"`. Remote exceptions preserve the original reason, trace, and exception object when available.

## Status

This project is a rework of [jdiaz5513/capnp-ts](https://github.com/jdiaz5513/capnp-ts/) by [Julián Díaz](https://github.com/jdiaz5513) and is under development.

<details>

<summary>Changes from capnp-ts</summary>

- Internal refactors and simplifications as was playing around.
- Compiler, runtime, and std lib published via a single and compact ESM-only package with subpath exports.
- Compiler updated to use Typescript v5 API
- Output files can be `.ts` (new), `.js` (ESM instead of CJS), and `.d.ts` and has no `.capnp` suffix.
- Compiler API can be used via the `@mnutt/capnp-es/compiler` subpath export programmatically.
- Use native `TextEncoder` and `TextDecoder` for utf8 encoding
- Enums are typed plain JS objects (this way `.ts` files work with strip-only ts loaders without enum support.)
- Compiler CLI can directly accept a path to `.capnp` files and internally use `capnpc`
- Built-in schemas are compiled from source (compiler, compiles itself. so cool right?)
- Use reflection (getter setters) to access structs.
- RPC level-1 merged from [jdiaz5513/capnp-ts#169](https://github.com/jdiaz5513/capnp-ts/pull/169).
- List interface implements [`Array` object](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array) (custom methods removed).
- Pointers had been improved to feel (inspected and serialized) like native JS values as much as possible.
- Basic JSDocs generated for class and getter

</details>

## Contribution

Feedback and PRs are more than welcome. 🙏

<details>

<summary>Local development</summary>

- Clone this repository
- Install the latest LTS version of [Node.js](https://nodejs.org/en/)
- Enable [Corepack](https://github.com/nodejs/corepack) using `corepack enable`
- Install dependencies using `pnpm install`
- Run interactive tests using `pnpm dev`

</details>

## License

🔀 Forked from [jdiaz5513/capnp-ts](https://github.com/jdiaz5513/capnp-ts/) by [Julián Díaz](https://github.com/jdiaz5513).

💛 Published under the [MIT](https://github.com/unjs/capnp-es/blob/main/LICENSE) license.
