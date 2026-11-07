import { Context, Effect } from "effect";
import { isEffect } from "effect/Effect";

import { Readable } from "@stax-ui/core";

import type {
  ChildLeaf,
  Children,
  Element as StaxElement,
} from "../Element/types.js";
import type { ComponentFactory } from "./types.js";

// -----------------------------------------------------------------------------
// Runtime argument dispatch
// -----------------------------------------------------------------------------

/**
 * Duck-type check mirroring `isAttrsObject` in `Element/DOMElements.ts`.
 * Decides whether `args[0]` fills the attrs slot or is the first child.
 */
const isPropsObject = (arg: unknown): boolean => {
  if (arg == null) return false;
  if (typeof arg !== "object") return false;
  if (Array.isArray(arg)) return false;
  if (isEffect(arg)) return false;
  if (Readable.isReadable(arg)) return false;
  if (typeof Node !== "undefined" && arg instanceof Node) return false;
  return true;
};

/**
 * Split variadic args into `[props, children]`. Mirrors `splitArgs` in
 * `Element/DOMElements.ts`. Unwraps the single-array forwarding form
 * so impl sees a flat children array in both call shapes.
 */
const splitArgs = (
  args: ReadonlyArray<unknown>,
): { props: Record<string, unknown>; children: ReadonlyArray<unknown> } => {
  const hasProps = args.length > 0 && isPropsObject(args[0]);
  const props = hasProps ? (args[0] as Record<string, unknown>) : {};
  const rest = hasProps ? args.slice(1) : args;
  const children =
    rest.length === 1 && Array.isArray(rest[0])
      ? (rest[0] as ReadonlyArray<unknown>)
      : rest;
  return { props, children };
};

// -----------------------------------------------------------------------------
// Impl signature types (not part of the public API — they describe the
// shape component authors hand to `component()` / `component.provides()`)
// -----------------------------------------------------------------------------

/**
 * The pure-path impl shape. Impl's `children` parameter is typed
 * `Children<never, never>` deliberately — the "additive-identity"
 * trick that lets TypeScript infer impl's own E and R (as `Fails` and
 * `Requires`) without them tangling with children's E and R, which
 * are re-attached by the {@link ComponentFactory} overload at the
 * call site.
 */
export type ComponentImpl<
  Props,
  A extends HTMLElement | SVGElement | DocumentFragment,
  SelfE,
  SelfR,
> = (
  props: Props,
  children: Children<never, never>,
) => StaxElement<A, SelfE, SelfR>;

/** Shape of the `provide` closure handed to a single-tag provider impl. */
export type ProvideOne<T extends Context.Tag<unknown, unknown>> = (
  service: Context.Tag.Service<T>,
  children?: Children<never, never>,
) => Children<never, never>;

/** Shape of the `provide` closure handed to a record-form provider impl. */
export type ProvideMany<
  Tags extends Record<string, Context.Tag<unknown, unknown>>,
> = (
  services: { [K in keyof Tags]: Context.Tag.Service<Tags[K]> },
  children?: Children<never, never>,
) => Children<never, never>;

export type ProviderImplOne<
  T extends Context.Tag<unknown, unknown>,
  Props,
  A extends HTMLElement | SVGElement | DocumentFragment,
  SelfE,
  SelfR,
> = (
  props: Props,
  provide: ProvideOne<T>,
  children?: Children<never, never>,
) => StaxElement<A, SelfE, SelfR>;

export type ProviderImplMany<
  Tags extends Record<string, Context.Tag<unknown, unknown>>,
  Props,
  A extends HTMLElement | SVGElement | DocumentFragment,
  SelfE,
  SelfR,
> = (
  props: Props,
  provide: ProvideMany<Tags>,
  children?: Children<never, never>,
) => StaxElement<A, SelfE, SelfR>;

// -----------------------------------------------------------------------------
// Runtime: wrap-each-child-with-provideService
// -----------------------------------------------------------------------------

/**
 * Apply `Effect.provideService` to each effectful child. Non-effectful
 * leaves (strings, numbers, booleans, null, undefined, Readables) pass
 * through unchanged — they don't carry an R channel to provide into.
 *
 * Returning the same array shape keeps impl's "children" opaque: impl
 * doesn't have to know which entries got wrapped.
 */
const provideToChildren = <I, S>(
  children: ReadonlyArray<unknown>,
  tag: Context.Tag<I, S>,
  service: S,
): ReadonlyArray<unknown> =>
  children.map((child) =>
    isEffect(child) ? Effect.provideService(child, tag, service) : child,
  );

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * Wrap an impl function as a {@link ComponentFactory}. The returned
 * factory accepts the user-facing variadic / forwarding overloads;
 * impl itself receives `(props, children)` with `children` typed as
 * the opaque `Children<never, never>` — see {@link ComponentImpl}.
 *
 * ```ts
 * const Panel = component((props: PanelProps, children) =>
 *   $.div({ class: "panel" }, children),
 * );
 *
 * Panel({}, "text");
 * Panel("just children");       // when PanelProps is all-optional
 * ```
 */
export function component<
  Props,
  A extends HTMLElement | SVGElement | DocumentFragment,
  SelfE,
  SelfR,
>(
  impl: ComponentImpl<Props, A, SelfE, SelfR>,
): ComponentFactory<Props, A, SelfE, SelfR, never> {
  const factory = (...args: ReadonlyArray<unknown>): unknown => {
    const { props, children } = splitArgs(args);
    return impl(
      props as Props,
      children as ReadonlyArray<ChildLeaf<never, never>>,
    );
  };
  return factory as ComponentFactory<Props, A, SelfE, SelfR, never>;
}

/**
 * Overload: single-tag provider. Impl receives a `provide(service,
 * children?)` closure that wraps impl's closed-over children with
 * `Effect.provideService` for the tag. Pass an explicit `children`
 * second arg to scope a different subset instead.
 */
export function provides<T extends Context.Tag<any, any>>(
  tag: T,
): <Props, A extends HTMLElement | SVGElement | DocumentFragment, SelfE, SelfR>(
  impl: ProviderImplOne<T, Props, A, SelfE, SelfR>,
) => ComponentFactory<Props, A, SelfE, SelfR, Context.Tag.Identifier<T>>;

/**
 * Overload: multi-tag provider via a record of author-chosen labels
 * mapping to Tags. Impl's `provide` closure takes a matching record
 * of services.
 */
export function provides<Tags extends Record<string, Context.Tag<any, any>>>(
  tags: Tags,
): <Props, A extends HTMLElement | SVGElement | DocumentFragment, SelfE, SelfR>(
  impl: ProviderImplMany<Tags, Props, A, SelfE, SelfR>,
) => ComponentFactory<
  Props,
  A,
  SelfE,
  SelfR,
  Context.Tag.Identifier<Tags[keyof Tags]>
>;

export function provides(
  tagOrTags: Context.Tag<any, any> | Record<string, Context.Tag<any, any>>,
): (impl: (...a: any[]) => any) => (...args: any[]) => unknown {
  const isSingle = Context.isTag(tagOrTags);
  return (impl) => {
    const factory = (...args: ReadonlyArray<unknown>): unknown => {
      const { props, children } = splitArgs(args);
      const provideFn = isSingle
        ? (service: unknown, override?: ReadonlyArray<unknown>) =>
            provideToChildren(
              override ?? children,
              tagOrTags as Context.Tag<unknown, unknown>,
              service,
            )
        : (
            services: Record<string, unknown>,
            override?: ReadonlyArray<unknown>,
          ) => {
            const tags = tagOrTags as Record<
              string,
              Context.Tag<unknown, unknown>
            >;
            let current: ReadonlyArray<unknown> = override ?? children;
            for (const key of Object.keys(tags)) {
              current = provideToChildren(current, tags[key]!, services[key]);
            }
            return current;
          };
      return impl(props, provideFn, children);
    };
    return factory;
  };
}

// Attach `.provides` to `component` so the public surface is the
// single `component` function with a namespaced helper.
component.provides = provides;
