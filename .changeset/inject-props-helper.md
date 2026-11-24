---
"@stax-ui/core": minor
"@stax-ui/dom": minor
"@stax-ui/form": patch
---

Add `injectProps` as the sanctioned provider entry point for
`MergePropsCtx`, and reject multi-root injection at the type and
runtime levels via a platform-neutral `SingleRoot` brand.

### Why

`MergePropsCtx` targets a *single* root — the first `$`-created
element merges the props into its own attrs and clears the Tag for
descendants. A fragment emits *many* roots, so providing non-empty
ctx to one has no canonical adopter. Before this change, nothing at
either compile time or runtime warned about that shape; the
"transparent fragment" semantics introduced in the previous release
masked the problem by letting every direct child independently
consume, which is almost never what the author of the injection
intended (and conflicts with the one-root asChild convention).

### What

**`injectProps` (new, `@stax-ui/core`).** The sanctioned way to
provide `MergePropsCtx`. Dual-overload, data-first and pipeable:

```ts
import { injectProps } from "@stax-ui/core"; // re-exported from @stax-ui/dom

injectProps($.form(children), { onSubmit: handle });
children.pipe(injectProps({ onSubmit: handle }));
```

**`SingleRoot` brand (new, `@stax-ui/core`).** A nominal, phantom
brand carried on the Element's `A` channel. Backends intersect their
single-root factory outputs with `SingleRoot`
(`Element<HTMLDivElement & SingleRoot, …>` for `$.div`) and leave
multi-root factories unbranded (`Element<DocumentFragment, …>` for
`$.fragment`). `injectProps` constrains its target to
`A extends SingleRoot`, so a fragment-rooted Element — whether
written as `$.fragment(...)` directly or returned by a container
whose body is a fragment — is a **type error at the provider site**.

Core carries no DOM knowledge. The brand is defined abstractly and
each backend attaches it to its own node types, so a future native
backend can gate the same APIs without naming any DOM type. A
`SingleRootElement<N, E, R>` convenience alias (equivalent to
`Element<N & SingleRoot, E, R>`) is exported for hand-annotation.

Because the brand rides on `A` and Effect's inference threads `A`
through `yield*`, containers whose body yields a single-root element
preserve the brand automatically — no special plumbing in
`container`. Reading from the Tag is unchanged; the two-way
stability contract still holds, now via the helper on the provider
side and `yield* Effect.serviceOption(MergePropsCtx)` on the reader
side.

**Runtime guard in `$.fragment` (`@stax-ui/dom`).** Any direct
`Effect.provideService(..., MergePropsCtx, {nonempty})` that reaches
a `$.fragment` runtime-dies with a message pointing at `injectProps`.
An empty record (`{}`) still passes — that's the "a parent $-element
already consumed and cleared" case where the fragment is harmlessly a
no-op.

**`$`-factory return types (`@stax-ui/dom`).** `ElementFactory` and
`SVGElementFactory` now intersect their node types with `SingleRoot`.
This is backwards-compatible — `HTMLDivElement & SingleRoot` is
assignable to `HTMLDivElement` — but it does mean an element returned
from a factory now shows up as `HTMLDivElement & SingleRoot` in
hover types.

**`Form.provide` migration (`@stax-ui/form`).** `Form.provide` is now
documented as a context installer first: it creates live form state,
installs `FormCtx`, and makes `MergePropsCtx` ambient so the first
`$`-element inside picks up `onSubmit` / `action` / `method`. The
`A` channel is unconstrained — children can be a `$.form(...)`, any
other `$`-element, or an Effect that reads form state and returns a
non-element result (tests, non-rendering workflows). When children do
render a form-shaped element, the single-root merge is unchanged;
when they render a `$.fragment(...)` with non-empty form props, the
fragment's runtime guard still dies with a message pointing at
`injectProps`. The compile-time single-root guarantee lives on
`injectProps` directly.

### Migration

For most callers, nothing changes:

```ts
// Before
Effect.provideService($.form(children), MergePropsCtx, { onSubmit });
// After — recommended
injectProps($.form(children), { onSubmit });
```

The raw `Effect.provideService(..., MergePropsCtx, ...)` form stays
compilable — the Tag is public — but loses the compile-time
single-root constraint and will die at runtime if its target is a
fragment. Use `injectProps` unless you have a specific reason to
reach for the Tag directly.

Passing `Form.provide(cfg, $.fragment(...))` with non-empty form
props still fails — but now at runtime, inside the fragment's own
guard, with a message pointing at `injectProps`. Wrap the fragment
in a single root element (`$.div`, `$.span`, etc.) that owns the
injection; the fragment inside flattens its children into the
wrapper's DOM children. For a compile-time check, call `injectProps`
directly on the child element.

**Hand-annotated root types.** Authors who hand-annotate as
`Element<HTMLFormElement>` (plain, unbranded) will hit a type error
from `injectProps` — `HTMLFormElement` alone doesn't carry
`SingleRoot`. Fix either by removing the annotation (let inference
carry the brand from the `$`-factory) or by using the
`SingleRootElement<HTMLFormElement>` convenience alias.
