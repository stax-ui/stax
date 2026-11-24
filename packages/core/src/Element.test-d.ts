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

import {
  injectProps,
  MergePropsCtx,
  type Element,
  type SingleRoot,
} from "./Element.js";

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

// -----------------------------------------------------------------------------
// injectProps: single-root constraint
// -----------------------------------------------------------------------------

// Positive: injectProps accepts an Element whose node type carries the
// SingleRoot brand — the shape every `$`-element returns (its factory
// intersects the node with `SingleRoot` on the way out). The result
// preserves the same A/E/R channels (injectProps only changes which
// context the child sees, not its outputs).
declare const htmlFormEl: Element<HTMLFormElement & SingleRoot, never, never>;
declare const svgPathEl: Element<SVGPathElement & SingleRoot, never, never>;

export type _InjectsHTML = Expect<
  Equals<
    ReturnType<typeof injectProps<HTMLFormElement & SingleRoot, never, never>>,
    Element<HTMLFormElement & SingleRoot, never, never>
  >
>;

// Pipeable form composes with the inferred Element shape; R stays what
// the original Element carried (Scope | RendererContext at minimum,
// plus whatever the caller declared).
const _pipeOk: Element<HTMLFormElement & SingleRoot, never, never> =
  htmlFormEl.pipe(injectProps({ onSubmit: (_: SubmitEvent) => undefined }));
const _pipeSvgOk: Element<SVGPathElement & SingleRoot, never, never> =
  svgPathEl.pipe(injectProps({ "aria-label": "home" }));

// Data-first form also accepts both.
const _dataFirstHtmlOk = injectProps(htmlFormEl, { onSubmit: () => undefined });
const _dataFirstSvgOk = injectProps(svgPathEl, { "aria-label": "home" });

// Negative: injectProps rejects an Element whose root is a DocumentFragment
// — `$.fragment(...)` returns one, and so does any container whose inferred
// body is a fragment. The DocumentFragment node type is deliberately
// un-branded, so it fails the `A extends SingleRoot` constraint. This is
// the whole point of the helper: the type-level guard against "providing
// MergePropsCtx to a multi-root Element with no canonical adopter."
declare const fragmentEl: Element<DocumentFragment, never, never>;

// @ts-expect-error — DocumentFragment does not carry the SingleRoot brand.
injectProps(fragmentEl, { onClick: () => undefined });

// @ts-expect-error — same rejection through the pipeable overload.
fragmentEl.pipe(injectProps({ onClick: () => undefined }));

// Negative: a plain unbranded HTMLElement-rooted Element also fails. The
// brand is attached by `$`-factories; a hand-annotated `Element<HTMLDivElement>`
// without `& SingleRoot` doesn't prove single-rootedness, so injectProps
// refuses. Authors who want to hand-annotate reach for `SingleRootElement`.
declare const unbrandedHtmlEl: Element<HTMLDivElement, never, never>;

// @ts-expect-error — HTMLDivElement alone doesn't carry the SingleRoot brand.
injectProps(unbrandedHtmlEl, { onClick: () => undefined });

// Negative: the raw `unknown` default also doesn't satisfy the constraint —
// a caller has to prove the root is a single-rooted thing.
declare const unknownRootEl: Element;

// @ts-expect-error — default `unknown` doesn't carry the SingleRoot brand.
injectProps(unknownRootEl, {});

// Reference the holdover bindings so noUnusedLocals doesn't flag them;
// they exist to assert the positive cases above compile.
export type _Refs =
  | typeof _pipeOk
  | typeof _pipeSvgOk
  | typeof _dataFirstHtmlOk
  | typeof _dataFirstSvgOk;
