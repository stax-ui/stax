---
"@stax-ui/platform": minor
"@stax-ui/vite-plugin": minor
"docs": patch
---

feat: SSG adapter for the framework-owned server lifecycle (#169, PR 2)

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

export { router };  // re-export so the SSG adapter can enumerate routes

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

export const AppLayer = undefined;  // or a real Layer
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
