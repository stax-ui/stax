/**
 * Type-level invariants for {@link MergePropsCtx}.
 *
 * Both providing into and reading out of this Tag are committed to as a
 * stable extension point (see the Tag's JSDoc for the two canonical
 * patterns). The three invariants pinned here are the ones that would
 * silently break downstream primitives — libraries whose Form reads the
 * injected `onSubmit` to sequence it with validation, or whose Base-UI-
 * style parts inject props into an `asChild` wrapper — if a future
 * refactor renamed the Tag, loosened its Service shape, or changed its
 * nominal identity.
 *
 * Runs under `tsc --noEmit`; no behavioural side.
 */

import { Context } from "effect";

import { MergePropsCtx } from "./Element.js";

// -----------------------------------------------------------------------------
// Assertion helpers
// -----------------------------------------------------------------------------

type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

type Expect<T extends true> = T;

// -----------------------------------------------------------------------------
// Invariants
// -----------------------------------------------------------------------------

// Service shape is exactly `Record<string, unknown>`. A loosening to
// `unknown` would silently defeat spreading into attrs; a tightening to
// a named struct would reject the `{ onSubmit, ... }` and `asChild` cases.
export type _Service = Expect<
  Equals<Context.Tag.Service<MergePropsCtx>, Record<string, unknown>>
>;

// Identifier resolves to the class itself — the nominal brand downstream
// code uses to ask Effect for this specific service. A silent re-tagging
// (same key, different brand) would break `yield* MergePropsCtx` reads
// while leaving source-text diffs looking harmless.
export type _Identifier = Expect<
  Equals<Context.Tag.Identifier<MergePropsCtx>, MergePropsCtx>
>;

// The string key stays `"MergePropsCtx"`. This is what `Context.Tag` uses
// for structural identity across realms and for debug output; a quiet
// rename (e.g. to `"@stax-ui/core/MergePropsCtx"`) would break any
// provider/reader pair whose two sides came from different package
// versions but reached an equal nominal `MergePropsCtx` class.
export type _StringKey = Expect<
  Equals<typeof MergePropsCtx.key, "MergePropsCtx">
>;
