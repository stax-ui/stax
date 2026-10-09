# docs

## 0.0.48

### Patch Changes

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

- Updated dependencies [866f03d]
- Updated dependencies [b7bdf32]
- Updated dependencies [ce22fff]
- Updated dependencies [daaf84f]
- Updated dependencies [c89eed1]
- Updated dependencies [19f02e6]
  - @stax-ui/dom@0.10.0
  - @stax-ui/platform@0.6.0
  - @stax-ui/router@0.5.3

## 0.0.47

### Patch Changes

- Updated dependencies [4cffac7]
  - @stax-ui/dom@0.9.2
  - @stax-ui/router@0.5.2

## 0.0.46

### Patch Changes

- Updated dependencies [bc7978e]
  - @stax-ui/dom@0.9.1
  - @stax-ui/router@0.5.1

## 0.0.45

### Patch Changes

- Updated dependencies [1d15d1a]
- Updated dependencies [6faf6a5]
- Updated dependencies [1d15d1a]
  - @stax-ui/dom@0.9.0
  - @stax-ui/router@0.5.0
  - @stax-ui/platform@0.5.5

## 0.0.44

### Patch Changes

- Updated dependencies [a8e1a51]
- Updated dependencies [a8e1a51]
  - @stax-ui/dom@0.8.0
  - @stax-ui/router@0.4.0
  - @stax-ui/platform@0.5.4

## 0.0.43

### Patch Changes

- Updated dependencies [497a8af]
  - @stax-ui/router@0.3.6

## 0.0.42

### Patch Changes

- Updated dependencies [eb6df75]
  - @stax-ui/dom@0.7.1
  - @stax-ui/router@0.3.5

## 0.0.41

### Patch Changes

- Updated dependencies [1690c6d]
  - @stax-ui/dom@0.7.0
  - @stax-ui/platform@0.5.3
  - @stax-ui/router@0.3.4

## 0.0.40

### Patch Changes

- Updated dependencies [904a41b]
  - @stax-ui/dom@0.6.0
  - @stax-ui/router@0.3.3
  - @stax-ui/platform@0.5.2

## 0.0.39

### Patch Changes

- @stax-ui/dom@0.5.1
- @stax-ui/router@0.3.2

## 0.0.38

### Patch Changes

- Updated dependencies [6750110]
- Updated dependencies [b1f07e5]
- Updated dependencies [9142686]
  - @stax-ui/dom@0.5.0
  - @stax-ui/platform@0.5.1
  - @stax-ui/router@0.3.1

## 0.0.37

### Patch Changes

- Updated dependencies [36b1d20]
- Updated dependencies [3065684]
- Updated dependencies [05f94f9]
- Updated dependencies [c5fd56a]
  - @stax-ui/dom@0.4.0
  - @stax-ui/router@0.3.0
  - @stax-ui/platform@0.5.0

## 0.0.36

### Patch Changes

- Updated dependencies [db36abb]
- Updated dependencies [5b11e9d]
- Updated dependencies [2b59417]
  - @stax-ui/dom@0.3.0
  - @stax-ui/router@0.2.1
  - @stax-ui/platform@2.0.0

## 0.0.35

### Patch Changes

- Updated dependencies [4bc4315]
  - @stax-ui/dom@0.2.0
  - @stax-ui/router@0.2.0
  - @stax-ui/platform@1.0.0

## 0.0.34

### Patch Changes

- Updated dependencies [7bd0248]
  - @stax-ui/dom@0.1.1
  - @stax-ui/router@0.1.1

## 0.0.33

### Patch Changes

- Updated dependencies [ca78ae9]
- Updated dependencies [aa1dd5e]
- Updated dependencies [4c0c3c4]
  - @stax-ui/dom@1.5.0
  - @stax-ui/router@1.4.0
  - @stax-ui/platform@1.2.4

## 0.0.32

### Patch Changes

- Updated dependencies [30f2c32]
- Updated dependencies [567a41c]
  - @stax-ui/dom@1.4.8
  - @stax-ui/router@1.3.9

## 0.0.31

### Patch Changes

- Updated dependencies [2b57548]
  - @stax-ui/dom@1.4.7
  - @stax-ui/router@1.3.8

## 0.0.30

### Patch Changes

- Updated dependencies [49af20d]
  - @stax-ui/dom@1.4.6
  - @stax-ui/router@1.3.7

## 0.0.29

### Patch Changes

- Updated dependencies [6651e7e]
  - @stax-ui/router@1.3.6

## 0.0.28

### Patch Changes

- Updated dependencies [8e9426f]
  - @stax-ui/dom@1.4.5
  - @stax-ui/router@1.3.5

## 0.0.27

### Patch Changes

- Updated dependencies [ec2ad34]
  - @stax-ui/dom@1.4.4
  - @stax-ui/router@1.3.4

## 0.0.26

### Patch Changes

- Updated dependencies [236f4a0]
- Updated dependencies [6c2c574]
  - @stax-ui/dom@1.4.3
  - @stax-ui/router@1.3.3

## 0.0.25

### Patch Changes

- Updated dependencies [c4674a0]
  - @stax-ui/dom@1.4.2
  - @stax-ui/router@1.3.2

## 0.0.24

### Patch Changes

- Updated dependencies [e3e8157]
  - @stax-ui/dom@1.4.1
  - @stax-ui/platform@1.2.3
  - @stax-ui/router@1.3.1

## 0.0.23

### Patch Changes

- Updated dependencies [3d7598d]
  - @stax-ui/dom@1.4.0
  - @stax-ui/router@1.3.0

## 0.0.22

### Patch Changes

- Updated dependencies [1419b6e]
  - @stax-ui/dom@1.3.3
  - @stax-ui/router@1.2.10

## 0.0.21

### Patch Changes

- Updated dependencies [b1241f4]
  - @stax-ui/router@1.2.9

## 0.0.20

### Patch Changes

- Updated dependencies [932821b]
  - @stax-ui/router@1.2.8

## 0.0.19

### Patch Changes

- Updated dependencies [4f1f4fe]
  - @stax-ui/dom@1.3.2
  - @stax-ui/router@1.2.7

## 0.0.18

### Patch Changes

- Updated dependencies [8b07d3d]
- Updated dependencies [bed39a9]
- Updated dependencies [9ba649c]
  - @stax-ui/dom@1.3.1
  - @stax-ui/platform@1.2.2
  - @stax-ui/router@1.2.6

## 0.0.17

### Patch Changes

- Updated dependencies [d95a27a]
  - @stax-ui/dom@1.3.0
  - @stax-ui/router@1.2.5

## 0.0.16

### Patch Changes

- Updated dependencies [65c74ec]
  - @stax-ui/dom@1.2.2
  - @stax-ui/router@1.2.4

## 0.0.15

### Patch Changes

- Updated dependencies [2a730e7]
  - @stax-ui/dom@1.2.1
  - @stax-ui/router@1.2.3

## 0.0.14

### Patch Changes

- Updated dependencies [b650fd8]
- Updated dependencies [12654be]
- Updated dependencies [ee8a4d1]
- Updated dependencies [0dd6440]
- Updated dependencies [3c5da0c]
  - @stax-ui/dom@1.2.0
  - @stax-ui/router@1.2.2

## 0.0.13

### Patch Changes

- Updated dependencies [d153d3a]
- Updated dependencies [2e2670e]
  - @stax-ui/platform@1.2.1
  - @stax-ui/dom@1.1.1
  - @stax-ui/router@1.2.1

## 0.0.12

### Patch Changes

- Updated dependencies [9c3fb19]
  - @stax-ui/platform@1.2.0
  - @stax-ui/router@1.2.0

## 0.0.11

### Patch Changes

- Updated dependencies [5023cff]
  - @stax-ui/platform@1.1.0
  - @stax-ui/router@1.1.0
  - @stax-ui/dom@1.1.0

## 0.0.10

### Patch Changes

- Updated dependencies [5023cff]
  - @stax-ui/platform@1.1.0
  - @stax-ui/router@1.1.0
  - @stax-ui/dom@1.1.0

## 0.0.9

### Patch Changes

- Updated dependencies [5023cff]
  - @stax-ui/platform@2.0.0
  - @stax-ui/router@1.1.0
  - @stax-ui/dom@1.1.0

## 0.0.8

### Patch Changes

- Updated dependencies [5023cff]
  - @stax-ui/platform@2.0.0
  - @stax-ui/router@1.1.0
  - @stax-ui/dom@1.1.0

## 0.0.7

### Patch Changes

- Updated dependencies [5023cff]
  - @stax-ui/platform@2.0.0
  - @stax-ui/router@1.1.0
  - @stax-ui/dom@1.1.0

## 0.0.6

### Patch Changes

- Updated dependencies [5023cff]
  - @stax-ui/platform@2.0.0
  - @stax-ui/router@1.1.0
  - @stax-ui/dom@1.1.0

## 0.0.5

### Patch Changes

- Updated dependencies [5023cff]
  - @stax-ui/platform@2.0.0
  - @stax-ui/router@1.1.0
  - @stax-ui/dom@1.1.0

## 0.0.4

### Patch Changes

- Updated dependencies [5023cff]
  - @stax-ui/platform@2.0.0
  - @stax-ui/router@1.1.0
  - @stax-ui/dom@1.1.0

## 0.0.3

### Patch Changes

- Updated dependencies [5023cff]
  - @stax-ui/platform@2.0.0
  - @stax-ui/router@1.1.0
  - @stax-ui/dom@1.1.0

## 0.0.2

### Patch Changes

- Updated dependencies [5023cff]
  - @stax-ui/platform@2.0.0
  - @stax-ui/router@2.0.0
  - @stax-ui/dom@2.0.0
