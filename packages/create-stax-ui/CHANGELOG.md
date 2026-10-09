# Changelog

## 0.2.7

### Patch Changes

- ce22fff: feat: Node adapter + framework-owned server lifecycle for SSR apps (#169)

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

- daaf84f: feat(platform): split into `./client` and `./server` sub-entries so client bundles don't drag in Node built-ins

  `@stax-ui/platform`'s single `.` entry re-exported both `makeClientLayer` (browser-safe) and `buildStaticSite` / `toHttpRoutes` (Node-only — `node:fs/promises`, `node:path`). A client bundle importing `{ Platform }` pulled the whole surface in, producing Vite warnings:

  - `Module "fs/promises" has been externalized for browser compatibility`
  - `"join" is not exported by "__vite-browser-external"`

  And a ~315 kB client bundle for the hello-world SSR scaffold, mostly made of code that will never run in the browser.

  **New entry points:**

  ```ts
  // Client code (hydrate entries, browser bundles)

  import { makeClientLayer } from "@stax-ui/platform/client";
  // Server code (SSR entries, SSG build scripts)
  import {
    buildStaticSite,
    generateDocument,
    RedirectError,
    toHttpRoutes,
  } from "@stax-ui/platform/server";
  ```

  The `.` entry is preserved for backward compatibility — existing `import { Platform } from "@stax-ui/platform"` still works. New code should prefer the sub-entries.

  **Additional fix:** inside `buildStaticSite`, the `node:fs/promises` and `node:path` imports are now dynamic (`await import(...)`) rather than top-level. So even consumers of `.` get the Node code tree-shaken out of client bundles.

  **Build layout:** `tsup` with `splitting: false` so each entry builds standalone — no shared chunk that would cross-contaminate. Each sub-entry is strictly its own surface at build-graph time, not just at runtime.

  **Templates + examples updated:**

  - `packages/create-stax-ui/templates/ssr/`: `client.ts`, `server.ts`, `vite-entry.ts` now use the sub-entries.
  - `examples/twitter/`: same treatment across its four `@stax-ui/platform` consumer files.

  **Verified:** SSR template's production client bundle has zero `fs/promises` / `__vite-browser-external` references, and Vite's build output has zero externalization warnings. Full workspace typecheck clean, 965 tests pass.

  Fixes #163.

- 1e5fdbb: fix(create-stax-ui): SSR template's `pnpm build` now actually builds the server bundle

  The SSR template's build script was `"vite build"`, which only runs the client build and emits `dist/client/client.js`. Nothing produced `dist/server/index.js`, so `pnpm serve` (which runs `node dist/server/index.js`) would exit with "module not found" on a freshly-scaffolded project.

  The vite-plugin needs two invocations to emit both bundles — one for the client, one for `--ssr` which triggers the plugin's SSR config branch and bundles the virtual `virtual:@stax-ui/platform/ssr-entry` module into `dist/server/index.js`. Fixed by setting `"build": "vite build && vite build --ssr"`, matching the SSG template and the in-repo docs app.

  Verified end-to-end: fresh scaffold → `pnpm build` → both `dist/client/client.js` and `dist/server/index.js` emit → `pnpm serve` returns a hydratable SSR'd page at HTTP 200.

  Follow-up worth tracking separately: Vite 7's `builder.buildApp` API lets a plugin declare multiple environments and run both from a single `vite build`. Moving the client + SSR coordination inside `@stax-ui/vite-plugin` would let users drop back to `"vite build"`.

- bd41637: chore(create-stax-ui): remove dead files from the SSR template left over from the Node adapter migration

  The SSR template's Node adapter migration (#169) added `src/main.ts` and reshaped `vite.config.ts` around `staxPlatform({ app, client, adapter })`, but didn't remove the files the new shape replaces:

  - `src/vite-entry.ts` — the old dev-server SSR entry. The plugin now synthesizes the SSR entry via its virtual `virtual:@stax-ui/platform/ssr-entry` module from the `app` option, so a user-written entry is no longer needed.
  - `src/server.ts` — the old prod Node bootstrap. `nodeAdapter` generates `dist/server/index.js` and `pnpm serve` runs that directly.

  Neither file was referenced from anywhere in the template (`vite.config.ts` points at `src/main.ts` + `src/client.ts`; nothing imports the old files). Removing them shrinks the scaffolded project to the files the user actually edits.

  Also tightened a stale comment in `vite.config.ts` that still named `server.ts` as the thing referencing `/client.js` — the generated server bundle is what references it now.

  No API change. Users running `pnpm create stax-ui` get a cleaner starting tree with the same behavior.

- 56afa99: fix: SSR template production build now emits a working client bundle

  The `--ssr` template's `build` script was `vite build && vite build --ssr
src/client.ts`. The second step built the client entry **as SSR**, emitting
  `dist/client.js` with bare imports (`import { hydrate } from "@stax-ui/dom/hydrate"`,
  etc.) that browsers can't execute. `server.ts` references `/client.js`, so
  production pages SSR-rendered but never hydrated — no console error on the
  server side, just a non-interactive page.

  The template now builds `src/client.ts` as a real browser bundle at a stable
  `dist/client.js` filename:

  - `vite.config.ts` sets `build.rollupOptions.input = "src/client.ts"` and
    `output.entryFileNames = "client.js"`.
  - `package.json` build script is just `vite build`.

  Verified: production page hydrates, server's `document.scripts: ["/client.js"]`
  agrees with the emitted filename. `examples/twitter` got the same treatment.

  A longer-term fix — having `staxPlatform` own the client build config so the
  template doesn't have to — is tracked separately. This PR unblocks the
  immediate "scaffold doesn't work in production" case.

  Fixes #162.

## 0.2.0

### Minor Changes

- 4bc4315: chore: relicense from MIT to Mozilla Public License 2.0

  Stax is now distributed under [MPL 2.0](../LICENSE). Nothing about how
  you _use_ Stax changes — commercial and proprietary projects can
  continue to depend on it freely, at any license. What changes is what
  happens when someone _modifies_ Stax's own source files: those
  modifications must be released under MPL 2.0. In short:

  - **Depend on Stax** — any license, including proprietary. No change.
  - **Fork or patch Stax itself** — those source files, and any files
    that contain Covered Software, must be released under MPL 2.0.

  MPL 2.0 is file-level copyleft. It does not "infect" downstream apps
  the way GPL / AGPL do; the boundary is at the file, not at the linked
  program. Adobe, Cisco, and Mozilla itself ship products using
  MPL 2.0-licensed components without opening the enclosing code.

  The intent: guarantee that Stax stays open source in perpetuity, and
  that no single party — including the current maintainer — can take
  the framework closed and start charging for it. Combined with the
  project's inbound = outbound contribution model (contributors retain
  copyright and license their work under the project's license), a
  future relicensing to a closed-source arrangement is effectively
  impossible once multiple contributors are involved.

  Every package version published at `0.1.x` was released under MIT and
  remains MIT forever — irrevocable per license terms. This changeset
  covers the switch to MPL 2.0 for `0.2.0` and onward. If you have
  downstream code that depends on the MIT permissive terms for a
  particular reason, you can pin to a `0.1.x` version indefinitely; the
  tags remain on npm.

## 0.1.0

Initial release. Renamed from the `@effex/*` scope.
