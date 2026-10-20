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

/**
 * The ctx-level element type. Kept narrow — slot elements are always
 * real DOM elements. `getContainer`'s default-sentinel path returns a
 * DocumentFragment at runtime; the type still says `DOMElement` because
 * the result is only ever passed to the parent's `appendChild` (which
 * accepts both) and never inspected as an element downstream.
 */
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
)<HydrationRootCtx, HTMLElement | SVGElement>() {}

/**
 * Anchor the ctx uses for addSlot/moveSlot/removeSlot. User-container
 * controls stay element-shaped (same behavior as before). Default
 * containers get a sentinel pair; slot ops operate on
 * `start.parentNode` and use the start/end comments as range markers.
 */
type ControlAnchor =
  | { readonly kind: "element"; readonly element: HTMLElement | SVGElement }
  | {
      readonly kind: "sentinels";
      readonly start: Comment;
      readonly end: Comment;
    };

/**
 * Collect the elements between `start` and `end` sentinels, in order.
 * Used by moveSlot/removeSlot sibling math.
 */
const slotsBetween = (
  start: Comment,
  end: Comment,
): HTMLElement[] | SVGElement[] => {
  const out: Array<HTMLElement | SVGElement> = [];
  for (
    let n: Node | null = start.nextSibling;
    n && n !== end;
    n = n.nextSibling
  ) {
    if (n.nodeType === 1) out.push(n as HTMLElement | SVGElement);
  }
  return out as HTMLElement[] | SVGElement[];
};

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
  let anchor: ControlAnchor | null = null;
  // Captured when getContainer runs so finalizeContainer can pop the stack
  let capturedRenderer: Renderer<unknown> | null = null;
  // Tracks whether initial hydration sync is complete.
  // After finalizeContainer, future addSlot calls use DOMRenderer.
  // When startInClientMode is true, skip the hydration phase entirely.
  let hydrationDone = startInClientMode;
  let beforeRects: Map<string, DOMRect> | null = null;

  /**
   * Default sentinel-anchored container. Only used in pure client mode
   * (post-hydration slow path, or no HydrationContext). The returned
   * fragment holds the sentinel pair; subsequent addSlots insert slots
   * before the end sentinel, and the fragment gets flattened into the
   * parent on mount so the sentinels and slots become the parent's own
   * children.
   */
  const defaultContainer: Element.Element<DOMElement, never, never> =
    Effect.gen(function* () {
      const renderer = yield* RendererContext;
      capturedRenderer = renderer;
      const fragment = (yield* renderer.createFragment()) as DocumentFragment;
      const start = (yield* renderer.createComment("$stax")) as Comment;
      const end = (yield* renderer.createComment("/stax")) as Comment;
      yield* renderer.appendChild(fragment, start);
      yield* renderer.appendChild(fragment, end);
      anchor = { kind: "sentinels", start, end };
      // See the DOMElement note above — fragment flows out as a handle
      // for the parent's appendChild (a no-op in hydration), never
      // inspected as an element.
      return fragment as unknown as DOMElement;
    });

  /** Dynamic parent of the sentinel range: fragment pre-mount, real parent post-mount. */
  const anchorParent = (): Node | null => {
    if (!anchor) return null;
    if (anchor.kind === "element") return anchor.element;
    return anchor.start.parentNode;
  };

  const ctx: IControlCtx<DOMElement> = {
    // Propagate hydrationDone so nested control functions created after
    // hydration finishes start in client mode immediately.
    fork: () => Effect.succeed(createClientLikeControlCtx(hydrationDone)),

    defaultContainer,

    getContainer: <E, R>(
      create?: () => Element.Element<DOMElement, E, R>,
    ): Element.Element<DOMElement, E, R> =>
      Effect.gen(function* () {
        if (anchor) {
          return (
            anchor.kind === "element" ? anchor.element : anchor.start.parentNode
          ) as DOMElement;
        }
        if (!capturedRenderer) {
          capturedRenderer = yield* RendererContext;
        }

        // Fast path: pre-indexed ID lookup during hydration.
        //
        // `nextControlId` issues `stax-N` in the same order SSR did, and
        // `findControl` resolves either to an element (user-container
        // case) or a sentinel pair (default container).
        if (!hydrationDone) {
          const hcOpt = yield* Effect.serviceOption(HydrationContext);
          if (Option.isSome(hcOpt)) {
            const expectedId = yield* hcOpt.value.nextControlId;
            const resolved = yield* hcOpt.value.findControl(expectedId);
            if (resolved) {
              if (resolved.kind === "element") {
                yield* capturedRenderer.enterPreresolvedNode(resolved.element);
                anchor = { kind: "element", element: resolved.element };
                return resolved.element;
              }
              yield* capturedRenderer.enterSentinelAnchor(resolved.start);
              anchor = {
                kind: "sentinels",
                start: resolved.start,
                end: resolved.end,
              };
              // The "container" value is only meaningful as an argument
              // to the parent's `appendChild`, which is a no-op during
              // hydration — return the start comment as a vestigial
              // handle so callers can still thread it through.
              return resolved.start as unknown as DOMElement;
            }
          }
        }

        // Slow path. User-supplied container, or default fragment+sentinels.
        if (create) {
          const element = (yield* create()) as HTMLElement | SVGElement;
          anchor = { kind: "element", element };
          // During hydration, `create()` walked the SSR DOM to `element`
          // then popped via `finalizeNode`. Subsequent addSlot renders
          // need the container back on top of the walker.
          if (!hydrationDone) {
            yield* capturedRenderer.pushHydrationParent(element);
          }
          return element;
        }
        return yield* defaultContainer as Element.Element<DOMElement, E, R>;
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

        let element: HTMLElement | SVGElement;

        if (!hydrationDone) {
          // During initial hydration: the hydration renderer walks existing
          // DOM. For a sentinel anchor, the walker's current frame is the
          // sentinel's parent (positioned past the start comment) — slot
          // renders find their elements as the next siblings. For an
          // element anchor, the frame is the container itself (standard).
          element = (yield* render({ item, index }).pipe(
            Effect.provideService(Scope.Scope, slotScope),
          )) as HTMLElement | SVGElement;
          // Don't insert — content is already in the DOM.
        } else {
          // Post-hydration: use DOMRenderer to create fresh DOM.
          const freshCtx = createClientLikeControlCtx(true);
          element = (yield* render({ item, index }).pipe(
            Effect.provideService(Scope.Scope, slotScope),
            Effect.provideService(
              RendererContext,
              DOMRenderer as unknown as Renderer<unknown>,
            ),
            Effect.provideService(ControlCtx, freshCtx as IControlCtx<unknown>),
          )) as HTMLElement | SVGElement;

          yield* applyPreInsertEnterFrom(element);

          if (anchor?.kind === "element") {
            const children = Array.from(anchor.element.children);
            const targetIndex = addOptions?.atIndex ?? children.length;
            const refChild = children[targetIndex] ?? null;
            anchor.element.insertBefore(element, refChild);
          } else if (anchor?.kind === "sentinels") {
            const parent = anchor.start.parentNode;
            if (parent) {
              const siblings = slotsBetween(anchor.start, anchor.end);
              const targetIndex = addOptions?.atIndex ?? siblings.length;
              const refNode = siblings[targetIndex] ?? anchor.end;
              parent.insertBefore(element, refNode);
            }
          }
        }

        const entry: DOMSlotEntry = {
          key,
          element: element as DOMElement,
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
      // Mark hydration as complete — future addSlot calls use DOMRenderer.
      hydrationDone = true;
      if (!anchor || !capturedRenderer) return Effect.void;
      // Pop the walker frame or skip past the end sentinel so surrounding
      // siblings resume from the correct position.
      if (anchor.kind === "element") {
        return capturedRenderer.finalizeNode(anchor.element);
      }
      return capturedRenderer.exitSentinelAnchor(anchor.end);
    },

    removeSlot: (key: string): Effect.Effect<void, never, Scope.Scope> =>
      Effect.gen(function* () {
        const entry = slots.get(key);
        if (!entry) return;
        slots.delete(key);
        yield* forkSlotRemoval(entry, () => {
          const slotEl = entry.element as HTMLElement | SVGElement;
          const parent = anchorParent();
          if (parent && slotEl.parentNode === parent) {
            parent.removeChild(slotEl);
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
        if (!entry || !anchor) return;

        // See the note in ClientControlCtx — exiting rows must be
        // filtered out of the sibling list so they don't get shoved
        // around before their exit animation plays.
        const active = new Set<Element>(
          Array.from(slots.values()).map(
            (e) => e.element as HTMLElement | SVGElement,
          ),
        );

        if (anchor.kind === "element") {
          const siblings = Array.from(anchor.element.children).filter((c) =>
            active.has(c),
          );
          const currentIndex = siblings.indexOf(
            entry.element as HTMLElement | SVGElement,
          );
          if (currentIndex === toIndex) return;
          const refChild = siblings[toIndex] ?? null;
          anchor.element.insertBefore(
            entry.element as HTMLElement | SVGElement,
            refChild,
          );
        } else {
          const parent = anchor.start.parentNode;
          if (!parent) return;
          const siblings = slotsBetween(anchor.start, anchor.end).filter((c) =>
            active.has(c),
          );
          const currentIndex = siblings.indexOf(
            entry.element as HTMLElement | SVGElement,
          );
          if (currentIndex === toIndex) return;
          const refNode = siblings[toIndex] ?? anchor.end;
          parent.insertBefore(
            entry.element as HTMLElement | SVGElement,
            refNode,
          );
        }
      }),

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
 * Creates a hydration control context that reads from existing DOM.
 * fork() returns a client-like context for nested control functions.
 *
 * AnimationConfigCtx is read lazily inside addSlot/removeSlot — see the
 * note on createClientLikeControlCtx for why.
 */
const createHydrationControlCtx = (
  containerElement: HTMLElement | SVGElement,
): IControlCtx<DOMElement> => {
  const slots = new Map<string, DOMSlotEntry>();
  // Tracks whether the initial hydration pass is complete.
  // Once true, fork() returns client-mode contexts.
  let hydrationComplete = false;
  let beforeRects: Map<string, DOMRect> | null = null;

  // Parse existing slots from DOM — top-level HydrationControlCtx reads
  // `data-stax-key` off the container's children since there's no
  // reconcile pass to walk them positionally. Only applies when the
  // hydration root is itself a control-flow container (user-supplied).
  const children = Array.from(containerElement.children) as Array<
    HTMLElement | SVGElement
  >;
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

          yield* forkSlotEnter(
            existing.element as HTMLElement | SVGElement,
            slotScope,
            {
              hydrating: true,
              index: addOptions?.atIndex,
              total: addOptions?.totalItems,
              staggerStartAt: addOptions?.staggerStartAt,
            },
          );

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
        )) as HTMLElement | SVGElement;

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
          const slotEl = entry.element as HTMLElement | SVGElement;
          if (slotEl.parentNode === containerElement) {
            containerElement.removeChild(slotEl);
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

        const active = new Set<Element>(
          Array.from(slots.values()).map(
            (e) => e.element as HTMLElement | SVGElement,
          ),
        );
        const containerChildren = Array.from(containerElement.children).filter(
          (c) => active.has(c),
        );
        const currentIndex = containerChildren.indexOf(
          entry.element as HTMLElement | SVGElement,
        );

        if (currentIndex === toIndex) return;

        const refChild = containerChildren[toIndex] ?? null;
        containerElement.insertBefore(
          entry.element as HTMLElement | SVGElement,
          refChild,
        );
      }),

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
