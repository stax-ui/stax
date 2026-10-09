import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    client: "src/client.ts",
    server: "src/server.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  // Each entry builds standalone — no shared chunk. The shared-chunk
  // story means `client.js` imports from a chunk that also contains
  // `buildStaticSite`'s Node-dynamic-import, which triggers Vite
  // "externalized for browser compatibility" warnings in client
  // consumers even though the actual code path never runs. Standalone
  // entries cost some duplication but make the `./client` entry truly
  // browser-safe at build-graph time, not just at runtime.
  splitting: false,
  external: [
    "effect",
    "@stax-ui/core",
    "@stax-ui/dom",
    "@stax-ui/router",
    "@stax-ui/form",
    "@effect/platform",
    "@effect/platform-node",
  ],
});
