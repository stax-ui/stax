/**
 * DX survey — every way a component author might handle children,
 * with the inferred type for each pattern.
 *
 * Compile-only. Not executed.
 */

import { Context } from "effect";

import { $, type Element } from "../index.js";
import type { Children, PermissiveChildren } from "./types.js";

// Shared fixtures — two services + two errors so we can see E/R unions.
class ApiClient extends Context.Tag("ApiClient")<
  ApiClient,
  { readonly get: (id: string) => void }
>() {}
class DbClient extends Context.Tag("DbClient")<
  DbClient,
  { readonly query: (sql: string) => void }
>() {}
class HttpError {
  readonly _tag = "HttpError";
}
class DbError {
  readonly _tag = "DbError";
}

declare const apiChild: Element.Element<HTMLSpanElement, HttpError, ApiClient>;
declare const dbChild: Element.Element<HTMLParagraphElement, DbError, DbClient>;

// ============================================================================
// PATTERN A — Single fixed child
// ============================================================================
// Simplest possible wrapper. E and R flow through cleanly.

const Card = <E = never, R = never>(
  props: { title: string },
  body: Element.Element<HTMLElement | SVGElement, E, R>,
): Element.Element<HTMLDivElement, E, R> =>
  $.div({ class: "card" }, $.h2(props.title), body);

// Type at the call site is exactly Element<HTMLDivElement, HttpError, ApiClient>.
const _cardOut = Card({ title: "User" }, apiChild);
const _cardProof: Element.Element<HTMLDivElement, HttpError, ApiClient> =
  _cardOut;
void _cardProof;

// ============================================================================
// PATTERN B — Variadic children only (no props)
// ============================================================================
// Use ChildInput<E, R> to accept anything valid — strings, nullish,
// Elements, arrays. Single-generic <E, R> so component authors don't need
// to know about ChildInputE / ChildInputR.

const CardList = <E = never, R = never>(
  ...items: PermissiveChildren<E, R>
): Element.Element<HTMLUListElement, E, R> =>
  $.ul({ class: "card-list" }, items);

// Homogeneous children: E and R pass through untouched.
const _clOut1 = CardList(apiChild, apiChild, "static");
const _clProof1: Element.Element<HTMLUListElement, HttpError, ApiClient> =
  _clOut1;
void _clProof1;

// ============================================================================
// PATTERN C — Props + variadic children, PURE PASS-THROUGH
// ============================================================================
// The Link / CardList shape: props for config, variadic ChildInput for
// arbitrary content, no wrapper-authored siblings mixed in.

const Panel = <E = never, R = never>(
  props: { class?: string },
  ...children: PermissiveChildren<E, R>
): Element.Element<HTMLDivElement, E, R> =>
  $.div({ class: props.class ?? "panel" }, children);

const _panelOut = Panel({ class: "hero" }, apiChild, "interleaved text", null);
const _panelProof: Element.Element<HTMLDivElement, HttpError, ApiClient> =
  _panelOut;
void _panelProof;

// ============================================================================
// PATTERN C-alt — Wrapper interleaves its own children with forwarded ones
// ============================================================================
// Use `Children<E, R>` when the wrapper wants to mix wrapper-authored
// children with forwarded ones in one primitive call. Callers spread arrays
// (`Section(props, ...myArray)`) — they can't pass a single-array arg.
//
// The two aliases side by side:
//
//   Children<E, R>            — leaves only. Interleaving-friendly.
//   PermissiveChildren<E, R>  — leaves OR one array-as-single-arg. Passthrough
//                               only; cannot be interleaved with wrapper-owned
//                               siblings in one primitive call.

const Section = <E = never, R = never>(
  props: { heading: string; class?: string },
  ...children: Children<E, R>
): Element.Element<HTMLElement, E, R> =>
  $.section(
    { class: props.class ?? "section" },
    $.h2({ class: "section-heading" }, props.heading),
    children,
  );

const _sectionOut = Section({ heading: "Users" }, apiChild, "list body", null);
const _sectionProof: Element.Element<HTMLElement, HttpError, ApiClient> =
  _sectionOut;
void _sectionProof;

// ============================================================================
// PATTERN D — Multiple named slots, each with independent E/R
// ============================================================================
// When slots are semantically distinct (header vs body vs footer) and
// callers may pass children with very different service dependencies to
// each slot, give each slot its own generic pair. E and R union at the
// return site.

const Layout = <
  ENav = never,
  RNav = never,
  EMain = never,
  RMain = never,
  EFoot = never,
  RFoot = never,
>(props: {
  nav: Element.Element<HTMLElement | SVGElement, ENav, RNav>;
  main: Element.Element<HTMLElement | SVGElement, EMain, RMain>;
  footer?: Element.Element<HTMLElement | SVGElement, EFoot, RFoot>;
}): Element.Element<
  HTMLDivElement,
  ENav | EMain | EFoot,
  RNav | RMain | RFoot
> =>
  $.div(
    { class: "layout" },
    $.nav(props.nav),
    $.main(props.main),
    props.footer && $.footer(props.footer),
  );

// Distinct services on nav (ApiClient) and main (DbClient) — both flow.
const _layoutOut = Layout({ nav: apiChild, main: dbChild });
const _layoutProof: Element.Element<
  HTMLDivElement,
  HttpError | DbError,
  ApiClient | DbClient
> = _layoutOut;
void _layoutProof;

// ============================================================================
// PATTERN E — Direct primitive call (no wrapper — full inference)
// ============================================================================
// This is the ONLY shape that gets per-slot E/R union out of the box.

const _directOut = $.div(
  { class: "card" },
  apiChild,
  dbChild,
  "static text",
  null,
);
const _directProof: Element.Element<
  HTMLDivElement,
  HttpError | DbError,
  ApiClient | DbClient
> = _directOut;
void _directProof;

// ============================================================================
// PATTERN F — Component that transforms each child
// ============================================================================
// If the wrapper does something to each child (e.g. wraps in <li>), it
// needs children to be Effects specifically — the ChildInput arms like
// `string` / `null` / `boolean` don't compose with `.map(child => …)`
// without runtime handling.

const BulletList = <E = never, R = never>(
  items: ReadonlyArray<Element.Element<HTMLElement | SVGElement, E, R>>,
): Element.Element<HTMLUListElement, E, R> =>
  $.ul(
    { class: "bullet-list" },
    items.map((item) => $.li({ class: "bullet-item" }, item)),
  );

const _blOut = BulletList([apiChild, apiChild]);
const _blProof: Element.Element<HTMLUListElement, HttpError, ApiClient> =
  _blOut;
void _blProof;

// ============================================================================
// PATTERN G — Heterogeneous children through a variadic wrapper (LIMITATION)
// ============================================================================
// A single-generic wrapper (`<E = never, R = never>`) types-check only when
// its callers pass children that share compatible E and R. Passing children
// with *distinct* errors fails outright, because TS locks E to the first
// child:
//
//   CardList(apiChild, dbChild)
//   //         ^-- E locked to HttpError
//   //                   ^-- dbChild's DbError isn't assignable, TS errors.
//
// This is different from the direct-primitive call (Pattern E), where the
// variadic-tuple overload correctly unions E and R across siblings.
//
// Workaround options, in order of ergonomic cost:
//
//   1. Inline the primitive call at that site. This is what the framework
//      recommends for anywhere a component's children genuinely span
//      unrelated service dependencies — usually a rare, top-level case.
//
//   2. Split the wrapper into two calls (one per child) and compose them
//      with `.pipe(...)` or an outer `$.div` — each call preserves its
//      own E/R.
//
//   3. Change the wrapper to accept a `ReadonlyArray<Element<..., E, R>>`
//      slot that's pre-collected by the caller. The caller manages the
//      union at the callsite; the wrapper stays single-generic.
//
// There is no "just cast" that recovers the union soundly — the R channel
// is contravariant, so any type-only widening lies about what the runtime
// will actually resolve.

// Concrete demonstration of Option 1 — inline the primitive for the mixed
// case, keep the wrapper for homogeneous ones.
const _inlineMixed = $.ul({ class: "card-list" }, apiChild, dbChild);
const _inlineProof: Element.Element<
  HTMLUListElement,
  HttpError | DbError,
  ApiClient | DbClient
> = _inlineMixed;
void _inlineProof;
