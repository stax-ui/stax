# Changelog

## 0.2.8

### Patch Changes

- 132a765: Add `injectProps` as the sanctioned provider entry point for
  `MergePropsCtx`, and reject multi-root injection at the type and
  runtime levels via a platform-neutral `SingleRoot` brand.

  ### Why

  `MergePropsCtx` targets a _single_ root — the first `$`-created
  element merges the props into its own attrs and clears the Tag for
  descendants. A fragment emits _many_ roots, so providing non-empty
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

- Updated dependencies [fca845a]
- Updated dependencies [132a765]
  - @stax-ui/core@0.9.0

## 0.2.7

### Patch Changes

- Updated dependencies [5b805f3]
  - @stax-ui/core@0.8.1

## 0.2.6

### Patch Changes

- Updated dependencies [0ed74c9]
- Updated dependencies [ab711af]
  - @stax-ui/core@0.8.0

## 0.2.5

### Patch Changes

- Updated dependencies [4cffac7]
- Updated dependencies [f2b4ee0]
  - @stax-ui/core@0.7.0

## 0.2.4

### Patch Changes

- Updated dependencies [904a41b]
  - @stax-ui/core@0.6.0

## 0.2.3

### Patch Changes

- Updated dependencies [8a13e9b]
  - @stax-ui/core@0.5.0

## 0.2.2

### Patch Changes

- Updated dependencies [b1f07e5]
  - @stax-ui/core@0.4.0

## 0.2.1

### Patch Changes

- Updated dependencies [2644592]
  - @stax-ui/core@0.3.0

## 0.2.0

### Minor Changes

- 4bc4315: chore: relicense from MIT to Mozilla Public License 2.0

  Stax is now distributed under [MPL 2.0](../LICENSE). Nothing about how
  you _use_ Stax changes — commercial and proprietary projects can
  continue to depend on it freely, at any license. What changes is what
  happens when someone _modifies_ Stax's own source files: those
  modifications must be released under MPL 2.0. In short:

  - **Depend on Stax** — any license, including proprietary. No change.
  - **Fork or patch Stax itself** — those source files, and any files
    that contain Covered Software, must be released under MPL 2.0.

  MPL 2.0 is file-level copyleft. It does not "infect" downstream apps
  the way GPL / AGPL do; the boundary is at the file, not at the linked
  program. Adobe, Cisco, and Mozilla itself ship products using
  MPL 2.0-licensed components without opening the enclosing code.

  The intent: guarantee that Stax stays open source in perpetuity, and
  that no single party — including the current maintainer — can take
  the framework closed and start charging for it. Combined with the
  project's inbound = outbound contribution model (contributors retain
  copyright and license their work under the project's license), a
  future relicensing to a closed-source arrangement is effectively
  impossible once multiple contributors are involved.

  Every package version published at `0.1.x` was released under MIT and
  remains MIT forever — irrevocable per license terms. This changeset
  covers the switch to MPL 2.0 for `0.2.0` and onward. If you have
  downstream code that depends on the MIT permissive terms for a
  particular reason, you can pin to a `0.1.x` version indefinitely; the
  tags remain on npm.

### Patch Changes

- Updated dependencies [4bc4315]
  - @stax-ui/core@0.2.0

## 0.1.0

Initial release. Renamed from the `@effex/*` scope.
