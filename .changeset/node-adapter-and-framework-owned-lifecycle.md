---
"@stax-ui/platform": minor
"@stax-ui/vite-plugin": minor
"create-stax-ui": patch
---

feat: Node adapter + framework-owned server lifecycle for SSR apps (#169)

Mirrors Next.js / SvelteKit / Astro — the framework owns both dev and prod HTTP server lifecycles. The user no longer writes `createServer` or `NodeRuntime.runMain` for the typical case.

## What's new

**`@stax-ui/platform`:**

- **`./node-adapter`** sub-entry exports `nodeAdapter(options)`, which produces an adapter the vite-plugin consumes at build time to synthesize a self-contained `dist/server/index.js`.
- **`./node-adapter/runtime`** sub-entry exports `serveStatic` (used by the generated server to serve `dist/client/`).
- **`AppOptions` type** exported from `@stax-ui/platform` for the user's `makeApp({ scripts, styles })` factory signature.
- **New `adapter.ts` module** describes the `StaxAdapter` contract (`SsrEntryContext`, `ssrEntryModule(ctx)`). Non-Node adapters (SSG, Vercel, Cloudflare, Deno) extend the same shape.

**`@stax-ui/vite-plugin`:**

- **New config shape** — pass `app` + `client` + `adapter` instead of `entry`:

  ```ts
  staxPlatform({
    app: "src/main.ts",
    client: "src/client.ts",
    adapter: nodeAdapter({ port: 3000 }),
  });
  ```

  Plugin owns composition in both dev and prod — in dev it SSR-loads the user's `main.ts`, calls `makeApp` with dev-shape URLs (`/src/client.ts`), and mounts via Vite middleware. In prod it contributes a virtual SSR entry that the adapter synthesizes into `dist/server/index.js`.
- **Re-exports `nodeAdapter`** so users can `import { staxPlatform, nodeAdapter } from "@stax-ui/vite-plugin"` without a second package.
- **Legacy `{ entry: "..." }` shape still works** with a dev-startup deprecation warning. SSG mode continues to use the legacy codepath for this release — SSG adapter follows in a separate PR per #169's plan.

**`create-stax-ui` SSR template:**

- Collapsed `src/vite-entry.ts` + `src/server.ts` + `src/serveStatic.ts` + `index.html` into a single **`src/main.ts`** exporting `makeApp(opts)` + optional `AppLayer`. One place to add API routes, middleware, and services.
- `package.json` scripts: `build` runs `vite build && vite build --ssr`, `serve` is literally `node dist/server/index.js`. No `tsx` dependency anymore.
- `vite.config.ts` uses the new config shape.

## What the user writes now

```ts
// src/main.ts
import { HttpRouter } from "@effect/platform";
import { Platform, type AppOptions } from "@stax-ui/platform";

import { App } from "./App.js";
import { router } from "./routes.js";

export const makeApp = (opts: AppOptions) =>
  HttpRouter.empty.pipe(
    HttpRouter.concat(
      Platform.toHttpRoutes(router, {
        app: App,
        document: {
          title: "Stax App",
          scripts: [...opts.scripts],
          styles: [...opts.styles],
        },
      }),
    ),
    // HttpRouter.concat(apiRoutes),      // API routes
    // HttpRouter.use(authMiddleware),    // Middleware
  );

export const AppLayer = undefined; // Or a real Layer for services
```

Full backend capability — API routes, middleware, Effect services via `AppLayer` — all composes inside `makeApp`. The adapter wraps and serves at runtime; it doesn't touch any of this.

## Verified end-to-end

- `pnpm dev` — Vite dev server, SSR'd pages via plugin middleware, HMR works.
- `pnpm build` — client bundle at `dist/client/client.js`, synthesized server at `dist/server/index.js`.
- `pnpm serve` — real Node HTTP server, SSR on routes, static file serving for `/client.js`, `/styles.css`, etc.

## Not in this PR (follow-ups)

- **SSG adapter** — `ssgAdapter()` with the same architecture. In-repo docs app migration lands with it.
- **Twitter example migration** — stays on legacy for now. Legacy codepath still works unchanged.
- **Full removal of legacy `entry` config** — deprecation warnings land here; actual removal is one minor release out.

Closes #169.
