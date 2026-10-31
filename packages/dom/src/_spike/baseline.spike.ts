/**
 * Sanity baseline for the ComponentFactory spike.
 *
 * Before judging ComponentFactory, confirm what `$.div` (the existing
 * ElementFactory) does with the shape we're about to stress-test:
 * children whose `R` channel is non-`never`.
 *
 * If `$.div` compiles with a service-tagged child, we know ChildInput's
 * `R = unknown` constraint is permissive and ComponentFactory issues
 * must come from the Exclude/Req stacking. If `$.div` ALSO fails, the
 * TS2589 question is moot — the real question is a different one about
 * `ChildInput<unknown, unknown>`'s constraint shape.
 */

import type { Effect } from "effect";

import { $ } from "../Element/DOMElements.js";

interface AsyncErrCtx {
  readonly _: "AsyncErrCtx";
}

declare const asyncLeaf: Effect.Effect<HTMLElement, Error, AsyncErrCtx>;

// Variadic: do R-tagged effects pass through `$.div`'s variadic overload?
export const _varTagged = $.div({}, "hi", asyncLeaf, "bye");

// Forwarding: single-array shape with R-tagged children.
export const _fwdTagged = $.div({}, ["hi", asyncLeaf, "bye"]);

// Nested-array shape (variadic position with one of the args being an array).
export const _nestedTagged = $.div({}, "a", ["b", asyncLeaf, "c"], "d");

// Deeply nested with multiple R-tagged children — matches the stress call
// shape in componentFactory.spike.ts but using the stock ElementFactory.
interface Ctx1 {
  readonly _: "Ctx1";
}
interface Ctx2 {
  readonly _: "Ctx2";
}
declare const needCtx1: Effect.Effect<HTMLDivElement, never, Ctx1>;
declare const needCtx2: Effect.Effect<HTMLDivElement, never, Ctx2>;

export const _deeplyNested = $.div(
  {},
  "a",
  needCtx1,
  [
    "b",
    needCtx2,
    needCtx1,
    asyncLeaf,
    "c",
    needCtx1,
    needCtx2,
    "d",
    asyncLeaf,
    "e",
  ],
  needCtx2,
  "f",
);
