# Changelog

## 0.9.2

### Patch Changes

- 4cffac7: fix(dom): `provide` preserves the caller's `Effect` shape instead of narrowing to `Child`

  `provide` is a pure passthrough over `Effect.provideService` but its type
  signature was over-specific — it took `Child<E, R>` and returned
  `Child<E, Exclude<R, I>>`, so any `Element<A, E, R>` passed in got downgraded
  to a plain `Child<E, R>` on the way out. Real callers hit this: passing
  `ThemedButton({...})` (an `Element<HTMLButtonElement, E, R>`) came back as
  `Child<E, R>`, losing the button-element type for any downstream binding.

  Generalized to shape-preserving generic-over-`Effect`:

  ```ts
  provide<A, E, R, I, S>(
    tag: Context.Tag<I, S>,
    value: S,
    children: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, Exclude<R, I>>
  ```

  Element in → Element out. Child in → Child out. Matches how
  `Effect.provideService` itself is typed — a thin wrapper shouldn't add
  narrowing the wrapped operation doesn't have.

  Behaviour is unchanged (implementation is still
  `children.pipe(Effect.provideService(tag, value))`).

- Updated dependencies [4cffac7]
- Updated dependencies [f2b4ee0]
  - @stax-ui/core@0.7.0

## 0.9.1

### Patch Changes

- bc7978e: fix(dom): exit-side `_register` now runs in `removeSlot`'s calling fiber

  `forkSlotRemoval` used to place group resolution + `_register` inside
  its forked animation body. `Animation.parallel(N)` (and `sequence`)
  open each group's gate immediately and schedule
  `Effect.forkDaemon(sleep(0))` to fire `_done` if `pending === 0` on
  the next tick — the empty-group fast-path, so downstream sequence
  steps don't stall on animations that never arrive.

  The forked body and the fast-path daemon both wake on the next
  scheduler tick. When the group is created in a different fiber than
  the one that will register on it (e.g. the router outlet's
  `getTransitionForKey` creates the exit group in one fiber, and
  `reconcile`'s `removeSlot` dispatches `forkSlotRemoval` in another),
  the daemon frequently won the race: `_done` fired with `pending ===
0`, before `_register` had a chance to run. Downstream
  `Animation.awaitDone(exitGroup)` — the router's per-nav exit gate,
  custom `Router.scrollBehavior` fns waiting for the outgoing slot to
  finish leaving — resolved immediately instead of gating on the
  exit animation.

  The fix mirrors `forkSlotEnter`: resolve the group and call
  `_register` in the caller's fiber (`removeSlot`'s dispatch), then
  fork only the animation body. `pending` is >= 1 by the time
  `yield* forkSlotRemoval(...)` returns, so the fast-path check sees a
  non-zero count and doesn't misfire.

  Regression test in `slotAnimation.test.ts` asserts `pending >= 1`
  synchronously after the `yield*` — no sleep between, so the fast-
  path daemon can't have run.

## 0.9.0

### Minor Changes

- 1d15d1a: feat(dom): `AnimationOptions` gains `enterGroup` + `exitGroup` + `AnimationGroupRef`

  Existing `group` still applies to both enter and exit — new `enterGroup`
  and `exitGroup` narrow it per side. All three fields share one type,
  `AnimationGroupRef`:

  ```ts
  type AnimationGroupRef = AnimationGroup | Effect<AnimationGroup | undefined>;
  ```

  - A plain `AnimationGroup` — resolved once at animation-fire time.
    Typical when the caller creates the group (`Animation.sequence(3)`)
    and hands it in directly.
  - An `Effect<AnimationGroup | undefined>` — resolved fresh at
    animation-fire time. This is what lets a stable
    `AnimationConfigCtx` point at a group that rotates over time (e.g.
    the router's per-nav `OutletCtx.enter`, read through a `Ref`)
    without freezing at Ctx-provision time. `undefined` means "no
    group active for this fire" and falls through to the next override
    in the `enterGroup ?? group` chain.

  Resolution order at animation-fire time is `enterGroup ?? group` for
  enter, `exitGroup ?? group` for exit.

  Also fixes a latent oversight: exit animations previously called
  `runExitAnimation` without `_register`/`_complete`-ing on the group,
  so `Animation.awaitDone(exitGroup)` would resolve via the
  empty-group fast-path even while the exit was still running. Exit
  animations now register and complete on their resolved group the same
  way enter animations do — `awaitDone` gates on the actual exit
  lifecycle.

- 6faf6a5: feat(dom): `Element.scrollTo` combinator

  Piped-through scroll for an Effect resolving to `HTMLElement | Window`.
  Both shapes expose `scrollTo(options)` identically, so a single
  combinator covers both the "scrollable ancestor" and the
  window-scrolled-document case without callers branching on null:

  ```ts
  Router.scrollBehavior((from, to) =>
    Effect.gen(function* () {
      const outlet = yield* OutletCtx;
      yield* Animation.awaitDone(outlet.exit);
      yield* Element.scrollTo(outlet.scrollContainer, {
        top: 0,
        behavior: "instant",
      });
    }),
  );
  ```

  Data-first + data-last supported via `dual`. Returns the target for
  chaining. Effect-only — no overload for a raw `HTMLElement | Window`;
  combinators in this namespace uniformly operate on Effects.

  Pairs with `OutletCtx.scrollContainer` (new in `@stax-ui/router`),
  which resolves to the same `HTMLElement | Window` shape.

## 0.8.0

### Minor Changes

- a8e1a51: feat(dom): `Animation.awaitDone(group)` — public wait-for-completion primitive

  Wrapper around the internal `Deferred.await(g._done)` so downstream
  code can coordinate off a group's completion without dipping into
  underscore-prefixed internals. Resolves once every registered
  animation on the group has completed (or the empty-group fast-path
  has fired), and returns immediately if `_done` has already fired.

  Prime use cases:

  - A page component sequencing its own intro off a parent transition:

    ```ts
    const HomePage = () =>
      Effect.gen(function* () {
        const outlet = yield* OutletCtx;
        const [entrance] = yield* Animation.sequence(1, {
          group: outlet.transition,
        });
        // ...
      });
    ```

  - A custom `Router.scrollBehavior` fn that defers the scroll until the
    outlet's transition finishes:

    ```ts
    Router.scrollBehavior((from, to) =>
      Effect.gen(function* () {
        const outlet = yield* OutletCtx;
        yield* Animation.awaitDone(outlet.transition);
        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      }),
    );
    ```

## 0.7.1

### Patch Changes

- eb6df75: fix(dom): `Screen.match` delivers the live value to late `.changes` subscribers

  The initial hydration-safe `Screen.match` (0.6 release) emitted the
  post-hydration correction as a one-shot delta through `phase.changes`.
  Reconcile subscriptions attach via `Effect.forkScoped` (async) — if the
  forked fiber landed after `completeHydration` had already fired, the
  one-shot was gone and no live value was ever delivered. The DOM stayed
  on the SSR fallback branch until the user actually resized across the
  breakpoint.

  Seed the post-hydration correction from `phase.values` (which prepends
  the current phase on subscribe) with `Stream.take(1)`:

  - Subscribe before flip → current `true` is dropped by filter, wait for
    future `false`.
  - Subscribe after flip → current `false` passes filter immediately.
  - No hydration ever → subscribe sees `false` as current, emits
    `mql.matches` once (idempotent no-op — the seed value equals what
    `.get` just returned).

  The existing "emits on mql fires" test acknowledges the initial seed
  emission. New regression test fires `completeHydration` first, attaches
  a subscriber after, and asserts it still receives the live value.

## 0.7.0

### Minor Changes

- 1690c6d: fix(dom): `Animation.sequence` / `Animation.parallel` release their parent registration on scope close

  Previously, `Animation.sequence(N, { group: parent })` called
  `_register(parent)` synchronously and forked a daemon that awaited the
  last child's `_done` to fire `_complete(parent)`. If the enclosing
  scope tore down before that natural completion — for example a
  `when(condition, { onTrue: A, onFalse: B })` swap where each branch
  owned its own nested sub-sequence under the same `parent` — the losing
  branch's `_register` leaked forever. `parent.pending` never balanced,
  so every sibling downstream of `parent` in the sequence hung.

  Both `Animation.sequence` and `Animation.parallel` now install a scope
  finalizer alongside the natural-completion daemon. Whichever fires
  first — the child chain completing OR the enclosing scope closing —
  releases `parent`'s virtual registration exactly once (guarded by an
  internal `released` flag so the loser is a no-op). A `when` branch
  swap now cleanly releases the outgoing branch's registration when its
  slot scope closes, so the surviving branch's completion actually
  drives `parent._done`.

  ### API-visible change

  Overload set — no runtime break for existing callers, but the nested
  form now advertises Scope in its `R` channel:

  ```ts
  Animation.sequence(3); // Effect<AnimationGroup[]>
  Animation.sequence(3, { group: parent }); // Effect<AnimationGroup[], never, Scope>
  ```

  Element-shaped callers already run under a Scope, so this shows up
  only for standalone use.

## 0.6.0

### Minor Changes

- 904a41b: feat(dom): `Screen.match` is now hydration-safe by construction

  Using `Screen.match` on an SSR'd page could produce hydration mismatches:
  the server rendered the "SSR-safe" default (`initial ?? false`), but on
  the client `matchMedia` reads the real viewport immediately, so the
  first client render could render a different subtree than the SSR HTML
  already contained. `when`, `each`, and any other reactive control flow
  consuming a `Screen.match` result would then trip a hydration
  mismatch.

  `Screen.match` now gates on the renderer's hydration phase:

  - **SSR** (`StringRenderer`): `.get` returns `initial` — no `matchMedia`
    access, no observation of `hydrationPhase`.
  - **Client hydration** (`HydrationRenderer`): `.get` returns `initial`
    while the initial walk is in progress. Once `hydrate()` finishes and
    fires `completeHydration`, the `.changes` stream emits the live
    `matchMedia` value once, and reconcile swaps the DOM off the SSR
    fallback in a follow-up pass.
  - **Fresh client** (`DOMRenderer`, no SSR): the phase is `false` from
    the outset, so `.get` returns `matchMedia().matches` immediately and
    only `matchMedia` `change` events drive updates.

  `Screen.match`'s type is now
  `Effect<Readable<boolean>, never, RendererContext>` — call it with
  `yield*` (matching `Signal.make`'s shape). This is what lets it pull
  the current renderer's phase from context.

  ### Renderer interface change (`@stax-ui/core`)

  `Renderer.isHydrating: Effect<boolean>` is replaced with:

  - `Renderer.hydrationPhase: Readable<boolean>` — observably `true` while
    hydration is in progress, `false` otherwise
  - `Renderer.completeHydration: Effect<void>` — flips the phase to
    `false` and emits the transition to subscribers; no-op on the DOM
    and SSR renderers

  `hydrate()` awaits the initial `Effect.provide(element, context)`, then
  `yield*`s `renderer.completeHydration` before the `Effect.never` that
  keeps the scope alive.

  Only the internal DOMRenderer test consumed the removed `isHydrating`
  field — external Renderer implementations (if any) will need to swap
  the field.

### Patch Changes

- Updated dependencies [904a41b]
  - @stax-ui/core@0.6.0

## 0.5.1

### Patch Changes

- Updated dependencies [8a13e9b]
  - @stax-ui/core@0.5.0

## 0.5.0

### Minor Changes

- 6750110: feat(dom): add `Keyboard` module for declarative keyboard bindings

  Phase 1 of the a11y-primitives push. Ships a scoped, cross-platform
  keyboard-binding API that handles the load-bearing details users get
  wrong when writing ad-hoc: cleanup, cross-platform modifier
  mapping, and the "shortcut vs. typing in a text field" collision.

  ```ts
  import { Effect } from "effect";

  import { Keyboard } from "@stax-ui/dom";

  // Global — bound to `document`
  yield * Keyboard.on("mod+k", () => Effect.sync(() => paletteOpen.set(true)));

  // Element-local via ElementRef — auto (re)attaches on
  // mount/unmount, no manual bookkeeping.
  yield *
    Keyboard.on("Escape", () => Effect.sync(() => close()), {
      target: containerRef,
    });

  // Multiple bindings, one handler
  yield *
    Keyboard.on(["ArrowDown", "j"], moveDown, {
      target: containerRef,
    });
  ```

  ## What's in the module
  - **`Keyboard.on(binding, handler, options?)`** — Effect-scoped
    binding. Auto-cleanup on scope close.

  - **Handler type is `(KeyboardEvent) => Effect<void, never, never>`.**
    Deliberately does NOT accept plain `() => void` — plain-function
    handlers are exactly where uncaught exceptions and un-typed side
    effects sneak in. Wrap DOM writes in `Effect.sync` (small cost,
    big norm-shift toward error-typed code).

  - **Binding syntax.** `[modifier+]*key`. Modifiers: `mod`
    (platform-normalized — `meta` on macOS, `ctrl` elsewhere), `meta`,
    `ctrl`, `alt`, `shift`. Keys follow `KeyboardEvent.key` values,
    case-insensitive.

    One documented alias: `"Space"` (any casing) → `" "`. The literal
    `" "` also works because it's the canonical `KeyboardEvent.key`
    value — the alias exists only because `" "` is invisible in
    source and code-review-hostile.

  - **`parseBinding(string)`** — exported for callers building
    bindings dynamically. Returns `Effect<ParsedBinding,
KeyboardBindingError>`. `Keyboard.on` uses this internally with
    `Effect.orDie` so its E channel stays `never` — a bad binding
    string is a programmer bug, not a runtime failure a caller should
    handle. Dynamic-binding consumers can call `parseBinding` first
    and catch the typed error.

  - **Targets:** `"document"` (default), any `HTMLElement`, or an
    `ElementRef`. Ref targets subscribe to `isConnected` so the
    listener follows the element's mount lifecycle without manual
    bookkeeping.

  - **`preventDefault`** as `boolean | (KeyboardEvent) => boolean`.
    Omit for a smart default that skips preventDefault when the event
    target is an editable element (text `<input>`, `<textarea>`,
    contenteditable) — so global bindings like `"j"` for feed nav
    don't block typing in a search box.

  - **`stopPropagation`** off by default so a parent Keyboard binding
    for the same key still fires; opt in when a child scope should
    consume the event.

  - Named predicates exported alongside: `outsideInputs` (the
    default), `withModifier`, and the underlying `isEditableTarget`
    helper.

  ## Not shipped in this PR
  - `Keyboard.format` for rendering bindings as `⌘K` / `Ctrl+K` in
    UI. A display-side concern separate from binding; will land in a
    follow-up when we have a real widget consumer for it.
  - Multi-key sequences and chords.
  - Global shortcut registry / cheatsheet.

  ## Unlocks

  `Escape.on`, `RovingTabIndex`, and eventually the headless-widget
  `Dialog` all compose on top of this.

### Patch Changes

- b1f07e5: fix(dom): stop leaking DOM event listeners on component unmount

  `Element.on` and `Element.once` registered a scope finalizer that
  flipped an internal `isActive` flag but never called
  `removeEventListener` — the DOM listener stayed attached to the
  element forever after the enclosing scope closed. Every mount/unmount
  cycle (dialog, route change, list-item update) leaked one native
  listener per binding. Handlers didn't visibly fire because the
  `isActive` gate short-circuited them, but the leak was real and
  compounded.

  The bare `Element.addEventListener` was affected too: it was
  documented as "you must call `removeEventListener`" but the low-level
  `Renderer.addEventListener` didn't return a cleanup handle, so
  manual removal was structurally impossible.

  ## What changed
  - **`Renderer.addEventListener`** now returns `Effect<void, never,
Scope.Scope>` and accepts `AddEventListenerOptions`. Uses
    `Effect.acquireRelease` internally so the DOM listener is properly
    detached when the enclosing scope closes. The `options` param means
    `Element.once` can pass `{ once: true }` for correct native
    auto-remove-on-first-fire semantics.
  - **DOMRenderer / HydrationRenderer** updated to `acquireRelease`.
    `StringRenderer` stays `Effect.void` (SSR still no-ops).
  - **`Element.on` / `Element.once` / `Element.addEventListener`** drop
    their `isActive`-flag pattern. Cleanup is now handled uniformly by
    the scoped renderer contract.

  ## Audit

  Full sweep of `packages/dom/src/Element/core.ts` for similar
  resource-lifecycle bugs. Only the three event-listener call sites
  above were affected. Every other resource in the file (streams
  subscribed by `bindAttribute`, `bindClass`, `bindStyle`, `bindData`,
  `bindTextContent`) uses `Effect.forkIn(scope)` correctly.

  ## Tests

  Five new tests in `Element/events.test.ts` that dispatch events after
  the scope closes and verify the handler doesn't fire. These would
  have failed under the pre-fix code.

  ## Compatibility

  `core` gets a **minor** bump because the `Renderer` interface signature
  changed. Custom `Renderer` implementations (rare — meant for framework
  integrators) need to widen their `addEventListener` return to
  `Effect<void, never, Scope.Scope>` and accept the optional `options`
  param. The DOM package's own three renderers are updated in this PR.

- Updated dependencies [b1f07e5]
  - @stax-ui/core@0.4.0

## 0.4.0

### Minor Changes

- 36b1d20: BREAKING: unify `runApp` + `mount` into a single `mount` for SPA startup

  (Marked `minor` — Stax is still pre-1.0, so we're using minor bumps
  for breaking changes. Once we hit `1.0.0` this would be `major`.)

  `runApp` is removed. Its responsibilities — providing `SignalRegistry`,
  merging caller layers, keeping the fiber alive via `Effect.never`, and
  pumping into a Promise — fold into `mount`. The new signature mirrors
  `hydrate`, so the two SPA entry points read as parallel intents rather
  than two different plumbing shapes:

  ```ts
  // SPA
  mount(App(), root, { layers: Navigation.makeLayer(router) });

  // SSR + hydration
  hydrate(App(), root, { layers: Navigation.makeLayer(router) });
  ```

  ## Migration

  Before:

  ```ts
  import { mount, runApp } from "@stax-ui/dom";

  runApp(
    Effect.gen(function* () {
      yield* mount(App(), document.getElementById("root")!);
    }),
  );
  ```

  After:

  ```ts
  import { mount } from "@stax-ui/dom";

  mount(App(), document.getElementById("root")!);
  ```

  With a layer:

  ```ts
  // Before
  runApp(mount(App(), root), { layer: Navigation.makeLayer(router) });

  // After
  mount(App(), root, { layers: Navigation.makeLayer(router) });
  ```

  Note that `options.layer` (singular) becomes `options.layers` (plural),
  matching `hydrate`. Compose multiple layers with `Layer.merge` or
  `Layer.mergeAll` as before.

  ## Why

  Every SPA in-tree did the same `runApp(Effect.gen(function* () { yield*
mount(App(), root) }))` dance — an `Effect.gen` wrapper that did one
  thing. The two-function form pushed a plumbing decision on every user
  of `mount` (they always chose the same one) and made SPA startup read
  differently than SSR hydration for no gained expressive power.

  The returned Promise from `mount` never resolves — this is intentional
  and matches the previous behavior of `runApp`. Mount is a terminal
  operation; it stakes out the fiber that owns the page's reactive
  lifetime.

- 3065684: feat(dom): preserve concrete element types through control-flow and Boundary wrappers

  Every DOM control-flow wrapper (`when`, `match`, `each`, `matchOption`,
  `matchEither`, `redraw`, `animated`) and both `Boundary.error` /
  `Boundary.suspense` used to pin their return element type to
  `HTMLElement | SVGElement`. Now the element type flows through:

  ```ts
  // Before
  each(todos, {
    container: () => $.ul({}), // ← Element<HTMLUListElement>
    key: (t) => t.id,
    render: (t) => $.li({}, t.text),
  });
  // inferred: Element<HTMLElement | SVGElement, ...>  — widened

  // After
  // inferred: Element<HTMLUListElement, ...>  — preserved
  ```

  For `Boundary.error`, the type unifies across both branches, so a
  `try`+`catch` that both return `Element<HTMLDivElement>` come back as
  `Element<HTMLDivElement>` — no more cast at `mount(App(), root)` sites.

  ## How it works

  Each config interface gains a trailing `N extends DOMElement = DOMElement`
  type parameter with a default. Container factories are typed
  `() => Element<N, never, never>`, so N is inferred from the container's
  concrete return type. Child branches (`onTrue`, `onFalse`, `onSome`, ...)
  keep the wider `Element<DOMElement, ...>` type — children can be any DOM
  element, only the container's type matters for the wrapper's return.

  Boundaries are different: `Boundary.error` and `Boundary.suspense` share
  N across all their branches (try, catch, render, fallback), because any
  of them can be the actually-rendered element. Inference unifies them at
  the call site.

  ## Back-compat

  Additive. The new type parameter has a default, so:

  - Existing callers that don't specify a container still get the same
    `Element<DOMElement, ...>` return type — behavior unchanged.
  - `EachConfig<Item, Error, Deps>` and other config annotations keep
    resolving; N falls back to `DOMElement`.
  - No runtime change. The generated JS is identical to before.

  ## Why

  Every user of `each`, `when`, `Boundary.error`, etc. previously had to
  either accept `HTMLElement | SVGElement` at every boundary or drop
  `as Element.Element<HTMLDivElement>` casts to narrow it. The casts
  weren't hiding bugs — they were papering over an artificial widening
  in the wrapper signatures. Removing the widening removes the casts.

### Patch Changes

- 05f94f9: fix(dom): stringify boolean `data-*` / `aria-*` values instead of using HTML boolean-attribute semantics

  `applyAttribute` was treating every boolean value as an HTML
  boolean-attribute — `true` set an empty string, `false` skipped the
  attribute entirely. That's correct for `disabled` / `checked` /
  `hidden` / etc., but wrong for `data-*` and `aria-*`, where consumers
  (CSS selectors, JS reads, ARIA state) expect the literal strings
  `"true"` and `"false"`.

  Fix: static boolean values only follow HTML boolean-attribute
  semantics when the key is in the fixed `BOOLEAN_ATTRIBUTES` set
  (`disabled`, `checked`, `selected`, `required`, `readonly`,
  `multiple`, `hidden`, `open`, `autofocus`, `autoplay`, `controls`,
  `default`, `defer`, `ismap`, `loop`, `muted`, `novalidate`,
  `reversed`). Everything else stringifies via `String(value)`.

  Before:

  ```ts
  $.div({ "data-active": true }); // <div data-active="">
  $.div({ "data-active": false }); // <div>              — attribute missing
  ```

  After:

  ```ts
  $.div({ "data-active": true }); // <div data-active="true">
  $.div({ "data-active": false }); // <div data-active="false">
  ```

  Also lifts the `EventHandler` type to the top-level `@stax-ui/dom`
  export so users writing typed `onClick` / `onSubmit` / etc. handlers
  don't have to reach into subpath modules.

  Callers that were working around the boolean-stringify gap with
  `Readable.map(v => v ? "true" : "false")` can drop the map entirely:

  ```ts
  // Before
  "data-active": Readable.map(active, (a) => (a === file.filename ? "true" : "false"))

  // After
  "data-active": Readable.map(active, (a) => a === file.filename)
  ```

  The `Readable<boolean>` path already stringifies via
  `Core.bindAttribute` — this change makes the static-boolean path
  consistent with that.

- Updated dependencies [2644592]
  - @stax-ui/core@0.3.0

## 0.3.0

### Minor Changes

- db36abb: feat(dom): auto-complete empty animation groups + `Animation.skip`

  Fixes a stall in `Animation.sequence` when a group has no registered
  animations — the previous behavior held the sequence forever waiting
  on `_done` that never fired. The typical trigger: a
  viewport-conditional branch (mobile hides the desktop-only
  `animated()` block, so the group never gets a registration), or a
  reduced-motion / error path that opts out of a step.

  Two new pieces:

  **Auto-complete on gate open.** When a group's gate opens, if no
  animation registers by the next tick, `_done` fires automatically so
  downstream sequence steps can advance. Registrations arriving later —
  reactive controls, late-mounted children — still run their
  animations; they just don't gate downstream, matching the existing
  "late arrivals don't re-open the signal" contract.

  ```ts
  // On mobile, don't render the chips step at all. The sequence
  // still cascades through `chips` to `cta` because `chips` completes
  // automatically with nothing registered.
  const [logo, chips, cta] = yield * Animation.sequence(3);
  return (
    yield *
    $.div(
      {},
      StaxLogo({ group: logo, intro: true }),
      yield * isMobile.get ? $.of("") : ChipRow({ group: chips, intro: true }),
      CtaButton({ group: cta, intro: true }),
    )
  );
  ```

  **Explicit `Animation.skip(group)`.** Forces a group's `_done` to
  fire without waiting on any registered animations to finish — the
  escape hatch for cases where the element IS rendered but the
  sequence should advance anyway (a "skip intro" button,
  `prefers-reduced-motion` fast-path, error branches, custom
  orchestrator logic). Idempotent, safe to call multiple times.
  Doesn't cancel in-flight animation fibers; they run to completion,
  they just no longer gate anything downstream.

  ```ts
  const [logo, chips, cta] = yield * Animation.sequence(3);
  if (yield * isMobile.get) {
    yield * Animation.skip(chips);
  }
  ```

  Purely additive. Existing sequences with real animations behave
  identically — the completion path from `_complete` (registered
  animation finished) is unchanged.

- 5b11e9d: feat(dom): add `Screen` — reactive viewport, media queries, and display metrics

  New primitive for reading viewport-level state as `Readable`s that
  compose with the rest of the reactivity system (`when`, `Readable.map`,
  `animated.group`, etc). Mirrors the shape of the browser's `Screen`
  interface, with two pragmatic tweaks:

  1. `Screen.width` / `Screen.height` return `window.innerWidth` /
     `innerHeight` — the VIEWPORT dimensions, which is what
     responsive-design code actually wants. The physical/logical
     display metrics from `window.screen` live under `Screen.display.*`.

  2. Adds `Screen.match(query)` — a `Readable<boolean>` from any
     `matchMedia` query. Closes the gap between viewport-conditional
     JS branches and the rest of the reactivity system.

  ```ts
  import { Screen } from "@stax-ui/dom";

  // Reactive viewport (window.innerWidth, updates on resize)
  const w = Screen.width;

  // Media-query matching — the main API
  const isMobile = Screen.match("(max-width: 767px)");
  const reducedMotion = Screen.match("(prefers-reduced-motion: reduce)");
  const prefersDark = Screen.match("(prefers-color-scheme: dark)");

  // Physical display metrics under `.display`
  const dpi = Screen.display.width;
  const orientation = Screen.display.orientation;
  ```

  **SSR-safe by construction.** On the server there's no `window`, so
  every reactive value stays at a sensible default (`0` for dimensions,
  `false` for match, `{ type: "landscape-primary", angle: 0 }` for
  orientation). `Screen.match` accepts an `initial:` option to override
  the boolean default per-query — useful when your SSR bias is known
  (portfolio site → mobile-first, ops dashboard → desktop-first). More
  sophisticated request-aware SSR defaults will land later via a
  Layer-based mechanism (tracked in a separate design issue).

  **Scope-clean.** Each Readable's change stream attaches its DOM
  event listener when subscribed and removes it when the enclosing
  scope closes. No lingering listeners, no leaks across route
  navigations.

  **Docs guidance to keep in mind.** For purely visual differences
  (hide at mobile, different padding), CSS `@media` is strictly better
  than `Screen.match` — both branches ship in the HTML for crawlers,
  no flash, no JS. `Screen.match` is for cases where the JS branch is
  fundamentally different code paths: skipping an animation sequence
  branch, deciding whether to mount a heavy component, choosing between
  two computed layouts.

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

## 0.1.1

### Patch Changes

- 7bd0248: fix(dom): allow undefined/null/false and nested arrays in class values

  Widens `ClassItem` / `ClassValue` so a component can pass an optional
  `class?: ClassValue` prop straight through to `$.div({ class: [...] })`
  without a `?? ""` dance:

  ```ts
  export const Card = (props: { class?: ClassValue }) =>
    $.div({ class: ["rounded-lg border p-4", props.class] });
  ```

  Previously, the outer array position rejected `ClassValue | undefined`
  because `ClassItem` was only `string | Readable<string>` — no
  `undefined`, no nested arrays. `ClassItem` is now recursive and admits
  clsx-style falsy values:

  ```ts
  export type ClassItem =
    | string
    | undefined
    | null
    | false
    | Readable.Readable<string>
    | readonly ClassItem[];
  ```

  Runtime side: `applyClass` gains a small `flattenClassValue` helper
  that walks the tree once, strips `undefined | null | false | ""`, and
  produces a flat `(string | Readable<string>)[]`. Both the non-reactive
  fast path and the mixed-reactive per-item subscription path operate on
  that flat list, so nested arrays and falsy items behave end-to-end —
  including reactive items that live inside a nested branch.

  Purely additive: every previously-valid `class` value still typechecks
  and behaves the same.

## 0.1.0

Initial release. Renamed from the `@effex/*` scope.
