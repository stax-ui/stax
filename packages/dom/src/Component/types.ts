import type { ChildInputE, ChildInputR } from "../Element/DOMElements.js";
import type { ChildInput, Element as StaxElement } from "../Element/types.js";

/**
 * Call-site shape when the component has at least one required prop.
 * Two overloads: a forwarding form (children as a single array, one
 * `<E, R>` pair) and a variadic form (mixed positional children,
 * `ChildInputE` / `ChildInputR` recurse over the tuple).
 *
 * `Requires` unions into the output R channel; `Provides` cancels
 * against children's R via `Exclude`. `Fails` unions into the output
 * E channel alongside each child's E — defaults to `never` so a
 * non-failing component reports children's E unchanged.
 */
export interface WithProps<
  Props,
  A extends HTMLElement | SVGElement | DocumentFragment,
  Fails,
  Requires,
  Provides,
> {
  <E = never, R = never>(
    props: Props,
    children: ReadonlyArray<ChildInput<E, R>>,
  ): StaxElement<A, E | Fails, Exclude<R, Provides> | Requires>;

  <T extends ReadonlyArray<ChildInput<unknown, unknown>>>(
    props: Props,
    ...children: T
  ): StaxElement<
    A,
    ChildInputE<T[number]> | Fails,
    Exclude<ChildInputR<T[number]>, Provides> | Requires
  >;
}

/** The props-less half of the factory, mirroring {@link WithProps}. */
export interface WithoutProps<
  A extends HTMLElement | SVGElement | DocumentFragment,
  Fails,
  Requires,
  Provides,
> {
  <E = never, R = never>(
    children: ReadonlyArray<ChildInput<E, R>>,
  ): StaxElement<A, E | Fails, Exclude<R, Provides> | Requires>;

  <T extends ReadonlyArray<ChildInput<unknown, unknown>>>(
    ...children: T
  ): StaxElement<
    A,
    ChildInputE<T[number]> | Fails,
    Exclude<ChildInputR<T[number]>, Provides> | Requires
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
 * input, then A / Fails (= E) / Requires (= R) describe the output,
 * with Provides as the R-transformer. `Fails`, `Requires`, and
 * `Provides` all default to `never`.
 */
export type ComponentFactory<
  Props,
  A extends HTMLElement | SVGElement | DocumentFragment,
  Fails = never,
  Requires = never,
  Provides = never,
> = WithProps<Props, A, Fails, Requires, Provides> &
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  ({} extends Props ? WithoutProps<A, Fails, Requires, Provides> : unknown);
