/**
 * Client-side hydration for Stax SSR.
 *
 * @example
 * ```ts
 * import { hydrate } from "@stax-ui/dom/hydrate";
 * import { App } from "./App";
 *
 * hydrate(App(), document.getElementById("root")!);
 * ```
 *
 * @module
 */

import { Effect, Layer } from "effect";

import {
  RendererContext,
  SignalRegistry,
  type ControlCtx,
  type Renderer,
  type SuspenseBoundaryCtx,
} from "@stax-ui/core";

import { ClientAsyncCacheLayer } from "../../ClientAsyncCache.js";
import {
  HydrationControlCtx,
  HydrationRootCtx,
} from "../../Control/HydrationControlCtx.js";
import * as Element from "../../Element/index.js";
import { HydrationSuspenseBoundaryCtx } from "../../SuspenseBoundaryCtx/HydrationSuspenseBoundaryCtx.js";
import { makeIdGeneratorLayer } from "../../UniqueId.js";
import { makeHydrationContext } from "./HydrationContext.js";
import { createHydrationRenderer } from "./HydrationRenderer.js";

export interface HydrateOptions<
  L extends Layer.Layer<never, never, never> = Layer.Layer<never, never, never>,
> {
  /**
   * Called when a hydration mismatch is detected.
   * In development, you might want to log warnings.
   * In production, the framework will attempt recovery.
   */
  readonly onMismatch?: (message: string, node: Node | null) => void;

  /**
   * Additional layers to provide to the element during hydration. Whatever
   * services these layers produce show up in the element's `R` parameter,
   * so you can pass e.g. `Platform.makeClientLayer(router)` and have
   * `App()` require `NavigationContext | RouteDataProvider` without any
   * casts. The default `Layer<never, never, never>` allows omitting the
   * field for elements that need no user services.
   */
  readonly layers?: L;
}

/**
 * Hydrate server-rendered HTML by attaching to existing DOM
 * and setting up reactive bindings.
 *
 * `R` is inferred from `options.layers` — whatever services the layers
 * provide are what the element is allowed to require on top of the
 * framework-provided contexts. Pass the layers via `options.layers` rather
 * than `Effect.provide(App(), layer)` before calling hydrate — the latter
 * scopes the layer to the element's short-lived render.
 *
 * @param element - The Element to hydrate (same component tree as SSR)
 * @param container - The DOM container with server-rendered HTML
 * @param options - Hydration options; `layers` provides `R` to the element
 * @returns Promise that resolves when hydration is complete
 *
 * @example
 * ```ts
 * import { hydrate } from "@stax-ui/dom/hydrate";
 * import { Platform } from "@stax-ui/platform";
 * import { App } from "./App";
 * import { router } from "./routes";
 *
 * hydrate(App(), document.getElementById("root")!, {
 *   layers: Platform.makeClientLayer(router),
 * });
 * ```
 */
export function hydrate<
  A extends HTMLElement | SVGElement,
  L extends Layer.Layer<never, never, never> = Layer.Layer<never, never, never>,
>(
  // `NoInfer` on the extracted layer type keeps TS from inferring L from
  // the element's requirements. L is inferred solely from `options.layers`,
  // then the element must fit `Framework | Layer.Success<L>` — passing an
  // element that requires a service you forgot to provide via layers is a
  // type error, not a silent runtime failure.
  element: Element.Element<
    A,
    never,
    | RendererContext
    | ControlCtx
    | SuspenseBoundaryCtx
    | NoInfer<Layer.Layer.Success<L>>
  >,
  container: HTMLElement,
  options?: HydrateOptions<L>,
): Promise<void> {
  const opts = options ?? {};
  const renderer = createHydrationRenderer(container, opts);

  const HydrationRendererLayer = Layer.succeed(
    RendererContext,
    renderer as Renderer<unknown>,
  );

  // Create the HydrationRootCtx layer that HydrationControlCtx needs
  const HydrationRootLayer = Layer.succeed(HydrationRootCtx, container);
  const ControlLayer = Layer.provide(HydrationControlCtx, HydrationRootLayer);

  const program = Effect.gen(function* () {
    // Create hydration context with ID counter matching SSR order
    const hydrationContextLayer = yield* makeHydrationContext(container);

    // Build the suspense layer with its HydrationContext dependency
    const suspenseLayer = Layer.provide(
      HydrationSuspenseBoundaryCtx,
      hydrationContextLayer,
    );

    // Build the layers to provide to the element
    let elementLayers = Layer.merge(hydrationContextLayer, ControlLayer);
    elementLayers = Layer.merge(elementLayers, suspenseLayer);
    elementLayers = Layer.merge(elementLayers, ClientAsyncCacheLayer);
    // Per-hydration `IdGenerator` — counter restarts at zero every
    // hydrate call, matching the per-SSR-request layer on the server
    // so `UniqueId.make` ids line up across the boundary. Without
    // this, SSR-generated ARIA references break after hydration
    // (see #173).
    elementLayers = Layer.merge(elementLayers, makeIdGeneratorLayer());
    if (opts.layers) {
      elementLayers = Layer.merge(
        elementLayers,
        opts.layers as Layer.Layer<never, never, never>,
      );
    }

    // Build elementLayers in the OUTER program scope (kept alive by
    // Effect.never below), not in a per-element scope. Effect.provide
    // with a scoped Layer wraps the effect in a fresh scope that closes
    // as soon as the effect completes — since the element function
    // returns synchronously after building the DOM, that would tear down
    // Navigation's popstate listener, the SubscriptionRef PubSub, and
    // any other scoped resources before the user can interact.
    const context = yield* Layer.build(elementLayers);
    yield* Effect.provide(element, context);

    // Signal that the initial hydration walk is done. Browser-only
    // reactive values (Screen.match, etc.) observe this and emit their
    // live-value delta so reconcile can swap the DOM to the real state
    // — the first client render matched SSR, and now we transition off
    // the SSR-safe fallback.
    yield* renderer.completeHydration;

    // Keep the scope alive - subscriptions run in forked fibers that need to persist
    // Wait forever (until page unload) so subscription fibers stay alive
    yield* Effect.never;
  });

  // Run without awaiting completion - the Effect.never keeps it alive
  // Type assertion needed because TypeScript can't fully trace the layer dependencies
  Effect.runFork(
    Effect.scoped(program).pipe(
      Effect.provide(HydrationRendererLayer),
      Effect.provide(SignalRegistry.Live),
    ) as Effect.Effect<never>,
  );

  // Return immediately - hydration setup is synchronous, subscriptions are async
  return Promise.resolve();
}

export type { HydrationRenderer } from "./HydrationRenderer.js";
export { createHydrationRenderer } from "./HydrationRenderer.js";
export {
  HydrationContext,
  type HydrationContextService,
} from "./HydrationContext.js";
