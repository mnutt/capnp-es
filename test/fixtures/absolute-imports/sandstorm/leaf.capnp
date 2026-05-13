@0xb1a0e6d85fc9449d;

using Base = import "/sandstorm/base.capnp";

struct LeafConfig {
  backend @0 :Base.BackendConfig;
  backends @1 :List(Base.BackendConfig);
}

interface LeafApi {
  getBackend @0 () -> (backend :Base.BackendConfig);
  getConfig @1 () -> Base.BackendConfig;
}
