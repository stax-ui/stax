/**
 * Reactive viewport, media-query, and display primitives.
 *
 * Mirrors the shape of the browser's `Screen` interface but with two
 * pragmatic deviations:
 *
 * 1. `Screen.width` / `Screen.height` return `window.innerWidth` /
 *    `window.innerHeight` — the VIEWPORT dimensions, which is what
 *    responsive-design code actually wants. The physical/logical
 *    display metrics from `window.screen` live under `Screen.display`.
 *
 * 2. Adds `Screen.match(query)` — a `Readable<boolean>` from any
 *    matchMedia query, which is the primitive that closes the gap
 *    between viewport-conditional JS branches and the rest of the
 *    reactivity system (`when`, `Readable.map`, etc.).
 *
 * SSR-safe by construction: on the server there's no `window`, so
 * every reactive value stays at a sensible default (`0` for
 * dimensions, `false` for match, or a caller-provided `initial`).
 * On the client, each Readable subscribes to the appropriate event
 * (`resize`, `matchMedia.change`, `orientationchange`) when its
 * `changes` stream is consumed and cleans up when the enclosing
 * scope closes.
 *
 * @example Feature-detecting mobile inside a component:
 * ```ts
 * const Card = () =>
 *   Effect.gen(function* () {
 *     const isMobile = Screen.match("(max-width: 767px)");
 *     return yield* $.div(
 *       {},
 *       when(isMobile, {
 *         onTrue: () => MobileCard(),
 *         onFalse: () => DesktopCard(),
 *       }),
 *     );
 *   });
 * ```
 *
 * @example Reading the viewport width reactively:
 * ```ts
 * yield* $.p(Readable.map(Screen.width, (w) => `${w}px wide`))
 * ```
 */

import { Effect, Stream } from "effect";

import { Readable, RendererContext } from "@stax-ui/core";

const isBrowser = typeof window !== "undefined";

/**
 * Build a `Readable` backed by a DOM event on a specified target.
 * `read` is called synchronously to produce the current value; the
 * change stream re-runs `read` on every fired event. SSR-safe — the
 * `get` side returns `ssrDefault` when `window` is absent, and the
 * change stream is empty (no listener attached).
 */
const fromEvent = <A>(
  read: () => A,
  eventTarget: () => EventTarget,
  eventName: string,
  ssrDefault: A,
): Readable.Readable<A> =>
  Readable.make(
    Effect.sync(() => (isBrowser ? read() : ssrDefault)),
    () =>
      Stream.async<A>((emit) => {
        if (!isBrowser) return;
        const target = eventTarget();
        const handler = () => {
          emit.single(read());
        };
        target.addEventListener(eventName, handler);
        return Effect.sync(() => {
          target.removeEventListener(eventName, handler);
        });
      }),
  );

// ─── Viewport ────────────────────────────────────────────────────────

/**
 * Reactive `window.innerWidth`. Updates on `resize`.
 * Returns 0 on SSR.
 */
export const width: Readable.Readable<number> = fromEvent(
  () => window.innerWidth,
  () => window,
  "resize",
  0,
);

/**
 * Reactive `window.innerHeight`. Updates on `resize`.
 * Returns 0 on SSR.
 */
export const height: Readable.Readable<number> = fromEvent(
  () => window.innerHeight,
  () => window,
  "resize",
  0,
);

// ─── Media query matching ────────────────────────────────────────────

/**
 * Options for {@link match}.
 */
export interface MatchOptions {
  /**
   * Value returned on SSR when there's no `matchMedia` available.
   * Defaults to `false`.
   *
   * If you know your app has a strong bias — a portfolio site that
   * expects mostly mobile visitors, or a dashboard that's almost
   * always desktop — bias this to reduce hydration flash on the
   * majority case. For more sophisticated request-aware SSR
   * defaults, see the follow-up Layer-based mechanism (tracked in
   * a separate issue).
   */
  readonly initial?: boolean;
}

/**
 * A reactive `Readable<boolean>` from any `matchMedia` query. Updates
 * when the query's match state changes (viewport crossing the
 * breakpoint, orientation change, theme preference flip, etc.).
 *
 * **Hydration-safe.** During SSR and while client-side hydration is in
 * progress, `.get` returns `options.initial ?? false` — matching what
 * the server rendered, so the client's first walk hydrates the SSR HTML
 * without a mismatch. Once hydration completes, `.changes` emits the
 * live `matchMedia` value, so reconcile swaps the DOM to the real state
 * in a single follow-up pass.
 *
 * Reads the renderer's `hydrationPhase` from `RendererContext`, so the
 * result is `Effect<Readable<boolean>>` — call it with `yield*`.
 *
 * @example Breakpoint matching:
 * ```ts
 * const isMobile = yield* Screen.match("(max-width: 767px)", { initial: true });
 * ```
 *
 * @example Accessibility hooks — respect reduced-motion preference:
 * ```ts
 * const reducedMotion = yield* Screen.match("(prefers-reduced-motion: reduce)");
 * ```
 *
 * @example Theme preference:
 * ```ts
 * const prefersDark = yield* Screen.match("(prefers-color-scheme: dark)");
 * ```
 */
export const match = (
  query: string,
  options: MatchOptions = {},
): Effect.Effect<Readable.Readable<boolean>, never, RendererContext> =>
  Effect.gen(function* () {
    const initial = options.initial ?? false;
    const renderer = yield* RendererContext;
    const phase = renderer.hydrationPhase;

    return Readable.make(
      Effect.gen(function* () {
        if (!isBrowser) return initial;
        const hydrating = yield* phase.get;
        if (hydrating) return initial;
        return window.matchMedia(query).matches;
      }),
      () => {
        if (!isBrowser) return Stream.empty;
        const mql = window.matchMedia(query);

        // Live matchMedia change events.
        const mqlEvents = Stream.async<boolean>((emit) => {
          const handler = (event: MediaQueryListEvent) => {
            emit.single(event.matches);
          };
          mql.addEventListener("change", handler);
          return Effect.sync(() => {
            mql.removeEventListener("change", handler);
          });
        });

        // Post-hydration seed: as soon as this subscriber is past
        // hydration — either because it observes the flip, or because
        // it discovers the phase is already false when it attaches —
        // emit the live `matchMedia` value once so reconcile can swap
        // the DOM off the SSR fallback.
        //
        // We subscribe to `.values` (not `.changes`) so a subscriber
        // that races past `completeHydration` still sees `false` as
        // the current value on subscribe rather than missing the
        // one-shot transition; `Stream.take(1)` limits it to that one
        // corrective emission.
        //
        // On a fresh (non-hydrating) client, `.values` immediately
        // emits `false`, this fires once with `mql.matches`, and
        // reconcile sees the same value it just read from `.get` — an
        // idempotent no-op, not a wasted DOM update.
        const postHydrationSeed = phase.values.pipe(
          Stream.filter((hydrating) => !hydrating),
          Stream.take(1),
          Stream.map(() => mql.matches),
        );

        return Stream.merge(postHydrationSeed, mqlEvents);
      },
    );
  });

// ─── Physical / logical display metrics ──────────────────────────────

/**
 * Snapshot of the browser's `ScreenOrientation` state.
 */
export interface OrientationSnapshot {
  readonly type: OrientationType;
  readonly angle: number;
}

/**
 * Standard `window.screen` metrics, exposed reactively. All values
 * are 0 on SSR (except `orientation`, which stays at a landscape-
 * primary neutral). Change events fire on `resize` (most fields)
 * or on `screen.orientation.change` (for `orientation`).
 *
 * These are the physical/logical DISPLAY dimensions — the ones that
 * describe the monitor / device screen itself. For the browser
 * VIEWPORT (usually what you want for responsive design), use
 * `Screen.width` / `Screen.height` on the top-level namespace.
 */
export const display = {
  /** `window.screen.width` — physical/logical screen width. */
  width: fromEvent(
    () => window.screen.width,
    () => window,
    "resize",
    0,
  ),
  /** `window.screen.height` — physical/logical screen height. */
  height: fromEvent(
    () => window.screen.height,
    () => window,
    "resize",
    0,
  ),
  /** `window.screen.availWidth` — width minus OS chrome (taskbar, dock). */
  availWidth: fromEvent(
    () => window.screen.availWidth,
    () => window,
    "resize",
    0,
  ),
  /** `window.screen.availHeight` — height minus OS chrome. */
  availHeight: fromEvent(
    () => window.screen.availHeight,
    () => window,
    "resize",
    0,
  ),
  /** `window.screen.colorDepth` — bits per pixel. */
  colorDepth: fromEvent(
    () => window.screen.colorDepth,
    () => window,
    "resize",
    0,
  ),
  /** `window.screen.pixelDepth` — bits per pixel. */
  pixelDepth: fromEvent(
    () => window.screen.pixelDepth,
    () => window,
    "resize",
    0,
  ),
  /**
   * `window.screen.orientation` snapshot. Fires on rotate. On SSR
   * defaults to `{ type: "landscape-primary", angle: 0 }`.
   */
  orientation: fromEvent<OrientationSnapshot>(
    () => ({
      type: window.screen.orientation.type,
      angle: window.screen.orientation.angle,
    }),
    () => window.screen.orientation,
    "change",
    { type: "landscape-primary", angle: 0 },
  ),
} as const;
