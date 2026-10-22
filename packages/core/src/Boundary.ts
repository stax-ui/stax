import { Cause, Context, Duration, Effect, Either, Option } from "effect";

import type { Element } from "./Element.js";
import { SuspenseBoundaryCtx } from "./SuspenseBoundaryCtx.js";

/**
 * Options for the suspense boundary.
 */
export interface SuspenseOptions<N, E, R1, RF, RC> {
  /**
   * Async function that returns the final element.
   * Can fail with error type E if `catch` is provided.
   */
  readonly render: () => Element<N, E, R1>;

  /**
   * Function to render the loading/fallback state.
   * Must have no requirements (will be rendered in detached context if delay > 0).
   */
  readonly fallback: () => Element<N, never, RF>;

  /**
   * Optional error handler. If provided, errors from render are caught
   * and this function is called to render an error state.
   * Must have no requirements.
   */
  readonly catch?: (error: E) => Element<N, never, RC>;

  /**
   * Delay before showing the fallback.
   * If the render completes before this duration, no fallback is shown.
   * Accepts Effect Duration strings like "200 millis", "1 second", or a number (milliseconds).
   * If not provided, fallback is shown immediately.
   */
  readonly delay?: Duration.DurationInput;
}

// ============================================================================
// Main suspense implementation
// ============================================================================

/**
 * Suspense boundary for async rendering with loading states.
 *
 * Renders the fallback while waiting for the async render to complete.
 * Optionally delays showing the fallback to avoid loading flashes on fast responses.
 * Optionally catches errors and renders an error state.
 *
 * The appropriate SuspenseBoundaryCtx layer (Client, SSR, Hydration) should be
 * provided at the rendering entry point (mount, hydrate, renderToString).
 *
 * @example
 * ```ts
 * // Simple - show fallback immediately (using @stax-ui/dom)
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
 */
export const suspense: {
  // Overload 1: No catch, render cannot fail
  <N, R1 = never, RF = never>(
    options: SuspenseOptions<N, never, R1, RF, never> & { catch?: never },
  ): Element<N, never, R1 | RF | SuspenseBoundaryCtx>;

  // Overload 2: With catch, render can fail
  <N, E, R1 = never, RF = never, RC = never>(
    options: SuspenseOptions<N, E, R1, RF, RC> & {
      catch: (error: E) => Element<N, never, RC>;
    },
  ): Element<N, never, R1 | RF | RC | SuspenseBoundaryCtx>;
} = <N, E, R1 = never, RF = never, RC = never>(
  options: SuspenseOptions<N, E, R1, RF, RC>,
): Element<N, never, R1 | RF | RC | SuspenseBoundaryCtx> =>
  Effect.gen(function* () {
    const ctx = yield* SuspenseBoundaryCtx;
    const resultElement = yield* ctx.createSuspensionPoint();
    const fallbackElement = yield* options.fallback();

    const delay = options.delay
      ? Option.some(Duration.decode(options.delay))
      : Option.none();
    const fallbackFiber = yield* ctx.showFallback(fallbackElement, delay);
    yield* ctx.forkRender(options.render, options.catch, fallbackFiber);

    return resultElement as N;
  });

/**
 * Error boundary that catches errors from a render function and displays a fallback element.
 *
 * @param tryRender - Function that may fail with an error
 * @param catchRender - Function to render the error fallback
 *
 * @example
 * ```ts
 * // Using @stax-ui/dom
 * Boundary.error(
 *   () => riskyComponent(),
 *   (error) => $.div({}, $.of(`Something went wrong: ${String(error)}`))
 * )
 * ```
 */
export const error = <N, E, R1 = never, R2 = never>(
  tryRender: () => Element<N, E, R1>,
  catchRender: (error: E) => Element<N, never, R2>,
): Element<N, never, R1 | R2> =>
  Effect.gen(function* () {
    const result = yield* tryRender().pipe(Effect.either);

    if (Either.isLeft(result)) {
      return yield* catchRender(result.left as E);
    }

    return result.right;
  });

/**
 * Boundary namespace for error and async handling.
 *
 * @example
 * ```ts
 * // Suspense boundary for async loading (using @stax-ui/dom)
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
// -----------------------------------------------------------------------------
// Error Boundary Context (sideband for reactive error boundaries)
// -----------------------------------------------------------------------------

/**
 * Service a reactive error boundary provides into its subtree.
 *
 * `reconcile`'s `safeSync` looks this up via `Effect.serviceOption` on
 * every subscription-path sync. On typed failures (and on defects
 * when the boundary opted in), it calls `report` so the nearest
 * enclosing boundary can swap to its fallback. On successful syncs
 * it calls `clear` so a successful nav after a failed one
 * auto-recovers the UI.
 *
 * Not provided → no boundary present → `safeSync` falls back to its
 * historical "log + swallow" behavior. Entirely opt-in; existing
 * callers see no behavior change.
 */
export interface ErrorBoundaryService {
  readonly report: (cause: Cause.Cause<unknown>) => Effect.Effect<void>;
  readonly clear: Effect.Effect<void>;
}

export class ErrorBoundaryCtx extends Context.Tag(
  "@stax-ui/core/ErrorBoundaryCtx",
)<ErrorBoundaryCtx, ErrorBoundaryService>() {}

export const Boundary = {
  suspense,
  error,
  ErrorBoundaryCtx,
} as const;

// Re-export types
export type { SuspenseOptions as BoundarySuspenseOptions };
