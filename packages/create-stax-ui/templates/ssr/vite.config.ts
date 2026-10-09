import { defineConfig } from "vite";

import { nodeAdapter, staxPlatform } from "@stax-ui/vite-plugin";

export default defineConfig({
  plugins: [
    staxPlatform({
      app: "src/main.ts",
      client: "src/client.ts",
      adapter: nodeAdapter({ port: 3000 }),
    }),
  ],
  build: {
    // Build the client entry as a real browser bundle and emit it
    // at a stable name under `dist/`. Previously the template did
    // `vite build && vite build --ssr src/client.ts`, where the
    // second step emitted an SSR-targeted file (bare imports) that
    // browsers couldn't execute — the production page rendered via
    // SSR but never hydrated. `server.ts` references `/client.js`,
    // so emitting with that filename makes the two sides agree.
    rollupOptions: {
      input: "src/client.ts",
      output: {
        entryFileNames: "client.js",
      },
    },
  },
});
