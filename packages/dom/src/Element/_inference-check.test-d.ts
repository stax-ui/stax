/**
 * Standalone type-inference check for the variadic element factory.
 * Verifies E/R channels union properly across mixed children.
 *
 * This file is compile-only — never executed.
 */

import { Context, Effect } from "effect";

import { $, type Element } from "../index.js";
// -------------------------------------------------------------------------
// Forwarding-case check — a wrapper component that passes its own children
// param down to a primitive. This is the pattern that hit TS2589 before
// the forwarding overload was added.
// -------------------------------------------------------------------------

import type { ChildInput } from "./types.js";

class ServiceA extends Context.Tag("ServiceA")<
  ServiceA,
  { readonly a: number }
>() {}
class ServiceB extends Context.Tag("ServiceB")<
  ServiceB,
  { readonly b: number }
>() {}

class ErrA {
  readonly _tag = "ErrA";
}
class ErrB {
  readonly _tag = "ErrB";
}

// Two children whose Effect signatures carry distinct errors AND
// distinct service dependencies. No `as` casts — these are genuine
// service/error dependencies picked up through `yield*`.
const childA: Element.Element<HTMLSpanElement, ErrA, ServiceA> = Effect.gen(
  function* () {
    yield* ServiceA;
    if (Math.random() < 0) yield* Effect.fail(new ErrA());
    return yield* $.span("a");
  },
);

const childB: Element.Element<HTMLParagraphElement, ErrB, ServiceB> =
  Effect.gen(function* () {
    yield* ServiceB;
    if (Math.random() < 0) yield* Effect.fail(new ErrB());
    return yield* $.p("b");
  });

// Attrs + variadic children. E should be ErrA | ErrB, R should include
// ServiceA | ServiceB (plus Scope + RendererContext from Element).
const combined1 = $.div({ class: "x" }, childA, childB, "static");

// The point of this file: this assignment must typecheck.
// If E/R don't union across variadic slots, this fails.
const _proof: Element.Element<
  HTMLDivElement,
  ErrA | ErrB,
  ServiceA | ServiceB
> = combined1;

// Children only (no attrs).
const combined2 = $.div(childA, childB, "static");
const _proof2: Element.Element<
  HTMLDivElement,
  ErrA | ErrB,
  ServiceA | ServiceB
> = combined2;

// Single-level array with mixed types — union propagates across the array
// element union. Nested arrays are intentionally NOT part of ChildInput
// (they'd re-introduce the TS2589 depth issue for component wrappers).
const combined3 = $.div([childA, childB, "flat"]);
const _proof3: Element.Element<
  HTMLDivElement,
  ErrA | ErrB,
  ServiceA | ServiceB
> = combined3;

// Mix of Elements, primitives, single-level arrays, nullish.
const combined4 = $.div(
  { class: "y" },
  childA,
  null,
  false,
  undefined,
  "hello",
  42,
  [childB, "arr-item"],
);
const _proof4: Element.Element<
  HTMLDivElement,
  ErrA | ErrB,
  ServiceA | ServiceB
> = combined4;

// No children — E and R should be `never`.
const combinedEmpty = $.div();
const _proofEmpty: Element.Element<HTMLDivElement, never, never> =
  combinedEmpty;

void _proof;
void _proof2;
void _proof3;
void _proof4;
void _proofEmpty;

// The canonical wrapper pattern: single-generic `<E, R>`, variadic
// `ReadonlyArray<ChildInput<E, R>>` children, and forwarding the collected
// array to a primitive. The factory's forwarding overload matches this
// shape and passes E/R straight through — no cast, no TS2589.
//
// Tradeoff: single-generic locks E/R across all children (covariant E
// unions naturally, contravariant R intersects). For the common wrapper
// case where callers pass children with a shared or compatible R, this is
// exactly what you want. Callers who genuinely need heterogeneous
// requirements use the primitive directly via its variadic overload.
const MyWrapper = <E, R>(
  ...children: ReadonlyArray<ChildInput<E, R>>
): Element.Element<HTMLDivElement, E, R> =>
  $.div({ class: "wrapper" }, children);

// Homogeneous children pass through E and R unchanged.
declare const childHomA: Element.Element<HTMLSpanElement, ErrA, ServiceA>;
declare const childHomB: Element.Element<HTMLParagraphElement, ErrA, ServiceA>;

const wrappedHomogeneous = MyWrapper(childHomA, childHomB);
const _proofWrappedHom: Element.Element<HTMLDivElement, ErrA, ServiceA> =
  wrappedHomogeneous;

void _proofWrappedHom;
