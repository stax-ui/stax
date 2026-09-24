# Changelog

## 0.5.3

### Patch Changes

- Updated dependencies [866f03d]
  - @stax-ui/dom@0.9.3

## 0.5.2

### Patch Changes

- Updated dependencies [4cffac7]
- Updated dependencies [f2b4ee0]
- Updated dependencies [4cffac7]
  - @stax-ui/core@0.7.0
  - @stax-ui/dom@0.9.2

## 0.5.1

### Patch Changes

- Updated dependencies [bc7978e]
  - @stax-ui/dom@0.9.1

## 0.5.0

### Minor Changes

- 1d15d1a: feat(router): `OutletCtx` grows to `{ exit, enter, scrollContainer }`

  Per the follow-up flagged in #148 — replaces the single `transition`
  group with independent per-nav `exit` and `enter` `AnimationGroup`s,
  wired into the outlet's own slot animation via the new
  `AnimationConfigCtx.single.enterGroup` / `.exitGroup` group refs (see
  the `@stax-ui/dom` changeset), so `Animation.awaitDone(exit)` /
  `awaitDone(enter)` gate on the actual lifecycle rather than the
  empty-group fast-path. Plus a `scrollContainer` accessor that reuses
  `ScrollBehavior`'s walker so custom scroll behaviors don't have to
  re-implement it.

  ```ts
  // Scroll waits for the outlet's EXIT to complete
  Router.scrollBehavior((from, to) =>
    Effect.gen(function* () {
      const outlet = yield* OutletCtx;
      yield* Animation.awaitDone(outlet.exit);
      yield* Element.scrollTo(outlet.scrollContainer, {
        top: 0,
        left: 0,
        behavior: "instant",
      });
    }),
  );

  // Page's intro sequence waits for the outlet's ENTER to complete
  const HomePage = () =>
    Effect.gen(function* () {
      const outlet = yield* OutletCtx;
      yield* Animation.awaitDone(outlet.enter);
      const groups = yield* Animation.sequence(3);
      // ...
    });
  ```

  ### Details
  - `exit` and `enter` are **independent groups** — they run in parallel
    by default, matching the current outlet behavior. Sequence them
    yourself in code if you want a serial exit → enter timeline.
  - **Fresh per nav.** The pair is stored in a `SynchronizedRef` so all
    three callers — scroll subscription, slot renderer, and the ambient
    `AnimationConfigCtx` refs — atomically get the same handles for a
    given key. Current + previous entries are retained, so a late exit
    completion from the outgoing nav still resolves against the group
    it registered with, not the incoming nav's fresh pair.
  - **`scrollContainer` is an `Effect<HTMLElement | Window>`** — matches
    `AnimationHook`'s `Effect<HTMLElement>` shape and integrates with
    the `Element` combinators. Resolves at consumption time so it sees
    the post-mount container even if read during the initial render
    pass. When no scrollable HTML ancestor is found on the walk up, it
    falls back to `window` — both shapes expose `scrollTo(options)`
    identically, so callers pipe through `Element.scrollTo` without
    branching. Cached after the first successful walk. SVGs are
    excluded from the walk since they use `viewBox`, not CSS overflow,
    for their internal coordinate space.
  - Wiring uses the new `AnimationOptions.enterGroup` / `.exitGroup`
    `AnimationGroupRef` shape (see the `@stax-ui/dom` changeset) — the
    outlet's `AnimationConfigCtx` provision stays stable across the
    outlet's lifetime while the group pair rotates per nav via
    `Ref.get(transitionRef)`.

  ### Breaking change

  `OutletCtxService.transition` is **removed**. Migration is direct:

  ```diff
  - yield* Animation.awaitDone(outlet.transition);
  + yield* Animation.awaitDone(outlet.enter); // for post-enter intros
  + // or outlet.exit for pre-scroll gating
  ```

  If you had a single group that fired after both exit and enter
  completed, compose one manually:
  `Effect.all([awaitDone(outlet.exit), awaitDone(outlet.enter)])`.

  ### Also

  The `Outlet` type keeps its `Exclude<R, OutletCtx>` — page components
  that consume `OutletCtx` still don't force the outlet's caller to
  provide it themselves. `findScrollRoot` is exported from
  `ScrollBehavior.ts` (shared with `OutletCtx.scrollContainer`).

  Closes #148.

### Patch Changes

- Updated dependencies [1d15d1a]
- Updated dependencies [6faf6a5]
  - @stax-ui/dom@0.9.0

## 0.4.0

### Minor Changes

- a8e1a51: feat(router): `OutletCtx` — per-outlet coordination context

  Every route render is now provided with an `OutletCtx` service exposing
  the current nav's transition `AnimationGroup`. Route components can
  read it via `yield* OutletCtx` and sequence their own intro animations
  off the outer transition rather than racing with it:

  ```ts
  const HomePage = () =>
    Effect.gen(function* () {
      const outlet = yield* OutletCtx;
      const groups = yield* Animation.sequence(3, { group: outlet.transition });
      // groups[0]'s gate opens after the outlet transition's gate opens —
      // no more "first item of the intro fires simultaneously with the
      // outlet's own enter and looks like the beginning got dropped."
    });
  ```

  The transition group is **fresh per slot render** — a page component
  that mounts on a fresh nav gets a group scoped to its own mount cycle,
  so downstream sequencing behaves predictably across multiple
  navigations rather than being gated by a stale `_done` from a previous
  one. Backed by `Animation.sequence(1)`, so the empty-group fast-path
  resolves quickly when nothing registers — pages that don't opt into
  the coordination see no downside.

  A custom `Router.scrollBehavior` fn can consume `OutletCtx` the same
  way and use `Animation.awaitDone(outlet.transition)` to defer the
  scroll until the transition finishes:

  ```ts
  Router.scrollBehavior((from, to) =>
    Effect.gen(function* () {
      const outlet = yield* OutletCtx;
      yield* Animation.awaitDone(outlet.transition);
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }),
  );
  ```

  ### Type change

  `Outlet`'s return type now `Exclude<R, OutletCtx>` from the routes'
  requirement channel — the outlet provides `OutletCtx` internally, so
  callers of `Outlet` don't need to provide it themselves even when
  their routes consume it. No API break; existing users see no change.

  ### Not in this pass

  Auto-deferring the built-in `"top"` `scrollBehavior` to the outlet's
  transition needs the outlet's own enter/exit to register with the
  `OutletCtx.transition` group, which requires plumbing per-nav config
  into `AnimationConfigCtx` (currently read at `addSlot` time from the
  outer outlet scope, not per-slot). Custom scroll behaviors using the
  pattern above cover the use case in the meantime.

### Patch Changes

- Updated dependencies [a8e1a51]
  - @stax-ui/dom@0.8.0

## 0.3.6

### Patch Changes

- 497a8af: fix(router): `scrollBehavior: "top"` now targets the outlet's nearest scrollable ancestor

  `"top"` used to call `window.scrollTo(0, 0)` unconditionally, which
  only works when the document is the scroll root. Apps that scroll
  inside a nested `overflow-y: auto` container — the common `100vh` app
  shell shape — got no scroll reset on navigation, because
  `window.scrollTo` is a no-op there.

  The router now walks up from the Outlet's own container element and
  scrolls the first ancestor whose vertical overflow can actually
  scroll (`overflow-y: auto | scroll` AND `scrollHeight > clientHeight`).
  If the walk finds nothing scrollable — the classic
  document-is-the-scroller layout — it falls back to `window.scrollTo`,
  so existing window-scrolled apps keep behaving identically.

  The `scrollHeight > clientHeight` check matters: it skips wrappers
  that _declare_ scrolling but have no overflow at the moment. Without
  it, an outer shell with `overflow: auto` and a currently-short child
  would shadow the real page scroller further up the tree.

  For layouts where the auto-detected container picks wrong — say,
  multiple scroll roots and you want to reset a specific one — the
  existing custom `(from, to) => Effect` variant is the escape hatch;
  no new API surface added.

## 0.3.5

### Patch Changes

- Updated dependencies [eb6df75]
  - @stax-ui/dom@0.7.1

## 0.3.4

### Patch Changes

- Updated dependencies [1690c6d]
  - @stax-ui/dom@0.7.0

## 0.3.3

### Patch Changes

- Updated dependencies [904a41b]
  - @stax-ui/core@0.6.0
  - @stax-ui/dom@0.6.0

## 0.3.2

### Patch Changes

- Updated dependencies [8a13e9b]
  - @stax-ui/core@0.5.0
  - @stax-ui/dom@0.5.1

## 0.3.1

### Patch Changes

- Updated dependencies [6750110]
- Updated dependencies [b1f07e5]
  - @stax-ui/dom@0.5.0
  - @stax-ui/core@0.4.0

## 0.3.0

### Minor Changes

- c5fd56a: fix(router): preserve E and R through combinators; tighten Route.make's D

  Three closely-related fixes that eliminate silent `unknown` widening in
  downstream consumers of a router.

  ## `Router.layout` collapsed E and R to `unknown`

  The signature had unbound outer generics that shadowed the wrapper's
  own generics:

  ```ts
  export const layout =
    <E, R>(                                           // ← outer generics
      wrapper: <A extends DOMElement, E, R>(          // ← INNER E, R shadow outer
        children: Element<A, E, R>,
      ) => Element<HTMLElement, E, R>,
    ) =>
    <P, S, D, E2, R2>(router: Router<P, S, D, E2, R2>):
      Router<P, S, D, E | E2, R | R2>                 // ← uses OUTER E, R
  ```

  The wrapper's own `<A, E, R>` shadowed the outer `<E, R>`, so those
  outer generics never got bound to anything specific and fell back to
  `unknown`. Every downstream consumer of the resulting router had E
  and R silently widened to `unknown` — a `mount(App(), root)` call
  where App composes through the router would end up with `Element<...,
unknown, unknown>` and require casts.

  Fix: drop the bogus outer generics, take `LayoutWrapper` directly.
  Layouts are transparent to E/R by contract; the returned router's E
  and R are identical to the input's.

  ## `Route.make` hardcoded `D = unknown`

  Every newly-created route had `D = unknown` regardless of whether it
  had a data loader. When routes are aggregated via `Router.concat`, the
  D union `unknown | Foo | Bar` collapses to `unknown`, cascading into
  Outlet's requirements via `Router<..., D, E, R>` inference.

  Fix: `Route.make` now returns `Route<..., D = never, ...>`. A route
  without a loader has no data — `never` correctly captures that.
  `Route.data`, `Route.get`, `Route.static`, etc. widen D at the site
  they're added.

  ## `MetaArgs.data` typing follows suit

  `MetaArgs.data` was `D`, which — now that `Route.make` produces
  `D = never` — meant callers constructing MetaArgs for no-loader routes
  would have to cast just to write `data: undefined`. Made it
  conditional: `data: [D] extends [never] ? undefined : D`. No-loader
  routes see `data: undefined`; loader-having routes see the concrete
  data type.

  ## Small `LayoutWrapper` widening tidy

  The wrapper's return type was `Element<HTMLElement, E, R>` — pinned
  to `HTMLElement`. Widened to `Element<HTMLElement | SVGElement, E, R>`
  so SVG-wrapping layouts type-check. The wrapper's own outer element
  type isn't preserved — the caller decides what chrome to add.

  ## Test surface

  Route.test.ts had two `route.render(undefined)` calls that relied on
  the old `D = unknown` accepting anything. Updated to
  `route.render(undefined as never)` to match the new stricter typing
  (and added a note explaining the runtime-vs-type contract).

  ## Verified

  Compared inferred App type in router-demo before and after:

  - Before: `Element<HTMLElement | SVGElement, unknown, unknown>`
  - After: `Element<HTMLDivElement, never, Scope | RendererContext | NavigationContext | ControlCtx>`

  The remaining `HTMLDivElement` sharpening was already in flight via
  the DOM wrapper generics PR — this PR handles the router side of the
  same class of problem.

### Patch Changes

- Updated dependencies [36b1d20]
- Updated dependencies [3065684]
- Updated dependencies [2644592]
- Updated dependencies [05f94f9]
  - @stax-ui/dom@0.4.0
  - @stax-ui/core@0.3.0

## 0.2.1

### Patch Changes

- 2b59417: fix(router): exact route beats catch-all when both match the same URL

  `/docs/*` was scoring higher in `routeSpecificity` than `/docs`, so
  for the URL `/docs` the router preferred the catch-all route and
  handed rendering code a match with an empty `*` capture. Callers
  who set up an exact route alongside a sibling catch-all (a common
  docs-shell pattern — `/docs` for the index, `/docs/*` for individual
  pages) got the wrong render.

  Catch-all segments now contribute `-1` to specificity instead of
  `+1`. A static-only route always beats a same-length catch-all one
  when both match; a longer catch-all route still beats a shorter
  one that doesn't match at all.

  Purely additive behavior change — routes that don't have a sibling
  catch-all match the same URLs as before.

- Updated dependencies [db36abb]
- Updated dependencies [5b11e9d]
  - @stax-ui/dom@0.3.0

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
  - @stax-ui/dom@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [7bd0248]
  - @stax-ui/dom@0.1.1

## 0.1.0

Initial release. Renamed from the `@effex/*` scope.
