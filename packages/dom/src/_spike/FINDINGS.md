# ComponentFactory spike — findings

**Branch:** `spike/component-factory`
**Date:** 2026-10-31
**Prompt:** [`stax-primitives/dev_notes/upstream/STAX_COMPONENT.md`](../../../../../stax-primitives/dev_notes/upstream/STAX_COMPONENT.md), part 2 — "A generic factory type."

**Question the spike answers:**
> Does stacking `Exclude<ChildInputR<T[number]>, Prov> | Req` on top of
> `ChildInputE` / `ChildInputR`'s recursive-tuple inference trip TS2589
> ("excessively deep") in realistic component call sites?

## Verdict

**No.** The proposed `ComponentFactory<Props, A, Requires, Provides>`
shape, four overloads and all, compiles cleanly at the proposal's own
stress threshold (3-deep, 10+ mixed children) and at a doubled threshold
(5-deep, ~25 mixed children). Repo-wide `tsc --noEmit` stays at ~6.5s,
unchanged from before the spike — no sign of exponential cost from the
added `Exclude` / `|` work.

**Recommendation:** ship parts 2 and 3 together as the proposal planned.
No need to fall back to a forwarding-only type.

## What was tested

Three files, all under `packages/dom/src/_spike/`:

- **`componentFactory.spike.ts`** — defines the type exactly as the
  proposal spec'd (`WithProps` ∩ (`{} extends Props` ? `WithoutProps`
  : `unknown`)); declares fake `Root` (provides Ctx), `Panel` /
  `Trigger` (require Ctx), `Leaf` (pure), `Progress` (required prop);
  stress-calls at the proposal threshold *and* at 2x depth / 2x breadth.
- **`crossReq.spike.ts`** — isolates the "component with
  `Requires = X` carrying a child with `R = Y` for an unrelated `Y`"
  case, both variadic and forwarding, with R-channel assertions.
- **`baseline.spike.ts`** — same shapes against the stock `$.div`
  (`ElementFactory`), as a control.

The spike also makes type-level assertions with an `Equals<>` set-equality
helper. Not just "compiles" — "compiles and infers the exact R the
proposal promises".

## Headline results

| Check | Shape | Verdict |
|---|---|---|
| Proposal threshold (3-deep, 10+ mixed children, `Root` ⊃ `Panel` ⊃ nested array) | variadic | ✅ compiles, `R = Ambient` (Prov cleared) |
| Same, single-array (forwarding) | forwarding | ✅ compiles, `R = Ambient` |
| 5-deep, ~25 mixed children | variadic | ✅ compiles, `R = Ambient` |
| `{} extends Props` guard — `Progress({value})` ok, `Progress()` / `Progress("x")` type errors | both | ✅ |
| Panel outside Root — mounts to `R = never` must fail | — | ✅ `@ts-expect-error` lands |
| Panel inside Root — mounts to `R = never` must pass | — | ✅ |
| Panel's `Requires = CtxA` + child with `R = CtxB` (unrelated service) | variadic + forwarding | ✅ compiles, `R = Ambient \| CtxA \| CtxB` |

Where `Ambient = Scope.Scope | RendererContext` — the services every
`Element` always carries in its R channel. The spike's assertions
account for them explicitly so the equality checks are exact.

## Notes for the implementation

- **DOM-global `Element` collision.** TypeScript's own `interface
  Element` is a 0-arg type in the DOM lib; when the spike wrote
  `Element<A, E, R>` directly inside the interface body, TS resolved to
  the global and the constraint reported was the wrong one. Importing
  stax's `Element` under an alias (`StaxElement`) fixed it. The
  landed implementation will want the same alias trick inside
  `ComponentFactory`'s definition, or to use a disambiguating import.
- **`Element`'s type parameter `A`.** The current
  `packages/dom/src/Element/types.ts` constrains it to `HTMLElement |
  SVGElement | DocumentFragment`. The namespace variant in
  `packages/dom/src/index.ts` constrains it to `HTMLElement |
  SVGElement`. Use the broader one in `ComponentFactory`'s own
  constraint so DocumentFragment-returning components stay reachable.
- **Variadic-tuple inference cost.** `tsc --noEmit` repo-wide ran in
  about 6.5s before and after the spike. Not a benchmark, but no
  signal of pathological inference.

## What a shipping implementation looks like

The forwarding-overload fallback is confirmed working, so even in the
unlikely event a future stress case reveals a limit at some depth we
can downgrade to forwarding-only without a protocol change — the
runtime side (`component()`) and `splitArgs` are identical in either
case.

## Reproducing

- `cd /Users/jon/projects/stax`
- `git checkout spike/component-factory`
- `pnpm typecheck` — should exit 0.
- Try breaking things: comment out a `@ts-expect-error`, flip an
  `Equals<>` target, drop a `Root(...)` wrapper around a `Panel`. The
  file is set up so each assertion is one line and easy to perturb.
