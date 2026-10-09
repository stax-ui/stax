---
"@stax-ui/dom": minor
"@stax-ui/platform": patch
---

fix(dom): `UniqueId` ids now line up between SSR and hydration (#173)

Before: `UniqueId.make` used a module-global counter. On the server it kept growing across requests in the same process (first SSR request → `panel-1`, tenth → `panel-23`); on the client the counter restarted from zero on each page load. So SSR'd ARIA references pointed at ids the client's hydration generated differently, silently breaking `aria-controls` / `aria-labelledby` / `aria-describedby` wiring, or triggering a hydration-mismatch warning on the `id` attribute.

Fix: add a per-render `IdGenerator` service (`Context.Tag`) and have `UniqueId.make` draw from it when it's in scope. The existing module-global counter stays as a fallback for callers that never pass through `mount` / `hydrate` / SSR (e.g. standalone tests, oddball embedding), so this is **not** a breaking change — SPA code that doesn't bother with the layer still gets sequential unique ids.

Entry points provide a fresh `IdGenerator` each:

- `mount(element, container, ...)` — one per app lifetime.
- `hydrate(element, container, ...)` — one per hydration call.
- `Platform.toHttpRoutes(router, ...)` — one per SSR request.
- `Platform.buildStaticSite(...)` — one per generated page.

Both server and client start from zero on the same tree, so ids match.

## New public API

```ts
import { IdGenerator, makeIdGeneratorLayer, UniqueId } from "@stax-ui/dom";

// Opt in manually (rare — entry points already do this):
yield* myProgram.pipe(Effect.provide(makeIdGeneratorLayer()));

// Access the service in a custom entry point:
const gen = yield* IdGenerator;
const id = yield* gen.next("widget");
```

`UniqueId.make(prefix?)` keeps its existing signature; its behavior change is purely "use the service when one's available."

## Tests

`UniqueId.test.ts` added. Covers:
- Counter restarts at 1 for a fresh `makeIdGeneratorLayer()`
- Two sequential renders with separate layers each start at 1 (SSR-isolation guarantee)
- Identical render orders produce identical id sequences (the SSR/hydrate contract)
- Fallback still produces unique ids when no layer is in scope (SPA backwards compat)
- `_reset` only affects the fallback counter, not scoped layers

Not part of this PR: an end-to-end integration test exercising `mount` + `hydrate` round-trip on a tree that uses `UniqueId.make` for ARIA relationships. The unit tests cover the mechanism; wiring is verified by inspection. Worth adding later with a Suspense-boundary variant, which is the one case most likely to desynchronize ids and should get special-case coverage.

Fixes #173.
