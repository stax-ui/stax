import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

import { ssgAdapter, staxPlatform } from "@stax-ui/vite-plugin";

export default defineConfig({
  plugins: [
    tailwindcss(),
    staxPlatform({
      app: "src/main.ts",
      client: "src/client.ts",
      adapter: ssgAdapter(),
    }),
  ],
});
