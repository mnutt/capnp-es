@0xf4a2775a3e2c4a81;

struct BackendConfig {
  label @0 :Text;
}

interface BackendApi {
  ping @0 (config :BackendConfig) -> ();
}
