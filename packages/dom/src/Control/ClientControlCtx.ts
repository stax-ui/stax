/**
 * Client-side ControlCtx Layer implementation.
 * Full reactive updates with optional animation support.
 */

import { Effect, Layer, Scope } from "effect";

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
 * Anchor the ctx uses for addSlot/moveSlot/removeSlot. User-supplied
 * containers stay element-shaped; default containers use a sentinel
 * pair and operate on `start.parentNode` (the fragment pre-mount, the
 * real parent after `parent.appendChild(fragment)` flattens it in).
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
): Array<HTMLElement | SVGElement> => {
  const out: Array<HTMLElement | SVGElement> = [];
  for (
    let n: Node | null = start.nextSibling;
    n && n !== end;
    n = n.nextSibling
  ) {
    if (n.nodeType === 1) out.push(n as HTMLElement | SVGElement);
  }
  return out;
};

/**
 * Creates a fresh client control context with isolated state.
 * Each context has its own anchor and slots Map.
 */
const createClientControlCtx = (): IControlCtx<DOMElement> => {
  const slots = new Map<string, DOMSlotEntry>();
  let anchor: ControlAnchor | null = null;
  // Rect snapshot captured by beginSync so endSync can compute FLIP
  // deltas per slot. Null between batches. See slotAnimation.ts for the
  // release mechanics.
  let beforeRects: Map<string, DOMRect> | null = null;

  /**
   * Default sentinel-anchored container. Builds `[start, end]` into a
   * fresh DocumentFragment; the parent's `appendChild` flattens them
   * into itself on mount, after which `start.parentNode` is the real
   * parent and all slot ops operate relative to that.
   */
  const defaultContainer: Element.Element<DOMElement, never, never> =
    Effect.gen(function* () {
      const renderer = yield* RendererContext;
      const fragment = (yield* renderer.createFragment()) as DocumentFragment;
      const start = (yield* renderer.createComment("$stax")) as Comment;
      const end = (yield* renderer.createComment("/stax")) as Comment;
      yield* renderer.appendChild(fragment, start);
      yield* renderer.appendChild(fragment, end);
      anchor = { kind: "sentinels", start, end };
      // See the DOMElement note above — fragment flows out as a handle
      // for the parent's appendChild, never inspected as an element.
      return fragment as unknown as DOMElement;
    });

  const anchorParent = (): Node | null => {
    if (!anchor) return null;
    return anchor.kind === "element" ? anchor.element : anchor.start.parentNode;
  };

  const ctx: IControlCtx<DOMElement> = {
    fork: () => Effect.succeed(createClientControlCtx()),

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
        if (create) {
          const element = (yield* create()) as HTMLElement | SVGElement;
          anchor = { kind: "element", element };
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

        const element = (yield* render({ item, index }).pipe(
          Effect.provideService(Scope.Scope, slotScope),
          Effect.provideService(
            RendererContext,
            DOMRenderer as unknown as Renderer<unknown>,
          ),
        )) as HTMLElement | SVGElement;

        // Apply enterFrom classes BEFORE inserting into the DOM, so the
        // browser's first paint of this element is already in the hidden
        // pre-animation state. Otherwise there's a one-frame flash of the
        // resolved state before forkSlotEnter's fiber gets to apply them.
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

        const entry: DOMSlotEntry = {
          key,
          element: element as DOMElement,
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

    finalizeContainer: () => Effect.void,

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

        // Filter DOM children down to active slots — exiting rows are
        // still in the DOM while their exit animation plays, but they
        // were removed from the `slots` map by `removeSlot`. Treating
        // them as siblings for index math would shove them around
        // (typically off the end of the DOM) before their exit
        // finishes, producing a visible "flash to the wrong spot"
        // before the fade. Filtering makes the exiting row hold its
        // position while the exit collapses it in place.
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
 * Client-side ControlCtx implementation.
 * Animation config is read at runtime in addSlot/removeSlot, not at Layer creation.
 */
export const ClientControlCtx: Layer.Layer<ControlCtx> = Layer.effect(
  ControlCtx,
  Effect.succeed(createClientControlCtx() as IControlCtx<unknown>),
);
