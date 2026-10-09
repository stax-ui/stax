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
    // at a stable name under `dist/`. The generated server bundle
    // references `/client.js` in its `document.scripts`, so the
    // client build has to publish at that exact name.
    rollupOptions: {
      input: "src/client.ts",
      output: {
        entryFileNames: "client.js",
      },
    },
  },
});
