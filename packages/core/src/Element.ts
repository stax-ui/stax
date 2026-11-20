import { Context, type Effect, type Scope } from "effect";

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
