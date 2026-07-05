import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@mnutt\/capnp-es\/compiler$/,
        replacement: fileURLToPath(
          new URL("src/compiler/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@mnutt\/capnp-es$/,
        replacement: fileURLToPath(new URL("src/index.ts", import.meta.url)),
      },
    ],
  },
  test: {
    coverage: { include: ["src/**/*.ts"], exclude: ["src/capnp/*.*"] },
    testTimeout: 10_000,
  },
  plugins: [tsconfigPaths()],
});
