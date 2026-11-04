/**
 * Spike for the proposed `ComponentFactory<Props, A, Requires, Provides>`
 * type (from `stax-primitives/dev_notes/upstream/STAX_COMPONENT.md`,
 * section 2).
 *
 * This file answers **one question**:
 *
 * > Does stacking `Exclude<ChildInputR<T[number]>, Prov> | Req` on top of
 * > the variadic-tuple inference in `ChildInputE` / `ChildInputR` trip
 * > TS2589 ("excessively deep") in realistic component call sites?
 *
 * The proposal's own tests section specifies the stress shape:
 *
 *   > A Root that provides a context, with a Panel that requires it,
 *   > holding 10+ mixed children, nested three deep.
 *
 * That is {@link TripleDeepRootPanelStress} below. The spike also
 * verifies, with `Equals<>` type-level assertions, that the inferred
 * `R` channel is what the proposal promises on simple shapes — Requires
 * added in, Provides subtracted out — so if the shape is viable we also
 * know the type is correct, not just that it compiles.
 *
 * Nothing runs; nothing is exported from the package. Component
 * construction is stubbed with `declare` so the spike stays focused on
 * the type-level question.
 */

import type { Effect, Scope } from "effect";

import type { Readable, RendererContext } from "@stax-ui/core";

import type { ChildInputE, ChildInputR } from "../Element/DOMElements.js";
import type { ChildInput, Element as StaxElement } from "../Element/types.js";

// `Element` is a DOM global interface — using the StaxElement alias
// keeps TypeScript from resolving the inner type references to it.

// -----------------------------------------------------------------------------
// 1. ComponentFactory — exactly as the proposal spec'd
// -----------------------------------------------------------------------------

/**
 * The TS2589-at-risk half: variadic form with `Exclude<ChildInputR<...>,
 * Prov>` on the R channel. The forwarding form sits alongside it as the
 * TS2589-safe fallback (one `<E, R>` pair, no recursive-tuple inference).
 *
 * `Fails` carries impl's own E channel (if any) unioned with each
 * child's E, mirroring the way `Requires` unions with children's R.
 * Defaults to `never`, so a component whose impl can't fail on its own
 * still reports children's E unchanged.
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

/** The props-less half, mirroring `WithProps` without the first arg. */
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
 * `{} extends Props` is the proposal's "every prop is optional" guard —
 * only when it holds do the no-props overloads exist. For a component
 * with a required prop the intersection collapses to `WithProps`, and
 * calling it with no first-arg object is a type error.
 *
 * Positional order mirrors `Element<A, E, R>`: Props describes the
 * input, then A / Fails (= E) / Requires (= R) describe the output
 * directly, with Provides as the R-transformer. `Fails`, `Requires`,
 * and `Provides` all default to `never`.
 */
export type ComponentFactory<
  Props,
  A extends HTMLElement | SVGElement | DocumentFragment,
  Fails = never,
  Requires = never,
  Provides = never,
> = WithProps<Props, A, Fails, Requires, Provides> &
  // `{} extends Props` is the "every prop is optional" check from the
  // proposal. The literal `{}` here is deliberate: it matches the
  // object with no required keys, which is exactly what we want to
  // branch on.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  ({} extends Props ? WithoutProps<A, Fails, Requires, Provides> : unknown);

// -----------------------------------------------------------------------------
// 2. Fake context tags and component declarations
// -----------------------------------------------------------------------------

interface CollapsibleRootCtx {
  readonly _: "CollapsibleRootCtx";
  readonly open: boolean;
}

interface PanelProps {
  readonly keepMounted?: boolean;
}

interface RootProps {
  readonly defaultOpen?: boolean;
}

interface TriggerProps {
  readonly disabled?: boolean;
}

interface ProgressProps {
  readonly value: number; // required
}

/** Root — provides CollapsibleRootCtx, no self failures or requirements. */
declare const Root: ComponentFactory<
  RootProps,
  HTMLDivElement,
  never, // Fails
  never, // Requires
  CollapsibleRootCtx // Provides
>;

/** Panel — requires CollapsibleRootCtx, can't fail on its own. */
declare const Panel: ComponentFactory<
  PanelProps,
  HTMLDivElement,
  never, // Fails
  CollapsibleRootCtx, // Requires
  never // Provides
>;

/** Trigger — requires CollapsibleRootCtx. */
declare const Trigger: ComponentFactory<
  TriggerProps,
  HTMLButtonElement,
  never,
  CollapsibleRootCtx,
  never
>;

/** Leaf — pure, no Req / no Prov. Props all optional. */
declare const Leaf: ComponentFactory<{ label?: string }, HTMLSpanElement>;

/** Progress — required prop; the `{} extends Props` guard disappears. */
declare const Progress: ComponentFactory<ProgressProps, HTMLDivElement>;

declare const sig: Readable.Readable<string>;

// -----------------------------------------------------------------------------
// 3. Type-level assertion helpers
// -----------------------------------------------------------------------------

type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

type Expect<T extends true> = T;

type RequirementsOf<T> =
  T extends Effect.Effect<unknown, unknown, infer R> ? R : never;

/** Every Element carries these ambient services in its R channel. */
type Ambient = Scope.Scope | RendererContext;

// -----------------------------------------------------------------------------
// 4. Baseline overload-selection checks
// -----------------------------------------------------------------------------

// 4a — Variadic, no props: a Leaf called with just children.
export const _leaf1 = Leaf("hello");
export const _leaf2 = Leaf({}, "hello");
export const _leaf3 = Leaf({}, ["a", "b"]);
export const _leaf4 = Leaf([]);

// 4b — Progress has a required prop, so the no-props overloads disappear.
export const _progress1 = Progress({ value: 10 });
// @ts-expect-error — missing required prop `value`
Progress();
// @ts-expect-error — missing required prop `value`
Progress("just a child");

// 4c — Panel requires CollapsibleRootCtx; R should include it.
export const _panelAlone = Panel({ keepMounted: true }, "text");
export type _PanelAloneR = Expect<
  Equals<RequirementsOf<typeof _panelAlone>, Ambient | CollapsibleRootCtx>
>;

// 4d — Root provides CollapsibleRootCtx; a Panel child's requirement is
// subtracted from Root's R, leaving only Ambient.
export const _rootPanel = Root({}, Panel({ keepMounted: true }, "inner"));
export type _RootPanelR = Expect<
  Equals<RequirementsOf<typeof _rootPanel>, Ambient>
>;

// 4e — Panel directly inside Root with multiple siblings — still clears.
export const _rootMulti = Root(
  {},
  Panel({}, "a"),
  Trigger({}, "b"),
  Panel({}, "c"),
);
export type _RootMultiR = Expect<
  Equals<RequirementsOf<typeof _rootMulti>, Ambient>
>;

// -----------------------------------------------------------------------------
// 5. The stress shape the proposal names: Root with a Panel, 10+ mixed
//    children, nested three deep
// -----------------------------------------------------------------------------
//
// Depth 1 = direct Root children.
// Depth 2 = direct Panel children.
// Depth 3 = elements inside an array literal passed as one Panel child.
//
// Children mix: strings, Readables (sig), context-requiring Elements
// (Panel, Trigger), and context-free Elements (Leaf). The R channel of
// each Panel/Trigger child cancels against Root's `Provides`.

export const TripleDeepRootPanelStress = Root(
  { defaultOpen: true },
  "preamble",
  Trigger({}, "open"),
  sig,
  Panel(
    { keepMounted: false },
    "panel header",
    Leaf({ label: "a" }),
    [
      "deep-1",
      Trigger({ disabled: true }, "x"),
      Panel({}, "another panel at depth 3"),
      sig,
      Leaf(),
      "deep-6",
      Leaf({ label: "deep-7" }),
      sig,
      Trigger({}, "deep-9"),
      "deep-10",
    ],
    "panel footer",
    Trigger({}, "close"),
  ),
  Leaf({ label: "aside" }),
  Trigger({}, "toggle"),
  Panel({}, "another sibling panel"),
  "epilogue",
  sig,
);

// Expected R on Root's output:
//   - Root provides CollapsibleRootCtx, so every child's requirement
//     for it (Panel, Trigger) is cleared.
//   - Nothing else contributes to R.
// If this compiles, the stacked `Exclude<ChildInputR<T[number]>, Prov>
// | Req` shape works end-to-end at three-deep nesting with 10+ mixed
// children — the proposal's own threshold.
export type _StressR = Expect<
  Equals<RequirementsOf<typeof TripleDeepRootPanelStress>, Ambient>
>;

// -----------------------------------------------------------------------------
// 6. Forwarding-overload fallback — the TS2589-safe shape
// -----------------------------------------------------------------------------
//
// If the variadic overload above exploded, this is what the fallback
// looks like. Callers pass children as a single array and `<E, R>`
// collapses to one pair. Keep this compiling to prove the fallback is
// available as a shippable floor.

export const TripleDeepRootPanelStressForwarding = Root({ defaultOpen: true }, [
  "preamble",
  Trigger({}, "open"),
  sig,
  Panel({ keepMounted: false }, [
    "panel header",
    Leaf({ label: "a" }),
    [
      "deep-1",
      Trigger({ disabled: true }, "x"),
      Panel({}, "another panel at depth 3"),
      sig,
      Leaf(),
      "deep-6",
      Leaf({ label: "deep-7" }),
      sig,
      Trigger({}, "deep-9"),
      "deep-10",
    ],
    "panel footer",
    Trigger({}, "close"),
  ]),
  Leaf({ label: "aside" }),
  Trigger({}, "toggle"),
  Panel({}, "another sibling panel"),
  "epilogue",
  sig,
]);

export type _StressForwardingR = Expect<
  Equals<RequirementsOf<typeof TripleDeepRootPanelStressForwarding>, Ambient>
>;

// -----------------------------------------------------------------------------
// 6b. Beyond-the-proposal headroom — 5 levels deep, ~25 mixed children
// -----------------------------------------------------------------------------
//
// If the proposal's 10+/3-deep threshold is where someone might
// reasonably stop stressing, this is 2x the depth and 2x the breadth —
// so a user doubling either dimension in real code still has margin
// before TS2589. If this compiles, we have real headroom.

export const WideAndDeepStress = Root(
  { defaultOpen: true },
  "d1-a",
  Trigger({}, "d1-trigger"),
  sig,
  Panel(
    {},
    "d2-a",
    Trigger({}, "d2-trigger"),
    Leaf({ label: "d2-leaf" }),
    [
      "d3-a",
      Panel(
        {},
        "d4-a",
        Trigger({}, "d4-trigger"),
        [
          "d5-a",
          Trigger({ disabled: true }, "d5-trigger-1"),
          Panel({}, "d5-panel-1"),
          Leaf({ label: "d5-leaf-1" }),
          sig,
          "d5-mid",
          Panel({}, "d5-panel-2"),
          Trigger({}, "d5-trigger-2"),
          Leaf(),
          "d5-z",
        ],
        "d4-mid",
        Panel({}, "d4-panel"),
        Trigger({}, "d4-trigger-2"),
      ),
      "d3-mid",
      Trigger({}, "d3-trigger-1"),
      Panel({}, "d3-panel"),
      sig,
      Leaf({ label: "d3-leaf" }),
      "d3-z",
    ],
    "d2-mid",
    Trigger({}, "d2-trigger-2"),
    Panel({}, "d2-panel"),
  ),
  "d1-mid",
  Leaf({ label: "d1-leaf" }),
  Trigger({}, "d1-trigger-2"),
  Panel({}, "d1-panel"),
  sig,
  "d1-z",
);

export type _WideDeepR = Expect<
  Equals<RequirementsOf<typeof WideAndDeepStress>, Ambient>
>;

// -----------------------------------------------------------------------------
// 7. Correctness smoke test: Panel outside a Root carries the Req, so
//    mounting it into a context that doesn't satisfy CollapsibleRootCtx
//    is a type error. Panel inside a Root is fine.
// -----------------------------------------------------------------------------

declare const mount: <A extends HTMLElement | SVGElement | DocumentFragment>(
  el: StaxElement<A, never, never>,
) => void;

// @ts-expect-error — Panel's output R still carries CollapsibleRootCtx
mount(Panel({}, "orphan"));

// Fine — Root subtracts the Ctx from its children's R.
mount(Root({}, Panel({}, "nested")));
