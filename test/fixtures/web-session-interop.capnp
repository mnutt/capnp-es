@0xdac2d161ba5d99e2;

using Ts = import "../../src/capnp/_capnp/ts.capnp";
$Ts.importPath("./capnp-runtime-shim.js");

interface UiSession {
  ping @0 () -> ();
}

interface ByteStream {
  write @0 (data :Data) -> ();
  done @1 () -> ();
}

interface WebSession extends(UiSession) {
  get @0 (path :Text, context :Context, ignoreBody :Bool) -> Response;
}

struct Context {
  responseStream @0 :ByteStream;
}

struct Response {
  union {
    content :group {
      statusCode @0 :UInt16;
      mimeType @1 :Text;

      body :union {
        bytes @2 :Data;
        stream @3 :ByteStream;
      }
    }

    noContent @4 :Void;
  }
}
