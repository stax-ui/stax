/**
 * Type-level invariants for `container()` and `container.provides()`.
 *
 * The cases checked here are the invariants the component() proposal
 * from `stax-primitives/dev_notes/upstream/STAX_COMPONENT.md` and the
 * upstream reply (2026-10-31) named as "must not quietly regress":
 *
 * - A required-prop container rejects the no-args and children-only
 *   call shapes.
 * - An impl that `yield*`-reads a service adds that service's
 *   Identifier to the factory's `R` channel.
 * - A `.provides(Tag)` container removes that Tag from children's `R`
 *   via `Exclude`.
 * - A `.provides(Tag)` factory called **without wrapping** the children
 *   that read the Tag does *not* silently cancel the requirement — the
 *   reader's `R` still carries it, so downstream consumption without
 *   a provider above is a type error.
 *
 * Runs under `tsc --noEmit`; no behavioural side.
 */

import { Context, Effect, Scope } from "effect";

import { RendererContext } from "@stax-ui/core";

import { $ } from "../Element/DOMElements.js";
import type { Element as StaxElement } from "../Element/types.js";
import { container } from "./container.js";

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

const Leaf = container((_props: LeafProps, children) => $.span({}, children));

// All three call shapes succeed for a fully-optional-prop container.
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

const Panel = container((_props: PanelProps, children) =>
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

const PanelTwo = container((_props: PanelProps, children) =>
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

const PanelFail = container((_props: PanelProps, children) =>
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

const Progress = container((props: RequiredProps, children) =>
  $.div({ "data-value": String(props.value) }, children),
);

Progress({ value: 10 });
Progress({ value: 10 }, "label");

// @ts-expect-error — missing required prop `value`.
Progress();
// @ts-expect-error — string isn't a valid Props.
Progress("just a child");

// -----------------------------------------------------------------------------
// Provider — single tag. Props/A/E/R inferred; Prov from the Tag's Identifier.
// -----------------------------------------------------------------------------

const Root = container.provides(CollapsibleRootCtx)(
  (props: RootProps, provide) =>
    $.div({}, provide({ open: props.defaultOpen ?? false })),
);

const _rootCall = Root({}, "x");
export type _RootA = Expect<
  Equals<SuccessOf<typeof _rootCall>, HTMLDivElement>
>;
export type _RootR = Expect<Equals<RequirementsOf<typeof _rootCall>, Ambient>>;

// Root wrapping Panel — Panel's requirement cancels under Root's Provides.
const _rootPanelCall = Root({}, Panel({}, "inner"));
export type _RootPanelR = Expect<
  Equals<RequirementsOf<typeof _rootPanelCall>, Ambient>
>;

// -----------------------------------------------------------------------------
// Provides-without-wrapping — the Tag on children's R is NOT silently
// cancelled, so a downstream consumer still sees the requirement.
// -----------------------------------------------------------------------------

// Panel called alone (no Root above) — R still carries CollapsibleRootCtx.
const _panelOrphan = Panel({}, "orphan");
export type _PanelOrphanR = Expect<
  Equals<RequirementsOf<typeof _panelOrphan>, Ambient | CollapsibleRootCtx>
>;

// An explicit downstream consumer that expects only Ambient requirements
// must reject the orphan Panel and accept the wrapped one.
declare function expectAmbient<A>(e: Effect.Effect<A, unknown, Ambient>): A;

expectAmbient(Root({}, Panel({}, "wrapped")));
// @ts-expect-error — Panel's CollapsibleRootCtx is not provided.
expectAmbient(Panel({}, "unprovided"));

// -----------------------------------------------------------------------------
// Provider — record form. Two Provides unioned into the Prov slot.
// -----------------------------------------------------------------------------

const MultiRoot = container.provides({
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
