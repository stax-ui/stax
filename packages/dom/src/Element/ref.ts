import { Data, Effect, Predicate, Stream } from "effect";

import { Readable } from "@stax-ui/core";

// The DOM's `Element` interface, aliased to avoid colliding with stax's
// `Element` namespace once tsup bundles the `.d.ts`. Without this alias
// the bundler renames the stax `Element` to `Element$1` and sometimes
// rewrites DOM references to match, producing `Cannot use namespace
// 'Element$1' as a type` under `skipLibCheck: false`.
type DOMElement = globalThis.Element;

// -----------------------------------------------------------------------------
// TypeId
// -----------------------------------------------------------------------------

export const ElementRefTypeId: unique symbol = Symbol.for(
  "stax/dom/ElementRef",
);
export type ElementRefTypeId = typeof ElementRefTypeId;

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

/**
 * Error thrown when attempting to access an element ref that has no element bound.
 * This occurs when the element hasn't been mounted yet or the ref wasn't bound to any element.
 */
export class NoSuchElementException extends Data.TaggedError(
  "NoSuchElementException",
)<{
  readonly message?: string;
}> {}

/**
 * Error thrown when attempting to get an attribute that doesn't exist on an element.
 */
export class AttributeNotFound extends Data.TaggedError("AttributeNotFound")<{
  readonly attribute: string;
  readonly message?: string;
}> {}

/**
 * Error thrown when attempting to get a data attribute that doesn't exist on an element.
 */
export class DataAttributeNotFound extends Data.TaggedError(
  "DataAttributeNotFound",
)<{
  readonly key: string;
  readonly message?: string;
}> {}

// -----------------------------------------------------------------------------
// Models
// -----------------------------------------------------------------------------

/**
 * A reference to a DOM element represented as an Effect.
 * The Effect itself serves as the ref identity - pass it to the `ref` prop
 * of an element and use it to access the element in Effect pipelines.
 *
 * @template T - The element type (defaults to HTMLElement, also supports SVGElement)
 *
 * @example
 * ```ts
 * const buttonRef = yield* Element.ref<HTMLButtonElement>();
 *
 * // Pipeable in event handlers
 * const handleClick = () =>
 *   buttonRef.pipe(
 *     Element.addClass("clicked"),
 *     Element.focus,
 *     Effect.asVoid
 *   );
 *
 * // Pass to element
 * return yield* $.button({ ref: buttonRef, onClick: handleClick }, "Click");
 *
 * // React to element being connected to the DOM
 * yield* buttonRef.isConnected.pipe(
 *   Readable.tap((connected) =>
 *     Effect.sync(() => {
 *       if (connected) {
 *         const el = Element.getUnsafe(buttonRef);
 *         // Measure or manipulate element after it's in the DOM
 *       }
 *     })
 *   )
 * );
 * ```
 */
export interface ElementRef<
  T extends DOMElement = HTMLElement | SVGElement,
> extends Effect.Effect<T, NoSuchElementException> {
  readonly [ElementRefTypeId]: ElementRefTypeId;
  /**
   * A Readable that tracks whether the element is connected to the DOM.
   */
  readonly isConnected: Readable.Readable<boolean>;
}

// -----------------------------------------------------------------------------
// Type Guards
// -----------------------------------------------------------------------------

/**
 * Check if the given value is an ElementRef.
 */
export const isElementRef = (value: unknown): value is ElementRef =>
  Predicate.hasProperty(value, ElementRefTypeId);

// -----------------------------------------------------------------------------
// Internal State
// -----------------------------------------------------------------------------

/**
 * Internal WeakMap that binds ref Effects to their DOM elements.
 * Uses WeakMap so refs can be garbage collected when no longer referenced.
 * @internal
 */
const elementRefMap = new WeakMap<
  Effect.Effect<DOMElement, NoSuchElementException>,
  DOMElement
>();

// -----------------------------------------------------------------------------
// Internal Helpers
// -----------------------------------------------------------------------------

/**
 * Bind an element to a ref. Called internally during element creation.
 * @internal
 */
export const bindElementToRef = <T extends DOMElement>(
  ref: ElementRef<T>,
  element: T,
): void => {
  elementRefMap.set(ref, element);
};

/**
 * Unbind an element from a ref. Can be called on element unmount.
 * @internal
 */
export const unbindElementFromRef = <T extends DOMElement>(
  ref: ElementRef<T>,
): void => {
  elementRefMap.delete(ref);
};

/**
 * Get element from ref synchronously.
 * @internal
 */
const getElementFromRef = <T extends DOMElement>(
  ref: ElementRef<T>,
): T | null => {
  return (elementRefMap.get(ref) as T) ?? null;
};

// -----------------------------------------------------------------------------
// Constructors
// -----------------------------------------------------------------------------

/**
 * Create a new element ref that can be passed to the `ref` prop
 * and used to access the element in Effects.
 *
 * @returns An Effect that when yielded returns an ElementRef
 *
 * @example
 * ```ts
 * const buttonRef = yield* Element.ref<HTMLButtonElement>();
 *
 * const handleClick = () =>
 *   buttonRef.pipe(
 *     Element.addClass("clicked"),
 *     Element.focus,
 *     Effect.asVoid
 *   );
 *
 * return yield* $.button({ ref: buttonRef, onClick: handleClick }, "Click");
 * ```
 */
export const make = <
  T extends DOMElement = HTMLElement | SVGElement,
>(): Effect.Effect<ElementRef<T>> =>
  Effect.sync(() => {
    // Create a suspended Effect that reads from the WeakMap
    const refEffect = Effect.suspend(() => {
      const element = elementRefMap.get(refEffect) as T | undefined;
      if (element) {
        return Effect.succeed(element);
      }
      return Effect.fail(
        new NoSuchElementException({
          message: "Element not mounted or ref not bound to any element",
        }),
      );
    });

    // Track connection state with RAF-based polling
    let lastConnected = false;
    const subscribers = new Set<(connected: boolean) => void>();
    let pollingActive = false;

    const startPolling = () => {
      if (pollingActive) return;
      pollingActive = true;

      const poll = () => {
        const element = elementRefMap.get(refEffect);
        const connected = element?.isConnected ?? false;

        if (connected !== lastConnected) {
          lastConnected = connected;
          for (const sub of subscribers) {
            sub(connected);
          }
        }

        // Continue polling only while there are subscribers
        if (subscribers.size > 0) {
          requestAnimationFrame(poll);
        } else {
          pollingActive = false;
        }
      };

      requestAnimationFrame(poll);
    };

    // Create the isConnected Readable using Readable.make
    const isConnected = Readable.make<boolean>(
      Effect.sync(() => {
        const element = elementRefMap.get(refEffect);
        return element?.isConnected ?? false;
      }),
      () =>
        Stream.async<boolean>((emit) => {
          const handler = (connected: boolean) => emit.single(connected);
          subscribers.add(handler);
          startPolling();
          return Effect.sync(() => {
            subscribers.delete(handler);
          });
        }),
    );

    // Attach TypeId and isConnected to the ref Effect
    const ref = refEffect as ElementRef<T>;
    (ref as unknown as Record<symbol, unknown>)[ElementRefTypeId] =
      ElementRefTypeId;
    (ref as unknown as Record<string, unknown>).isConnected = isConnected;

    return ref;
  });

// -----------------------------------------------------------------------------
// Accessors
// -----------------------------------------------------------------------------

/**
 * Synchronously get the element from a ref, returning null if not mounted.
 * Use this for imperative code paths where you need synchronous access.
 *
 * @param ref - The element ref created by Element.ref()
 * @returns The element or null if not mounted
 *
 * @example
 * ```ts
 * const el = Element.getUnsafe(buttonRef);
 * if (el) {
 *   el.style.transform = `translateX(${x}px)`;
 * }
 * ```
 */
export const getUnsafe = <T extends DOMElement>(ref: ElementRef<T>): T | null =>
  getElementFromRef(ref);
