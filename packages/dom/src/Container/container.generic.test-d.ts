/**
 * Type-level invariants for `container.generic<F>()` and
 * `container.generic<F>().provides(...)`.
 *
 * The cases checked here map to the invariants the primitives agent named
 * in `stax-primitives/dev_notes/upstream/STATUS.md` (2026-11-15, new ask 2):
 *
 * - `V` is inferred from `defaultValue` and flows through `onValueChange`.
 * - `const V` preserves literal narrowing of array-of-literals props.
 * - A wrong `V` passed through a prop is rejected at the type level.
 * - The `{} extends Props` guard is evaluated against the fully-unknown
 *   instance of the type lambda.
 * - `.provides(Tag)` on a generic container removes the Tag from the
 *   children's `R` via `Exclude`, same as the non-generic variant.
 *
 * Runs under `tsc --noEmit`; no behavioural side.
 */

import { Context, Effect, Scope } from "effect";
import type { TypeLambda } from "effect/HKT";

import { RendererContext, type SingleRoot } from "@stax-ui/core";

import { $ } from "../Element/DOMElements.js";
import { container } from "./container.js";

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
type SuccessOf<T> =
  T extends Effect.Effect<infer A, unknown, unknown> ? A : never;

type Ambient = Scope.Scope | RendererContext;

// -----------------------------------------------------------------------------
// Fixtures — a Base UI-style Root with a required array value prop.
// -----------------------------------------------------------------------------

interface RootProps<V> {
  readonly defaultValue: ReadonlyArray<V>;
  readonly onValueChange?: (value: ReadonlyArray<V>) => void;
}

interface RootPropsF extends TypeLambda {
  readonly type: RootProps<this["Target"]>;
}

const Root = container.generic<RootPropsF>()((_props, children) =>
  $.div(children),
);

// `onValueChange` sees V inferred from defaultValue — this is the whole point.
const _rootInferA = Root({
  defaultValue: ["a", "b"],
  onValueChange: (v) => {
    const _check: ReadonlyArray<"a" | "b"> = v;
    void _check;
  },
});

export type _RootInferASuccess = Expect<
  Equals<SuccessOf<typeof _rootInferA>, HTMLDivElement & SingleRoot>
>;
export type _RootInferARequires = Expect<
  Equals<RequirementsOf<typeof _rootInferA>, Ambient>
>;

// With a child as well, the child's E and R union into the output.
declare const asyncChild: Effect.Effect<HTMLElement, "ChildErr", "SiblingCtx">;

const _rootWithChild = Root(
  { defaultValue: ["x"], onValueChange: (v) => void v },
  asyncChild,
);

export type _RootChildR = Expect<
  Equals<RequirementsOf<typeof _rootWithChild>, Ambient | "SiblingCtx">
>;

// -----------------------------------------------------------------------------
// `const V` keeps the literal narrowing.
// -----------------------------------------------------------------------------

type Panel = "a" | "b";

// Caller declares V externally via `onValueChange`'s argument type — the
// `defaultValue` has to fit, and this is where generic containers earn
// their keep: a value outside the declared V is rejected.
Root({
  // @ts-expect-error — "c" isn't in Panel.
  defaultValue: ["c"],
  onValueChange: (v: ReadonlyArray<Panel>) => void v,
});

// Converse: a defaultValue that's a strict subset of the declared V is fine.
Root({
  defaultValue: ["a"],
  onValueChange: (v: ReadonlyArray<Panel>) => void v,
});

// -----------------------------------------------------------------------------
// Required-prop guard — missing `defaultValue` is an error.
// -----------------------------------------------------------------------------

// @ts-expect-error — defaultValue is required.
Root({});
// @ts-expect-error — the no-args shape is not available for required-prop containers.
Root();

// -----------------------------------------------------------------------------
// `.generic<F>().provides(Tag)` — Tag cancels from children's R.
// -----------------------------------------------------------------------------

class CollapsibleRootCtx extends Context.Tag("CollapsibleRootCtx")<
  CollapsibleRootCtx,
  { readonly open: boolean }
>() {}

interface PanelProps<V> {
  readonly keepValue: ReadonlyArray<V>;
}
interface PanelPropsF extends TypeLambda {
  readonly type: PanelProps<this["Target"]>;
}

const ProviderRoot = container
  .generic<PanelPropsF>()
  .provides(CollapsibleRootCtx)((props, provide) =>
  $.div(provide({ open: props.keepValue.length > 0 })),
);

// A child that reads CollapsibleRootCtx cancels its requirement under ProviderRoot.
const PanelChild = container((_props: object, children) =>
  Effect.gen(function* () {
    yield* CollapsibleRootCtx;
    return yield* $.span(children);
  }),
);

const _providerCall = ProviderRoot(
  { keepValue: ["one", "two"] },
  PanelChild({}, "hello"),
);

export type _ProviderRootA = Expect<
  Equals<SuccessOf<typeof _providerCall>, HTMLDivElement & SingleRoot>
>;
// CollapsibleRootCtx is NOT in requirements — provided by ProviderRoot.
export type _ProviderRootR = Expect<
  Equals<RequirementsOf<typeof _providerCall>, Ambient>
>;

// -----------------------------------------------------------------------------
// Fully-optional generic props — the WithoutProps shape is available.
// -----------------------------------------------------------------------------

interface LeafProps<V> {
  readonly hint?: ReadonlyArray<V>;
}
interface LeafPropsF extends TypeLambda {
  readonly type: LeafProps<this["Target"]>;
}

const Leaf = container.generic<LeafPropsF>()((_props, children) =>
  $.span(children),
);

// All three call shapes — no-args, children-only, props+children.
export const _leafNoArg = Leaf();
export const _leafText = Leaf("hi");
export const _leafPropsText = Leaf({ hint: ["a", "b"] }, "hi");

export type _LeafA = Expect<
  Equals<SuccessOf<typeof _leafText>, HTMLSpanElement & SingleRoot>
>;
