import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

import { nodeAdapter, staxPlatform } from "@stax-ui/vite-plugin";

export default defineConfig({
  plugins: [
    tailwindcss(),
    staxPlatform({
      app: "src/main.ts",
      client: "src/client.ts",
      adapter: nodeAdapter({
        port: 3002,
        // Vite bundles styles via `client.ts`'s `import "./styles.css"`
        // and injects CSS on client load — no top-level `<link>` tag.
        styles: [],
      }),
    }),
  ],
  build: {
    // See templates/ssr/vite.config.ts for context — this emits the
    // client entry as a real browser bundle at `dist/client.js`,
    // which the server's `document.scripts` references.
    rollupOptions: {
      input: "src/client.ts",
      output: {
        entryFileNames: "client.js",
      },
    },
  },
});
