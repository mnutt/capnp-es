@0xaeb2a45dc1c8a9a1;

# Wire shapes from Sandstorm web-session.capnp and powerbox.capnp (Apache-2.0,
# Sandstorm Development Group). Separate type IDs: this is a benchmark fixture.
# https://www.apache.org/licenses/LICENSE-2.0
struct SessionParams {
  basePath @0 :Text;
  userAgent @1 :Text;
  acceptableLanguages @2 :List(Text);
}

struct Descriptor {
  tags @0 :List(Tag);
  quality @1 :MatchQuality = acceptable;
  struct Tag {
    id @0 :UInt64;
    value @1 :AnyPointer;
  }
  enum MatchQuality {
    acceptable @0;
    preferred @1;
    unacceptable @2;
  }
}

# Synthetic tag payload; no production data.
struct TagValue {
  title @0 :Text;
  permissions @1 :List(Bool);
}

# Synthetic RPCs isolate library costs without Sandstorm application logic.
interface Bench {
  ping @0 (sequence :UInt32) -> (sequence :UInt32);
  open @1 (params :SessionParams) -> (session :Bench);
  write @2 (data :Data) -> (size :UInt32);
  callback @3 (target :Bench, sequence :UInt32) -> (sequence :UInt32);
}
