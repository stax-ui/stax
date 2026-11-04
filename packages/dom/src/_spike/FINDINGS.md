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

## Inference follow-up (2026-11-04)

Separate question added during the design pass
(`dev_notes/COMPONENT.md`, §1): can TypeScript infer every generic
of `component(impl)` so authors don't write type arguments?

### Verdict

**Yes, for four of the five slots** — `Props`, `A`, `Fails` (impl's
own E), and `Requires` (impl's own R) all infer with zero explicit
generics. Only `Provides` needs an explicit carrier, and that
carrier is a runtime Tag value, not a type argument.

The trick that unlocks `Fails` and `Requires`: declare impl's
`children` parameter as `Children<never, never>` instead of
`Children<E, R>`. Impl's return `E` and `R` channels then contain
*only* impl's own contributions — what it yielded via `Effect.fail`
and what services it read via `yield* SomeTag`. TS infers both
directly from the return type with no "diff" calculation.

The small lie at runtime: children at the actual call site DO have
E and R. Impl's body forwards them opaquely into inner factories
(`$.div({}, children)`), which don't care about the declared static
type. The ComponentFactory wrapper around impl's output
re-attaches the call-site children's E and R via
`ChildInputE<T[number]>` / `ChildInputR<T[number]>`, so the output
reports the correct composite type. `component()`'s runtime casts
the result at that boundary.

For `Provides`, the Tag-value trick: pass the Context.Tag as a
runtime argument to `component.makes(Tag)`. TS unifies `T` with the
Tag's type and extracts `Context.Tag.Identifier<T>` as the Provides
slot. Impl receives a curried `provide(service)` helper that wraps
closed-over children with `provideService` before returning
them — same `Children<never, never>` shape as the pure path, so
`Fails` and `Requires` still infer inside `makes` impls too.

### Shapes the author writes

```ts
// Pure leaf — no reads, no failures, no provides.
const Leaf = component((props: LeafProps, children) =>
  Effect.gen(function* () {
    return yield* $.span({}, children);
  }),
);
// → ComponentFactory<LeafProps, HTMLSpanElement, never, never, never>

// Context reader — Req inferred from yield* inside impl.
const Panel = component((props: PanelProps, children) =>
  Effect.gen(function* () {
    yield* CollapsibleRootCtx;
    return yield* $.div({}, children);
  }),
);
// → ComponentFactory<PanelProps, HTMLDivElement, never, CollapsibleRootCtx, never>

// Impl can fail — Fails inferred too.
const Guarded = component((props: GuardedProps, children) =>
  Effect.gen(function* () {
    if (bad) yield* Effect.fail(new GuardError());
    return yield* $.div({}, children);
  }),
);
// → ComponentFactory<GuardedProps, HTMLDivElement, GuardError, never, never>

// Provider — Tag value carries Prov; Fails/Req still inferred.
const Root = component.makes(CollapsibleRootCtx)(
  (props: RootProps, _c, provide) =>
    $.div({}, provide({ open: props.defaultOpen ?? false })),
);
// → ComponentFactory<RootProps, HTMLDivElement, never, never, CollapsibleRootCtx>
```

**Zero type arguments anywhere.** Props is annotated on the impl's
arg — unavoidable, intrinsic to the component having a prop
interface — but that's a value-level annotation, not a generic.

### Dead ends — what we tried first

Keeping these in the FINDINGS so the next reader doesn't retrace
them:

1. **`Element<A, E, Exclude<R, Prov> | Req>` return pattern** (the
   original proposal, inferring Req / Prov from the return
   structure). TS widens both to `unknown` because `Exclude<R, X>`
   and reverse-Exclude are opaque to the inference engine.
2. **`Element<A, E, R | SelfR>` return pattern.** Also widens SelfR
   to `unknown`: the actual return `Element<A, E, R | Ctx>` is
   contravariantly assignable to the expected `Element<A, E, R |
   SelfR>` for *any* SelfR, so TS has no evidence to narrow. A
   `SelfR = never` default makes pure leaves pass but any
   context-reading impl errors with "`R` could be instantiated with
   an arbitrary type unrelated to `R | Ctx`".
3. **Contextual typing from a declared const annotation** (`const
   Panel: ComponentFactory<...> = component(impl)`). TS resolves the
   RHS independently of the LHS annotation during generic inference,
   so Req still widens to `unknown`.
4. **Curried type-level carriers** (`component.requires<Ctx>()(impl)` /
   `.provides<Ctx>()()` / `.spec<{ requires, provides }>()()`).
   Worked, but each context-aware component still carried one
   explicit type argument. Superseded by the children-at-never
   discovery.

### What the current spike verifies

`componentUnified.spike.ts` under this directory, against stax's
real `Element`, `ComponentFactory`, `Effect`, and `Context.Tag`:

- Pure leaf with no reads.
- Context reader with one Ctx and with two Ctx (union inferred).
- Impl that can fail — E channel inferred into the output.
- Child at the call site carries its own E and R — unioned
  correctly into the output.
- Provider via `component.makes(Tag)`, with `provide(service)`
  wrapping children.
- Panel-inside-Root composition: Panel's Req cancels under Root's
  Prov down to Ambient.

All assertions are `Equals<RequirementsOf<CallResult>, Expected>` /
`Equals<FailuresOf<CallResult>, Expected>` / `Equals<SuccessOf<...>,
Expected>` — exact set equality, not just "compiles". Repo-wide
`tsc --noEmit` stays at ~6.5s.

### Where this leaves the design

This is a checkpoint, not a final decision — more design thoughts
to land. The direction captured: `component(impl)` is the one-call
form for everything that doesn't provide context;
`component.makes(Tag)(impl)` is the one-call form for providers.
See `dev_notes/COMPONENT.md`, §1 for the design-note write-up.
