/**
 * Type-level assertions for `component()` and `component.provides()`.
 *
 * These assertions verify that every call-site axis is inferred with
 * zero explicit generics, and that composition (child Req, Root Prov,
 * call-site E) threads correctly. Run under `tsc --noEmit`; no
 * runtime side.
 */

import { Context, Effect, Scope } from "effect";

import { RendererContext } from "@stax-ui/core";

import { $ } from "../Element/DOMElements.js";
import type { Element as StaxElement } from "../Element/types.js";
import { component } from "./component.js";

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

interface RequiredProps {
  readonly value: number;
}

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
// Pure leaf — all four axes inferred.
// -----------------------------------------------------------------------------

const Leaf = component((_props: LeafProps, children) => $.span({}, children));

// All three call shapes succeed for a fully-optional-prop component.
export const _leafNoArg = Leaf();
export const _leafText = Leaf("hello");
export const _leafPropsText = Leaf({ label: "x" }, "hello");

export type _LeafA = Expect<
  Equals<SuccessOf<typeof _leafText>, HTMLSpanElement>
>;
export type _LeafR = Expect<Equals<RequirementsOf<typeof _leafText>, Ambient>>;
export type _LeafE = Expect<Equals<FailuresOf<typeof _leafText>, never>>;

// -----------------------------------------------------------------------------
// Context reader — Requires inferred from `yield*`.
// -----------------------------------------------------------------------------

const Panel = component((_props: PanelProps, children) =>
  Effect.gen(function* () {
    yield* CollapsibleRootCtx;
    return yield* $.div({}, children);
  }),
);

const _panelCall = Panel({}, "text");
export type _PanelA = Expect<
  Equals<SuccessOf<typeof _panelCall>, HTMLDivElement>
>;
export type _PanelR = Expect<
  Equals<RequirementsOf<typeof _panelCall>, Ambient | CollapsibleRootCtx>
>;

// -----------------------------------------------------------------------------
// Two reads — union into Requires.
// -----------------------------------------------------------------------------

const PanelTwo = component((_props: PanelProps, children) =>
  Effect.gen(function* () {
    yield* CollapsibleRootCtx;
    yield* ToolbarCtx;
    return yield* $.div({}, children);
  }),
);

const _panelTwoCall = PanelTwo({}, "text");
export type _PanelTwoR = Expect<
  Equals<
    RequirementsOf<typeof _panelTwoCall>,
    Ambient | CollapsibleRootCtx | ToolbarCtx
  >
>;

// -----------------------------------------------------------------------------
// Impl can fail — Fails inferred.
// -----------------------------------------------------------------------------

const PanelFail = component((_props: PanelProps, children) =>
  Effect.gen(function* () {
    yield* CollapsibleRootCtx;
    if (Math.random() > 0.5) yield* Effect.fail(new Error("boom"));
    return yield* $.div({}, children);
  }),
);

const _panelFailCall = PanelFail({}, "text");
export type _PanelFailE = Expect<
  Equals<FailuresOf<typeof _panelFailCall>, Error>
>;
export type _PanelFailR = Expect<
  Equals<RequirementsOf<typeof _panelFailCall>, Ambient | CollapsibleRootCtx>
>;

// -----------------------------------------------------------------------------
// Call-site composition — child's E and R flow into the output.
// -----------------------------------------------------------------------------

declare const asyncChild: StaxElement<HTMLElement, "ChildErr", "SiblingCtx">;
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

// -----------------------------------------------------------------------------
// Required prop — the no-props overloads disappear.
// -----------------------------------------------------------------------------

const Progress = component((props: RequiredProps, children) =>
  $.div({ "data-value": String(props.value) }, children),
);

Progress({ value: 10 });
Progress({ value: 10 }, "label");

// @ts-expect-error — missing required prop `value`.
Progress();
// @ts-expect-error — string isn't a valid Props.
Progress("just a child");

// -----------------------------------------------------------------------------
// Provider — single tag. Props/A/Fails/Requires inferred; Prov from
// the Tag's Identifier.
// -----------------------------------------------------------------------------

const Root = component.provides(CollapsibleRootCtx)(
  (props: RootProps, provide) =>
    $.div({}, provide({ open: props.defaultOpen ?? false })),
);

const _rootCall = Root({}, "x");
export type _RootA = Expect<
  Equals<SuccessOf<typeof _rootCall>, HTMLDivElement>
>;
export type _RootR = Expect<Equals<RequirementsOf<typeof _rootCall>, Ambient>>;

// Root wrapping Panel — Panel's Req cancels under Root's Prov.
const _rootPanelCall = Root({}, Panel({}, "inner"));
export type _RootPanelR = Expect<
  Equals<RequirementsOf<typeof _rootPanelCall>, Ambient>
>;

// -----------------------------------------------------------------------------
// Provider — record form. Two Provides unioned into the Prov slot.
// -----------------------------------------------------------------------------

const MultiRoot = component.provides({
  root: CollapsibleRootCtx,
  toolbar: ToolbarCtx,
})((props: RootProps, provide) =>
  $.div(
    {},
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
