---
title: "Vite Plugin"
description: "Dev server SSR, server-code stripping, and SSG build integration with @stax-ui/vite-plugin."
order: 3
---

# Vite Plugin

`@stax-ui/vite-plugin` provides three capabilities:

1. **SSR dev server** — intercepts requests in dev mode, renders pages with HMR
2. **Server-code stripping** — removes loader and handler bodies from client builds
3. **SSG build hook** — runs `buildStaticSite` after the SSR build completes

You only need this plugin when using `@stax-ui/platform` for SSR or SSG. Pure SPAs don't need it.

## Installation

```bash
pnpm add -D @stax-ui/vite-plugin
```

## Configuration

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import { staxPlatform } from "@stax-ui/vite-plugin";

export default defineConfig({
  plugins: [
    staxPlatform({
      entry: "src/entry.ts",
      mode: "ssr",  // or "ssg"
    }),
  ],
});
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `entry` | `string` | — | Path to the SSR/SSG entry module |
| `mode` | `"ssr" \| "ssg"` | `"ssr"` | Build mode |
| `include` | `RegExp` | `/\.(tsx?\|jsx?)$/` | Files to apply server-code stripping to |
| `exclude` | `RegExp` | — | Files to exclude from stripping |

## SSR Dev Server

When `entry` is provided and Vite is in dev mode, the plugin intercepts incoming requests and renders them through your entry module:

```typescript
// src/entry.ts (SSR mode)
import { HttpApp, HttpRouter } from "@effect/platform";
import { Platform } from "@stax-ui/platform";

import { App } from "./app.js";
import { router } from "./routes.js";

const staxRoutes = Platform.toHttpRoutes(router, {
  app: App,
  document: { title: "My App", scripts: ["/src/client.ts"] },
});

const httpApp = HttpRouter.empty.pipe(HttpRouter.concat(staxRoutes));
const handler = HttpApp.toWebHandler(httpApp);

export async function render(request: Request): Promise<Response> {
  return handler(request);
}
```

The entry must export a `render` function that takes a Web Request and returns a Web Response. The plugin:

1. Converts the incoming Node request to a Web Request
2. Calls your `render` function via `vite.ssrLoadModule` (with HMR)
3. Injects Vite's HMR client into HTML responses
4. Sends the response back to the browser

Static assets, Vite internal requests, and source files are passed through to Vite's normal middleware.

## Server-Code Stripping

In client builds, the plugin removes server-only code so it doesn't end up in the browser bundle:

| Source | Client build output |
|--------|-------------------|
| `Route.get(loader, render)` | `Route.get(null, render)` |
| `Route.post("key", handler)` | `Route.post("key", () => { throw new Error("server only"); })` |
| `Route.put("key", handler)` | Same as post |
| `Route.delete("key", handler)` | Same as post |
| `Route.static({ paths, load, render })` | `Route.render(() => (render)(undefined))` |

This means your loader functions can import server-only dependencies (database clients, filesystem, etc.) without worrying about them being bundled into the client. The plugin also removes import declarations that become unused after stripping.

Stripping only happens in **client builds** — SSR builds and dev mode keep the full code.

## SSG Build Hook

In SSG mode, the plugin runs `Platform.buildStaticSite` after the SSR build completes:

```typescript
staxPlatform({ mode: "ssg", entry: "src/entry.ts" })
```

The build sequence is:

1. `vite build` — client bundle (stripping applied, SSG hook skipped)
2. `vite build --ssr src/entry.ts` — SSR bundle (no stripping, SSG hook runs)

The hook imports the compiled SSR entry from the output directory and calls `buildStaticSite` with the exported `router`, `app`, `document`, and `layers`.

### SSG Entry Point

```typescript
// src/entry.ts (SSG mode)
import { App } from "./app.js";
import { router } from "./routes.js";

export { router };
export const app = App;
export const document = {
  title: "My Site",
  scripts: ["/assets/client.js"],
  styles: ["/assets/styles.css"],
};

// Optional: services needed by loaders at build time
export { layers } from "./services.js";
```

The entry can also export a `render` function for the dev server — both SSR and SSG entries work in dev mode.

## Build Scripts

### SSR

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build && vite build --ssr src/entry.ts",
    "start": "node dist/server.js"
  }
}
```

### SSG

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build && vite build --ssr src/entry.ts",
    "preview": "vite preview"
  }
}
```

Both modes use the same two-step build. The difference is what happens after: SSR deploys a server, SSG deploys static files.
