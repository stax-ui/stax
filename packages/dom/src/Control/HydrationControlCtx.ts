/**
 * Hydration ControlCtx Layer implementation.
 * Finds existing DOM and attaches handlers, then subscribes like client mode.
 */

import { Context, Effect, Layer, Option, Scope } from "effect";

import {
  ControlCtx,
  RendererContext,
  Signal,
  type IControlCtx,
  type Renderer,
  type SlotEntry,
} from "@stax-ui/core";

import * as Element from "../Element/index.js";
import { DOMRenderer } from "../Render/DOMRenderer.js";
import { HydrationContext } from "../Render/hydrate/HydrationContext.js";
import {
  applyPreInsertEnterFrom,
  captureSlotRects,
  flipMovedSlots,
  forkSlotEnter,
  forkSlotRemoval,
} from "./slotAnimation.js";
import { subscribeReconcile } from "./subscribeReconcile.js";

type DOMElement = HTMLElement | SVGElement;

interface DOMSlotEntry extends SlotEntry<DOMElement> {
  readonly item: Signal.Signal<unknown>;
  readonly index: Signal.Signal<number>;
}

/**
 * Context for providing the hydration root element.
 */
export class HydrationRootCtx extends Context.Tag(
  "@stax-ui/dom/HydrationRootCtx",
)<HydrationRootCtx, DOMElement>() {}

/**
 * Creates a fresh client-like control context for nested/forked contexts during hydration.
 * Used when fork() is called - nested control functions don't read from DOM.
 *
 * AnimationConfigCtx is read lazily inside addSlot/removeSlot at the moment
 * the effect runs, not captured at construction time — that way nested control
 * flow (e.g. `each` with `animate`) sees the config its parent provided.
 */
const createClientLikeControlCtx = (
  startInClientMode = false,
): IControlCtx<DOMElement> => {
  const slots = new Map<string, DOMSlotEntry>();
  let containerElement: DOMElement | null = null;
  // Captured when getContainer runs so finalizeContainer can pop the stack
  let capturedRenderer: Renderer<unknown> | null = null;
  // Tracks whether initial hydration sync is complete.
  // After finalizeContainer, future addSlot calls use DOMRenderer.
  // When startInClientMode is true, skip the hydration phase entirely.
  let hydrationDone = startInClientMode;
  let beforeRects: Map<string, DOMRect> | null = null;

  const defaultContainer: Element.Element<DOMElement, never, never> =
    Effect.gen(function* () {
      const renderer = yield* RendererContext;
      capturedRenderer = renderer;
      const container = yield* renderer.createNode("div");
      yield* renderer.setStyleProperty(container, "display", "contents");
      // Pop the frame that createNode pushed so this helper is symmetric
      // with a user-provided `create()` (which ends with finalizeNode via
      // createElement). Without this, `getContainer`'s pushHydrationParent
      // call below would stack a second frame on top of `createNode`'s
      // and leave the walker with residue after `finalizeContainer` pops.
      // No-op on non-hydrating renderers.
      yield* renderer.finalizeNode(container);
      return container as DOMElement;
    });

  const ctx: IControlCtx<DOMElement> = {
    // Propagate hydrationDone so nested control functions created after
    // hydration finishes start in client mode immediately.
    fork: () => Effect.succeed(createClientLikeControlCtx(hydrationDone)),

    defaultContainer,

    getContainer: <E, R>(
      create?: () => Element.Element<DOMElement, E, R>,
    ): Element.Element<DOMElement, E, R> =>
      Effect.gen(function* () {
        if (containerElement) return containerElement;
        // Capture renderer for finalizeContainer
        if (!capturedRenderer) {
          capturedRenderer = yield* RendererContext;
        }

        // Fast path: pre-indexed ID lookup.
        //
        // During hydration, HydrationContext.nextControlId issues
        // `stax-1, stax-2, …` in the same order SSR did, and
        // `findById` reads from a Map<id, Element> pre-populated at
        // hydrate() entry — O(1) per lookup.
        //
        // Only applied when (a) we're still hydrating, (b) the user
        // didn't supply a custom `container` factory (that path
        // continues to use positional walking so user-supplied
        // elements don't need a `data-stax-id`), and (c) the ID
        // resolves in the pre-index. Any miss falls through to the
        // slow (positional-walk) path for safe degradation.
        if (!hydrationDone && !create) {
          const hcOpt = yield* Effect.serviceOption(HydrationContext);
          if (Option.isSome(hcOpt)) {
            const expectedId = yield* hcOpt.value.nextControlId;
            const resolved = yield* hcOpt.value.findById(expectedId);
            if (resolved) {
              yield* capturedRenderer.enterPreresolvedNode(resolved);
              containerElement = resolved as DOMElement;
              return containerElement;
            }
          }
        }

        // Slow path: positional walking.
        const container = create
          ? yield* create()
          : yield* defaultContainer as Element.Element<DOMElement, E, R>;
        containerElement = container;
        // During hydration, `create()` walked the SSR DOM to `container` and
        // then popped the traversal stack via its inner `finalizeNode`
        // (createElement's default behavior). But subsequent addSlot renders
        // need to walk INTO the container to find slot nodes — re-push the
        // container onto the walker so children resolve correctly. No-op
        // once hydration is done or on non-hydrating renderers.
        if (!hydrationDone) {
          yield* capturedRenderer.pushHydrationParent(container);
        }
        return container;
      }) as Element.Element<DOMElement, E, R>,

    addSlot: <E, R>(
      key: string,
      render: (ctx: {
        item: Signal.Signal<unknown>;
        index: Signal.Signal<number>;
      }) => Element.Element<DOMElement, E, R>,
      addOptions?: {
        atIndex?: number;
        initialItem?: unknown;
        initialIndex?: number;
        totalItems?: number;
        staggerStartAt?: number;
      },
    ): Effect.Effect<DOMSlotEntry, E, R> =>
      Effect.gen(function* () {
        const slotScope = yield* Scope.make();

        const item = yield* Signal.make(addOptions?.initialItem).pipe(
          Effect.provideService(Scope.Scope, slotScope),
        );
        const index = yield* Signal.make(addOptions?.initialIndex ?? 0).pipe(
          Effect.provideService(Scope.Scope, slotScope),
        );

        let element: DOMElement;

        if (!hydrationDone) {
          // During initial hydration: use the hydration renderer to walk
          // existing DOM and attach event handlers / reactive subscriptions.
          element = (yield* render({ item, index }).pipe(
            Effect.provideService(Scope.Scope, slotScope),
          )) as DOMElement;
          // Don't insert — content is already in the DOM
        } else {
          // After hydration: use DOMRenderer to create new DOM.
          // Provide a fresh client-mode ControlCtx so nested control flow
          // (each, matchOption, etc.) doesn't inherit the stale hydration root.
          const freshCtx = createClientLikeControlCtx(true);
          element = (yield* render({ item, index }).pipe(
            Effect.provideService(Scope.Scope, slotScope),
            Effect.provideService(
              RendererContext,
              DOMRenderer as unknown as Renderer<unknown>,
            ),
            Effect.provideService(ControlCtx, freshCtx as IControlCtx<unknown>),
          )) as DOMElement;

          // Client-mode mount — apply enterFrom before insertion (see
          // ClientControlCtx for rationale).
          yield* applyPreInsertEnterFrom(element);

          if (containerElement) {
            const children = Array.from(containerElement.children);
            const targetIndex = addOptions?.atIndex ?? children.length;
            const refChild = children[targetIndex] ?? null;
            containerElement.insertBefore(element, refChild);
          }
        }

        const entry: DOMSlotEntry = {
          key,
          element,
          scope: slotScope,
          item,
          index,
        };
        slots.set(key, entry);

        // Post-hydration → always. During hydration → forkSlotEnter checks
        // the intro flag and only runs for opted-in controls.
        yield* forkSlotEnter(element, slotScope, {
          hydrating: !hydrationDone,
          index: addOptions?.atIndex,
          total: addOptions?.totalItems,
          staggerStartAt: addOptions?.staggerStartAt,
        });

        return entry;
      }) as Effect.Effect<DOMSlotEntry, E, R>,

    finalizeContainer: () => {
      // Mark hydration as complete — future addSlot calls use DOMRenderer
      hydrationDone = true;
      // Pop the container from the hydration stack if the renderer supports it.
      // capturedRenderer was set when getContainer ran.
      if (containerElement && capturedRenderer) {
        return capturedRenderer.finalizeNode(containerElement);
      }
      return Effect.void;
    },

    removeSlot: (key: string): Effect.Effect<void, never, Scope.Scope> =>
      Effect.gen(function* () {
        const entry = slots.get(key);
        if (!entry) return;
        slots.delete(key);
        yield* forkSlotRemoval(entry, () => {
          if (
            containerElement &&
            entry.element.parentNode === containerElement
          ) {
            containerElement.removeChild(entry.element);
          }
        });
      }),

    getSlot: (key: string): Effect.Effect<DOMSlotEntry | undefined> =>
      Effect.sync(() => slots.get(key)),

    getSlotKeys: (): Effect.Effect<readonly string[]> =>
      Effect.sync(() => Array.from(slots.keys())),

    moveSlot: (key: string, toIndex: number): Effect.Effect<void> =>
      Effect.sync(() => {
        const entry = slots.get(key);
        if (!entry || !containerElement) return;

        // See the note in ClientControlCtx — exiting rows must be
        // filtered out of the sibling list so they don't get shoved
        // around before their exit animation plays.
        const active = new Set<Element>(
          Array.from(slots.values()).map((e) => e.element),
        );
        const children = Array.from(containerElement.children).filter((c) =>
          active.has(c),
        );
        const currentIndex = children.indexOf(entry.element);

        if (currentIndex === toIndex) return;

        const refChild = children[toIndex] ?? null;
        containerElement.insertBefore(entry.element, refChild);
      }),

    // Snapshot every current slot's bounding rect BEFORE removes/moves
    // run this batch. `endSync` uses this to compute per-slot deltas
    // for the FLIP release. Elements that get added this batch have no
    // pre-batch rect and so are excluded from FLIP — their enter
    // animation owns them.
    beginSync: (): Effect.Effect<void> =>
      Effect.sync(() => {
        beforeRects = captureSlotRects(slots.values());
      }),

    // Close the batch: measure each still-present slot's new rect,
    // fork the FLIP release for anything that moved. No-op when no
    // `move` config is provided by AnimationConfigCtx.
    endSync: (): Effect.Effect<void, never, Scope.Scope> =>
      Effect.gen(function* () {
        const before = beforeRects;
        beforeRects = null;
        if (!before) return;
        yield* flipMovedSlots(before, slots.values());
      }),

    subscribe: subscribeReconcile,
  };

  return ctx;
};

/**
 * Creates a hydration control context that reads from existing DOM.
 * fork() returns a client-like context for nested control functions.
 *
 * AnimationConfigCtx is read lazily inside addSlot/removeSlot — see the
 * note on createClientLikeControlCtx for why.
 */
const createHydrationControlCtx = (
  containerElement: DOMElement,
): IControlCtx<DOMElement> => {
  const slots = new Map<string, DOMSlotEntry>();
  // Tracks whether the initial hydration pass is complete.
  // Once true, fork() returns client-mode contexts.
  let hydrationComplete = false;
  // Rect snapshot captured by beginSync so endSync can compute FLIP
  // deltas per slot. Populated on every batch — during the initial
  // hydration pass the deltas will be zero (SSR DOM already matches
  // the initial value), but once `hydrationComplete` flips true this
  // is the same code path that handles reactive reorder animations
  // for hydration-root `each`s. See ClientControlCtx for details.
  let beforeRects: Map<string, DOMRect> | null = null;

  // Parse existing slots from DOM
  const children = Array.from(containerElement.children) as DOMElement[];
  for (const child of children) {
    const key = child.getAttribute("data-stax-key");
    if (key) {
      slots.set(key, {
        key,
        element: child,
        scope: null as unknown as Scope.CloseableScope,
        item: null as unknown as Signal.Signal<unknown>,
        index: null as unknown as Signal.Signal<number>,
      });
    }
  }

  const defaultContainer: Element.Element<DOMElement, never, never> =
    Effect.succeed(containerElement);

  const ctx: IControlCtx<DOMElement> = {
    // After hydration completes, nested control functions start in client mode
    fork: () => Effect.succeed(createClientLikeControlCtx(hydrationComplete)),

    defaultContainer,

    getContainer: <E, R>(
      _create?: () => Element.Element<DOMElement, E, R>,
    ): Element.Element<DOMElement, E, R> =>
      Effect.succeed(containerElement) as Element.Element<DOMElement, E, R>,

    addSlot: <E, R>(
      key: string,
      render: (ctx: {
        item: Signal.Signal<unknown>;
        index: Signal.Signal<number>;
      }) => Element.Element<DOMElement, E, R>,
      addOptions?: {
        atIndex?: number;
        initialItem?: unknown;
        initialIndex?: number;
        totalItems?: number;
        staggerStartAt?: number;
      },
    ): Effect.Effect<DOMSlotEntry, E, R> =>
      Effect.gen(function* () {
        const existing = slots.get(key);
        if (existing && existing.element) {
          const slotScope = yield* Scope.make();
          const item = yield* Signal.make(addOptions?.initialItem).pipe(
            Effect.provideService(Scope.Scope, slotScope),
          );
          const index = yield* Signal.make(addOptions?.initialIndex ?? 0).pipe(
            Effect.provideService(Scope.Scope, slotScope),
          );

          const entry: DOMSlotEntry = {
            key,
            element: existing.element,
            scope: slotScope,
            item,
            index,
          };
          slots.set(key, entry);

          // Attaching to pre-existing SSR/SSG DOM. forkSlotEnter checks the
          // intro flag and only runs the enter animation for opted-in
          // controls; ordinary content lists just wire up handlers and
          // leave the rendered DOM as-is.
          yield* forkSlotEnter(existing.element, slotScope, {
            hydrating: true,
            index: addOptions?.atIndex,
            total: addOptions?.totalItems,
            staggerStartAt: addOptions?.staggerStartAt,
          });

          return entry;
        }

        // No existing element, create new one (client fallback)
        hydrationComplete = true;
        const slotScope = yield* Scope.make();
        const item = yield* Signal.make(addOptions?.initialItem).pipe(
          Effect.provideService(Scope.Scope, slotScope),
        );
        const index = yield* Signal.make(addOptions?.initialIndex ?? 0).pipe(
          Effect.provideService(Scope.Scope, slotScope),
        );

        const freshCtx = createClientLikeControlCtx(true);
        const element = (yield* render({ item, index }).pipe(
          Effect.provideService(Scope.Scope, slotScope),
          Effect.provideService(
            RendererContext,
            DOMRenderer as unknown as Renderer<unknown>,
          ),
          Effect.provideService(ControlCtx, freshCtx as IControlCtx<unknown>),
        )) as DOMElement;

        // Client-mode fallback mount — apply enterFrom before insertion.
        yield* applyPreInsertEnterFrom(element);

        const containerChildren = Array.from(containerElement.children);
        const targetIndex = addOptions?.atIndex ?? containerChildren.length;
        const refChild = containerChildren[targetIndex] ?? null;
        containerElement.insertBefore(element, refChild);

        const entry: DOMSlotEntry = {
          key,
          element,
          scope: slotScope,
          item,
          index,
        };
        slots.set(key, entry);

        yield* forkSlotEnter(element, slotScope, {
          index: addOptions?.atIndex,
          total: addOptions?.totalItems,
          staggerStartAt: addOptions?.staggerStartAt,
        });

        return entry;
      }) as Effect.Effect<DOMSlotEntry, E, R>,

    // No-op — container was provided externally, not found via hydration walker
    finalizeContainer: () => Effect.void,

    removeSlot: (key: string): Effect.Effect<void, never, Scope.Scope> =>
      Effect.gen(function* () {
        const entry = slots.get(key);
        if (!entry) return;
        slots.delete(key);
        yield* forkSlotRemoval(entry, () => {
          if (entry.element.parentNode === containerElement) {
            containerElement.removeChild(entry.element);
          }
        });
      }),

    getSlot: (key: string): Effect.Effect<DOMSlotEntry | undefined> =>
      Effect.sync(() => slots.get(key)),

    getSlotKeys: (): Effect.Effect<readonly string[]> =>
      Effect.sync(() => Array.from(slots.keys())),

    moveSlot: (key: string, toIndex: number): Effect.Effect<void> =>
      Effect.sync(() => {
        const entry = slots.get(key);
        if (!entry) return;

        // See the note in ClientControlCtx — exiting rows must be
        // filtered out of the sibling list so they don't get shoved
        // around before their exit animation plays.
        const active = new Set<Element>(
          Array.from(slots.values()).map((e) => e.element),
        );
        const containerChildren = Array.from(containerElement.children).filter(
          (c) => active.has(c),
        );
        const currentIndex = containerChildren.indexOf(entry.element);

        if (currentIndex === toIndex) return;

        const refChild = containerChildren[toIndex] ?? null;
        containerElement.insertBefore(entry.element, refChild);
      }),

    // Snapshot every current slot's bounding rect BEFORE removes/moves
    // run this batch. Mirrors `ClientControlCtx.beginSync` — the same
    // ctx serves both the initial hydration pass (deltas end up zero,
    // no FLIP fires) and post-hydration reactive updates (real reorder
    // moves fire the FLIP release).
    beginSync: (): Effect.Effect<void> =>
      Effect.sync(() => {
        beforeRects = captureSlotRects(slots.values());
      }),

    endSync: (): Effect.Effect<void, never, Scope.Scope> =>
      Effect.gen(function* () {
        const before = beforeRects;
        beforeRects = null;
        if (!before) return;
        yield* flipMovedSlots(before, slots.values());
      }),

    subscribe: subscribeReconcile,
  };

  return ctx;
};

/**
 * Hydration ControlCtx implementation.
 * Finds existing DOM and attaches handlers, then subscribes like client mode.
 *
 * AnimationConfigCtx is intentionally NOT read here — it would be captured
 * at Layer construction time (at the hydration root), before any `each`
 * gets a chance to provide it. Instead each addSlot/removeSlot reads the
 * service lazily, mirroring ClientControlCtx.
 */
export const HydrationControlCtx: Layer.Layer<
  ControlCtx,
  never,
  HydrationRootCtx
> = Layer.effect(
  ControlCtx,
  Effect.gen(function* () {
    const containerElement = yield* HydrationRootCtx;
    return createHydrationControlCtx(containerElement) as IControlCtx<unknown>;
  }),
);
