/**
 * Client-side mounting for Stax applications.
 *
 * @example
 * ```ts
 * import { mount } from "@stax-ui/dom/client";
 * import { App } from "./App";
 *
 * mount(App(), document.getElementById("root")!);
 * ```
 *
 * @example
 * ```ts
 * // With a router / other client layers
 * import { mount } from "@stax-ui/dom/client";
 * import { Navigation } from "@stax-ui/router";
 * import { App } from "./App";
 * import { router } from "./routes";
 *
 * mount(App(), document.getElementById("root")!, {
 *   layers: Navigation.makeLayer(router),
 * });
 * ```
 *
 * @module
 */

import { Effect, Layer, Scope } from "effect";

import {
  RendererContext,
  SignalRegistry,
  type ControlCtx,
  type Renderer,
  type SuspenseBoundaryCtx,
} from "@stax-ui/core";

import { ClientAsyncCacheLayer } from "../../ClientAsyncCache.js";
import { ClientControlCtx } from "../../Control/ClientControlCtx.js";
import * as Element from "../../Element/index.js";
import { ClientSuspenseBoundaryCtx } from "../../SuspenseBoundaryCtx/ClientSuspenseBoundaryCtx.js";
import { makeIdGeneratorLayer } from "../../UniqueId.js";
import { DOMRenderer } from "../DOMRenderer.js";

/**
 * Provides the client-side rendering layers (Renderer, ControlCtx,
 * SuspenseBoundary, AsyncCache) to an element, renders it, and
 * inserts it into the container. Registers a scoped finalizer to
 * pull the element back out when the scope closes.
 *
 * The scoped variant that {@link mount} builds on top of, exported
 * for tests that want to observe DOM after insertion without the
 * fiber getting parked on `Effect.never`. Real applications should
 * use `mount` directly.
 *
 * @internal
 */
export const _mountScoped = (
  element: Element.Element<
    HTMLElement,
    never,
    RendererContext | ControlCtx | SuspenseBoundaryCtx
  >,
  container: HTMLElement,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const rendererLayer = Layer.succeed(
      RendererContext,
      DOMRenderer as Renderer<unknown>,
    );
    const suspenseLayer = Layer.provide(
      ClientSuspenseBoundaryCtx,
      rendererLayer,
    );
    const el = yield* element.pipe(
      Effect.provide(rendererLayer),
      Effect.provide(ClientControlCtx),
      Effect.provide(suspenseLayer),
      Effect.provide(ClientAsyncCacheLayer),
      // Per-app `IdGenerator` so `UniqueId.make` ids restart at zero
      // for each `mount` call. In an SPA this is per page-load; in an
      // SSR app the matching reset happens inside `hydrate`.
      Effect.provide(makeIdGeneratorLayer()),
    );
    container.appendChild(el);

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (el.parentNode === container) {
          container.removeChild(el);
        }
      }),
    );
  });

/**
 * Mount a Stax application into a DOM container.
 *
 * Handles every piece of client-side app startup:
 *
 * - Provides the client-side rendering layers (Renderer, ControlCtx,
 *   SuspenseBoundary, AsyncCache) plus `SignalRegistry`.
 * - Optionally merges caller-supplied layers (typically the Navigation
 *   layer from `@stax-ui/router`, plus anything else the app needs).
 * - Renders the element and appends it to the container.
 * - Keeps the fiber alive until page unload so scoped subscriptions —
 *   signals, streams, popstate listeners — stay live.
 *
 * The element must be error-free (`Element<A, never, ...>`) — handle
 * failures with `Boundary.error` before mounting. Any layer requirements
 * beyond the built-in client layers must be supplied via `options.layers`.
 *
 * The returned Promise never resolves — that's intentional. Mount is a
 * terminal operation: it stakes out the fiber that owns the page's
 * reactive lifetime.
 *
 * @example Simple app
 * ```ts
 * import { mount } from "@stax-ui/dom";
 * import { App } from "./App";
 *
 * mount(App(), document.getElementById("root")!);
 * ```
 *
 * @example App with a router
 * ```ts
 * import { mount } from "@stax-ui/dom";
 * import { Navigation } from "@stax-ui/router";
 * import { App } from "./App";
 * import { router } from "./routes";
 *
 * mount(App(), document.getElementById("root")!, {
 *   layers: Navigation.makeLayer(router),
 * });
 * ```
 *
 * @example App with multiple layers
 * ```ts
 * mount(App(), root, {
 *   layers: Layer.mergeAll(
 *     Navigation.makeLayer(router),
 *     Layer.succeed(MyContext, myService),
 *   ),
 * });
 * ```
 */
export const mount = <R = never>(
  element: Element.Element<
    HTMLElement,
    never,
    RendererContext | ControlCtx | SuspenseBoundaryCtx | R
  >,
  container: HTMLElement,
  options?: {
    readonly layers?: Layer.Layer<R, never, never>;
  },
): Promise<void> => {
  const program = Effect.gen(function* () {
    yield* _mountScoped(
      element as Element.Element<
        HTMLElement,
        never,
        RendererContext | ControlCtx | SuspenseBoundaryCtx
      >,
      container,
    );
    // Terminal: hold the fiber open so scoped resources (subscription
    // streams, popstate listeners, PubSubs) live for the page's lifetime.
    yield* Effect.never;
  });

  let effect: Effect.Effect<void, never, R> = Effect.scoped(program).pipe(
    Effect.provide(SignalRegistry.Live),
  ) as Effect.Effect<void, never, R>;

  if (options?.layers) {
    effect = effect.pipe(Effect.provide(options.layers)) as Effect.Effect<
      void,
      never,
      R
    >;
  }

  return Effect.runPromise(effect as Effect.Effect<void, never, never>);
};
