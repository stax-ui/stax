import { Context, Effect, Layer, Ref } from "effect";

/**
 * Result of a control-flow ID lookup. Element containers (user-supplied
 * `container: () => $.ul(...)`) resolve to the element itself; default
 * containers resolve to a sentinel-comment pair that delimits the
 * group of slot nodes they manage.
 */
export type ControlLookup =
  | {
      readonly kind: "element";
      readonly element: HTMLElement | SVGElement;
    }
  | {
      readonly kind: "sentinels";
      readonly start: Comment;
      readonly end: Comment;
    };

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
   * `data-stax-id` attributes and `<!--$stax-N-->` sentinel comments.
   *
   * Each `HydrationControlCtx` fork pulls one ID from this sequence
   * to look its container up in the pre-index. The sequence has to
   * match SSR's exactly, which it will as long as the Effect graph
   * evaluates children in source order (true for synchronous reactive
   * trees, which covers nearly all usage).
   */
  readonly nextControlId: Effect.Effect<string>;

  /**
   * The root container element for DOM queries.
   */
  readonly root: HTMLElement | SVGElement;

  /**
   * Find an element by its hydration ID (user-container case). Reads
   * from the pre-built element map populated at hydration-context
   * creation time; `null` if the id isn't an element in the index.
   *
   * Suspense and user-container controls use this. Default (sentinel)
   * controls use {@link findControl} instead.
   */
  readonly findById: (
    id: string,
  ) => Effect.Effect<HTMLElement | SVGElement | null>;

  /**
   * Find a control-flow container by hydration ID. Resolves to either
   * an element (user-supplied `container:`) or a sentinel pair (the
   * default `<!--$stax-N-->…<!--/$stax-N-->` form). `null` if the id
   * isn't present in either index.
   */
  readonly findControl: (id: string) => Effect.Effect<ControlLookup | null>;

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
 * The two indexes built up front at hydration entry.
 *
 * `elements` keyed by `data-stax-id` — covers user-container controls
 *   and Suspense. `querySelectorAll('[data-stax-id]')` is close to a
 *   linear scan over the matching nodes (browsers index attribute
 *   selectors internally).
 *
 * `sentinels` keyed by the id extracted from a `<!--$stax-N-->` start
 *   comment's text; the end comment is located lazily by walking the
 *   start comment's forward siblings. `TreeWalker(SHOW_COMMENT)`
 *   covers the full tree in one pass.
 */
export interface HydrationIndex {
  readonly elements: Map<string, HTMLElement | SVGElement>;
  readonly sentinels: Map<string, Comment>;
}

/**
 * Build the two pre-index maps for a hydration root.
 *
 * One scan per index — elements via `querySelectorAll('[data-stax-id]')`
 * (browser-indexed, near-linear), sentinel starts via
 * `TreeWalker(SHOW_COMMENT)` which visits every comment node once.
 *
 * Exported so benchmarks can measure index-build cost without going
 * through the full `makeHydrationContext` path.
 */
export const buildHydrationIndex = (
  root: HTMLElement | SVGElement,
): HydrationIndex => {
  const elements = new Map<string, HTMLElement | SVGElement>();
  const sentinels = new Map<string, Comment>();

  // Element pass. `querySelectorAll` does not include the root itself,
  // so check its own attribute explicitly below.
  for (const el of root.querySelectorAll<HTMLElement | SVGElement>(
    "[data-stax-id]",
  )) {
    const id = el.getAttribute("data-stax-id");
    if (id) elements.set(id, el);
  }
  const rootId = root.getAttribute?.("data-stax-id");
  if (rootId) elements.set(rootId, root);

  // Comment pass. Only start sentinels are indexed; end sentinels get
  // resolved by walking forward from `start` at findControl time, which
  // avoids a second map and matches the natural lifecycle (a control
  // consumes its own sentinel pair atomically).
  const doc = root.ownerDocument ?? document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const comment = node as Comment;
    const text = comment.data;
    // Start-sentinel format is `$stax-N`. Everything else (slot
    // markers, user comments, end sentinels, non-control stax
    // comments) is ignored by the index.
    if (text.startsWith("$stax-")) {
      sentinels.set(text.slice(1), comment);
    }
  }

  return { elements, sentinels };
};

/**
 * Resolve the end sentinel for a start sentinel with the given id.
 * Walks the start's forward siblings looking for `/stax-N`. Null if
 * the matching end is missing (treated as a hydration mismatch by
 * callers).
 */
const findSentinelEnd = (start: Comment, id: string): Comment | null => {
  const expected = `/${id}`;
  for (let node = start.nextSibling; node !== null; node = node.nextSibling) {
    if (
      node.nodeType === 8 /* COMMENT_NODE */ &&
      (node as Comment).data === expected
    ) {
      return node as Comment;
    }
  }
  return null;
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
 * Builds the hydration-id pre-indexes up front via one DOM pass over
 * `root` (one `querySelectorAll` for elements, one `TreeWalker` for
 * comment sentinels), then exposes O(1) `findById` / `findControl`
 * lookups backed by those maps.
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
          const hit = index.elements.get(id);
          if (hit) return hit;
          // Defensive fallback for user code that injects hydration
          // markers after the index was built. O(DOM size) but very rare.
          return root.querySelector<HTMLElement | SVGElement>(
            `[data-stax-id="${id}"]`,
          );
        }),

      findControl: (id: string) =>
        Effect.sync(() => {
          const start = index.sentinels.get(id);
          if (start) {
            const end = findSentinelEnd(start, id);
            if (end) return { kind: "sentinels", start, end };
            // Start sentinel present but end missing — treat as miss so
            // the caller falls back to the slow path.
            return null;
          }
          const el = index.elements.get(id);
          if (el) return { kind: "element", element: el };
          return null;
        }),

      findSuspense: (id: string) =>
        Effect.sync(() => {
          // Suspense containers have both `data-stax-id` and
          // `data-stax-type="suspense"`. The element index gives us the
          // element by ID; we check the type attribute to confirm it's
          // actually a suspense boundary.
          const indexed = index.elements.get(id);
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
