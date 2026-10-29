import unjs from "eslint-config-unjs";

export default unjs({
  ignores: [
    "test/fixtures/*.*",
    "src/capnp/*.ts",
    "test/interop/cpp/build/**",
    "test/bench/cpp/build/**",
    "test/bench/*.bench.mjs",
    "test/bench/data/sandstorm/workloads.ts",
  ],
  rules: {
    "unicorn/prefer-code-point": 0,
    "unicorn/no-null": 0,
    "unicorn/prefer-spread": 0,
    "unicorn/no-instanceof-builtins": 0,
    "unicorn/numeric-separators-style": 0,
  },
});
