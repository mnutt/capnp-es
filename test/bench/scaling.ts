import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { CapnpRpcError, Message, Server, utils } from "capnp-es";
import { transportFromDuplex } from "capnp-es/node";
import { Exception, Message as RPCMessage } from "capnp-es/capnp/rpc";
import { pack, unpack } from "../../src/serialization/packing";
import {
  SessionParams,
  Bench,
  Bench_Ping$Results,
  Bench_Write$Params,
} from "./data/sandstorm/workloads";
import { measure, selected } from "./measure";

// Large builders and deliberately fragmented frames make each operation costly.
process.env.BENCH_ITERATIONS ||= "100";

// Obtain the built library's MethodError constructor through an unimplemented
// local call. It is not a public export; importing its source here would measure
// a separate bundled implementation instead of the package under comparison.
const errorMethod = Bench.Client.methods[0];
type MethodErrorConstructor = new (
  method: typeof errorMethod,
  exception: Exception,
) => CapnpRpcError;
let MethodError: MethodErrorConstructor | undefined;
try {
  await new Server({}, []).call({ method: errorMethod }).struct();
} catch (error) {
  assert.ok(error instanceof CapnpRpcError);
  assert.equal(error.name, "MethodError");
  MethodError = error.constructor as MethodErrorConstructor;
}
assert.ok(MethodError);
const exceptionMessage = new Message();
const exception = exceptionMessage.initRoot(Exception);
const exceptionReason =
  "expected context.getParams().getSequence() != 0xffffffffu " +
  "[4294967295 != 4294967295]; forced benchmark failure";
exception.reason = exceptionReason;
exceptionMessage._capnp.traversalLimit = 0x3fffffff;
for (const readStack of [false, true]) {
  const name = `remote MethodError construction${readStack ? " + stack access" : ""}`;
  const ErrorClass = MethodError;
  const operation = () => {
    const error = new ErrorClass(errorMethod, exception);
    return readStack ? error.stack! : String(error);
  };
  assert.ok(operation().includes(exceptionReason));
  if (selected(name)) await measure(name, operation);
}

// Architectural experiment, not a public reader API: take an owned snapshot,
// validate its field through the regular reader, then cache this one scalar's
// location. Nothing can mutate this private message during the operation.
const scalarMessage = new Message();
scalarMessage.initRoot(Bench_Ping$Results).sequence = 42;
const scalarBytes = scalarMessage.toUint8Array();
for (const cached of [false, true]) {
  const name = `owned scalar reader ${cached ? "cached prototype" : "current"}, 100 reads`;
  const operation = () => {
    const root = new Message(scalarBytes, false).getRoot(Bench_Ping$Results);
    const initial = root.sequence;
    let sum = initial;
    if (cached) {
      const { segment, byteOffset } = utils.getContent(root);
      for (let i = 1; i < 100; i++) sum += segment.getUint32(byteOffset);
    } else {
      for (let i = 1; i < 100; i++) sum += root.sequence;
    }
    return sum;
  };
  assert.equal(operation(), 4200);
  if (selected(name)) await measure(name, operation);
}

for (const size of [1024, 64 * 1024]) {
  for (const pattern of ["zero", "dense", "mixed"]) {
    const bytes = new Uint8Array(size);
    if (pattern === "dense") bytes.fill(0x5a);
    else if (pattern === "mixed") {
      for (let i = 0; i < size; i++) bytes[i] = i % 17;
    }
    assert.deepEqual(new Uint8Array(unpack(pack(bytes.buffer))), bytes);
    const name = `pack ${pattern} ${size}`;
    if (selected(name)) await measure(name, () => pack(bytes.buffer));
  }
}
for (const size of [1024, 64 * 1024]) {
  const bytes = Buffer.alloc(size, 0x5a);
  const message = new Message();
  const data = message.initRoot(Bench_Write$Params)._initData(size);
  const reuse = () => {
    data.copyBuffer(bytes);
    return data;
  };
  const build = () => {
    const message = new Message();
    message.initRoot(Bench_Write$Params)._initData(size).copyBuffer(bytes);
    return message;
  };
  reuse();
  assert.equal(data.get(0), 0x5a);
  assert.equal(data.get(size - 1), 0x5a);
  assert.equal(build().getRoot(Bench_Write$Params).data.length, size);
  for (const [kind, operation] of [
    ["reuse", reuse],
    ["build", build],
  ] as const) {
    const name = `Data.copyBuffer ${kind} ${size}`;
    if (selected(name)) await measure(name, operation);
  }
}
for (const count of [16, 1024, 16384]) {
  const encode = () => {
    const message = new Message();
    const root = message.initRoot(SessionParams);
    const list = root._initAcceptableLanguages(count);
    for (let i = 0; i < count; i++) list.set(i, `language-${i}-benchmark`);
    return message.toUint8Array();
  };
  const encoded = encode();
  assert.equal(
    new Message(encoded, false)
      .getRoot(SessionParams)
      .acceptableLanguages.get(count - 1),
    `language-${count - 1}-benchmark`,
  );
  const name = `build text list ${count}`;
  if (selected(name)) await measure(name, encode);
}

for (const size of [32, 256, 1024, 64 * 1024]) {
  for (const pattern of ["ascii", "unicode"]) {
    const value = (pattern === "ascii" ? "abcd" : "é🦀x").repeat(size / 4);
    const operation = () => {
      const message = new Message();
      message.initRoot(SessionParams).basePath = value;
      return message.toArrayBuffer();
    };
    assert.equal(
      new Message(operation(), false).getRoot(SessionParams).basePath,
      value,
    );
    const name = `encode text ${pattern} ${size} UTF-16 units`;
    if (selected(name)) await measure(name, operation);
  }
}

// Fragmentation is independent of the socket's packetization. Construct chunks
// once, then time transport delivery, framing, message decoding and validation.
const frameMessage = new Message();
const call = frameMessage.initRoot(RPCMessage)._initCall();
call.questionId = 123;
utils.initStruct(Bench_Write$Params._capnp.size, call._initParams().content);
const params = utils.getAs(Bench_Write$Params, call.params.content);
params._initData(64 * 1024).copyBuffer(new Uint8Array(64 * 1024).fill(0x5a));
const frame = Buffer.from(frameMessage.toArrayBuffer());
// Architectural experiment only: the fixture is an owned, immutable,
// single-segment frame. Public Message constructors retain their copy semantics.
assert.equal(frame.readUInt32LE(0), 0);
const segmentBytes = frame.readUInt32LE(4) * 8;
for (const borrowed of [false, true]) {
  const name = `64 KiB segment ${borrowed ? "borrowed view prototype" : "owned copy"}`;
  if (selected(name))
    await measure(name, () => {
      const view = borrowed
        ? new DataView(frame.buffer, frame.byteOffset + 8, segmentBytes)
        : new DataView(
            frame.buffer.slice(
              frame.byteOffset + 8,
              frame.byteOffset + 8 + segmentBytes,
            ),
          );
      return view.getUint32(0, true);
    });
}
for (const chunkSize of [frame.byteLength, 1024, 64]) {
  const name = `receive 64 KiB frame in ${chunkSize}-byte chunks`;
  if (!selected(name)) continue;
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < frame.byteLength; offset += chunkSize) {
    chunks.push(frame.subarray(offset, offset + chunkSize));
  }
  await measure(
    name,
    async () => {
      const stream = new PassThrough();
      const transport = transportFromDuplex(stream);
      try {
        const pending = transport.recvMessage();
        for (const chunk of chunks) stream.write(chunk);
        const result = await pending;
        assert.equal(result.call.questionId, 123);
        assert.equal(
          utils.getAs(Bench_Write$Params, result.call.params.content).data
            .length,
          64 * 1024,
        );
        return result.call.questionId;
      } finally {
        transport.close();
      }
    },
    true,
  );
}
