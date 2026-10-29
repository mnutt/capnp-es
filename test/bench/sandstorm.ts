import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { bench, group, run, summary } from "mitata";
import { Message } from "capnp-es";
import {
  Descriptor,
  SessionParams,
  TagValue,
} from "./data/sandstorm/workloads";
import { loadNodeCapnp } from "./node-capnp";
import { measure, selected } from "./measure";

const native = loadNodeCapnp();
const schema = native.import(
  fileURLToPath(new URL("data/sandstorm/workloads.capnp", import.meta.url)),
);
type Codec = {
  encode: () => Uint8Array;
  decode: (data: Uint8Array) => unknown;
};
const workloads: { name: string; expected: unknown; es: Codec; nc: Codec }[] =
  [];
const params = {
  basePath: "https://grain.example.test/session",
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) Sandstorm benchmark",
  acceptableLanguages: ["en-US", "en", "fr"],
};
workloads.push({
  name: "session startup params (framed, unpacked)",
  expected: params,
  es: {
    encode() {
      const message = new Message();
      const root = message.initRoot(SessionParams);
      root.basePath = params.basePath;
      root.userAgent = params.userAgent;
      const languages = root._initAcceptableLanguages(
        params.acceptableLanguages.length,
      );
      for (const [i, value] of params.acceptableLanguages.entries())
        languages.set(i, value);
      return message.toUint8Array();
    },
    decode(data) {
      const root = new Message(data, false).getRoot(SessionParams);
      return {
        basePath: root.basePath,
        userAgent: root.userAgent,
        acceptableLanguages: [...root.acceptableLanguages],
      };
    },
  },
  nc: {
    encode: () => native.serialize(schema.SessionParams, params),
    decode: (data) => native.parse(schema.SessionParams, data),
  },
});

for (const count of [1, 16]) {
  const tags = Array.from({ length: count }, (_, i) => ({
    id: (0xf123456789abcdefn + BigInt(i)).toString(),
    value: {
      title: `Synthetic powerbox tag ${i}`,
      permissions: [true, false, true, false, true],
    },
  }));
  const expected = { tags };
  workloads.push({
    name: `powerbox descriptor: ${count} AnyPointer tags (framed, packed)`,
    expected,
    es: {
      encode() {
        const message = new Message();
        const root = message.initRoot(Descriptor);
        const list = root._initTags(count);
        for (const [i, input] of tags.entries()) {
          const tag = list.get(i);
          tag.id = BigInt(input.id);
          const value = new Message().initRoot(TagValue);
          value.title = input.value.title;
          const permissions = value._initPermissions(
            input.value.permissions.length,
          );
          for (const [j, v] of input.value.permissions.entries())
            permissions.set(j, v);
          tag.value = value;
        }
        return message.toPackedUint8Array();
      },
      decode(data) {
        const root = new Message(data, true).getRoot(Descriptor);
        return {
          tags: [...root.tags].map((tag) => {
            const pointer = tag.value;
            const value = new TagValue(pointer.segment, pointer.byteOffset);
            return {
              id: tag.id.toString(),
              value: {
                title: value.title,
                permissions: [...value.permissions],
              },
            };
          }),
        };
      },
    },
    nc: {
      encode: () =>
        native.serialize(
          schema.Descriptor,
          {
            tags: tags.map((tag) => ({
              id: tag.id,
              value: native.serialize(schema.TagValue, tag.value),
            })),
          },
          { packed: true },
        ),
      decode(data) {
        const root = native.parse(schema.Descriptor, data, { packed: true });
        return {
          tags: root.tags.map((tag: any) => ({
            id: String(tag.id),
            value: native.parse(schema.TagValue, tag.value),
          })),
        };
      },
    },
  });
}

let checks = 0;
for (const w of workloads) {
  const encodings = [w.es.encode(), w.nc.encode()];
  // Cross-decode both producers, checking nested values and full UInt64 IDs.
  for (const encoded of encodings) {
    for (const codec of [w.es, w.nc]) {
      assert.deepEqual(codec.decode(encoded), w.expected, w.name);
      checks++;
    }
  }
  // Both timed decoders receive exactly the same bytes, generated outside timing.
  const data = Buffer.from(encodings[1]);
  for (const operation of ["encode", "decode"] as const) {
    if (
      process.argv.includes("--measure") &&
      selected(`${w.name}: ${operation}`)
    ) {
      await measure(`${w.name}: ${operation}: capnp-es`, () =>
        operation === "encode" ? w.es.encode() : w.es.decode(data),
      );
      await measure(`${w.name}: ${operation}: node-capnp`, () =>
        operation === "encode" ? w.nc.encode() : w.nc.decode(data),
      );
    }
    group(`${w.name}: ${operation}`, () =>
      summary(() => {
        bench("capnp-es", () =>
          operation === "encode" ? w.es.encode() : w.es.decode(data),
        );
        bench("node-capnp", () =>
          operation === "encode" ? w.nc.encode() : w.nc.decode(data),
        );
      }),
    );
  }
}
console.log(`All ${checks} serialization cross-checks passed.`);
if (!process.argv.includes("--check") && !process.argv.includes("--measure"))
  await run();
