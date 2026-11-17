import { Context, Effect } from "effect";
import { isEffect } from "effect/Effect";
import type { Kind, TypeLambda } from "effect/HKT";

import type {
  ChildLeaf,
  Children,
  Element as StaxElement,
} from "../Element/types.js";
import { splitArgs } from "../helpers/splitArgs.js";
import type { ContainerFactory, GenericContainerFactory } from "./types.js";

// -----------------------------------------------------------------------------
// Runtime argument dispatch
// -----------------------------------------------------------------------------

/**
 * Unwrap the single-array forwarding form into a flat children list.
 *
 * `Element.splitArgs` returns `children` unchanged, but a container's
 * impl receives children as a flat `ReadonlyArray`. `splitArgs` plus
 * this unwrap step match the behavior of the `$` factories' child
 * normalization (which flattens one level of nesting inside
 * `normalizeChildren`) without pulling impl through normalization.
 */
const flattenForwarded = (
  children: ReadonlyArray<unknown>,
): ReadonlyArray<unknown> =>
  children.length === 1 && Array.isArray(children[0])
    ? (children[0] as ReadonlyArray<unknown>)
    : children;

// -----------------------------------------------------------------------------
// Impl signature types
// -----------------------------------------------------------------------------

/**
 * The function signature an author hands to {@link container}.
 *
 * `children` is deliberately typed `Children<never, never>` — the
 * "additive-identity" trick that lets TypeScript infer impl's own `E`
 * and `R` without them tangling with children's `E` and `R`, which are
 * re-attached by the {@link ContainerFactory} overload at the call site.
 *
 * @example
 * ```ts
 * const Panel = container(
 *   (props: { tone?: "soft" | "loud" }, children) =>
 *     $.div({ class: `panel panel--${props.tone ?? "soft"}` }, children),
 * );
 * ```
 */
export type ContainerImpl<
  Props,
  A extends HTMLElement | SVGElement | DocumentFragment,
  SelfE,
  SelfR,
> = (
  props: Props,
  children: Children<never, never>,
) => StaxElement<A, SelfE, SelfR>;

/**
 * The `provide` closure handed to a single-tag provider impl.
 *
 * Call it with the service value to scope impl's closed-over children
 * under that Tag. Pass an explicit `children` second argument to scope
 * a different subset instead — the escape hatch for routing only part
 * of `children` through the provider.
 */
export type ProvideOne<T extends Context.Tag<unknown, unknown>> = (
  service: Context.Tag.Service<T>,
  children?: Children<never, never>,
) => Children<never, never>;

/**
 * The `provide` closure handed to a multi-tag provider impl.
 *
 * `services` keys match the label record passed to
 * `container.provides({...})`. Values are the service instances to bind.
 */
export type ProvideMany<
  Tags extends Record<string, Context.Tag<unknown, unknown>>,
> = (
  services: { [K in keyof Tags]: Context.Tag.Service<Tags[K]> },
  children?: Children<never, never>,
) => Children<never, never>;

/**
 * The function signature handed to `container.provides(Tag)(…)`.
 * Impl receives `(props, provide, children?)` — `children` is optional
 * because most providers only route through `provide(service)` and
 * never read the raw children directly.
 */
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

/** Multi-tag counterpart to {@link ProviderImplOne}. */
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
// Runtime: provide a Context into each effectful child
// -----------------------------------------------------------------------------

/**
 * Apply `Effect.provide(context)` to each effectful child. Non-effectful
 * leaves (strings, numbers, booleans, null, undefined, Readables) pass
 * through unchanged — they don't carry an R channel to provide into.
 *
 * A single Context carries every service the provider binds, so the
 * multi-tag case walks each child once no matter how many tags are in
 * the record (vs. once per `(child, tag)` pair if we looped
 * `provideService`).
 */
const provideContextToChildren = <R>(
  children: ReadonlyArray<unknown>,
  context: Context.Context<R>,
): ReadonlyArray<unknown> =>
  children.map((child) =>
    isEffect(child) ? Effect.provide(child, context) : child,
  );

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * Wrap an impl function as a reusable container factory — a component
 * that accepts children.
 *
 * The returned factory accepts the same `(props, ...children)` and
 * `(props, children[])` call shapes as the `$.div` / `$.span` factories,
 * and threads each child's `E` and `R` into the output element — so a
 * container's requirements union naturally with its children's at the
 * call site, and a parent that provides a service cancels it out via
 * `Exclude` on the R channel.
 *
 * Impl itself receives `(props, children)`. `children` is typed as the
 * opaque `Children<never, never>` so impl can pass them through (to
 * `$.div(children)`) without having to re-declare children's `E`
 * and `R` as generics on impl — see {@link ContainerImpl}.
 *
 * When every prop is optional, three call shapes are allowed:
 *
 * ```ts
 * const Leaf = container(
 *   (props: { label?: string }, children) => $.span(children),
 * );
 *
 * Leaf();                       // no args
 * Leaf("hello");                // children-only
 * Leaf({ label: "x" }, "hi");   // props + variadic children
 * ```
 *
 * When at least one prop is required, the no-args / children-only
 * overloads disappear and the factory demands a props object:
 *
 * ```ts
 * const Progress = container(
 *   (props: { value: number }, children) =>
 *     $.div({ "data-value": String(props.value) }, children),
 * );
 *
 * Progress({ value: 10 });
 * Progress({ value: 10 }, "label");
 * ```
 *
 * Impl can read Effect services with `yield*`; those services surface on
 * the factory's `R` channel so a caller gets a type error if they
 * aren't provided above:
 *
 * ```ts
 * const Panel = container((_props: object, children) =>
 *   Effect.gen(function* () {
 *     const { color } = yield* ThemeCtx;
 *     return yield* $.div({ "data-color": color }, children);
 *   }),
 * );
 *
 * // RequirementsOf<typeof Panel()> includes ThemeCtx
 * ```
 *
 * Use {@link container.provides} to build a container that **supplies**
 * a service to its children instead of reading one.
 */
function containerImpl<
  Props,
  A extends HTMLElement | SVGElement | DocumentFragment,
  SelfE,
  SelfR,
>(
  impl: ContainerImpl<Props, A, SelfE, SelfR>,
): ContainerFactory<Props, A, SelfE, SelfR, never> {
  const factory = (...args: ReadonlyArray<unknown>): unknown => {
    const { attrs, children } = splitArgs<Props>(args);
    return impl(
      attrs ?? ({} as Props),
      flattenForwarded(children) as ReadonlyArray<ChildLeaf<never, never>>,
    );
  };
  return factory as ContainerFactory<Props, A, SelfE, SelfR, never>;
}

/**
 * Build a container that **provides** a single service to its children.
 *
 * Impl receives a `provide(service, children?)` closure that wraps its
 * closed-over children with the Tag's service, so children (and their
 * descendants) can `yield*` it without the caller supplying it.
 *
 * ```ts
 * class ThemeCtx extends Context.Tag("ThemeCtx")<
 *   ThemeCtx,
 *   { readonly color: string }
 * >() {}
 *
 * const Root = container.provides(ThemeCtx)(
 *   (props: { color: string }, provide) =>
 *     $.div({ class: "root" }, provide({ color: props.color })),
 * );
 *
 * const Panel = container((_props: object, children) =>
 *   Effect.gen(function* () {
 *     const { color } = yield* ThemeCtx;
 *     return yield* $.span({ "data-color": color }, children);
 *   }),
 * );
 *
 * // RequirementsOf includes no ThemeCtx — Root cancelled it.
 * const ui = Root({ color: "teal" }, Panel("hi"));
 * ```
 *
 * To scope only part of `children` under the service, declare the
 * optional third parameter and hand the chosen subset to `provide`:
 *
 * ```ts
 * const SplitRoot = container.provides(ThemeCtx)(
 *   (_props: object, provide, children = []) =>
 *     $.div(
 *       children.slice(0, 1),                           // raw
 *       provide({ color: "lime" }, children.slice(1)),  // scoped
 *     ),
 * );
 * ```
 */
function provides<T extends Context.Tag<any, any>>(
  tag: T,
): <Props, A extends HTMLElement | SVGElement | DocumentFragment, SelfE, SelfR>(
  impl: ProviderImplOne<T, Props, A, SelfE, SelfR>,
) => ContainerFactory<Props, A, SelfE, SelfR, Context.Tag.Identifier<T>>;

/**
 * Build a container that **provides** multiple services to its children,
 * via a record of author-chosen labels mapping to Tags.
 *
 * The labels are impl-local — they shape the `services` record `provide`
 * expects, nothing more. The output type unions every Tag's Identifier
 * into the `Provides` slot, so each one cancels against children's R.
 *
 * ```ts
 * const MultiRoot = container.provides({
 *   theme: ThemeCtx,
 *   size: SizeCtx,
 * })((_props: object, provide) =>
 *   $.div(
 *     provide({
 *       theme: { color: "cyan" },
 *       size: { scale: 2 },
 *     }),
 *   ),
 * );
 * ```
 *
 * At runtime the services are gathered into a single `Context` once per
 * call and `Effect.provide`d into each effectful child, so N tags × M
 * children is still one `provide` per child, not N × M wraps.
 */
function provides<Tags extends Record<string, Context.Tag<any, any>>>(
  tags: Tags,
): <Props, A extends HTMLElement | SVGElement | DocumentFragment, SelfE, SelfR>(
  impl: ProviderImplMany<Tags, Props, A, SelfE, SelfR>,
) => ContainerFactory<
  Props,
  A,
  SelfE,
  SelfR,
  Context.Tag.Identifier<Tags[keyof Tags]>
>;

function provides(
  tagOrTags: Context.Tag<any, any> | Record<string, Context.Tag<any, any>>,
): (impl: (...a: any[]) => any) => (...args: any[]) => unknown {
  const isSingle = Context.isTag(tagOrTags);
  return (impl) => {
    const factory = (...args: ReadonlyArray<unknown>): unknown => {
      const { attrs, children: raw } = splitArgs<Record<string, unknown>>(args);
      const props = attrs ?? {};
      const children = flattenForwarded(raw);

      const provideFn = isSingle
        ? (service: unknown, override?: ReadonlyArray<unknown>) =>
            provideContextToChildren(
              override ?? children,
              Context.make(tagOrTags as Context.Tag<unknown, unknown>, service),
            )
        : (
            services: Record<string, unknown>,
            override?: ReadonlyArray<unknown>,
          ) => {
            const tags = tagOrTags as Record<
              string,
              Context.Tag<unknown, unknown>
            >;
            const context = Object.keys(tags).reduce(
              (ctx, key) => Context.add(ctx, tags[key]!, services[key]),
              Context.empty() as Context.Context<any>,
            );
            return provideContextToChildren(override ?? children, context);
          };

      return impl(props, provideFn, children);
    };
    return factory;
  };
}

// -----------------------------------------------------------------------------
// Generic container — value-typed Roots (e.g. Accordion.Root<Value>)
// -----------------------------------------------------------------------------

/**
 * Impl signature for a generic container. `props` sees the fully-unknown
 * instance of the type lambda; the factory's call signature re-introduces
 * `<const V>` so each call infers `V` from the props it receives.
 *
 * Runtime behavior is identical to {@link ContainerImpl} — only the exposed
 * type surface differs.
 */
export type GenericContainerImpl<
  F extends TypeLambda,
  A extends HTMLElement | SVGElement | DocumentFragment,
  SelfE,
  SelfR,
> = (
  props: Kind<F, never, never, never, unknown>,
  children: Children<never, never>,
) => StaxElement<A, SelfE, SelfR>;

/** Single-tag provider impl for `container.generic<F>().provides(Tag)(…)`. */
export type GenericProviderImplOne<
  T extends Context.Tag<unknown, unknown>,
  F extends TypeLambda,
  A extends HTMLElement | SVGElement | DocumentFragment,
  SelfE,
  SelfR,
> = (
  props: Kind<F, never, never, never, unknown>,
  provide: ProvideOne<T>,
  children?: Children<never, never>,
) => StaxElement<A, SelfE, SelfR>;

/** Multi-tag provider impl for `container.generic<F>().provides({…})(…)`. */
export type GenericProviderImplMany<
  Tags extends Record<string, Context.Tag<unknown, unknown>>,
  F extends TypeLambda,
  A extends HTMLElement | SVGElement | DocumentFragment,
  SelfE,
  SelfR,
> = (
  props: Kind<F, never, never, never, unknown>,
  provide: ProvideMany<Tags>,
  children?: Children<never, never>,
) => StaxElement<A, SelfE, SelfR>;

/**
 * Return shape of `container.generic<F>()` — a callable that builds a
 * generic container, plus a `.provides` helper mirroring the non-generic
 * side.
 *
 * The `F` type lambda is fixed at the `.generic<F>()` step; from there,
 * `A`, `SelfE`, `SelfR` (and, for `provides`, the Tag's Identifier)
 * continue to infer from the impl as with {@link containerImpl}.
 */
export interface GenericContainer<F extends TypeLambda> {
  <
    A extends HTMLElement | SVGElement | DocumentFragment,
    SelfE = never,
    SelfR = never,
  >(
    impl: GenericContainerImpl<F, A, SelfE, SelfR>,
  ): GenericContainerFactory<F, A, SelfE, SelfR, never>;

  readonly provides: {
    <T extends Context.Tag<any, any>>(
      tag: T,
    ): <
      A extends HTMLElement | SVGElement | DocumentFragment,
      SelfE = never,
      SelfR = never,
    >(
      impl: GenericProviderImplOne<T, F, A, SelfE, SelfR>,
    ) => GenericContainerFactory<F, A, SelfE, SelfR, Context.Tag.Identifier<T>>;

    <Tags extends Record<string, Context.Tag<any, any>>>(
      tags: Tags,
    ): <
      A extends HTMLElement | SVGElement | DocumentFragment,
      SelfE = never,
      SelfR = never,
    >(
      impl: GenericProviderImplMany<Tags, F, A, SelfE, SelfR>,
    ) => GenericContainerFactory<
      F,
      A,
      SelfE,
      SelfR,
      Context.Tag.Identifier<Tags[keyof Tags]>
    >;
  };
}

/**
 * Build a generic container — a {@link containerImpl} variant whose factory
 * carries a `<const V>` parameter at each call site, so a Root can type its
 * `onValueChange` from its `defaultValue` the way Base UI's `Accordion.Root<V>`
 * and friends do.
 *
 * Usage:
 *
 * ```ts
 * import type { TypeLambda } from "effect/HKT";
 *
 * interface RootProps<V> {
 *   readonly defaultValue?: ReadonlyArray<V>;
 *   readonly onValueChange?: (v: ReadonlyArray<V>) => void;
 * }
 * interface RootPropsF extends TypeLambda {
 *   readonly type: RootProps<this["Target"]>;
 * }
 *
 * const Root = container.generic<RootPropsF>()(
 *   (props, children) => $.div(children),
 * );
 *
 * Root({ defaultValue: ["a", "b"], onValueChange: v => … });
 * //                                                ^? v: readonly ("a" | "b")[]
 * ```
 *
 * Runtime behavior is identical to {@link containerImpl} and {@link provides};
 * only the type surface differs. The cast is safe for impls that only store
 * and compare values without inspecting them, which is the shape every generic
 * Root takes.
 */
function genericContainer<F extends TypeLambda>(): GenericContainer<F> {
  const make = (<
    A extends HTMLElement | SVGElement | DocumentFragment,
    SelfE,
    SelfR,
  >(
    impl: GenericContainerImpl<F, A, SelfE, SelfR>,
  ) =>
    containerImpl(
      impl as unknown as ContainerImpl<
        Kind<F, never, never, never, unknown>,
        A,
        SelfE,
        SelfR
      >,
    ) as unknown as GenericContainerFactory<
      F,
      A,
      SelfE,
      SelfR,
      never
    >) as GenericContainer<F>;

  // `provides` is reassigned as a read-write property on `make` here; the
  // public surface narrows it to `readonly` via the GenericContainer type.
  (make as { provides: GenericContainer<F>["provides"] }).provides =
    provides as unknown as GenericContainer<F>["provides"];

  return make;
}

/**
 * The public `container` — see {@link containerImpl} for the full docs on the
 * call shape and inference, {@link provides} for the `.provides(Tag | {…})`
 * helper, and {@link genericContainer} for the `.generic<F>()` helper used for
 * value-typed Roots.
 *
 * The explicit intersection replaces what was previously a function/namespace
 * merge. Inside an emitted `declare namespace container { var provides: typeof
 * provides; }` block the `typeof provides` lookup resolves to the namespace
 * member itself (self-reference), which collapses to `any` under
 * `skipLibCheck: true` and errors under `skipLibCheck: false`. Using
 * `Object.assign` with an explicit intersection prevents TypeScript from
 * emitting that merge in the `.d.ts`.
 */
export const container: typeof containerImpl & {
  provides: typeof provides;
  generic: typeof genericContainer;
} = Object.assign(containerImpl, { provides, generic: genericContainer });
