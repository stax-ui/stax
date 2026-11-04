/**
 * Unified inference spike — combining two discoveries:
 *
 * 1. If impl's declared `children` parameter is typed `Children<never,
 *    never>`, impl's return E and R channels contain only impl's own
 *    contributions. TS infers both directly from the return type with
 *    no "diff" to compute.
 *
 * 2. For the `Provides` axis, passing the Context.Tag as a runtime
 *    argument to `component.makes(Tag)` lets TS infer `Prov` from the
 *    Tag's Identifier type, without the author ever writing a type
 *    argument.
 *
 * The runtime side carries a small "lie": children's actual E and R
 * at the call site are not what impl's signature declares. The
 * ComponentFactory wrapper re-attaches the call-site children's E and
 * R into the output via its overload type magic
 * (`ChildInputE<T[number]>`, `ChildInputR<T[number]>`). Impl's body
 * just forwards children opaquely — it doesn't need to see their
 * generics because it isn't doing anything with the type parameters
 * beyond passing them to inner factories.
 *
 * End result: `component(impl)` covers pure leaves AND context
 * readers AND impl-can-fail cases, all with zero generics. The only
 * case that still needs an explicit carrier is Provides, via the
 * Tag-value `.makes` curry.
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
 * Provider path. Tag value in; impl receives a `provide(service)`
 * helper that wraps closed-over children with provideService and
 * returns them as `Children<never, never>` — ready to flow into
 * inner factories.
 */
declare namespace component {
  function makes<T extends Context.Tag<any, any>>(
    tag: T,
  ): <
    Props,
    A extends HTMLElement | SVGElement | DocumentFragment,
    SelfE,
    SelfR,
  >(
    impl: (
      props: Props,
      children: Children<never, never>,
      provide: (service: Context.Tag.Service<T>) => Children<never, never>,
    ) => StaxElement<A, SelfE, SelfR>,
  ) => ComponentFactory<Props, A, SelfE, SelfR, Context.Tag.Identifier<T>>;
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

// Provider via Tag-value `.makes`.
const Root = component.makes(CollapsibleRootCtx)(
  (props: RootProps, _children, provide) =>
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
