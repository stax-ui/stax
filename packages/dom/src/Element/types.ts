import { Effect, Scope } from "effect";

import { Readable, RendererContext } from "@stax-ui/core";

// =============================================================================
// Types
// =============================================================================

/**
 * An Element is an Effect that produces an HTML, SVG, or DocumentFragment
 * node. All Element operations are effectful and go through the Renderer.
 *
 * `DocumentFragment` is admitted so control-flow functions can return a
 * sentinel-wrapped slot group (`<!--$stax-N-->…slots…<!--/$stax-N-->`
 * inlined into the parent on `appendChild`) instead of a wrapper element.
 * `$.div(...)` and friends still return `Element<HTMLDivElement>`, so
 * downstream code that depends on narrow element types (refs, attribute
 * helpers, bounding-rect reads) is unaffected.
 */
export type Element<
  A extends HTMLElement | SVGElement | DocumentFragment =
    HTMLElement | SVGElement | DocumentFragment,
  E = never,
  R = never,
> = Effect.Effect<A, E, Scope.Scope | RendererContext | R>;

/**
 * A child that can be appended to an element. `DocumentFragment` and
 * `Comment` are included so a control-flow function's return value (which
 * may be a fragment, and whose sentinels are comments) flows through
 * `$.div(..., when(...))` without needing a cast at the call site.
 */
export type ChildNode =
  | string
  | number
  | Readable.Readable<string | number>
  | HTMLElement
  | SVGElement
  | DocumentFragment
  | Comment;

/**
 * An effectful child producer.
 */
export type Child<E = never, R = never> = Effect.Effect<
  ChildNode | ChildNode[],
  E,
  R
>;

/**
 * A single child leaf — everything the factory accepts as one element in
 * its variadic tuple or as one entry inside a children array.
 *
 * - `string` / `number` → wrapped as a text node
 * - `null` / `undefined` / `boolean` → skipped (React-style)
 * - `Effect<ChildNode | ChildNode[]>` → passed through
 * - `Readable<string | number>` → reactive text
 */
export type ChildLeaf<E = never, R = never> =
  | string
  | number
  | boolean
  | null
  | undefined
  | Child<E, R>
  | Readable.Readable<string | number>;

/**
 * A child input accepted by element builders (`$.div`, `$.span`, ...) and
 * component authors who want to opt in to the same API.
 *
 * A ChildInput is either a leaf or a *single-level* array of leaves. Nested
 * arrays (`[[a, b], [c]]`) are intentionally not part of the type — the
 * runtime does not walk deeper than one level either. Use `.flat()` or the
 * variadic form if you're combining multiple lists.
 *
 * The single-level constraint is what makes `E`/`R` inference through
 * component wrappers tractable — a self-recursive array branch collides
 * with `ChildInputE`/`ChildInputR`'s array recursion and produces TS2589
 * ("excessively deep") whenever a wrapper forwards its own generic
 * children to a primitive.
 */
export type ChildInput<E = never, R = never> =
  ChildLeaf<E, R> | ReadonlyArray<ChildLeaf<E, R>>;

// =============================================================================
// Component-author aliases
// =============================================================================
//
// The two shapes below cover ~all wrapper components. Pick by the wrapper's
// intent, not by the caller's ergonomics.

/**
 * Variadic-rest type for wrappers that need to **interleave** their own
 * elements with forwarded children:
 *
 * ```ts
 * const Section = <E = never, R = never>(
 *   props: { heading: string },
 *   ...children: Children<E, R>
 * ): Element<HTMLElement, E, R> =>
 *   $.section({}, $.h2({}, props.heading), children);
 * ```
 *
 * Uses `ChildLeaf` under the hood — no array-as-single-arg from the caller,
 * but the collected array fits `$.section`'s ChildInput slot as one unit,
 * so the wrapper can pass it alongside its own owned children in the same
 * primitive call. Callers spread arrays: `Section(props, ...myArray)`.
 *
 * This is the recommended default for wrapper variadic children.
 */
export type Children<E = never, R = never> = ReadonlyArray<ChildLeaf<E, R>>;

/**
 * Variadic-rest type for wrappers that only **forward** children without
 * mixing in wrapper-owned elements:
 *
 * ```ts
 * const Link = <E = never, R = never>(
 *   props: LinkProps,
 *   ...children: PermissiveChildren<E, R>
 * ): Element<HTMLAnchorElement, E, R> =>
 *   $.a({ href: props.href }, children);
 * ```
 *
 * Uses `ChildInput` — callers may pass an array as a single argument
 * (`Link(props, [a, b])`) as well as spread or variadic. In exchange, the
 * wrapper cannot interleave its own children with the forwarded ones in
 * the same primitive call (it must forward `children` as the sole child
 * argument).
 */
export type PermissiveChildren<E = never, R = never> = ReadonlyArray<
  ChildInput<E, R>
>;
