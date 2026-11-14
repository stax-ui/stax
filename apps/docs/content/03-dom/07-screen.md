---
title: "Screen"
description: "Reactive viewport dimensions, media queries, and display metrics."
order: 7
---

# Screen

The `Screen` module in `@stax-ui/dom` exposes viewport-level state — window size, media-query matches, physical display metrics — as `Readable`s that compose with the rest of the reactivity system (`when`, `Readable.map`, `animated.group`, etc.). It mirrors the shape of the browser's `Screen` interface with two pragmatic tweaks:

1. `Screen.width` / `Screen.height` return `window.innerWidth` / `innerHeight` — the **viewport** dimensions, which is what responsive-design code actually wants. The physical/logical display metrics from `window.screen` live under `Screen.display.*`.
2. Adds `Screen.match(query)` — a `Readable<boolean>` from any `matchMedia` query.

```typescript
import { Screen } from "@stax-ui/dom";
```

## Media queries

`Screen.match(query, opts?)` is the primary API. It returns an `Effect<Readable<boolean>>` (it reads the renderer's hydration phase from context), which you unwrap with `yield*`. The resulting `Readable<boolean>` flips when the underlying media query's match state changes.

```typescript
const isMobile = yield* Screen.match("(max-width: 767px)");
const reducedMotion = yield* Screen.match("(prefers-reduced-motion: reduce)");
const prefersDark = yield* Screen.match("(prefers-color-scheme: dark)");
```

Use it wherever any other `Readable<boolean>` fits — as the condition on `when`, mapped through `Readable.map`, or passed as the `group` argument to an animated block:

```typescript
const Card = () =>
  Effect.gen(function* () {
    const isMobile = yield* Screen.match("(max-width: 767px)");
    return yield* $.div(
      when(isMobile, {
        onTrue: () => MobileCard(),
        onFalse: () => DesktopCard(),
      }),
    );
  });
```

### SSR defaults and hydration safety

On the server there's no `matchMedia`, so `Screen.match` returns `false` by default. Pass an `initial` option to bias the fallback per-query:

```typescript
// Portfolio site — expect mostly mobile visitors. Bias the SSR
// render toward mobile so most users don't see a hydration flash.
const isMobile = yield* Screen.match("(max-width: 767px)", { initial: true });
```

`Screen.match` is **hydration-safe by construction**. During SSR *and* while the client-side hydration walk is in progress, `.get` returns `initial` — matching the SSR HTML exactly, so hydration doesn't see a mismatch. Once hydration completes, `.changes` emits the live `matchMedia` value, and reconcile swaps the DOM to the real state in a single follow-up pass. The read is gated on the renderer's `hydrationPhase`, which is why the API returns an `Effect` rather than a bare `Readable` — this is what pulls the phase from context.

Request-aware SSR defaults (from `Sec-CH-UA-Mobile` client hints or a cookie) are a follow-up feature — for now, `initial` is a single-value bias.

### When to use `Screen.match` vs. CSS `@media`

`Screen.match` is a JS-level primitive, and it earns its keep only when the branch is fundamentally different code paths:

- Skipping an animation sequence branch on mobile.
- Deciding whether to mount a heavy component at all.
- Choosing between two computed layouts.

For purely visual differences — hide at mobile, different padding, swap an icon — CSS `@media` queries are strictly better. Both branches ship in the HTML for web crawlers, no hydration flash, no JS involvement for the initial paint. Reach for `Screen.match` only when the DOM you actually build differs, not when you're just styling the same DOM differently.

## Viewport dimensions

`Screen.width` and `Screen.height` are reactive `Readable<number>`s backed by `window.innerWidth` / `innerHeight`. They update on `resize`.

```typescript
// Display the viewport width live in a text node
yield* $.p(Readable.map(Screen.width, (w) => `${w}px wide`));
```

On SSR both return `0`.

Most responsive-design use cases don't need the numeric value — they need a boolean (is this bigger/smaller than a breakpoint?). Reach for `Screen.match` for breakpoint work; `Screen.width` / `Screen.height` are for cases where the pixel count itself matters (canvas sizing, virtual list windowing, etc.).

## Display metrics

`Screen.display.*` mirrors the standard `window.screen` properties reactively. These describe the physical/logical display — the monitor or device screen — not the viewport.

| Property | Underlying value |
|----------|------------------|
| `Screen.display.width` | `window.screen.width` |
| `Screen.display.height` | `window.screen.height` |
| `Screen.display.availWidth` | `window.screen.availWidth` (excluding OS chrome like the taskbar or dock) |
| `Screen.display.availHeight` | `window.screen.availHeight` |
| `Screen.display.colorDepth` | `window.screen.colorDepth` |
| `Screen.display.pixelDepth` | `window.screen.pixelDepth` |
| `Screen.display.orientation` | `{ type, angle }` snapshot of `window.screen.orientation`, updates on rotate |

All values are reactive `Readable`s. Change events fire on `resize` for the dimensions and on `screen.orientation.change` for `orientation`.

On SSR the numeric fields return `0` and orientation returns `{ type: "landscape-primary", angle: 0 }`.

## Cleanup

Every Readable in `Screen` attaches its DOM event listener when its `changes` stream is first subscribed to, and removes the listener when the enclosing scope closes. There's nothing to clean up manually — as long as the component using the Readable respects Stax's `Scope`, event listeners are automatically added and removed with the mount lifecycle.
