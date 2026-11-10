import type { ChildInputE, ChildInputR } from "../Element/DOMElements.js";
import type { ChildInput, Element as StaxElement } from "../Element/types.js";

/**
 * Call-site shape when the component has at least one required prop.
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
 * A user-defined component's public call surface.
 *
 * `{} extends Props` is the "every prop is optional" guard — only when
 * it holds do the no-props overloads exist. For a component with a
 * required prop the intersection collapses to {@link WithProps}, and
 * calling it with no first-arg object is a type error.
 *
 * Positional order mirrors `Element<A, E, R>`: Props describes the
 * input, then A / E / R describe the output, with Provides as the
 * R-transformer. `E`, `R`, and `Provides` all default to `never`.
 */
export type ComponentFactory<
  Props,
  A extends HTMLElement | SVGElement | DocumentFragment,
  E = never,
  R = never,
  Provides = never,
> = WithProps<Props, A, E, R, Provides> &
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  ({} extends Props ? WithoutProps<A, E, R, Provides> : unknown);
