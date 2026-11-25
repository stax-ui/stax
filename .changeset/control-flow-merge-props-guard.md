---
"@stax-ui/core": patch
"@stax-ui/dom": patch
---

Extend the fragment-style `MergePropsCtx` guard to control-flow primitives.

### Why

`$.fragment` already runtime-dies when it sees a non-empty ambient
`MergePropsCtx` — a fragment emits many roots and has no canonical
single root for the injection to land on. The same multi-root problem
exists for `each`, `redraw`, and any control-flow primitive that
reconciles into more than one slot: every slot's first `$`-element
would merge the same props into its own attrs, silently.

`injectProps` already catches this at compile time — control-flow
primitives return `Element<unknown, …>` with no `SingleRoot` brand, so
they're rejected at the provider site. But the escape hatches — raw
`Effect.provideService(..., MergePropsCtx, …)` or a provider that
doesn't constrain its child to `SingleRoot` (like `Form.provide`) —
compile fine and would otherwise reach the control-flow slot machinery
with no runtime check.

### What

Added a guard in `reconcile` (the shared core of `when`, `match`,
`matchOption`, `matchEither`, `each`, and `redraw`). When a sync is
about to render more than one slot and the ambient `MergePropsCtx` is
non-empty, the reconcile dies with a message pointing at `injectProps`.

Single-slot primitives (`when`, `match`, `redraw`, and `each` whose
current value holds at most one item) pass through unchanged — exactly
one root exists to consume the injection, matching the `SingleRoot`
contract at that moment. The guard checks `targetKeys.length > 1`
per-sync, so an `each` that starts single-slot and transitions to
multi-slot fires on the transitioning sync, not the initial render.

### Migration

For callers using `injectProps(control, …)` — no change, already a
type error. For callers using raw `Effect.provideService(..., MergePropsCtx, …)`
to inject into an `each` or similar, the inject must now either land
on a single-root wrapper (`$.div(each(…))` and inject into the div) or
reach a specific slot by reading `MergePropsCtx` inside the render
callback. The sanctioned helper is `injectProps`; prefer it over the
raw tag whenever possible.
