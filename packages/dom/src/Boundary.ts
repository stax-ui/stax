/**
 * DOM-specific boundary components for async and error handling.
 *
 * The suspense boundary now uses SuspenseBoundaryCtx which is provided
 * by the rendering entry points (mount, hydrate, renderToString).
 * This allows the same code to work across client, SSR, and hydration modes.
 */

import { Cause, Duration, Effect, Either, Option } from "effect";

import {
  ControlCtx,
  Boundary as CoreBoundary,
  ErrorBoundaryCtx,
  Signal,
  SuspenseBoundaryCtx,
  type BoundarySuspenseOptions as CoreSuspenseOptions,
  type ErrorBoundaryService,
} from "@stax-ui/core";

import { matchOption } from "./Control/index.js";
import * as Element from "./Element/index.js";

type DOMElement = HTMLElement | SVGElement;

/**
 * Options for the suspense boundary (DOM-specialized version).
 *
 * The `N` parameter is the element type all three branches share.
 * Inferred from the callbacks, defaults to `HTMLElement | SVGElement`.
 * When all three branches return the same concrete element type (say
 * `HTMLDivElement`), the return type of {@link suspense} preserves it
 * — no cast needed at `mount(...)` sites.
 */
export interface SuspenseOptions<N extends DOMElement, E, R1, RF, RC> {
  /**
   * Async function that returns the final element.
   * Can fail with error type E if `catch` is provided.
   */
  readonly render: () => Element.Element<N, E, R1>;

  /**
   * Function to render the loading/fallback state.
   * Must have no requirements (will be rendered in detached context if delay > 0).
   */
  readonly fallback: () => Element.Element<N, never, RF>;

  /**
   * Optional error handler. If provided, errors from render are caught
   * and this function is called to render an error state.
   * Must have no requirements.
   */
  readonly catch?: (error: E) => Element.Element<N, never, RC>;

  /**
   * Delay before showing the fallback.
   * If the render completes before this duration, no fallback is shown.
   * Accepts Effect Duration strings like "200 millis", "1 second", or a number (milliseconds).
   * If not provided, fallback is shown immediately.
   */
  readonly delay?: Duration.DurationInput;
}

/**
 * Suspense boundary for async rendering with loading states.
 *
 * Renders the fallback while waiting for the async render to complete.
 * Optionally delays showing the fallback to avoid loading flashes on fast responses.
 * Optionally catches errors and renders an error state.
 *
 * The appropriate SuspenseBoundaryCtx layer (Client, SSR, Hydration) is provided
 * automatically by mount(), hydrate(), or renderToString().
 *
 * @example
 * ```ts
 * // Simple - show fallback immediately
 * Boundary.suspense({
 *   render: () => fetchAndRenderUser(userId),
 *   fallback: () => $.div({}, $.of("Loading...")),
 * })
 * ```
 *
 * @example
 * ```ts
 * // With delay - avoid loading flash on fast responses
 * Boundary.suspense({
 *   render: () => Effect.gen(function* () {
 *     const user = yield* fetchUser(userId)
 *     return yield* UserPage({ user })
 *   }),
 *   fallback: () => $.div({}, $.of("Loading user...")),
 *   delay: "200 millis",
 * })
 * ```
 *
 * @example
 * ```ts
 * // With error handling
 * Boundary.suspense({
 *   render: () => Effect.gen(function* () {
 *     const user = yield* fetchUser(userId)
 *     return yield* UserPage({ user })
 *   }),
 *   fallback: () => $.div({}, $.of("Loading...")),
 *   catch: (error) => $.div({}, $.of(`Error: ${String(error)}`)),
 *   delay: "200 millis",
 * })
 * ```
 */
export const suspense: {
  // Overload 1: No catch, render cannot fail
  <N extends DOMElement = DOMElement, R1 = never, RF = never>(
    options: SuspenseOptions<N, never, R1, RF, never> & { catch?: never },
  ): Element.Element<N, never, R1 | RF | SuspenseBoundaryCtx>;

  // Overload 2: With catch, render can fail
  <
    N extends DOMElement = DOMElement,
    E = never,
    R1 = never,
    RF = never,
    RC = never,
  >(
    options: SuspenseOptions<N, E, R1, RF, RC> & {
      catch: (error: E) => Element.Element<N, never, RC>;
    },
  ): Element.Element<N, never, R1 | RF | RC | SuspenseBoundaryCtx>;
} = <
  N extends DOMElement = DOMElement,
  E = never,
  R1 = never,
  RF = never,
  RC = never,
>(
  options: SuspenseOptions<N, E, R1, RF, RC>,
): Element.Element<N, never, R1 | RF | RC | SuspenseBoundaryCtx> => {
  // Delegate to core — the context handles environment-specific behavior.
  const coreSuspense = CoreBoundary.suspense as <
    N2 extends DOMElement,
    E2,
    R1_2,
    RF2,
    RC2,
  >(
    opts: CoreSuspenseOptions<N2, E2, R1_2, RF2, RC2>,
  ) => Element.Element<N2, never, R1_2 | RF2 | RC2 | SuspenseBoundaryCtx>;

  return coreSuspense(
    options as unknown as CoreSuspenseOptions<N, E, R1, RF, RC>,
  );
};

/**
 * Error boundary that catches errors from a render function and displays a fallback element.
 *
 * @param tryRender - Function that may fail with an error
 * @param catchRender - Function to render the error fallback
 *
 * @example
 * ```ts
 * Boundary.error(
 *   () => riskyComponent(),
 *   (error) => $.div({}, $.of(`Something went wrong: ${String(error)}`))
 * )
 * ```
 */
/**
 * Options for the DOM-side `Boundary.error`.
 */
export interface ErrorOptions {
  /**
   * When true, defects (unexpected throws from user code —
   * `Effect.die`, uncaught sync throws, etc.) ALSO trigger the
   * fallback. Default is `false`: only typed `Effect.fail(...)`
   * failures are caught, matching the "surface planned risk"
   * principle. Flip to `true` when you want the boundary to catch
   * runtime bugs too (e.g. a top-level app boundary).
   */
  readonly catchDefects?: boolean;
}

/**
 * Error boundary that catches errors from a render function and
 * displays a fallback element. Reactive: subscription-fiber failures
 * (route render errors from `Outlet`, slot render errors from `each`
 * / `when` / `match`, etc.) also route through here, not just the
 * initial render.
 *
 * The boundary provides an `ErrorBoundaryCtx` into its subtree.
 * `reconcile`'s `safeSync` reports failures through that service and
 * clears on successful syncs, so a successful nav after a failed one
 * auto-swaps back to the child. If a nested boundary is also
 * installed, the nearest ancestor wins (standard context semantics).
 *
 * **Opt-in:** no boundary wrapping Outlet / `each` / etc. means the
 * historical "log + swallow" subscription behavior stays, with no
 * change for existing callers.
 *
 * @param tryRender - Function that may fail with an error.
 * @param catchRender - Function to render the fallback. Called when
 *   the initial render fails OR when the subscription path reports an
 *   error. On subsequent subscription success, the child is remounted.
 * @param options - See {@link ErrorOptions}.
 *
 * @example
 * ```ts
 * Boundary.error(
 *   () => Outlet({ router }),
 *   (err: MetaRenderError) =>
 *     $.div({ class: "error" }, "Oops — ", err.route, " broke"),
 * )
 * ```
 */
export const error = <N extends DOMElement, E, R1 = never, R2 = never>(
  tryRender: () => Element.Element<N, E, R1>,
  catchRender: (error: E) => Element.Element<N, never, R2>,
  options: ErrorOptions = {},
): Element.Element<N, never, ControlCtx | R1 | R2> => {
  const catchDefects = options.catchDefects ?? false;
  return Effect.gen(function* () {
    // Latest-cause signal. `safeSync` writes `Some(cause)` on reported
    // failures and `None` on successful subsequent syncs, so the
    // boundary swaps back to the child automatically when navigation
    // recovers.
    const errors = yield* Signal.make<Option.Option<Cause.Cause<E>>>(
      Option.none(),
    );

    // Build the ambient service. `catchDefects` is enforced here so
    // `safeSync` doesn't need to care about the shape — it reports
    // every cause and the boundary decides whether that cause
    // actually belongs in the signal.
    const service: ErrorBoundaryService = {
      report: (cause: Cause.Cause<unknown>) =>
        Effect.gen(function* () {
          const hasFailure = Option.isSome(Cause.failureOption(cause));
          const hasDefect = Option.isSome(Cause.dieOption(cause));
          if (hasFailure || (hasDefect && catchDefects)) {
            yield* errors.set(Option.some(cause as Cause.Cause<E>));
          }
        }),
      clear: errors.set(Option.none()),
    };

    // Attempt the initial render once up front. matchOption's reactive
    // swap only reacts to signal changes AFTER its own subscription
    // starts, so a failure during matchOption's initial `onNone`
    // slot can't swap in-place to `onSome`. Running `tryRender` here
    // lets us set the signal synchronously (so matchOption's initial
    // read picks the right branch) and reuse the already-mounted
    // node when `tryRender` succeeded.
    const initialResult = yield* tryRender().pipe(
      Effect.provideService(ErrorBoundaryCtx, service),
      Effect.either,
    );
    // One-shot cache so matchOption's first `onNone` evaluation
    // returns the node we already mounted; later evaluations (after
    // a recovery) run `tryRender` fresh for a clean remount.
    let primed: { node: N } | null = null;
    if (Either.isLeft(initialResult)) {
      yield* errors.set(Option.some(Cause.fail(initialResult.left)));
    } else {
      primed = { node: initialResult.right };
    }

    return yield* matchOption(errors, {
      onSome: (causeReadable) =>
        Effect.gen(function* () {
          const cause = yield* causeReadable.get;
          return yield* catchRender(extractError(cause as Cause.Cause<E>));
        }) as unknown as Element.Element<N, never, R2>,
      onNone: () =>
        Effect.gen(function* () {
          if (primed) {
            const node = primed.node;
            primed = null; // consume
            return node;
          }
          // Second+ time through onNone: the previous child was
          // unmounted when matchOption swapped to onSome; now we're
          // recovering, so run `tryRender` fresh for a clean mount.
          return yield* tryRender().pipe(
            Effect.provideService(ErrorBoundaryCtx, service),
          );
        }) as unknown as Element.Element<N, never, R1>,
    }) as unknown as Element.Element<N, never, ControlCtx | R1 | R2>;
  });
};

/**
 * Pull the user-facing error value out of a `Cause`. Prefers the
 * typed `Fail` failure; falls back to the `Die` defect's value when
 * `catchDefects` was true. Used only inside `Boundary.error` — the
 * `undefined` branch is unreachable because the boundary only writes
 * causes that contain at least one of the two.
 */
const extractError = <E>(cause: Cause.Cause<E>): E => {
  const failure = Cause.failureOption(cause);
  if (Option.isSome(failure)) return failure.value;
  const die = Cause.dieOption(cause);
  return (Option.isSome(die) ? die.value : undefined) as E;
};

/**
 * Boundary namespace for error and async handling.
 *
 * @example
 * ```ts
 * // Suspense boundary for async loading
 * Boundary.suspense({
 *   render: () => fetchAndRenderData(),
 *   fallback: () => $.div({}, $.of("Loading...")),
 *   catch: (err) => $.div({}, $.of(`Error: ${err}`)),
 *   delay: "200 millis",
 * })
 *
 * // Error boundary for catching render errors
 * Boundary.error(
 *   () => riskyComponent(),
 *   (err) => $.div({}, $.of(`Oops: ${err}`))
 * )
 * ```
 */
export const Boundary = {
  suspense,
  error,
} as const;

// Re-export types
export type { SuspenseOptions as BoundarySuspenseOptions };
