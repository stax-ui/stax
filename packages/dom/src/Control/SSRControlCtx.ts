/**
 * SSR ControlCtx Layer implementation.
 * Renders once with hydration markers, no subscriptions or animations.
 */

import { Effect, Layer, Option, Scope } from "effect";

import {
  ControlCtx,
  RendererContext,
  Signal,
  type IControlCtx,
  type SlotEntry,
} from "@stax-ui/core";

import type { AnimationOptions } from "../Animation/index.js";
import * as Element from "../Element/index.js";
import { AnimationConfigCtx } from "./AnimationConfigCtx.js";

/**
 * The ctx-level element type. Kept narrow — slot elements are always
 * real DOM elements. `getContainer`'s default-sentinel path returns a
 * VFragment at runtime; the type still says `DOMElement` because the
 * result is only ever passed to the parent's `appendChild` (which
 * accepts both) and never inspected as an element downstream.
 */
type DOMElement = HTMLElement | SVGElement;

interface DOMSlotEntry extends SlotEntry<DOMElement> {
  readonly item: Signal.Signal<unknown>;
  readonly index: Signal.Signal<number>;
}

/**
 * Factory for `stax-N` IDs. Each `renderToString` call gets its own
 * counter via `makeSSRControlCtx` (below), so hydration IDs start at
 * `stax-1` for every request. Historically this counter was
 * module-level and only grew; across requests in a long-running SSR
 * server, that produced IDs like `stax-123` on the first control of
 * request 51, which made ID-based hydration lookup impossible.
 */
type IdFactory = () => string;

const makeIdFactory = (): IdFactory => {
  let counter = 0;
  return () => `stax-${++counter}`;
};

/**
 * What a ctx tracks after `getContainer` runs. User-supplied containers
 * stay element-shaped (so SSR output and hydration lookup match the
 * old wrapper flow one-for-one). The default path tracks a sentinel
 * pair instead, with slots inserted into the fragment before the end
 * sentinel.
 */
type ControlAnchor =
  | { readonly kind: "element"; readonly element: HTMLElement | SVGElement }
  | {
      readonly kind: "sentinels";
      readonly fragment: DocumentFragment;
      readonly start: Comment;
      readonly end: Comment;
    };

/**
 * Creates a fresh SSR control context with isolated state.
 * Each context has its own anchor, slots Map, and hydration ID.
 *
 * The `nextId` factory is shared across every fork within one
 * `renderToString` call so IDs form a single increasing sequence —
 * the same sequence hydration regenerates on the client to pair
 * SSR output with client-side control instances.
 */
const createSSRControlCtx = (nextId: IdFactory): IControlCtx<DOMElement> => {
  // Fresh state per context instance
  const slots = new Map<string, DOMSlotEntry>();
  let anchor: ControlAnchor | null = null;
  // Resolve the hydration ID lazily so the root ctx (which forks but
  // never calls getContainer) doesn't consume a counter slot. First
  // call to defaultContainer or getContainer fixes the ID; subsequent
  // calls on the same ctx reuse it.
  let hydrationId: string | null = null;
  const resolveHydrationId = (): string => (hydrationId ??= nextId());

  /**
   * The default sentinel-wrapped container. Emits a VFragment carrying
   * `[VComment("$stax-N"), VComment("/stax-N")]` — the parent's
   * `appendChild` flattens these into itself, so the SSR output is
   * two comment siblings around the slot elements (no wrapper div).
   */
  const defaultContainer: Element.Element<DOMElement, never, never> =
    Effect.gen(function* () {
      const renderer = yield* RendererContext;
      const id = resolveHydrationId();
      const fragment = (yield* renderer.createFragment()) as DocumentFragment;
      const start = (yield* renderer.createComment(`$${id}`)) as Comment;
      const end = (yield* renderer.createComment(`/${id}`)) as Comment;
      yield* renderer.appendChild(fragment, start);
      yield* renderer.appendChild(fragment, end);
      anchor = { kind: "sentinels", fragment, start, end };
      // Fragment flows out as the "container" handle; it only gets
      // passed to the parent's appendChild (which flattens it in).
      // Downstream code never inspects it as an element, so the cast
      // is a contained type lie — see the DOMElement note at the top.
      return fragment as unknown as DOMElement;
    });

  const ctx: IControlCtx<DOMElement> = {
    fork: () => Effect.succeed(createSSRControlCtx(nextId)),

    defaultContainer,

    getContainer: <E, R>(
      create?: () => Element.Element<DOMElement, E, R>,
    ): Element.Element<DOMElement, E, R> =>
      Effect.gen(function* () {
        if (anchor) {
          return anchor.kind === "element" ? anchor.element : anchor.fragment;
        }
        if (!create) {
          return yield* defaultContainer as Element.Element<DOMElement, E, R>;
        }
        const renderer = yield* RendererContext;
        const element = (yield* create()) as HTMLElement | SVGElement;
        yield* renderer.setAttribute(
          element,
          "data-stax-id",
          resolveHydrationId(),
        );
        anchor = { kind: "element", element };
        return element;
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
      },
    ): Effect.Effect<DOMSlotEntry, E, R> =>
      Effect.gen(function* () {
        const slotScope = yield* Scope.make();
        const renderer = yield* RendererContext;

        const item = yield* Signal.make(addOptions?.initialItem).pipe(
          Effect.provideService(Scope.Scope, slotScope),
        );
        const index = yield* Signal.make(addOptions?.initialIndex ?? 0).pipe(
          Effect.provideService(Scope.Scope, slotScope),
        );

        const element = (yield* render({ item, index }).pipe(
          Effect.provideService(Scope.Scope, slotScope),
        )) as HTMLElement | SVGElement;

        yield* renderer.setAttribute(element, "data-stax-key", key);

        // FOUC prevention: when the control opted into intro re-animation,
        // emit the `enterFrom` classes on the SSR/SSG output so the browser
        // paints the pre-animation state (e.g. `opacity-0`). Hydration then
        // runs the full enter lifecycle which removes them and transitions
        // to the final state. Without this, users see a flash of the final
        // state before hydration starts animating.
        const animConfigOpt = yield* Effect.serviceOption(AnimationConfigCtx);
        const animConfig = Option.getOrUndefined(animConfigOpt);
        if (animConfig?.intro) {
          const animate = (animConfig.list ?? animConfig.single) as
            AnimationOptions | undefined;
          const enterFrom = animate?.enterFrom;
          if (enterFrom) {
            for (const cls of enterFrom.split(/\s+/).filter(Boolean)) {
              yield* renderer.toggleClass(element, cls, true);
            }
          }
        }

        if (anchor?.kind === "element") {
          yield* renderer.appendChild(anchor.element, element);
        } else if (anchor?.kind === "sentinels") {
          yield* renderer.insertBefore(anchor.fragment, element, anchor.end);
        }

        const entry: DOMSlotEntry = {
          key,
          element: element as DOMElement,
          scope: slotScope,
          item,
          index,
        };
        slots.set(key, entry);

        return entry;
      }) as Effect.Effect<DOMSlotEntry, E, R>,

    finalizeContainer: () => Effect.void,

    removeSlot: (): Effect.Effect<void> => Effect.void,

    getSlot: (key: string): Effect.Effect<DOMSlotEntry | undefined> =>
      Effect.sync(() => slots.get(key)),

    getSlotKeys: (): Effect.Effect<readonly string[]> =>
      Effect.sync(() => Array.from(slots.keys())),

    moveSlot: (): Effect.Effect<void> => Effect.void,

    beginSync: (): Effect.Effect<void> => Effect.void,
    endSync: (): Effect.Effect<void> => Effect.void,

    subscribe: (): Effect.Effect<void> => Effect.void,
  };

  return ctx;
};

/**
 * SSR ControlCtx implementation.
 * Renders once with hydration markers, no subscriptions or animations.
 *
 * `Effect.sync` (not `Effect.succeed`) so the id-factory is created at
 * layer-build time, not at module import. Each `Effect.provide` that
 * builds a fresh layer gets its own counter starting at zero.
 */
export const SSRControlCtx: Layer.Layer<ControlCtx> = Layer.effect(
  ControlCtx,
  Effect.sync(
    () => createSSRControlCtx(makeIdFactory()) as IControlCtx<unknown>,
  ),
);
