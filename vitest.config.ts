import { resolve } from "path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["packages/*/src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // Package aliases for cross-package imports
      "@stax-ui/core": resolve(__dirname, "packages/core/src/index.ts"),
      "@stax-ui/dom/server": resolve(
        __dirname,
        "packages/dom/src/server/index.ts",
      ),
      "@stax-ui/dom/hydrate": resolve(
        __dirname,
        "packages/dom/src/hydrate/index.ts",
      ),
      "@stax-ui/dom": resolve(__dirname, "packages/dom/src/index.ts"),
      "@stax-ui/router": resolve(__dirname, "packages/router/src/index.ts"),
      "@stax-ui/form": resolve(__dirname, "packages/form/src/index.ts"),
      "@stax-ui/platform/node-adapter/runtime": resolve(
        __dirname,
        "packages/platform/src/node-adapter-runtime.ts",
      ),
      "@stax-ui/platform/node-adapter": resolve(
        __dirname,
        "packages/platform/src/node-adapter.ts",
      ),
      "@stax-ui/platform": resolve(__dirname, "packages/platform/src/index.ts"),
    },
  },
});
