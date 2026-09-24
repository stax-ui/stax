import { Context, Effect } from "effect";

/**
 * Provide a context value to children elements.
 * Similar to React's Context.Provider pattern.
 *
 * Supports partial context provision - if children require multiple contexts,
 * providing one will satisfy that requirement and leave the rest.
 *
 * Shape-preserving: whatever the caller hands in comes back out with the same
 * success type. Passing a single `Element<HTMLButtonElement>` yields
 * `Element<HTMLButtonElement>` (context removed from R); passing a `Child`
 * (e.g., the result of `collect(...)`) yields a `Child`. A previous version
 * narrowed everything to `Child`, which dropped element-specific types for
 * single-child callers.
 *
 * @param tag - The Effect Context tag
 * @param value - The value to provide
 * @param children - Child effects that require this context (and possibly others)
 * @returns The children with context provided, requiring only remaining contexts
 *
 * @example
 * ```ts
 * // Define a context
 * class ThemeCtx extends Context.Tag("Theme")<ThemeCtx, { color: string }>() {}
 *
 * // Provide it to children
 * $.div(
 *   { class: "app" },
 *   provide(ThemeCtx, { color: "blue" }, collect(
 *     ThemedButton({}),
 *     ThemedText({}, "Hello"),
 *   ))
 * )
 * ```
 *
 * @example
 * ```ts
 * // Nested contexts - children require AccordionCtx | AccordionItemCtx
 * // After providing AccordionItemCtx, they only require AccordionCtx
 * provide(AccordionItemCtx, itemCtx, ThemedButton({}))
 * ```
 */
export const provide = <A, E, R, I, S>(
  tag: Context.Tag<I, S>,
  value: S,
  children: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, I>> =>
  children.pipe(Effect.provideService(tag, value));
