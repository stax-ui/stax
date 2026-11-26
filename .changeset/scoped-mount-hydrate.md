---
"@stax-ui/dom": minor
---

Public `mountScoped` and `hydrateScoped` for test harnesses, Storybook,
and hot-reload.

### Why

`mount` ends in `Effect.never` and returns a Promise that never
resolves — correct for apps, no good for tests that need to tear a
tree down and run every finalizer. `hydrate` forked its fiber with
`Effect.runFork` and returned `Promise.resolve()` before the walk
finished, leaving tests racing on a `setTimeout(0)` to see the
hydrated DOM. The internal `_mountScoped` was already the right
shape, just not exported; there was no hydrate counterpart.

### What

- **`mountScoped(element, container)`** → `Effect<void, never, Scope>`.
  Provides the full client render stack to the element and inserts
  the node; closing the caller's scope runs the finalizer that pulls
  the node back out and tears down subscriptions. Promoted from
  the previously internal `_mountScoped`. `SignalRegistry` stays a
  caller responsibility — provide `SignalRegistry.Live` or a scoped
  test variant.
- **`hydrateScoped(element, container, options)`** →
  `Effect<void, never, Scope>`. Does the full hydration walk and
  `completeHydration`, then returns. Scope stays open so subscription
  fibers live; closing it tears them down. Same shape as
  `mountScoped`.
- **`hydrate`'s Promise now actually resolves after the walk**, not
  immediately. The returned-Promise-resolves-when-hydration-done
  contract matched the docstring but not the code until now.
  Subscription fibers still live past the resolve, backgrounded.

### Migration

None required for app-level `mount` / `hydrate` callers. The internal
`_mountScoped` export is gone — anyone hitting it through
`dist/` (not the public entry) should switch to `mountScoped`.
