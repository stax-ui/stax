import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

import { staxPlatform } from "@stax-ui/vite-plugin";

export default defineConfig({
  plugins: [tailwindcss(), staxPlatform({ entry: "src/vite-entry.ts" })],
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
