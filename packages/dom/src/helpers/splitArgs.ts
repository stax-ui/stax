import { isEffect } from "effect/Effect";

import { Readable } from "@stax-ui/core";

import type { ChildInput } from "../Element/types.js";

/**
 * Runtime duck-type check: is this argument a plain attrs object (as opposed
 * to a {@link ChildInput})? Attrs are plain objects that aren't Effects,
 * Readables, DOM nodes, or arrays. Anything else (string, number, boolean,
 * null, undefined, Effect, Readable, Node, array) is a ChildInput.
 *
 * Used by the `$` factories and {@link splitArgs} to disambiguate
 * `$.tag(attrs, ...children)` from `$.tag(...children)` at runtime —
 * TypeScript overloads pick statically but the runtime needs to decide
 * which slot arg[0] fills.
 *
 * Exported so component authors who want the same `(attrs?, ...children)`
 * / `(attrs?, children[])` call shapes as the `$` factories can reuse the
 * exact same disambiguation rule. Matching this rule is the only way a
 * user component and a `$` factory can read a given call the same way.
 */
export const isAttrsObject = (arg: unknown): arg is object => {
  if (arg == null) return false;
  if (typeof arg !== "object") return false;
  if (Array.isArray(arg)) return false;
  if (isEffect(arg)) return false;
  if (Readable.isReadable(arg)) return false;
  if (typeof Node !== "undefined" && arg instanceof Node) return false;
  return true;
};

/**
 * Split a variadic argument list into `[attrs, children]` at runtime.
 * TypeScript overloads pick statically; this is the runtime counterpart —
 * a duck-type check on `args[0]` (via {@link isAttrsObject}) decides
 * whether it occupies the attrs slot.
 *
 * **Returns `attrs: undefined`, not `{}`,** when no attrs were passed, so
 * a component author can tell "no props" from "empty props" (useful when
 * deciding whether to apply default props). The `$` factories themselves
 * default the `undefined` through at their own call site.
 *
 * Exported so component authors can split their own variadic arg lists the
 * same way the `$` factories do, without reproducing the rule. If stax
 * later adds a new kind of child (another runtime shape that passes
 * through `ChildInput`), every component using `splitArgs` picks it up.
 */
export const splitArgs = <A>(
  args: ReadonlyArray<unknown>,
): {
  readonly attrs: A | undefined;
  readonly children: ReadonlyArray<ChildInput<unknown, unknown>>;
} => {
  if (args.length > 0 && isAttrsObject(args[0])) {
    return {
      attrs: args[0] as A,
      children: args.slice(1) as ReadonlyArray<ChildInput<unknown, unknown>>,
    };
  }
  return {
    attrs: undefined,
    children: args as ReadonlyArray<ChildInput<unknown, unknown>>,
  };
};
