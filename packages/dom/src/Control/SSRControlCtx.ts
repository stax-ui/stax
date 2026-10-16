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
 * Creates a fresh SSR control context with isolated state.
 * Each context has its own containerElement, slots Map, and hydration ID.
 *
 * The `nextId` factory is shared across every fork within one
 * `renderToString` call so IDs form a single increasing sequence —
 * the same sequence hydration regenerates on the client to pair
 * SSR output with client-side control instances.
 */
const createSSRControlCtx = (nextId: IdFactory): IControlCtx<DOMElement> => {
  // Fresh state per context instance
  const slots = new Map<string, DOMSlotEntry>();
  let containerElement: DOMElement | null = null;
  // Resolve the hydration ID lazily so the root ctx (which forks but
  // never calls getContainer) doesn't consume a counter slot. First
  // call to defaultContainer or getContainer fixes the ID; subsequent
  // calls on the same ctx reuse it.
  let hydrationId: string | null = null;
  const resolveHydrationId = (): string => (hydrationId ??= nextId());

  const defaultContainer: Element.Element<DOMElement, never, never> =
    Effect.gen(function* () {
      const renderer = yield* RendererContext;
      const container = yield* renderer.createNode("div");
      yield* renderer.setStyleProperty(container, "display", "contents");
      yield* renderer.setAttribute(
        container,
        "data-stax-id",
        resolveHydrationId(),
      );
      return container as DOMElement;
    });

  const ctx: IControlCtx<DOMElement> = {
    fork: () => Effect.succeed(createSSRControlCtx(nextId)),

    defaultContainer,

    getContainer: <E, R>(
      create?: () => Element.Element<DOMElement, E, R>,
    ): Element.Element<DOMElement, E, R> =>
      Effect.gen(function* () {
        if (containerElement) return containerElement;
        const renderer = yield* RendererContext;
        const container = create
          ? yield* create()
          : yield* defaultContainer as Element.Element<DOMElement, E, R>;
        yield* renderer.setAttribute(
          container,
          "data-stax-id",
          resolveHydrationId(),
        );
        containerElement = container;
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
        )) as DOMElement;

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

        if (containerElement) {
          yield* renderer.appendChild(containerElement, element);
        }

        const entry: DOMSlotEntry = {
          key,
          element,
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
