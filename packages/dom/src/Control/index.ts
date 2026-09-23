/**
 * DOM-specific control flow components with SSR, hydration, and animation support.
 *
 * These functions wrap the core control flow functions and provide animation
 * configuration via AnimationConfigCtx. The appropriate ControlCtx Layer
 * (ClientControlCtx, SSRControlCtx, HydrationControlCtx) should be provided
 * at the rendering entry point (mount, hydrate, renderToString).
 */

import { Effect, Either, Option, pipe } from "effect";

import {
  ControlCtx,
  each as coreEach,
  match as coreMatch,
  matchEither as coreMatchEither,
  matchOption as coreMatchOption,
  redraw as coreRedraw,
  when as coreWhen,
  Readable,
} from "@stax-ui/core";

import * as Element from "../Element/index.js";
import { AnimationConfigCtx } from "./AnimationConfigCtx.js";
import type {
  AnimatedConfig,
  EachConfig,
  MatchConfig,
  MatchEitherConfig,
  MatchOptionConfig,
  RedrawConfig,
  WhenConfig,
} from "./types.js";

// Re-export types
export type {
  AnimatedConfig,
  WhenConfig,
  MatchConfig,
  MatchCase,
  EachConfig,
  MatchOptionConfig,
  MatchEitherConfig,
  RedrawConfig,
} from "./types.js";

// Re-export errors
export { HydrationMismatchError } from "./errors.js";

// Re-export ControlCtx layers and AnimationConfigCtx
export { ClientControlCtx } from "./ClientControlCtx.js";
export { SSRControlCtx } from "./SSRControlCtx.js";
export {
  HydrationControlCtx,
  HydrationRootCtx,
} from "./HydrationControlCtx.js";
export {
  AnimationConfigCtx,
  type AnimationConfig,
} from "./AnimationConfigCtx.js";

type DOMElement = HTMLElement | SVGElement;

/**
 * Conditionally render one of two elements based on a reactive boolean.
 *
 * @example
 * ```ts
 * when(isLoggedIn, {
 *   onTrue: () => $.div("Welcome back!"),
 *   onFalse: () => $.div("Please log in")
 * })
 * ```
 *
 * @example
 * ```ts
 * // With animations
 * when(isVisible, {
 *   onTrue: () => Modal(),
 *   onFalse: () => $.div(),
 *   animate: { enter: "fade-in", exit: "fade-out" }
 * })
 * ```
 */
export const when = <
  E1 = never,
  R1 = never,
  E2 = never,
  R2 = never,
  N extends DOMElement = DOMElement,
>(
  condition: Readable.Readable<boolean>,
  config: WhenConfig<E1, R1, E2, R2, N>,
): Element.Element<N, E1 | E2, R1 | R2 | ControlCtx> =>
  pipe(
    coreWhen(condition, {
      onTrue: config.onTrue,
      onFalse: config.onFalse,
      container: config.container,
    }),
    config.animate || config.intro
      ? Effect.provideService(AnimationConfigCtx, {
          single: config.animate,
          intro: config.intro,
        })
      : (x) => x,
  ) as Element.Element<N, E1 | E2, R1 | R2 | ControlCtx>;

/**
 * Pattern match on a reactive value and render the corresponding element.
 *
 * @example
 * ```ts
 * match(status, {
 *   cases: [
 *     { pattern: "loading", render: () => $.div("Loading...") },
 *     { pattern: "success", render: () => $.div("Done!") },
 *     { pattern: "error", render: () => $.div("Failed") },
 *   ]
 * })
 * ```
 *
 * @example
 * ```ts
 * // With fallback and animations
 * match(status, {
 *   cases: [
 *     { pattern: "loading", render: () => Spinner() },
 *   ],
 *   fallback: () => $.div("Unknown"),
 *   animate: { enter: "fade-in", exit: "fade-out" }
 * })
 * ```
 */
export const match = <
  A,
  E = never,
  R = never,
  E2 = never,
  R2 = never,
  N extends DOMElement = DOMElement,
>(
  value: Readable.Readable<A>,
  config: MatchConfig<A, E, R, E2, R2, N>,
): Element.Element<N, E | E2, R | R2 | ControlCtx> =>
  pipe(
    coreMatch(value, {
      cases: config.cases,
      fallback: config.fallback,
      container: config.container,
    }),
    config.animate || config.intro
      ? Effect.provideService(AnimationConfigCtx, {
          single: config.animate,
          intro: config.intro,
        })
      : (x) => x,
  ) as Element.Element<N, E | E2, R | R2 | ControlCtx>;

/**
 * Render a list of items with efficient updates using keys.
 *
 * @example
 * ```ts
 * each(todos, {
 *   container: () => $.ul({ class: "todo-list" }),
 *   key: (todo) => todo.id,
 *   render: (todo, index) => $.li(todo.map(t => t.text))
 * })
 * ```
 *
 * @example
 * ```ts
 * // With staggered animations
 * each(items, {
 *   key: (item) => item.id,
 *   render: (item) => ListItem(item),
 *   animate: { enter: "slide-in", exit: "slide-out", stagger: 50 }
 * })
 * ```
 */
export const each = <
  A,
  E = never,
  R = never,
  N extends DOMElement = DOMElement,
>(
  items: Readable.Readable<readonly A[]>,
  config: EachConfig<A, E, R, N>,
): Element.Element<N, E, R | ControlCtx> =>
  pipe(
    coreEach(items, {
      key: config.key,
      render: config.render,
      container: config.container,
    }),
    config.animate || config.intro
      ? Effect.provideService(AnimationConfigCtx, {
          list: config.animate,
          intro: config.intro,
        })
      : (x) => x,
  ) as Element.Element<N, E, R | ControlCtx>;

/**
 * Match on an Option and render different elements for Some/None cases.
 *
 * @example
 * ```ts
 * matchOption(userData.value, {
 *   onSome: (user) => $.div(user.map(u => u.name)),
 *   onNone: () => $.div("No user loaded"),
 * })
 * ```
 *
 * @example
 * ```ts
 * // With animations
 * matchOption(selectedItem, {
 *   onSome: (item) => ItemDetails({ item }),
 *   onNone: () => $.div("Select an item"),
 *   animate: { enter: "fade-in", exit: "fade-out" },
 * })
 * ```
 */
export const matchOption = <
  A,
  E1 = never,
  R1 = never,
  E2 = never,
  R2 = never,
  N extends DOMElement = DOMElement,
>(
  option: Readable.Readable<Option.Option<A>>,
  config: MatchOptionConfig<A, E1, R1, E2, R2, N>,
): Element.Element<N, E1 | E2, R1 | R2 | ControlCtx> =>
  pipe(
    coreMatchOption(option, {
      onSome: config.onSome,
      onNone: config.onNone,
      container: config.container,
    }),
    config.animate || config.intro
      ? Effect.provideService(AnimationConfigCtx, {
          single: config.animate,
          intro: config.intro,
        })
      : (x) => x,
  ) as Element.Element<N, E1 | E2, R1 | R2 | ControlCtx>;

/**
 * Match on an Either and render different elements for Right/Left cases.
 *
 * @example
 * ```ts
 * matchEither(result, {
 *   onRight: (validated) => $.div(validated.map(v => v.formatted)),
 *   onLeft: (error) => $.span({ class: "error" }, error.map(e => e.message)),
 * })
 * ```
 */
export const matchEither = <
  A,
  E,
  E1 = never,
  R1 = never,
  E2 = never,
  R2 = never,
  N extends DOMElement = DOMElement,
>(
  either: Readable.Readable<Either.Either<A, E>>,
  config: MatchEitherConfig<A, E, E1, R1, E2, R2, N>,
): Element.Element<N, E1 | E2, R1 | R2 | ControlCtx> =>
  pipe(
    coreMatchEither(either, {
      onRight: config.onRight,
      onLeft: config.onLeft,
      container: config.container,
    }),
    config.animate || config.intro
      ? Effect.provideService(AnimationConfigCtx, {
          single: config.animate,
          intro: config.intro,
        })
      : (x) => x,
  ) as Element.Element<N, E1 | E2, R1 | R2 | ControlCtx>;

/**
 * Re-render a component whenever any of the provided Readables change.
 *
 * Unlike other control functions that switch between states, `redraw` always
 * renders one element that gets completely recreated on each change. This is
 * useful when you need to rebuild a component tree based on reactive values,
 * rather than just updating individual properties.
 *
 * @example
 * ```ts
 * redraw([markdown, citations], {
 *   render: ([md, cites]) => MarkdownRenderer({ markdown: md, citations: cites }),
 *   container: () => $.div({ class: "markdown-container" }),
 * })
 * ```
 */
export const redraw = <
  T extends Readable.Readable<unknown>,
  N extends DOMElement = DOMElement,
>(
  readables: T,
  config: RedrawConfig<T, N>,
): Element.Element<N, never, ControlCtx> =>
  pipe(
    coreRedraw(readables, {
      render: config.render,
      container: config.container,
    }),
    config.animate || config.intro
      ? Effect.provideService(AnimationConfigCtx, {
          single: config.animate,
          intro: config.intro,
        })
      : (x) => x,
  ) as Element.Element<N, never, ControlCtx>;

/**
 * Mount-once wrapper for a single element with animation support.
 *
 * Renders `render()` inside a container and applies enter animations on
 * mount (or on hydration when `intro: true` is set). Unlike `each` /
 * `when` / `match`, `animated` doesn't reconcile against a signal — the
 * element is inserted exactly once and stays. Exit-related animation
 * fields are unavailable by construction (see {@link EnterOnlyAnimationOptions}).
 *
 * Use it to wrap sibling elements in a hand-authored intro sequence:
 *
 * @example Sequenced headline with mixed animation styles
 * ```ts
 * const App = () =>
 *   Effect.gen(function* () {
 *     const [g0, g1, g2] = yield* Animation.sequence(3);
 *     return $.h1(
 *       {},
 *       animated(
 *         {
 *           animate: {
 *             enterFrom: "opacity-0",
 *             enter: "opacity-100 transition duration-300",
 *             group: g0,
 *           },
 *           intro: true,
 *         },
 *         () => $.span({}, "Hello,"),
 *       ),
 *       animated(
 *         // No visual animation — the span has its own CSS keyframes; the
 *         // group still gates when it appears in the sequence.
 *         { animate: { group: g1 } },
 *         () => $.span({ class: "wobble" }, "world!"),
 *       ),
 *       animated(
 *         {
 *           animate: {
 *             enterFrom: "opacity-0",
 *             enter: "opacity-100 transition duration-500",
 *             group: g2,
 *           },
 *           intro: true,
 *         },
 *         () => $.span({}, "Welcome."),
 *       ),
 *     );
 *   });
 * ```
 */
export const animated = <
  E = never,
  R = never,
  N extends DOMElement = DOMElement,
>(
  config: AnimatedConfig<N>,
  render: () => Element.Element<DOMElement, E, R>,
): Element.Element<N, E, R | ControlCtx> =>
  pipe(
    Effect.gen(function* () {
      const parentCtx = yield* ControlCtx;
      const ctx = yield* parentCtx.fork();
      const container = yield* ctx.getContainer(config.container);
      yield* ctx.addSlot("_", () => render(), {
        atIndex: 0,
        initialIndex: 0,
        totalItems: 1,
      });
      yield* ctx.finalizeContainer();
      return container;
    }) as Element.Element<N, E, R | ControlCtx>,
    config.animate || config.intro
      ? Effect.provideService(AnimationConfigCtx, {
          single: config.animate,
          intro: config.intro,
        })
      : (x) => x,
  ) as Element.Element<N, E, R | ControlCtx>;
