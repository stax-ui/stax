import { Effect } from "effect";

import type { ChildNode } from "./Element/types.js";

/**
 * Combine multiple child effects into a single Child.
 * Use this when an element needs multiple children.
 *
 * Error and context types are properly propagated through the union,
 * so effects with different error/context types combine correctly.
 *
 * @deprecated Element factories are variadic now — pass children directly
 * as trailing arguments instead of wrapping them in `collect(...)`.
 * `$.div({ class: "card" }, child1, child2, child3)` replaces
 * `$.div({ class: "card" }, collect(child1, child2, child3))` — error
 * and context types propagate through the variadic just as they did
 * through `collect`.
 *
 * @example
 * ```ts
 * import { $ } from "@stax-ui/dom"
 *
 * // Before:
 * $.div({}, collect($.of("Hello"), $.span({}, $.of("World"))))
 *
 * // After:
 * $.div({}, "Hello", $.span({}, "World"))
 * ```
 */
export const collect = <
  T extends readonly Effect.Effect<ChildNode, unknown, unknown>[],
>(
  ...elements: T
): Effect.Effect<
  ChildNode[],
  Effect.Effect.Error<T[number]>,
  Effect.Effect.Context<T[number]>
> =>
  Effect.all(elements) as Effect.Effect<
    ChildNode[],
    Effect.Effect.Error<T[number]>,
    Effect.Effect.Context<T[number]>
  >;
