/**
 * DOM Element factories built on the core Element API.
 * Provides convenient $.div, $.span, etc. syntax for creating elements.
 */

import { Effect, Option, Stream } from "effect";
import { isEffect } from "effect/Effect";

import { MergePropsCtx, Readable, RendererContext } from "@stax-ui/core";

import * as Core from "./core.js";
import type { ElementRef } from "./ref.js";
import type { Child, ChildInput, ChildNode, Element } from "./types.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Handler for DOM events that must return an Effect.
 * Errors must be handled (E = never) and no requirements allowed (R = never).
 */
export type EventHandler<E extends Event> = (
  event: E,
) => Effect.Effect<void, never, never>;

/**
 * Valid values for inline styles.
 */
export type StyleValue = string | number | Readable.Readable<string | number>;

/**
 * A single class-list entry that may appear in a class tree. Recursive so
 * arrays of arrays can be composed freely (e.g. defaults ++ overrides), and
 * `undefined | null | false` are permitted so callers can pass through
 * optional class props without a `?? ""` dance.
 */
export type ClassItem =
  | string
  | undefined
  | null
  | false
  | Readable.Readable<string>
  | readonly ClassItem[];

/**
 * Valid class value types. Either a class tree (see {@link ClassItem}) or a
 * top-level `Readable` that emits the entire class list at once (as a string
 * or a `readonly string[]`).
 */
export type ClassValue = ClassItem | Readable.Readable<readonly string[]>;

/**
 * Data/ARIA attribute value.
 */
export type AttributeValue =
  | string
  | boolean
  | number
  | undefined
  | Readable.Readable<string | boolean | number | undefined>;

/**
 * Base attributes available on all elements (HTML and SVG).
 */
export interface BaseElementAttributes<T extends HTMLElement | SVGElement> {
  readonly class?: ClassValue;
  readonly style?:
    Record<string, StyleValue> | Readable.Readable<Record<string, string>>;
  readonly id?: string | Readable.Readable<string>;
  readonly role?: string | Readable.Readable<string>;
  readonly ref?: ElementRef<T>;
  readonly innerHTML?: string | Readable.Readable<string>;
  readonly tabIndex?: number | Readable.Readable<number>;
  readonly hidden?: boolean | Readable.Readable<boolean>;
  readonly title?: string | Readable.Readable<string>;
  // Allow data-* and aria-* attributes
  readonly [key: `data-${string}`]: AttributeValue;
  readonly [key: `aria-${string}`]: AttributeValue;
}

/**
 * Common event handler attributes.
 */
export interface EventAttributes {
  readonly onClick?: EventHandler<MouseEvent>;
  readonly onInput?: EventHandler<InputEvent>;
  readonly onChange?: EventHandler<Event>;
  readonly onSubmit?: EventHandler<SubmitEvent>;
  readonly onKeyDown?: EventHandler<KeyboardEvent>;
  readonly onKeyUp?: EventHandler<KeyboardEvent>;
  readonly onKeyPress?: EventHandler<KeyboardEvent>;
  readonly onFocus?: EventHandler<FocusEvent>;
  readonly onBlur?: EventHandler<FocusEvent>;
  readonly onMouseDown?: EventHandler<MouseEvent>;
  readonly onMouseUp?: EventHandler<MouseEvent>;
  readonly onMouseEnter?: EventHandler<MouseEvent>;
  readonly onMouseLeave?: EventHandler<MouseEvent>;
  readonly onMouseMove?: EventHandler<MouseEvent>;
  readonly onContextMenu?: EventHandler<MouseEvent>;
  readonly onPointerDown?: EventHandler<PointerEvent>;
  readonly onPointerUp?: EventHandler<PointerEvent>;
  readonly onPointerMove?: EventHandler<PointerEvent>;
  readonly onPointerEnter?: EventHandler<PointerEvent>;
  readonly onPointerLeave?: EventHandler<PointerEvent>;
  readonly onPointerCancel?: EventHandler<PointerEvent>;
  readonly onScroll?: EventHandler<Event>;
  readonly onWheel?: EventHandler<WheelEvent>;
  readonly onDragStart?: EventHandler<DragEvent>;
  readonly onDrag?: EventHandler<DragEvent>;
  readonly onDragEnd?: EventHandler<DragEvent>;
  readonly onDrop?: EventHandler<DragEvent>;
  readonly onDragOver?: EventHandler<DragEvent>;
  readonly onDragEnter?: EventHandler<DragEvent>;
  readonly onDragLeave?: EventHandler<DragEvent>;
  readonly onTouchStart?: EventHandler<TouchEvent>;
  readonly onTouchMove?: EventHandler<TouchEvent>;
  readonly onTouchEnd?: EventHandler<TouchEvent>;
  readonly onTouchCancel?: EventHandler<TouchEvent>;
  readonly onAnimationStart?: EventHandler<AnimationEvent>;
  readonly onAnimationEnd?: EventHandler<AnimationEvent>;
  readonly onAnimationIteration?: EventHandler<AnimationEvent>;
  readonly onTransitionEnd?: EventHandler<TransitionEvent>;
}

/**
 * HTML attributes combining base and events.
 */
export type HTMLAttributes<T extends HTMLElement = HTMLElement> =
  BaseElementAttributes<T> &
    EventAttributes & {
      // Common HTML attributes
      readonly disabled?: boolean | Readable.Readable<boolean>;
      readonly name?: string | Readable.Readable<string>;
      readonly value?: string | number | Readable.Readable<string | number>;
      readonly checked?: boolean | Readable.Readable<boolean>;
      readonly selected?: boolean | Readable.Readable<boolean>;
      readonly type?: string | Readable.Readable<string>;
      readonly placeholder?: string | Readable.Readable<string>;
      readonly href?: string | Readable.Readable<string>;
      readonly src?: string | Readable.Readable<string>;
      readonly alt?: string | Readable.Readable<string>;
      readonly for?: string | Readable.Readable<string>;
      readonly action?: string | Readable.Readable<string>;
      readonly method?: string | Readable.Readable<string>;
      readonly target?: string | Readable.Readable<string>;
      readonly rel?: string | Readable.Readable<string>;
      readonly autocomplete?: string | Readable.Readable<string>;
      readonly min?: string | number | Readable.Readable<string | number>;
      readonly max?: string | number | Readable.Readable<string | number>;
      readonly step?: string | number | Readable.Readable<string | number>;
      readonly pattern?: string | Readable.Readable<string>;
      readonly required?: boolean | Readable.Readable<boolean>;
      readonly readonly?: boolean | Readable.Readable<boolean>;
      readonly multiple?: boolean | Readable.Readable<boolean>;
      readonly rows?: number | Readable.Readable<number>;
      readonly cols?: number | Readable.Readable<number>;
      readonly wrap?: string | Readable.Readable<string>;
      readonly width?: string | number | Readable.Readable<string | number>;
      readonly height?: string | number | Readable.Readable<string | number>;
      readonly open?: boolean | Readable.Readable<boolean>;
      // Allow any other string attributes for flexibility
      readonly [key: string]: unknown;
    };

/**
 * SVG attributes.
 */
export type SVGAttributes<T extends SVGElement = SVGElement> =
  BaseElementAttributes<T> &
    EventAttributes & {
      readonly viewBox?: string | Readable.Readable<string>;
      readonly xmlns?: string;
      readonly fill?: string | Readable.Readable<string>;
      readonly stroke?: string | Readable.Readable<string>;
      readonly strokeWidth?:
        string | number | Readable.Readable<string | number>;
      readonly d?: string | Readable.Readable<string>;
      readonly x?: string | number | Readable.Readable<string | number>;
      readonly y?: string | number | Readable.Readable<string | number>;
      readonly cx?: string | number | Readable.Readable<string | number>;
      readonly cy?: string | number | Readable.Readable<string | number>;
      readonly r?: string | number | Readable.Readable<string | number>;
      readonly rx?: string | number | Readable.Readable<string | number>;
      readonly ry?: string | number | Readable.Readable<string | number>;
      readonly x1?: string | number | Readable.Readable<string | number>;
      readonly y1?: string | number | Readable.Readable<string | number>;
      readonly x2?: string | number | Readable.Readable<string | number>;
      readonly y2?: string | number | Readable.Readable<string | number>;
      readonly points?: string | Readable.Readable<string>;
      readonly transform?: string | Readable.Readable<string>;
      readonly opacity?: string | number | Readable.Readable<string | number>;
      readonly clipPath?: string | Readable.Readable<string>;
      readonly mask?: string | Readable.Readable<string>;
      readonly preserveAspectRatio?: string | Readable.Readable<string>;
      // Allow any other string attributes
      readonly [key: string]: unknown;
    };

/**
 * Extract the union of `E` (error) types across every {@link ChildInput}
 * in a variadic tuple, recursing into nested arrays. Primitives (string,
 * number, boolean, null, undefined) and Readables contribute `never` and
 * fall out of the union.
 *
 * Exposed so component authors can preserve E/R inference when wrapping
 * a primitive with variadic children — see {@link ElementFactory}'s
 * forwarding overload for the intended usage.
 */
export type ChildInputE<T> =
  T extends Effect.Effect<unknown, infer E, unknown>
    ? E
    : T extends ReadonlyArray<infer U>
      ? ChildInputE<U>
      : never;

/**
 * Extract the union of `R` (requirements) types across every
 * {@link ChildInput} in a variadic tuple, recursing into nested arrays.
 * Scope and RendererContext from `Element`'s type alias flow through
 * naturally; they're satisfied by the ambient render layer.
 */
export type ChildInputR<T> =
  T extends Effect.Effect<unknown, unknown, infer R>
    ? R
    : T extends ReadonlyArray<infer U>
      ? ChildInputR<U>
      : never;

/**
 * Factory function type for HTML elements.
 *
 * Supports four call shapes, resolved by TypeScript overload matching on
 * the first argument:
 *
 * - `$.tag()` — no attrs, no children.
 * - `$.tag(attrs)` — attrs only.
 * - `$.tag(child1, child2, ...)` — variadic children with no attrs (first
 *   arg must be a {@link ChildInput}, not a plain attrs object).
 * - `$.tag(attrs, child1, child2, ...)` — the full form.
 *
 * Each child is a {@link ChildInput} — string, number, Element, Readable,
 * nullish/boolean (skipped), or a nested array (flattened recursively).
 * Backward-compatible: a single `Child` effect (e.g. from `collect(...)`)
 * still works as one variadic entry.
 *
 * The variadic-tuple generic `T` captures each argument's type
 * independently, so the returned Element's `E` and `R` channels are the
 * *union* of every child's requirements — mixing children with different
 * error types and service dependencies works as expected.
 */
export type ElementFactory<K extends keyof HTMLElementTagNameMap> = {
  // Forwarding overload: takes a homogeneous array of children with a
  // single `<E, R>` pair — the shape wrappers naturally have when they
  // collect their own variadic children into an array and pass it down.
  // Avoids TS2589 (recursive depth) because there's no `ChildInputE`
  // computation on a tuple type.
  //
  // Component authors write:
  //   export const MyComponent = <E, R>(
  //     ...children: ReadonlyArray<ChildInput<E, R>>
  //   ): Element<..., E, R> => $.div(attrs, children);
  //
  // Tradeoff: `E`/`R` collapse to a single pair, so heterogeneous
  // requirements from siblings become an intersection (contravariant R).
  // For the common wrapper case (E/R passes through) that's exactly right.
  <E = never, R = never>(
    attrs: HTMLAttributes<HTMLElementTagNameMap[K]>,
    children: ReadonlyArray<ChildInput<E, R>>,
  ): Element<HTMLElementTagNameMap[K], E, R>;
  <E = never, R = never>(
    children: ReadonlyArray<ChildInput<E, R>>,
  ): Element<HTMLElementTagNameMap[K], E, R>;

  // Variadic overload: max inference across mixed positional children.
  <T extends ReadonlyArray<ChildInput<unknown, unknown>>>(
    attrs: HTMLAttributes<HTMLElementTagNameMap[K]>,
    ...children: T
  ): Element<
    HTMLElementTagNameMap[K],
    ChildInputE<T[number]>,
    ChildInputR<T[number]>
  >;
  <T extends ReadonlyArray<ChildInput<unknown, unknown>>>(
    ...children: T
  ): Element<
    HTMLElementTagNameMap[K],
    ChildInputE<T[number]>,
    ChildInputR<T[number]>
  >;
};

/**
 * Factory function type for SVG elements. Mirrors {@link ElementFactory}.
 */
export type SVGElementFactory<K extends keyof SVGElementTagNameMap> = {
  <E = never, R = never>(
    attrs: SVGAttributes<SVGElementTagNameMap[K]>,
    children: ReadonlyArray<ChildInput<E, R>>,
  ): Element<SVGElementTagNameMap[K], E, R>;
  <E = never, R = never>(
    children: ReadonlyArray<ChildInput<E, R>>,
  ): Element<SVGElementTagNameMap[K], E, R>;

  <T extends ReadonlyArray<ChildInput<unknown, unknown>>>(
    attrs: SVGAttributes<SVGElementTagNameMap[K]>,
    ...children: T
  ): Element<
    SVGElementTagNameMap[K],
    ChildInputE<T[number]>,
    ChildInputR<T[number]>
  >;
  <T extends ReadonlyArray<ChildInput<unknown, unknown>>>(
    ...children: T
  ): Element<
    SVGElementTagNameMap[K],
    ChildInputE<T[number]>,
    ChildInputR<T[number]>
  >;
};

// =============================================================================
// Context for asChild pattern
// =============================================================================

// MergePropsCtx is imported from @stax-ui/core
// Re-export it for backwards compatibility
export { MergePropsCtx } from "@stax-ui/core";

// =============================================================================
// Attribute Application using Core functions
// =============================================================================

const classValueToString = (value: string | readonly string[]): string =>
  typeof value === "string" ? value : value.join(" ");

/**
 * Walk a class tree and collect the leaf items — plain strings and
 * `Readable<string>` — while stripping `undefined | null | false | ""`.
 * Nested arrays are flattened; the input tree is never mutated.
 */
const flattenClassValue = (
  value: ClassValue,
): (string | Readable.Readable<string>)[] => {
  const out: (string | Readable.Readable<string>)[] = [];
  const walk = (v: ClassValue): void => {
    if (v == null || v === false) return;
    if (typeof v === "string") {
      if (v.length > 0) out.push(v);
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(item as ClassValue);
      return;
    }
    // Nested Readables are only supported as Readable<string>; a
    // Readable<readonly string[]> must appear at the top level.
    out.push(v as Readable.Readable<string>);
  };
  walk(value);
  return out;
};

/**
 * Apply class attribute to an element using Core functions.
 */
const applyClass = <A extends HTMLElement | SVGElement>(
  el: Element<A>,
  value: ClassValue,
): Element<A> => {
  // Fast path: top-level Readable (of a string, or of a full class list).
  if (Readable.isReadable(value)) {
    return Effect.gen(function* () {
      const element = yield* el;
      const renderer = yield* RendererContext;
      const readable = value as Readable.Readable<string | readonly string[]>;
      const initial = yield* readable.get;
      yield* renderer.setClassName(element, classValueToString(initial));
      const scope = yield* Effect.scope;
      yield* Stream.runForEach(readable.changes, (v) =>
        renderer.setClassName(element, classValueToString(v)),
      ).pipe(Effect.forkIn(scope));
      return element;
    }) as Element<A>;
  }

  // Fast path: plain string.
  if (typeof value === "string") {
    return value.length > 0 ? Core.setClass(el, value) : el;
  }

  // Top-level falsy (undefined | null | false) — no classes to apply.
  if (value == null || value === false) return el;

  // Otherwise it's a (possibly nested) tree — flatten to a flat item list
  // of `string | Readable<string>` and process from there.
  const items = flattenClassValue(value);
  if (items.length === 0) return el;

  const hasReactive = items.some(Readable.isReadable);
  if (!hasReactive) {
    return Core.setClass(el, (items as string[]).join(" "));
  }

  // Mixed array with reactive items — subscribe per-item and re-serialize
  // the class list whenever any of them change.
  return Effect.gen(function* () {
    const element = yield* el;
    const renderer = yield* RendererContext;
    const currentValues: string[] = new Array(items.length).fill("");

    const updateClassName = () =>
      renderer.setClassName(
        element,
        currentValues.filter((s) => s.length > 0).join(" "),
      );

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (Readable.isReadable(item)) {
        const initial = yield* (item as Readable.Readable<string>).get;
        currentValues[i] = initial;
        const index = i;
        const scope = yield* Effect.scope;
        yield* Stream.runForEach(
          (item as Readable.Readable<string>).changes,
          (v) =>
            Effect.gen(function* () {
              currentValues[index] = v;
              yield* updateClassName();
            }),
        ).pipe(Effect.forkIn(scope));
      } else {
        currentValues[i] = item as string;
      }
    }

    yield* updateClassName();
    return element;
  }) as Element<A>;
};

/**
 * Apply style attribute to an element using Core functions.
 */
const applyStyle = <A extends HTMLElement | SVGElement>(
  el: Element<A>,
  value: Record<string, StyleValue> | Readable.Readable<Record<string, string>>,
): Element<A> => {
  if (Readable.isReadable(value)) {
    // Entire style object is reactive
    return Effect.gen(function* () {
      const element = yield* el;
      const renderer = yield* RendererContext;
      const readable = value as Readable.Readable<Record<string, string>>;
      const initial = yield* readable.get;
      for (const [prop, val] of Object.entries(initial)) {
        yield* renderer.setStyleProperty(element, prop, val);
      }
      const scope = yield* Effect.scope;
      yield* Stream.runForEach(readable.changes, (styles) =>
        Effect.forEach(
          Object.entries(styles),
          ([prop, val]) => renderer.setStyleProperty(element, prop, val),
          { discard: true },
        ),
      ).pipe(Effect.forkIn(scope));
      return element;
    }) as Element<A>;
  }

  // Object with potentially reactive values
  let result = el;
  for (const [prop, styleVal] of Object.entries(value)) {
    if (Readable.isReadable(styleVal)) {
      result = Core.bindStyle(
        result,
        prop,
        Readable.map(styleVal as Readable.Readable<string | number>, String),
      );
    } else {
      result = Core.setStyle(result, prop, String(styleVal));
    }
  }
  return result;
};

/**
 * Apply an event handler to an element using Core functions.
 */
const applyEventHandler = <A extends HTMLElement>(
  el: Element<A>,
  eventName: string,
  handler: EventHandler<Event>,
): Element<A> => Core.on(el, eventName as keyof HTMLElementEventMap, handler);

/**
 * Apply innerHTML to an element using Core functions.
 */
const applyInnerHTML = <A extends HTMLElement | SVGElement>(
  el: Element<A>,
  value: string | Readable.Readable<string>,
): Element<A> => {
  if (Readable.isReadable(value)) {
    return Core.bindInnerHTML(el, value);
  }
  return Core.setInnerHTML(el, value);
};

// Boolean attributes that should be added/removed rather than set to "true"/"false"
const BOOLEAN_ATTRIBUTES = new Set([
  "disabled",
  "checked",
  "selected",
  "required",
  "readonly",
  "multiple",
  "hidden",
  "open",
  "autofocus",
  "autoplay",
  "controls",
  "default",
  "defer",
  "ismap",
  "loop",
  "muted",
  "novalidate",
  "reversed",
]);

/**
 * Apply a generic attribute to an element using Core functions.
 */
const applyAttribute = <A extends HTMLElement | SVGElement>(
  el: Element<A>,
  key: string,
  value: unknown,
): Element<A> => {
  if (Readable.isReadable(value)) {
    if (BOOLEAN_ATTRIBUTES.has(key)) {
      return Core.bindBooleanAttribute(
        el,
        key,
        value as Readable.Readable<boolean>,
      );
    }
    return Core.bindAttribute(el, key, value as Readable.Readable<unknown>);
  }
  if (typeof value === "boolean") {
    // HTML boolean-attribute semantics (`disabled`, `checked`, etc.):
    // presence-only — `true` sets an empty string, `false` removes the
    // attribute. For any other attribute — notably `data-*` and
    // `aria-*` — a boolean value should stringify to `"true"` /
    // `"false"`. ARIA states are specified that way, and `data-*`
    // attributes are typically read as strings by CSS selectors and
    // JS consumers.
    if (BOOLEAN_ATTRIBUTES.has(key)) {
      return value ? Core.setAttribute(el, key, "") : el;
    }
    return Core.setAttribute(el, key, String(value));
  }
  return Core.setAttribute(el, key, String(value));
};

/**
 * Apply input value (special handling to avoid cursor reset).
 */
const applyInputValue = <A extends HTMLElement | SVGElement>(
  el: Element<A>,
  value: unknown,
): Element<A> => {
  if (Readable.isReadable(value)) {
    return Core.bindInputValue(el, value as Readable.Readable<unknown>);
  }
  return Core.setInputValue(el, String(value));
};

/**
 * Apply all attributes to an element using Core functions.
 */
const applyAttributes = <T extends HTMLElement | SVGElement>(
  el: Element<T>,
  attrs: Record<string, unknown>,
): Element<T> => {
  let result = el;

  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue;

    if (key === "ref") {
      result = Core.setRef(result, value as ElementRef<T>);
    } else if (key === "class") {
      result = applyClass(result, value as ClassValue);
    } else if (key === "style") {
      result = applyStyle(
        result,
        value as
          | Record<string, StyleValue>
          | Readable.Readable<Record<string, string>>,
      );
    } else if (key === "innerHTML") {
      result = applyInnerHTML(
        result,
        value as string | Readable.Readable<string>,
      );
    } else if (key.startsWith("on") && key.length > 2) {
      const eventName = key.slice(2).toLowerCase();
      result = applyEventHandler(
        result as Element<HTMLElement>,
        eventName,
        value as EventHandler<Event>,
      ) as Element<T>;
    } else if (key === "value") {
      // Check if this is an input-like element at runtime
      result = applyInputValue(result, value);
    } else {
      result = applyAttribute(result, key, value);
    }
  }

  return result;
};

// =============================================================================
// Child normalization
// =============================================================================

/**
 * Runtime duck-type check: is this argument a plain attrs object (as opposed
 * to a ChildInput)? Attrs are plain objects that aren't Effects, Readables,
 * DOM nodes, or arrays. Anything else (string, number, boolean, null,
 * undefined, Effect, Readable, Node, array) is a ChildInput.
 *
 * Used by the factory to disambiguate `$.tag(attrs, ...children)` from
 * `$.tag(...children)` at runtime — TypeScript overloads pick statically
 * but the runtime needs to decide which slot arg[0] fills.
 */
const isAttrsObject = (arg: unknown): boolean => {
  if (arg == null) return false;
  if (typeof arg !== "object") return false;
  if (Array.isArray(arg)) return false;
  if (isEffect(arg)) return false;
  if (Readable.isReadable(arg)) return false;
  if (typeof Node !== "undefined" && arg instanceof Node) return false;
  return true;
};

/**
 * Normalize a list of {@link ChildInput}s into `Child` effects:
 *
 * - Strings / numbers wrap as text children via `Core.of`.
 * - `null` / `undefined` / booleans drop out (React-style — supports
 *   `condition && <el/>` and `list?.map(...)`).
 * - One level of array nesting flattens (matches `ChildInput`'s type
 *   surface; deeper nesting isn't part of the contract but the runtime
 *   walks recursively as a defensive belt-and-braces measure).
 * - Readables of string/number pass through as reactive text.
 * - Elements (Effects) pass through as-is.
 */
const normalizeChildren = <E, R>(
  inputs: ReadonlyArray<ChildInput<E, R>>,
): Array<Child<E, R>> => {
  const out: Array<Child<E, R>> = [];
  const walk = (item: ChildInput<E, R>): void => {
    if (item == null || typeof item === "boolean") return;
    if (Array.isArray(item)) {
      for (const nested of item) walk(nested as ChildInput<E, R>);
      return;
    }
    if (typeof item === "string" || typeof item === "number") {
      out.push(Core.of(item) as Child<E, R>);
      return;
    }
    if (Readable.isReadable(item)) {
      out.push(
        Core.of(item as Readable.Readable<string | number>) as Child<E, R>,
      );
      return;
    }
    // At this point item is an Element (Effect) — pass through.
    out.push(item as Child<E, R>);
  };
  for (const input of inputs) walk(input);
  return out;
};

/**
 * Combine an array of normalized children into a single `Child` effect
 * that yields the concatenated `ChildNode` list. `Core.appendChild` accepts
 * that shape and iterates internally.
 *
 * Returns `Core.empty` for an empty list so the factory has one uniform
 * `Child` to pass to `createElement`.
 */
const combineChildren = <E, R>(
  children: ReadonlyArray<Child<E, R>>,
): Child<E, R> => {
  if (children.length === 0) return Core.empty as Child<E, R>;
  if (children.length === 1) return children[0];
  return Effect.gen(function* () {
    const collected: ChildNode[] = [];
    for (const child of children) {
      const value = yield* child;
      if (Array.isArray(value)) collected.push(...value);
      else collected.push(value);
    }
    return collected;
  }) as Child<E, R>;
};

// =============================================================================
// Element Creation using Core functions
// =============================================================================

/**
 * Create an HTML element with attributes and children using Core functions.
 */
const createElement = <K extends keyof HTMLElementTagNameMap, E, R>(
  tagName: K,
  attrs: HTMLAttributes<HTMLElementTagNameMap[K]>,
  children: Child<E, R>,
): Element<HTMLElementTagNameMap[K], E, R> =>
  Effect.gen(function* () {
    // Check for injected props from asChild pattern
    const mergePropsOption = yield* Effect.serviceOption(MergePropsCtx);
    const finalAttrs = Option.match(mergePropsOption, {
      onSome: (mergeProps) => ({ ...mergeProps, ...attrs }),
      onNone: () => attrs,
    });

    // Create element using Core.make
    let el = Core.make(tagName);

    // Apply attributes
    el = applyAttributes(el, finalAttrs as Record<string, unknown>);

    // Append children (clearing MergePropsCtx so children don't inherit it)
    const childEl = Core.appendChild(el, children);

    const result = yield* Effect.provideService(childEl, MergePropsCtx, {});

    // Signal that this element is fully built (children processed).
    // In hydration mode, this pops the traversal context so sibling
    // elements are found in the correct parent.
    const renderer = yield* RendererContext;
    yield* renderer.finalizeNode(result);

    return result;
  }) as Element<HTMLElementTagNameMap[K], E, R>;

/**
 * Create an SVG element with attributes and children using Core functions.
 */
const createSVGElement = <K extends keyof SVGElementTagNameMap, E, R>(
  tagName: K,
  attrs: SVGAttributes<SVGElementTagNameMap[K]>,
  children: Child<E, R>,
): Element<SVGElementTagNameMap[K], E, R> =>
  Effect.gen(function* () {
    // Check for injected props from asChild pattern
    const mergePropsOption = yield* Effect.serviceOption(MergePropsCtx);
    const finalAttrs = Option.match(mergePropsOption, {
      onSome: (mergeProps) => ({ ...mergeProps, ...attrs }),
      onNone: () => attrs,
    });

    // Create SVG element using Core.makeSVG
    let el = Core.makeSVG(tagName);

    // Apply attributes
    el = applyAttributes(el, finalAttrs as Record<string, unknown>);

    // Append children (clearing MergePropsCtx so children don't inherit it)
    const childEl = Core.appendChild(el, children);

    const result = yield* Effect.provideService(childEl, MergePropsCtx, {});

    // Signal that this element is fully built (see createElement for details)
    const renderer = yield* RendererContext;
    yield* renderer.finalizeNode(result);

    return result;
  }) as Element<SVGElementTagNameMap[K], E, R>;

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Split a variadic argument list into `[attrs, children]` at runtime.
 * TypeScript overloads pick statically; this is the runtime counterpart —
 * a duck-type check on `args[0]` decides whether it occupies the attrs slot.
 */
const splitArgs = <A>(args: unknown[]): { attrs: A; children: unknown[] } => {
  if (args.length > 0 && isAttrsObject(args[0])) {
    return { attrs: args[0] as A, children: args.slice(1) };
  }
  return { attrs: {} as A, children: args };
};

/**
 * Create an HTML element factory for a specific tag.
 */
const makeElementFactory = <K extends keyof HTMLElementTagNameMap>(
  tagName: K,
): ElementFactory<K> => {
  return (<E = never, R = never>(...args: unknown[]) => {
    const { attrs, children: rawChildren } =
      splitArgs<HTMLAttributes<HTMLElementTagNameMap[K]>>(args);
    const normalized = normalizeChildren<E, R>(
      rawChildren as ReadonlyArray<ChildInput<E, R>>,
    );
    return createElement(tagName, attrs, combineChildren(normalized));
  }) as ElementFactory<K>;
};

/**
 * Create an SVG element factory for a specific tag.
 */
const makeSVGElementFactory = <K extends keyof SVGElementTagNameMap>(
  tagName: K,
): SVGElementFactory<K> => {
  return (<E = never, R = never>(...args: unknown[]) => {
    const { attrs, children: rawChildren } =
      splitArgs<SVGAttributes<SVGElementTagNameMap[K]>>(args);
    const normalized = normalizeChildren<E, R>(
      rawChildren as ReadonlyArray<ChildInput<E, R>>,
    );
    return createSVGElement(tagName, attrs, combineChildren(normalized));
  }) as SVGElementFactory<K>;
};

// =============================================================================
// HTML Element Exports
// =============================================================================

// Document structure
export const div = makeElementFactory("div");
export const span = makeElementFactory("span");
export const p = makeElementFactory("p");
export const h1 = makeElementFactory("h1");
export const h2 = makeElementFactory("h2");
export const h3 = makeElementFactory("h3");
export const h4 = makeElementFactory("h4");
export const h5 = makeElementFactory("h5");
export const h6 = makeElementFactory("h6");
export const header = makeElementFactory("header");
export const footer = makeElementFactory("footer");
export const main = makeElementFactory("main");
export const nav = makeElementFactory("nav");
export const section = makeElementFactory("section");
export const article = makeElementFactory("article");
export const aside = makeElementFactory("aside");
export const address = makeElementFactory("address");

// Text content
export const blockquote = makeElementFactory("blockquote");
export const cite = makeElementFactory("cite");
export const q = makeElementFactory("q");
export const pre = makeElementFactory("pre");
export const code = makeElementFactory("code");
export const kbd = makeElementFactory("kbd");
export const samp = makeElementFactory("samp");
export const varEl = makeElementFactory("var");
export const abbr = makeElementFactory("abbr");
export const dfn = makeElementFactory("dfn");
export const mark = makeElementFactory("mark");
export const del = makeElementFactory("del");
export const ins = makeElementFactory("ins");
export const s = makeElementFactory("s");
export const u = makeElementFactory("u");
export const small = makeElementFactory("small");
export const strong = makeElementFactory("strong");
export const em = makeElementFactory("em");
export const b = makeElementFactory("b");
export const i = makeElementFactory("i");
export const sub = makeElementFactory("sub");
export const sup = makeElementFactory("sup");
export const time = makeElementFactory("time");
export const data = makeElementFactory("data");
export const wbr = makeElementFactory("wbr");
export const bdi = makeElementFactory("bdi");
export const bdo = makeElementFactory("bdo");
export const ruby = makeElementFactory("ruby");
export const rt = makeElementFactory("rt");
export const rp = makeElementFactory("rp");
export const hr = makeElementFactory("hr");
export const br = makeElementFactory("br");

// Lists
export const ul = makeElementFactory("ul");
export const ol = makeElementFactory("ol");
export const li = makeElementFactory("li");
export const dl = makeElementFactory("dl");
export const dt = makeElementFactory("dt");
export const dd = makeElementFactory("dd");

// Links and media
export const a = makeElementFactory("a");
export const img = makeElementFactory("img");
export const figure = makeElementFactory("figure");
export const figcaption = makeElementFactory("figcaption");
export const picture = makeElementFactory("picture");
export const audio = makeElementFactory("audio");
export const video = makeElementFactory("video");
export const source = makeElementFactory("source");
export const track = makeElementFactory("track");
export const canvas = makeElementFactory("canvas");
export const iframe = makeElementFactory("iframe");
export const embed = makeElementFactory("embed");
export const objectEl = makeElementFactory("object");
export const map = makeElementFactory("map");
export const area = makeElementFactory("area");

// Tables
export const table = makeElementFactory("table");
export const thead = makeElementFactory("thead");
export const tbody = makeElementFactory("tbody");
export const tfoot = makeElementFactory("tfoot");
export const tr = makeElementFactory("tr");
export const th = makeElementFactory("th");
export const td = makeElementFactory("td");
export const caption = makeElementFactory("caption");
export const colgroup = makeElementFactory("colgroup");
export const col = makeElementFactory("col");

// Forms
export const form = makeElementFactory("form");
export const input = makeElementFactory("input");
export const textarea = makeElementFactory("textarea");
export const select = makeElementFactory("select");
export const option = makeElementFactory("option");
export const optgroup = makeElementFactory("optgroup");
export const button = makeElementFactory("button");
export const label = makeElementFactory("label");
export const fieldset = makeElementFactory("fieldset");
export const legend = makeElementFactory("legend");
export const datalist = makeElementFactory("datalist");
export const output = makeElementFactory("output");
export const progress = makeElementFactory("progress");
export const meter = makeElementFactory("meter");

// Interactive
export const details = makeElementFactory("details");
export const summary = makeElementFactory("summary");
export const dialog = makeElementFactory("dialog");
export const menu = makeElementFactory("menu");

// Template and slots
export const template = makeElementFactory("template");
export const slot = makeElementFactory("slot");

// Scripting
export const noscript = makeElementFactory("noscript");
export const script = makeElementFactory("script");
export const style = makeElementFactory("style");

// =============================================================================
// SVG Element Exports
// =============================================================================

// Container and structural
export const svg = makeSVGElementFactory("svg");
export const g = makeSVGElementFactory("g");
export const defs = makeSVGElementFactory("defs");
export const symbol = makeSVGElementFactory("symbol");
export const use = makeSVGElementFactory("use");

// Shapes
export const path = makeSVGElementFactory("path");
export const rect = makeSVGElementFactory("rect");
export const circle = makeSVGElementFactory("circle");
export const ellipse = makeSVGElementFactory("ellipse");
export const line = makeSVGElementFactory("line");
export const polyline = makeSVGElementFactory("polyline");
export const polygon = makeSVGElementFactory("polygon");

// Text
export const svgText = makeSVGElementFactory("text");
export const tspan = makeSVGElementFactory("tspan");
export const textPath = makeSVGElementFactory("textPath");

// Gradients and patterns
export const linearGradient = makeSVGElementFactory("linearGradient");
export const radialGradient = makeSVGElementFactory("radialGradient");
export const stop = makeSVGElementFactory("stop");
export const pattern = makeSVGElementFactory("pattern");

// Clipping and masking
export const clipPath = makeSVGElementFactory("clipPath");
export const mask = makeSVGElementFactory("mask");

// Filters
export const filter = makeSVGElementFactory("filter");
export const feGaussianBlur = makeSVGElementFactory("feGaussianBlur");
export const feColorMatrix = makeSVGElementFactory("feColorMatrix");
export const feBlend = makeSVGElementFactory("feBlend");
export const feOffset = makeSVGElementFactory("feOffset");

// Other
export const image = makeSVGElementFactory("image");
export const foreignObject = makeSVGElementFactory("foreignObject");
export const marker = makeSVGElementFactory("marker");

// =============================================================================
// Helpers
// =============================================================================

/**
 * Lift a primitive value into a Child.
 *
 * @deprecated Element factories accept primitives and Readables directly
 * as children — pass the value straight through instead of wrapping in
 * `$.of(...)`. `$.p("Hello")` replaces `$.p($.of("Hello"))`;
 * `$.span(name)` (with `name: Readable<string>`) replaces
 * `$.span($.of(name))`. Strings, numbers, and `Readable<string | number>`
 * are all valid children.
 */
export const of = Core.of;

/**
 * An empty child effect.
 */
export const empty = Core.empty;

// =============================================================================
// $ Namespace
// =============================================================================

/**
 * Namespace containing all HTML and SVG element factories.
 */
export const $ = {
  of,
  empty,
  // HTML - Document structure
  div,
  span,
  p,
  h1,
  h2,
  h3,
  h4,
  h5,
  h6,
  header,
  footer,
  main,
  nav,
  section,
  article,
  aside,
  address,
  // HTML - Text content
  blockquote,
  cite,
  q,
  pre,
  code,
  kbd,
  samp,
  var: varEl,
  abbr,
  dfn,
  mark,
  del,
  ins,
  s,
  u,
  small,
  strong,
  em,
  b,
  i,
  sub,
  sup,
  time,
  data,
  wbr,
  bdi,
  bdo,
  ruby,
  rt,
  rp,
  hr,
  br,
  // HTML - Lists
  ul,
  ol,
  li,
  dl,
  dt,
  dd,
  // HTML - Links and media
  a,
  img,
  figure,
  figcaption,
  picture,
  audio,
  video,
  source,
  track,
  canvas,
  iframe,
  embed,
  object: objectEl,
  map,
  area,
  // HTML - Tables
  table,
  thead,
  tbody,
  tfoot,
  tr,
  th,
  td,
  caption,
  colgroup,
  col,
  // HTML - Forms
  form,
  input,
  textarea,
  select,
  option,
  optgroup,
  button,
  label,
  fieldset,
  legend,
  datalist,
  output,
  progress,
  meter,
  // HTML - Interactive
  details,
  summary,
  dialog,
  menu,
  // HTML - Template and slots
  template,
  slot,
  // HTML - Scripting
  noscript,
  script,
  style,
  // SVG - Container and structural
  svg,
  g,
  defs,
  symbol,
  use,
  // SVG - Shapes
  path,
  rect,
  circle,
  ellipse,
  line,
  polyline,
  polygon,
  // SVG - Text
  text: svgText,
  tspan,
  textPath,
  // SVG - Gradients and patterns
  linearGradient,
  radialGradient,
  stop,
  pattern,
  // SVG - Clipping and masking
  clipPath,
  mask,
  // SVG - Filters
  filter,
  feGaussianBlur,
  feColorMatrix,
  feBlend,
  feOffset,
  // SVG - Other
  image,
  foreignObject,
  marker,
};
