---
"@stax-ui/platform": minor
"create-stax-ui": patch
---

feat(platform): split into `./client` and `./server` sub-entries so client bundles don't drag in Node built-ins

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
  toHttpRoutes,
  buildStaticSite,
  generateDocument,
  RedirectError,
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
