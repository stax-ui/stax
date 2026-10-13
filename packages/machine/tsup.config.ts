import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    stax: "src/stax.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  // Standalone entries — the `stax` subpath pulls in `@stax-ui/core`
  // and we don't want that chunk-shared into the main `index` entry
  // for consumers that only touch the runtime (or that bridge to a
  // non-Stax UI library via a future peer adapter).
  splitting: false,
  external: ["effect", "@stax-ui/core"],
});
