# Changelog

## 0.6.0

### Minor Changes

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

- c89eed1: feat: SSG adapter for the framework-owned server lifecycle (#169, PR 2)

  Second PR in the #169 series. Adds `ssgAdapter` alongside the Node adapter from PR 1 and migrates the in-repo docs app onto it. SSG users now get the same single-`src/main.ts` DX as SSR users.

  ## What's new

  **`@stax-ui/platform`:**

  - **`./ssg-adapter`** sub-entry exports `ssgAdapter(options)`.
  - **`./ssg-adapter/runtime`** sub-entry exports `runSsgBuild` — called from the generated SSG entry at build time to iterate static routes, fire synthetic GET requests at each, and write the response bodies as `index.html` files.
  - **Adapter contract expanded**: new `clientBuildOptions` field on `StaxAdapter` so adapters can describe their client-build preferences (`outDir`, `entryFileNames`, `manifest`). Node adapter asks for stable `client.js` at `dist/client/`; SSG adapter asks for hashed `assets/*.js` at `dist/` plus `.vite/manifest.json`. New `afterSsrBuild` hook lets adapters run post-build work (SSG dynamically imports the emitted entry so its top-level `await runSsgBuild(...)` executes).

  **`@stax-ui/vite-plugin`:**

  - Re-exports `ssgAdapter` so `import { staxPlatform, ssgAdapter } from "@stax-ui/vite-plugin"` works.
  - Plugin's build-config hook now reads `adapter.clientBuildOptions` instead of hardcoding Node-shaped defaults.
  - Plugin's `closeBundle` hook calls `adapter.afterSsrBuild` for the new shape (SSG uses this; Node leaves it undefined).
  - The `clientRelativeDir` the adapter receives is now computed from the adapter's own client outDir, not hardcoded.
  - Legacy `{ entry }` + `mode: "ssg"` codepath still works unchanged.

  ## What the user writes now (SSG)

  ```ts
  // src/main.ts (same shape as the SSR template)

  import { HttpRouter } from "@effect/platform";

  import { Platform, type AppOptions } from "@stax-ui/platform";

  import { App } from "./App.js";
  import { router } from "./routes.js";

  export { router }; // re-export so the SSG adapter can enumerate routes

  export const makeApp = (opts: AppOptions) =>
    HttpRouter.empty.pipe(
      HttpRouter.concat(
        Platform.toHttpRoutes(router, {
          app: App,
          document: {
            title: "My Docs",
            scripts: [...opts.scripts],
            styles: [...opts.styles],
          },
        }),
      ),
    );

  export const AppLayer = undefined; // or a real Layer
  ```

  ```ts
  // vite.config.ts

  import { defineConfig } from "vite";

  import { ssgAdapter, staxPlatform } from "@stax-ui/vite-plugin";

  export default defineConfig({
    plugins: [
      staxPlatform({
        app: "src/main.ts",
        client: "src/client.ts",
        adapter: ssgAdapter(),
      }),
    ],
  });
  ```

  ```json
  // package.json
  "dev": "vite",
  "build": "vite build && vite build --ssr",
  "preview": "vite preview"
  ```

  ## Docs app migration
  - `apps/docs/src/entry.ts` collapsed into `apps/docs/src/main.ts` with the shape above.
  - `apps/docs/index.html` deleted — SSG generates the full document.
  - `apps/docs/vite.config.ts` uses the new `{ app, client, adapter: ssgAdapter() }` shape.
  - `apps/docs/src/content.server.ts` updated to resolve `content/` from `process.cwd()` instead of an entry-location-relative path (the SSG bundle lives at a different depth now).

  ## Build layout

  ```
  dist/
  ├── index.html                 ← /
  ├── docs/
  │   ├── index.html             ← /docs
  │   ├── introduction/
  │   │   └── index.html         ← /docs/introduction
  │   └── ...
  ├── assets/
  │   ├── client-<hash>.js       ← Vite-hashed, references via manifest
  │   └── client-<hash>.css
  ├── .vite/
  │   └── manifest.json          ← SSG runtime reads this to find hashed URLs
  ├── 404.html                   ← router's fallback route
  └── server/                    ← SSG scratch bundle (not served)
  ```

  The whole `dist/` tree is deployable to any static file host.

  ## Verified end-to-end
  - `pnpm build` on the docs app: 41 pages generated (`/`, `/docs/*` for every discovered page, 404 page). Hashed asset URLs correctly resolved from `.vite/manifest.json` and injected into every `<link rel="stylesheet">` + `<script src>`.
  - `pnpm preview` serves the full site. Routes work with trailing slashes (static hosts handle clean-URL rewriting; this is a Vite-preview limitation, not a build issue).
  - Workspace `pnpm exec tsc --noEmit` clean, `pnpm exec vitest run` — 965 passed, 2 pre-existing skipped.

  ## Not in this PR
  - **Twitter example migration** — still deferred.
  - **Removal of legacy `entry` config + `mode: "ssg"` codepath** — one release out, same timeline as PR 1 noted.
  - **Portfolio migration** (external) — out of scope; user's call when to do it. 15 min of edits per [#169](https://github.com/stax-ui/stax/issues/169).

  Builds on #170 — stacked PR, target that branch.

### Patch Changes

- Updated dependencies [ce22fff]
- Updated dependencies [daaf84f]
- Updated dependencies [c89eed1]
- Updated dependencies [19f02e6]
  - @stax-ui/platform@0.6.0

## 0.5.1

### Patch Changes

- 9142686: fix: reclassify internal `@stax-ui/*` deps as regular deps (not peers)

  `@stax-ui/platform` previously declared `@stax-ui/dom` and
  `@stax-ui/router` as peer dependencies; `@stax-ui/vite-plugin`
  declared `@stax-ui/platform` as an optional peer. This tripped the
  changesets "peer dep out of range → major bump" rule every time
  `dom` (or anything downstream) got a minor bump, silently inflating
  `platform` and `vite-plugin` past 1.0 before Stax is genuinely ready
  to signal API stability.

  Reclassified both to regular `dependencies`. Consequences:

  - `platform` now installs `dom` and `router` alongside itself.
    Users who also install those directly get the same version deduped
    by pnpm/npm.
  - `vite-plugin` installs `platform` unconditionally instead of the
    optional-peer arrangement. The SSG-only dynamic import in
    `plugin.ts` still keeps platform out of the runtime graph for SPA
    builds, so the cost is a devDep install, not a bundle inflation.

  Also dropped the redundant `@stax-ui/core` direct dep from
  `platform`. Since `@stax-ui/dom` re-exports everything from core
  (`export * from "@stax-ui/core"`), platform can source the couple of
  core-native symbols it uses (`AsyncCache`, `RendererContext`, etc.)
  through dom's barrel. One fewer dep edge to maintain.

  Long-term, once we're planning a coordinated 1.0 across every
  `@stax-ui/*` package, the peer-dep model may make sense again — but
  by then we can also opt into a wider peer range that doesn't collide
  with pre-1.0 minor bumps.

- Updated dependencies [9142686]
  - @stax-ui/platform@0.5.1

## 0.5.0

### Patch Changes

- @stax-ui/platform@0.5.0

## 2.0.0

> **⚠ Published in error and deprecated on npm.** This version was
> released while the rest of the `@stax-ui/*` family was still at
> `0.x`, falsely implying API stability. Rewound to the `0.x` track
> starting with `0.4.0` — see the [version rewind PR][rewind] for
> the reasoning. Any consumer on `1.x` or `2.x` should downgrade to
> the latest `0.x`.
>
> [rewind]: https://github.com/stax-ui/stax/pull/125

### Patch Changes

- @stax-ui/platform@2.0.0

## 1.0.0

> **⚠ Published in error and deprecated on npm.** See the note on
> `2.0.0` above.

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

### Patch Changes

- Updated dependencies [4bc4315]
  - @stax-ui/platform@1.0.0

## 0.1.0

Initial release. Renamed from the `@effex/*` scope.
