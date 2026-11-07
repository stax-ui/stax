/**
 * Unified inference spike — combining three discoveries:
 *
 * 1. If impl's declared `children` parameter is typed `Children<never,
 *    never>`, impl's return E and R channels contain only impl's own
 *    contributions. TS infers both directly from the return type with
 *    no "diff" to compute.
 *
 * 2. For the `Provides` axis, passing the Context.Tag as a runtime
 *    argument to `component.provides(Tag)` lets TS infer `Prov` from
 *    the Tag's Identifier type without the author ever writing a type
 *    argument.
 *
 * 3. For multi-service providers, pass a `{ label: Tag }` record to
 *    `component.provides(...)`. TS extracts the union of
 *    `Context.Tag.Identifier` across all values, and the matching
 *    `provide({ label: service, ... })` call is type-checked against
 *    the record's service shapes.
 *
 * Impl signature for providers: `(props, provide, children?) =>
 * Element`. `provide` is the primary tool — it closes over impl's
 * children and wraps them with the service(s). `children` is a third
 * optional parameter for impl that wants to route children manually
 * (e.g. slot some raw, scope others); `provide(service, specific)`
 * accepts an explicit children override for that case.
 *
 * The runtime side carries a small "lie": children's actual E and R
 * at the call site are not what impl's signature declares. The
 * ComponentFactory wrapper re-attaches the call-site children's E and
 * R into the output via its overload type magic
 * (`ChildInputE<T[number]>`, `ChildInputR<T[number]>`).
 *
 * End result: `component(impl)` covers pure leaves, context readers,
 * and impl-can-fail with zero generics. Providers use
 * `component.provides(Tag)(impl)` or
 * `component.provides({ ... })(impl)`; the Tag value(s) are the only
 * runtime carrier Provides needs.
 */

import { Context, Effect, Scope } from "effect";

import { RendererContext } from "@stax-ui/core";

import type { ChildLeaf, Element as StaxElement } from "../Element/types.js";
import type { ComponentFactory } from "./componentFactory.spike.js";

type Children<E, R> = ReadonlyArray<ChildLeaf<E, R>>;

// -----------------------------------------------------------------------------
// The `component` constructor surface
// -----------------------------------------------------------------------------

/**
 * Pure path. Impl declares children with R=never, E=never; TS infers
 * SelfE and SelfR from impl's return.
 */
declare function component<
  Props,
  A extends HTMLElement | SVGElement | DocumentFragment,
  SelfE,
  SelfR,
>(
  impl: (
    props: Props,
    children: Children<never, never>,
  ) => StaxElement<A, SelfE, SelfR>,
): ComponentFactory<Props, A, SelfE, SelfR, never>;

/**
 * Provider paths. Single-tag shorthand and record form share the same
 * impl shape: `(props, provide, children?)`. `provide` closes over
 * impl's children by default; pass an explicit second arg to override.
 */
declare namespace component {
  // Single-tag shorthand.
  function provides<T extends Context.Tag<any, any>>(
    tag: T,
  ): <
    Props,
    A extends HTMLElement | SVGElement | DocumentFragment,
    SelfE,
    SelfR,
  >(
    impl: (
      props: Props,
      provide: (
        service: Context.Tag.Service<T>,
        children?: Children<never, never>,
      ) => Children<never, never>,
      children?: Children<never, never>,
    ) => StaxElement<A, SelfE, SelfR>,
  ) => ComponentFactory<Props, A, SelfE, SelfR, Context.Tag.Identifier<T>>;

  // Record form — any number of services keyed by author-chosen
  // labels. `provide({ label: service, ... })` takes the matching
  // record.
  function provides<Tags extends Record<string, Context.Tag<any, any>>>(
    tags: Tags,
  ): <
    Props,
    A extends HTMLElement | SVGElement | DocumentFragment,
    SelfE,
    SelfR,
  >(
    impl: (
      props: Props,
      provide: (
        services: { [K in keyof Tags]: Context.Tag.Service<Tags[K]> },
        children?: Children<never, never>,
      ) => Children<never, never>,
      children?: Children<never, never>,
    ) => StaxElement<A, SelfE, SelfR>,
  ) => ComponentFactory<
    Props,
    A,
    SelfE,
    SelfR,
    Context.Tag.Identifier<Tags[keyof Tags]>
  >;
}

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

class CollapsibleRootCtx extends Context.Tag("CollapsibleRootCtx")<
  CollapsibleRootCtx,
  { readonly open: boolean }
>() {}

class ToolbarCtx extends Context.Tag("ToolbarCtx")<
  ToolbarCtx,
  { readonly orientation: "horizontal" | "vertical" }
>() {}

interface PanelProps {
  readonly keepMounted?: boolean;
}

interface RootProps {
  readonly defaultOpen?: boolean;
}

interface LeafProps {
  readonly label?: string;
}

declare const stubDiv: <E, R>(
  children: Children<E, R>,
) => StaxElement<HTMLDivElement, E, R>;

declare const stubSpan: <E, R>(
  children: Children<E, R>,
) => StaxElement<HTMLSpanElement, E, R>;

// -----------------------------------------------------------------------------
// Assertion helpers
// -----------------------------------------------------------------------------

type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

type Expect<T extends true> = T;

type RequirementsOf<T> =
  T extends Effect.Effect<unknown, unknown, infer R> ? R : never;
type FailuresOf<T> =
  T extends Effect.Effect<unknown, infer E, unknown> ? E : never;
type SuccessOf<T> =
  T extends Effect.Effect<infer A, unknown, unknown> ? A : never;

type Ambient = Scope.Scope | RendererContext;

// -----------------------------------------------------------------------------
// Tests — all four axes (Props, A, Req, Prov) inferred with zero
// explicit generics. Plus Fails for the bonus E axis.
// -----------------------------------------------------------------------------

// Pure leaf.
const Leaf = component((_props: LeafProps, children) => stubSpan(children));
const _leafCall = Leaf({});
export type _LeafA = Expect<
  Equals<SuccessOf<typeof _leafCall>, HTMLSpanElement>
>;
export type _LeafR = Expect<Equals<RequirementsOf<typeof _leafCall>, Ambient>>;
export type _LeafE = Expect<Equals<FailuresOf<typeof _leafCall>, never>>;

// Context reader — just yield* the tag in impl; Req inferred.
const Panel = component((_props: PanelProps, children) =>
  Effect.gen(function* () {
    yield* CollapsibleRootCtx;
    return yield* stubDiv(children);
  }),
);
const _panelCall = Panel({}, "text");
export type _PanelA = Expect<
  Equals<SuccessOf<typeof _panelCall>, HTMLDivElement>
>;
export type _PanelR = Expect<
  Equals<RequirementsOf<typeof _panelCall>, Ambient | CollapsibleRootCtx>
>;

// Two reads.
const PanelTwo = component((_props: PanelProps, children) =>
  Effect.gen(function* () {
    yield* CollapsibleRootCtx;
    yield* ToolbarCtx;
    return yield* stubDiv(children);
  }),
);
const _panelTwoCall = PanelTwo({}, "text");
export type _PanelTwoR = Expect<
  Equals<
    RequirementsOf<typeof _panelTwoCall>,
    Ambient | CollapsibleRootCtx | ToolbarCtx
  >
>;

// Impl can fail — E inferred as well.
const PanelFail = component((_props: PanelProps, children) =>
  Effect.gen(function* () {
    yield* CollapsibleRootCtx;
    if (Math.random() > 0.5) yield* Effect.fail(new Error("boom"));
    return yield* stubDiv(children);
  }),
);
const _panelFailCall = PanelFail({}, "text");
export type _PanelFailE = Expect<
  Equals<FailuresOf<typeof _panelFailCall>, Error>
>;
export type _PanelFailR = Expect<
  Equals<RequirementsOf<typeof _panelFailCall>, Ambient | CollapsibleRootCtx>
>;

// Call-site composition: a child that itself has E and R.
declare const asyncChild: Effect.Effect<HTMLElement, "ChildErr", "SiblingCtx">;
const _withChildCall = Panel({}, "a", asyncChild, "b");
export type _WithChildE = Expect<
  Equals<FailuresOf<typeof _withChildCall>, "ChildErr">
>;
export type _WithChildR = Expect<
  Equals<
    RequirementsOf<typeof _withChildCall>,
    Ambient | CollapsibleRootCtx | "SiblingCtx"
  >
>;

// Single-tag provider via `.provides(Tag)`.
const Root = component.provides(CollapsibleRootCtx)(
  (props: RootProps, provide) =>
    stubDiv(provide({ open: props.defaultOpen ?? false })),
);
const _rootCall = Root({}, "x");
export type _RootA = Expect<
  Equals<SuccessOf<typeof _rootCall>, HTMLDivElement>
>;
export type _RootR = Expect<Equals<RequirementsOf<typeof _rootCall>, Ambient>>;

// Root({}, Panel({}, "x")) — Panel's Req cancels under Root's Prov.
const _rootPanelCall = Root({}, Panel({}, "inner"));
export type _RootPanelR = Expect<
  Equals<RequirementsOf<typeof _rootPanelCall>, Ambient>
>;

// Record-form provider — multiple services at once.
const MultiRoot = component.provides({
  root: CollapsibleRootCtx,
  toolbar: ToolbarCtx,
})((props: RootProps, provide) =>
  stubDiv(
    provide({
      root: { open: props.defaultOpen ?? false },
      toolbar: { orientation: "horizontal" },
    }),
  ),
);
const _multiRootCall = MultiRoot({}, "x");
export type _MultiRootA = Expect<
  Equals<SuccessOf<typeof _multiRootCall>, HTMLDivElement>
>;
export type _MultiRootR = Expect<
  Equals<RequirementsOf<typeof _multiRootCall>, Ambient>
>;

// MultiRoot wrapping a child that needs both services — both cancel.
const _multiRootPanelCall = MultiRoot({}, PanelTwo({}, "inner"));
export type _MultiRootPanelR = Expect<
  Equals<RequirementsOf<typeof _multiRootPanelCall>, Ambient>
>;

// Escape hatch — impl takes raw `children` as a third param and routes
// them through `provide` selectively. Here, impl's children arg is the
// opaque `Children<never, never>` the trick gives us; `provide(service,
// specific)` scopes an explicit subset instead of impl's closed-over
// set. The author is responsible for making sure every real child ends
// up scoped where needed — the lie about children's E/R means TS can't
// catch mis-routing.
const SplitRoot = component.provides(CollapsibleRootCtx)(
  (props: RootProps, provide, children = []) =>
    stubDiv([
      ...children.slice(0, 1),
      ...provide({ open: props.defaultOpen ?? false }, children.slice(1)),
    ]),
);
const _splitRootCall = SplitRoot({}, "head", "body");
export type _SplitRootA = Expect<
  Equals<SuccessOf<typeof _splitRootCall>, HTMLDivElement>
>;
