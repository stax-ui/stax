import { Context, Effect, type Scope } from "effect";
import { dual } from "effect/Function";

import type { RendererContext } from "./Renderer.js";

/**
 * A rendered element wrapped in an Effect with scope management.
 * This is the generic version that works with any renderer.
 *
 * @template N - The node type (e.g., HTMLElement for DOM, string for SSR)
 * @template E - The error type (defaults to never for infallible elements)
 * @template R - Additional requirements/context type beyond RendererContext
 *
 * @example
 * ```ts
 * // DOM element (using @stax-ui/dom)
 * const myButton: Element<HTMLButtonElement> = button({ class: "primary" }, $.of("Click me"))
 *
 * // Function that can fail
 * const UserProfile = () =>
 *   Effect.gen(function* () {
 *     const user = yield* fetchUser(userId)
 *     return yield* div({}, $.of(user.name))
 *   })
 *
 * // Function with context requirements
 * const NavLink = () =>
 *   Effect.gen(function* () {
 *     const router = yield* RouterContext
 *     return yield* button({ onClick: () => router.push("/") }, $.of("Home"))
 *   })
 * ```
 */
export type Element<N = unknown, E = never, R = never> = Effect.Effect<
  N,
  E,
  Scope.Scope | RendererContext | R
>;

// -----------------------------------------------------------------------------
// Single-root brand
// -----------------------------------------------------------------------------

declare const SingleRootBrand: unique symbol;

/**
 * Nominal brand attached by a backend to the node type its single-root
 * factories return — e.g. `@stax-ui/dom`'s `$.div`, `$.form`, etc. return
 * `Element<HTMLDivElement & SingleRoot, …>`. A hypothetical native backend's
 * `$.view` would brand the same way; its own multi-root factory would not.
 *
 * Carried on the Element's `A` (success) channel so inference threads it
 * through `yield*` and back out of `Effect.gen` bodies — containers
 * preserve the brand automatically, no special plumbing needed.
 *
 * Platform-agnostic: core doesn't know what "single root" means
 * concretely; it just gates APIs like {@link injectProps} on the marker.
 */
export type SingleRoot = { readonly [SingleRootBrand]: true };

/**
 * Convenience alias for an Element whose node type is branded as
 * single-root. Equivalent to `Element<N & SingleRoot, E, R>`; use it when
 * hand-annotating a root type so you don't have to spell the intersection.
 */
export type SingleRootElement<N = unknown, E = never, R = never> = Element<
  N & SingleRoot,
  E,
  R
>;

/**
 * Context for injecting props into child elements.
 *
 * A parent provides a props record under this Tag, and the next `$`-created
 * element in scope merges those props into its own attributes — the child's
 * explicit props win on conflict. After the merge, the Tag is cleared so
 * further descendants don't re-inherit it.
 *
 * ## Supported use cases
 *
 * Two patterns are first-class and committed to as a stable extension
 * point:
 *
 * 1. **Providing** — a wrapper (e.g. `Form.provide` injecting `onSubmit`,
 *    or a Base-UI-style `asChild` pattern) calls
 *    `Effect.provideService(child, MergePropsCtx, { ... })` so the child
 *    picks the props up transparently.
 * 2. **Reading** — a component (e.g. a `Form` that needs to sequence its
 *    own validation before a parent-provided `onSubmit`) calls
 *    `yield* Effect.serviceOption(MergePropsCtx)` to pull the injected
 *    props out first, strip the entries it wants to handle itself, and
 *    pass the remainder along to its underlying element.
 *
 * Both uses rely on the same guarantees: this Tag, its `Identifier`
 * (`"MergePropsCtx"`), and its Service shape (`Record<string, unknown>`)
 * are part of the public API and will not change without a major bump.
 *
 * @example
 * ```ts
 * // Pattern 1: providing — inject onSubmit into the first child element.
 * Effect.provideService(children, MergePropsCtx, {
 *   onSubmit: (e) => { e.preventDefault(); return handleSubmit(); }
 * })
 * ```
 *
 * @example
 * ```ts
 * // Pattern 2: reading — a Form component sequences validation before
 * // running the onSubmit a parent injected.
 * const Form = container((props, children) =>
 *   Effect.gen(function* () {
 *     const injected = yield* Effect.serviceOption(MergePropsCtx);
 *     const { onSubmit: parentOnSubmit, ...rest } = Option.getOrElse(
 *       Option.map(injected, (m) => m),
 *       () => ({} as Record<string, unknown>),
 *     );
 *     return yield* $.form(
 *       {
 *         ...props,
 *         ...rest,
 *         onSubmit: (e) => {
 *           e.preventDefault();
 *           if (!validate()) return;
 *           if (typeof parentOnSubmit === "function") parentOnSubmit(e);
 *         },
 *       },
 *       children,
 *     );
 *   }),
 * );
 * ```
 */
export class MergePropsCtx extends Context.Tag("MergePropsCtx")<
  MergePropsCtx,
  Record<string, unknown>
>() {}

/**
 * Inject props into `child`'s root element via {@link MergePropsCtx}.
 *
 * The sanctioned entry point for the "provider" half of the
 * `MergePropsCtx` contract — equivalent to
 * `Effect.provideService(child, MergePropsCtx, props)` but constrained
 * so that only an Element whose node type carries the {@link SingleRoot}
 * brand can be targeted. Each backend brands its single-root factory
 * outputs (e.g. `$.div`, `$.form`) and leaves its multi-root factories
 * (e.g. `$.fragment` → `Element<DocumentFragment, …>`) unbranded; a
 * fragment-rooted Element — whether written as `$.fragment(...)` or
 * returned from a container whose body is a fragment — therefore fails
 * the constraint at compile time. Authors who need that shape either
 * wrap the fragment in a container element or route injection to a
 * specific child by reading {@link MergePropsCtx} themselves.
 *
 * Because the brand rides on the Element's `A` channel, inference
 * preserves it through `yield*` and back out of `Effect.gen` bodies —
 * containers whose body yields a single-root element stay single-root
 * with no special handling.
 *
 * At runtime the first `$`-created element inside `child` merges
 * `props` into its own attributes — the child's explicit props win on
 * conflict. After the merge the Tag is cleared so further descendants
 * don't re-inherit it. This matches the Radix / Base-UI `asChild`
 * composition pattern: the component wrapped at the call site becomes
 * the slot, without having to opt in.
 *
 * Direct use of `Effect.provideService(..., MergePropsCtx, ...)` is
 * still possible — the Tag's stability contract carries that over —
 * but loses the type constraint and will runtime-die inside
 * `$.fragment` if the ambient ctx is non-empty. Reach for `injectProps`
 * unless you have a reason not to.
 *
 * @example
 * ```ts
 * // Data-first
 * injectProps($.form(children), { onSubmit: handle });
 *
 * // Pipeable (what Form.provide does internally)
 * children.pipe(injectProps({ onSubmit: handle }));
 * ```
 */
export const injectProps: {
  (
    props: Record<string, unknown>,
  ): <A extends SingleRoot, E, R>(child: Element<A, E, R>) => Element<A, E, R>;
  <A extends SingleRoot, E, R>(
    child: Element<A, E, R>,
    props: Record<string, unknown>,
  ): Element<A, E, R>;
} = dual(
  2,
  <A extends SingleRoot, E, R>(
    child: Element<A, E, R>,
    props: Record<string, unknown>,
  ): Element<A, E, R> =>
    Effect.provideService(child, MergePropsCtx, props) as Element<A, E, R>,
);
