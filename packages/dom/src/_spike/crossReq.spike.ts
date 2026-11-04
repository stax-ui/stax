/**
 * Focused probe: does a ComponentFactory with `Requires = X` accept
 * children whose own R channel brings in an unrelated service `Y`?
 *
 * This isolates one interaction. The question is whether it's a general
 * limitation of `ComponentFactory`'s variadic overload or specific to a
 * particular shape — and, either way, whether `$.div` (ElementFactory)
 * handles the same shape today.
 *
 * The answer determines what we tell component authors:
 *   - If both fail → it's a stax-wide ChildInput-variance limitation,
 *     unchanged by `component()`.
 *   - If `$.div` works and `ComponentFactory` doesn't → the proposed
 *     shape introduces a new limitation that affects any wrapper over a
 *     service-mixing child set, and the response needs to flag it.
 *
 * Result (2026-10-31): both work. R inference is correct in all four
 * cases. See `FINDINGS.md`.
 */

import type { Effect, Scope } from "effect";

import type { Readable, RendererContext } from "@stax-ui/core";

import { $ } from "../Element/DOMElements.js";
import type { ComponentFactory } from "./componentFactory.spike.js";

// `Readable` and `Scope` are only used in the type-level assertions below.
void (null as unknown as Readable.Readable<string>);

interface CollapsibleRootCtx {
  readonly _: "CollapsibleRootCtx";
  readonly open: boolean;
}

interface AsyncErrCtx {
  readonly _: "AsyncErrCtx";
}

declare const Panel: ComponentFactory<
  { keepMounted?: boolean },
  HTMLDivElement,
  never, // Fails
  CollapsibleRootCtx, // Requires
  never // Provides
>;

declare const asyncLeaf: Effect.Effect<HTMLElement, Error, AsyncErrCtx>;

// Case 1: `$.div` with a mix of context-tagged children variadically.
// Baseline control — if this fails, the limitation is in the stock
// ElementFactory, not in anything the proposal introduces.
export const _case1 = $.div({}, "a", asyncLeaf, "b");

// Case 2: Panel accepts the same mix variadically. Panel's `Requires`
// should only decorate the return R, never the child slot's constraint.
export const _case2 = Panel({}, "a", asyncLeaf, "b");

// Case 3: Panel's own children (R=CollapsibleRootCtx) mixed with
// asyncLeaf (R=AsyncErrCtx), both at the same depth.
export const _case3 = Panel({}, "a", Panel({}, "nested"), asyncLeaf, "b");

// Case 4: Case 3's shape in forwarding form (single-array children).
export const _case4 = Panel({}, ["a", Panel({}, "nested"), asyncLeaf, "b"]);

// -----------------------------------------------------------------------------
// R-channel assertions — Panel never provides, so both services pass
// through to the output, plus Panel's own Requires.
// -----------------------------------------------------------------------------

type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

type Expect<T extends true> = T;

type RequirementsOf<T> =
  T extends Effect.Effect<unknown, unknown, infer R> ? R : never;

type Ambient = Scope.Scope | RendererContext;

export type _Case2R = Expect<
  Equals<
    RequirementsOf<typeof _case2>,
    Ambient | CollapsibleRootCtx | AsyncErrCtx
  >
>;

export type _Case3R = Expect<
  Equals<
    RequirementsOf<typeof _case3>,
    Ambient | CollapsibleRootCtx | AsyncErrCtx
  >
>;
