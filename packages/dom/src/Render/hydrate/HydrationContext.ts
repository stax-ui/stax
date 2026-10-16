import { Context, Effect, Layer, Ref } from "effect";

/**
 * Hydration context service interface.
 * Used during client-side hydration to generate matching IDs
 * and look up existing DOM elements.
 */
export interface HydrationContextService {
  /**
   * Generate the next hydration ID (matches SSR order).
   */
  readonly generateId: Effect.Effect<string>;

  /**
   * Generate the next control-flow ID (`stax-1`, `stax-2`, …),
   * matching the format and increment order of SSR's
   * `data-stax-id` attributes.
   *
   * Each `HydrationControlCtx` fork pulls one ID from this
   * sequence to look its container up in the pre-index. The
   * sequence has to match SSR's exactly, which it will as long as
   * the Effect graph evaluates children in source order (true for
   * synchronous reactive trees, which covers nearly all usage).
   */
  readonly nextControlId: Effect.Effect<string>;

  /**
   * The root container element for DOM queries.
   */
  readonly root: HTMLElement | SVGElement;

  /**
   * Find an element by its hydration ID.
   *
   * Reads from a pre-built map populated at hydration-context
   * creation time via a single DOM pass over all `[data-stax-id]`
   * attributes. O(1) per lookup; the up-front O(C) build amortizes
   * across every control's container lookup.
   *
   * Supersedes the historical per-lookup `querySelector` call —
   * callers that need O(1) lookup during the hot path of hydration
   * should use this (now that `HydrationControlCtx` does, Suspense
   * is the main non-control-flow caller).
   */
  readonly findById: (
    id: string,
  ) => Effect.Effect<HTMLElement | SVGElement | null>;

  /**
   * Find a suspense container and get its current state.
   */
  readonly findSuspense: (id: string) => Effect.Effect<{
    container: HTMLElement | SVGElement;
    state: "loading" | "loaded" | "error";
    fallback: Node | null;
  } | null>;
}

/**
 * Build the pre-index map of hydration IDs to elements.
 *
 * One pass through the root subtree via `querySelectorAll` —
 * browsers' attribute selectors are internally indexed, so this
 * is a near-linear scan over the matching nodes rather than the
 * whole tree. For a page with C controls, the result is a
 * `Map<string, Element>` of size C.
 *
 * Exported so benchmarks can measure index-build vs. positional-walk
 * costs without going through the full `makeHydrationContext` path.
 */
export const buildHydrationIndex = (
  root: HTMLElement | SVGElement,
): Map<string, HTMLElement | SVGElement> => {
  const index = new Map<string, HTMLElement | SVGElement>();
  const matches = root.querySelectorAll<HTMLElement | SVGElement>(
    "[data-stax-id]",
  );
  for (const el of matches) {
    const id = el.getAttribute("data-stax-id");
    if (id) index.set(id, el);
  }
  // Include the root itself if it carries a `data-stax-id` — `querySelectorAll`
  // does not match the root in its own search.
  const rootId = root.getAttribute?.("data-stax-id");
  if (rootId) index.set(rootId, root);
  return index;
};

/**
 * Context tag for hydration state.
 * Components check for this context to determine if they're hydrating
 * and to look up existing DOM elements.
 */
export class HydrationContext extends Context.Tag("@stax-ui/HydrationContext")<
  HydrationContext,
  HydrationContextService
>() {}

/**
 * Create a HydrationContext layer for a given root element.
 *
 * Builds the hydration-id pre-index up front via one DOM pass over
 * `root`, then exposes O(1) `findById` lookups backed by that map.
 * The historical per-lookup `querySelector` call still works as a
 * fallback for IDs added to the DOM after the pre-index was built
 * (rare — mostly a defensive case for user code that manually
 * injects hydration markers post-SSR).
 */
export const makeHydrationContext = (
  root: HTMLElement | SVGElement,
): Effect.Effect<Layer.Layer<HydrationContext>> =>
  Effect.gen(function* () {
    const counter = yield* Ref.make(0);
    const controlCounter = yield* Ref.make(0);
    const index = buildHydrationIndex(root);

    const service: HydrationContextService = {
      generateId: Ref.updateAndGet(counter, (n) => n + 1).pipe(
        Effect.map((n) => `h${n}`),
      ),

      nextControlId: Ref.updateAndGet(controlCounter, (n) => n + 1).pipe(
        Effect.map((n) => `stax-${n}`),
      ),

      root,

      findById: (id: string) =>
        Effect.sync(() => {
          // Fast path: pre-indexed lookup.
          const hit = index.get(id);
          if (hit) return hit;
          // Fallback for IDs injected after index build — keeps the
          // behavior of the pre-index-less version for defensive
          // callers. The lookup is O(DOM size) just like before.
          return root.querySelector<HTMLElement | SVGElement>(
            `[data-stax-id="${id}"]`,
          );
        }),

      findSuspense: (id: string) =>
        Effect.sync(() => {
          // Suspense containers have both `data-stax-id` and
          // `data-stax-type="suspense"`. The pre-index gives us the
          // element by ID; we check the type attribute to confirm
          // it's actually a suspense boundary.
          const indexed = index.get(id);
          const container =
            indexed && indexed.getAttribute("data-stax-type") === "suspense"
              ? indexed
              : root.querySelector<HTMLElement | SVGElement>(
                  `[data-stax-id="${id}"][data-stax-type="suspense"]`,
                );
          if (!container) return null;

          const state =
            (container.getAttribute("data-stax-suspense-state") as
              "loading" | "loaded" | "error") ?? "loading";

          // The fallback is the first child of the container
          const fallback = container.firstChild;

          return { container, state, fallback };
        }),
    };

    return Layer.succeed(HydrationContext, service);
  });

/**
 * Run an effect with a hydration context.
 */
export const withHydrationContext = <A, E, R>(
  root: HTMLElement,
  effect: Effect.Effect<A, E, R | HydrationContext>,
): Effect.Effect<A, E, Exclude<R, HydrationContext>> =>
  Effect.gen(function* () {
    const layer = yield* makeHydrationContext(root);
    return yield* Effect.provide(effect, layer);
  }) as Effect.Effect<A, E, Exclude<R, HydrationContext>>;
