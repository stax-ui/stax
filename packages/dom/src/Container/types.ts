import type { Kind, TypeLambda } from "effect/HKT";

import type { ChildInputE, ChildInputR } from "../Element/DOMElements.js";
import type { ChildInput, Element as StaxElement } from "../Element/types.js";

/**
 * Call-site shape when the container has at least one required prop.
 *
 * Two overloads, matching the `$` factories: a forwarding form (children
 * as a single array, one `<ChildE, ChildR>` pair) and a variadic form
 * (mixed positional children, {@link ChildInputE} / {@link ChildInputR}
 * recurse over the tuple).
 *
 * `R` unions into the output R channel; `Provides` cancels against
 * children's R via `Exclude`. `E` unions into the output E channel
 * alongside each child's E.
 */
export interface WithProps<
  Props,
  A extends HTMLElement | SVGElement | DocumentFragment,
  E,
  R,
  Provides,
> {
  <ChildE = never, ChildR = never>(
    props: Props,
    children: ReadonlyArray<ChildInput<ChildE, ChildR>>,
  ): StaxElement<A, ChildE | E, Exclude<ChildR, Provides> | R>;

  <T extends ReadonlyArray<ChildInput<unknown, unknown>>>(
    props: Props,
    ...children: T
  ): StaxElement<
    A,
    ChildInputE<T[number]> | E,
    Exclude<ChildInputR<T[number]>, Provides> | R
  >;
}

/** The props-less half of the factory, mirroring {@link WithProps}. */
export interface WithoutProps<
  A extends HTMLElement | SVGElement | DocumentFragment,
  E,
  R,
  Provides,
> {
  <ChildE = never, ChildR = never>(
    children: ReadonlyArray<ChildInput<ChildE, ChildR>>,
  ): StaxElement<A, ChildE | E, Exclude<ChildR, Provides> | R>;

  <T extends ReadonlyArray<ChildInput<unknown, unknown>>>(
    ...children: T
  ): StaxElement<
    A,
    ChildInputE<T[number]> | E,
    Exclude<ChildInputR<T[number]>, Provides> | R
  >;
}

/**
 * A user-defined container's public call surface.
 *
 * `{} extends Props` is the "every prop is optional" guard — only when
 * it holds do the no-props overloads exist. For a container with a
 * required prop the intersection collapses to {@link WithProps}, and
 * calling it with no first-arg object is a type error.
 *
 * Positional order mirrors `Element<A, E, R>`: Props describes the
 * input, then A / E / R describe the output, with Provides as the
 * R-transformer. `E`, `R`, and `Provides` all default to `never`.
 */
export type ContainerFactory<
  Props,
  A extends HTMLElement | SVGElement | DocumentFragment,
  E = never,
  R = never,
  Provides = never,
> = WithProps<Props, A, E, R, Provides> &
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  ({} extends Props ? WithoutProps<A, E, R, Provides> : unknown);

// -----------------------------------------------------------------------------
// Generic containers — value-typed Roots (e.g. Accordion.Root<Value>)
// -----------------------------------------------------------------------------

/**
 * Call-site shape when the generic container has at least one required prop.
 *
 * The leading `<const V, ...>` type parameters let a caller instantiate the
 * container's value type from the props it passes: for a props shape
 * `{ defaultValue: ReadonlyArray<V>; onValueChange?: (v: ReadonlyArray<V>) => void }`,
 * calling `Root({ defaultValue: ["a", "b"], onValueChange: v => … })` infers
 * `V` as `"a" | "b"` and types `onValueChange`'s `v` as `ReadonlyArray<"a" | "b">`.
 *
 * `F` is a {@link TypeLambda} whose `Target` slot carries `V`. `Props` is
 * obtained by instantiating `F` at `V`, written `Kind<F, never, never, never, V>`.
 *
 * The signature mirrors {@link WithProps} otherwise — forwarding form, then
 * variadic — and threads child `E` / `R` into the output the same way.
 */
export interface GenericWithProps<
  F extends TypeLambda,
  A extends HTMLElement | SVGElement | DocumentFragment,
  E,
  R,
  Provides,
> {
  <const V, ChildE = never, ChildR = never>(
    props: Kind<F, never, never, never, V>,
    children: ReadonlyArray<ChildInput<ChildE, ChildR>>,
  ): StaxElement<A, ChildE | E, Exclude<ChildR, Provides> | R>;

  <const V, T extends ReadonlyArray<ChildInput<unknown, unknown>>>(
    props: Kind<F, never, never, never, V>,
    ...children: T
  ): StaxElement<
    A,
    ChildInputE<T[number]> | E,
    Exclude<ChildInputR<T[number]>, Provides> | R
  >;
}

/**
 * The props-less half of the generic factory. `V` can't be inferred when
 * no props are passed, so these overloads are plain children-only shapes
 * with no `V` parameter — identical to {@link WithoutProps}.
 */
export interface GenericWithoutProps<
  A extends HTMLElement | SVGElement | DocumentFragment,
  E,
  R,
  Provides,
> {
  <ChildE = never, ChildR = never>(
    children: ReadonlyArray<ChildInput<ChildE, ChildR>>,
  ): StaxElement<A, ChildE | E, Exclude<ChildR, Provides> | R>;

  <T extends ReadonlyArray<ChildInput<unknown, unknown>>>(
    ...children: T
  ): StaxElement<
    A,
    ChildInputE<T[number]> | E,
    Exclude<ChildInputR<T[number]>, Provides> | R
  >;
}

/**
 * The public call surface of a container built with `container.generic<F>()`.
 *
 * `{} extends Kind<F, never, never, never, unknown>` is the generic version of
 * {@link ContainerFactory}'s "every prop is optional" guard — only when the
 * fully-unknown props instance is empty do the no-props overloads exist.
 *
 * The one-line intersection with `GenericWithProps<...>` keeps the generic
 * `<V>` inference discoverable to TypeScript even though it's layered under
 * the optional-props branch.
 */
export type GenericContainerFactory<
  F extends TypeLambda,
  A extends HTMLElement | SVGElement | DocumentFragment,
  E = never,
  R = never,
  Provides = never,
> = GenericWithProps<F, A, E, R, Provides> &
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  ({} extends Kind<F, never, never, never, unknown>
    ? GenericWithoutProps<A, E, R, Provides>
    : unknown);
