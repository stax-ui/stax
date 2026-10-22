---
"@stax-ui/core": minor
"@stax-ui/dom": minor
---

feat(core,dom): reactive `Boundary.error` catches subscription-path failures

Closes the loop on typed errors from Outlet (and any other long-running `reconcile` subscription — `each`, `when`, `match`, `redraw`, `animated`): a `Boundary.error` wrapping the subtree now catches failures that fire on subscription-driven syncs, not just the initial render.

### How it works

- **`ErrorBoundaryCtx`** (new) in `@stax-ui/core`. Context tag whose service exposes `report(cause)` + `clear`.
- **`reconcile`'s `safeSync`** reads the ambient `ErrorBoundaryCtx` via `Effect.serviceOption`. On failure it calls `report`. On success it calls `clear`. If no boundary is installed, both calls short-circuit and the historical "log + swallow" behavior stays — no change for existing callers.
- **`Boundary.error` in `@stax-ui/dom`** now:
  - Owns a `Signal<Option<Cause>>` reflecting the latest sync outcome.
  - Provides `ErrorBoundaryCtx` into its subtree.
  - Uses `matchOption` to swap between child and fallback based on the signal.
  - Pre-runs the initial render once so the signal is set synchronously before `matchOption`'s first evaluation; the mounted node is one-shot cached so a successful initial render isn't re-run.

### Semantics

- **Initial render fails** → fallback mounts (same as today).
- **Subscription-path failure in the subtree** → report fires → signal flips to `Some` → `matchOption` swaps to fallback.
- **Subsequent successful sync** → `clear` fires → signal flips to `None` → `matchOption` swaps back to the child (fresh mount, not the stale pre-render cache).
- **No boundary installed** → same behavior as today (log + swallow).

### New option

`Boundary.error(tryRender, catchRender, { catchDefects: boolean })`

- Default `false` — only typed `Effect.fail(...)` failures route to the fallback.
- `true` — defects (`Effect.die`, uncaught sync throws) also route to the fallback. For top-level app boundaries that want to catch runtime bugs too.

### Backward compatibility

Signature grew by one optional argument. Return type `R` now includes `ControlCtx` because the reactive swap uses `matchOption` internally. In practice every call site already has `ControlCtx` available (any component mounted via `mount` / `hydrate`), so this is a type-only change for most callers. The old non-reactive `Boundary.error` is unchanged in `@stax-ui/core` — the reactive upgrade is DOM-side only.
