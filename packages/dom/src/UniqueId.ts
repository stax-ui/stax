import { Context, Effect, Layer, Option, Ref } from "effect";

/**
 * Module-global fallback counter — used only when no `IdGenerator` is
 * provided in the current Effect context. SPAs that never bother with
 * `mount`'s automatic layer still get sequential ids this way.
 *
 * In SSR / hydration apps the fallback is never reached: `mount`,
 * `hydrate`, `toHttpRoutes` (per request), and `buildStaticSite` (per
 * generated page) all provide a fresh `IdGenerator`, so counts restart
 * per request / per page / per hydration and server/client agree.
 */
let fallbackCounter = 0;

/**
 * Render-scoped id generator. Provided by `mount` / `hydrate`
 * (one per app lifetime) and by `toHttpRoutes` / `buildStaticSite`
 * (one per SSR request or SSG page). When a request-scoped generator
 * is in scope, `UniqueId.make` draws from it; otherwise it falls back
 * to a module-global counter.
 *
 * Fixes #173 — the pre-service version used only the module-global
 * counter, so SSR requests kept growing it while hydration restarted
 * from zero, producing mismatched ids and breaking ARIA wiring.
 */
export class IdGenerator extends Context.Tag("@stax-ui/dom/IdGenerator")<
  IdGenerator,
  {
    readonly next: (prefix: string) => Effect.Effect<string>;
  }
>() {}

/**
 * Build a fresh `IdGenerator` layer. Each call creates its own counter
 * starting at zero. Entry points that render a tree once (mount,
 * hydrate, per-SSR-request, per-SSG-page) call this to get an
 * isolated counter.
 */
export const makeIdGeneratorLayer = (): Layer.Layer<IdGenerator> =>
  Layer.effect(
    IdGenerator,
    Effect.gen(function* () {
      const counter = yield* Ref.make(0);
      return {
        next: (prefix: string) =>
          Ref.updateAndGet(counter, (n) => n + 1).pipe(
            Effect.map((n) => `${prefix}-${n}`),
          ),
      };
    }),
  );

/**
 * Generate unique IDs for DOM elements.
 * Useful for ARIA relationships, label associations, and other cases
 * where elements need to reference each other by ID.
 *
 * On SSR'd apps, `mount` / `hydrate` / `toHttpRoutes` /
 * `buildStaticSite` each provide an `IdGenerator` whose counter is
 * scoped to that render — so server and client agree on ids and ARIA
 * wiring survives hydration.
 *
 * @example
 * ```ts
 * // Basic usage
 * const id = yield* UniqueId.make()
 * // => "uid-1"
 *
 * // With prefix
 * const contentId = yield* UniqueId.make("collapsible-content")
 * // => "collapsible-content-1"
 *
 * // For ARIA relationships
 * Effect.gen(function* () {
 *   const labelId = yield* UniqueId.make("label")
 *   const inputId = yield* UniqueId.make("input")
 *
 *   return yield* $.div([
 *     $.label({ id: labelId, htmlFor: inputId }, "Name"),
 *     $.input({ id: inputId, "aria-labelledby": labelId }),
 *   ])
 * })
 * ```
 */
export const UniqueId = {
  IdGenerator,
  makeIdGeneratorLayer,

  /**
   * Generate a unique ID, optionally with a prefix. Draws from the
   * scoped `IdGenerator` when one is provided (always true inside
   * `mount` / `hydrate` / SSR / SSG), falls back to a module-global
   * counter otherwise.
   *
   * @param prefix - Optional prefix for the ID (default: "uid")
   * @returns Effect that produces a unique string ID
   */
  make: (prefix = "uid"): Effect.Effect<string> =>
    Effect.serviceOption(IdGenerator).pipe(
      Effect.flatMap((maybe) =>
        Option.match(maybe, {
          onNone: () => Effect.sync(() => `${prefix}-${++fallbackCounter}`),
          onSome: (gen) => gen.next(prefix),
        }),
      ),
    ),

  /**
   * Reset the module-global fallback counter. Only affects calls to
   * `make` that fall through to the fallback — scoped `IdGenerator`
   * instances have their own counters that reset per-layer-construction.
   *
   * Kept for test backward-compat; most new tests should provide a
   * fresh `makeIdGeneratorLayer()` instead.
   * @internal
   */
  _reset: (): Effect.Effect<void> =>
    Effect.sync(() => {
      fallbackCounter = 0;
    }),
};
