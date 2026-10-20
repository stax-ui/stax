---
"@stax-ui/dom": minor
---

feat(dom): `Element.bindVisible` + animation-runtime fixes

### `Element.bindVisible`

New reactive show/hide binding for an element that stays mounted while hidden. Toggles the `hidden` attribute on a `Readable<boolean>` and runs enter/exit animations against the same `AnimationOptions` shape that `when` / `each` / `match` accept.

```ts
const open = yield* Signal.make(false);

yield* $.div({ class: "panel" }, ...content).pipe(
  Element.bindVisible(open, {
    animate: {
      enterFrom: "opacity-0 transition-opacity duration-150",
      enter: "!opacity-100",
      exit: "transition-opacity duration-150",
      exitTo: "!opacity-0",
    },
  }),
);
```

Fills the gap `when` / `each` / `match` leave open — they animate mounting and unmounting, which loses DOM state (scroll position, form values, focus returns) and prevents SEO indexing or find-in-page reveal of hidden content.

- **Writes `display: none !important` by default** alongside the `hidden` attribute so Tailwind's display utilities don't override `[hidden] { display: none }`. Opt out with `manageDisplay: false`.
- **`hidden="until-found"` support** via `hiddenValue: "until-found"`. When the browser's find-in-page reveals the element and fires `beforematch`, the consumer flips `visible` to `true`; `bindVisible` detects the already-removed `hidden` attribute and skips the enter animation.
- **SSR renders the attribute and style** so the markup is correct before hydration. Hydration adopts whatever's already there.
- **Interrupt handling.** Each change interrupts the previous animation fiber, so rapid toggles don't pile up. Combined with the `runAnimation` interrupt cleanup (below), mid-flight reverses leave the element clean.
- **`intro: true`** runs the enter animation on first mount when the initial value is `true` — same contract as `intro` on control-flow functions.

### `runAnimation` cleans up its own classes on interrupt

Fixes a latent class-leak: when an in-flight animation is interrupted (e.g. a rapid condition flip reverses a mid-exit animation), the next run inherits half-applied `enterFrom` / `enter` / `enterTo` / `exit` / `exitTo` classes and fights them. The lifecycle now tracks every class it adds or removes in a per-run `touched` set and strips them in an `Effect.ensuring` finalizer when the body didn't complete normally. Normal completions still leave `enterTo` on the element — the finalizer only fires on interrupt.

### `waitForAnimationEvent` uses `getAnimations()` where available

Three gaps in the historical event-plus-timeout path:

1. A descendant's `transitionend` bubbled and resolved the parent's wait early (hover color on a nested button under a `when`-animated parent).
2. The shortest property's `transitionend` won — `transition: opacity 150ms, transform 300ms` resolved after 150ms, leaving transform unfinished.
3. A declared-but-unchanging transition (hover rule the exit classes don't touch) emitted no event and waited out the full 5s timeout.

The wait now prefers `element.getAnimations()` when it's available: filters to animations whose effect target is the element itself, waits on `Promise.allSettled(a.finished)` so the longest-running wins, and resolves immediately to `"skip"` when no animations are running (no declared-but-unchanging stall). The event-plus-timeout path stays as a fallback for jsdom, with a `event.target === element` guard added so a bubbled descendant can't resolve the parent's wait there either.
