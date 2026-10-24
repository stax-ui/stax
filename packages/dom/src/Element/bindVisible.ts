/**
 * `Element.bindVisible` — reactive show/hide for an element that stays
 * mounted. Toggles the `hidden` attribute (and, by default, an inline
 * `display: none !important` style to beat Tailwind's display utilities)
 * and runs enter/exit animations against the same shape of
 * `AnimationOptions` that `when` / `each` / `match` accept.
 *
 * Why not use `when` for this? `when` unmounts the hidden branch, so a
 * popover panel loses its DOM state (scroll position, form values,
 * focus returns), SEO can't index the hidden content, and the browser's
 * find-in-page can't reveal it via `hidden="until-found"`. `bindVisible`
 * is the primitive for cases where the element should stay in the DOM
 * while invisible.
 */

import { Effect, Fiber, Ref, Stream } from "effect";

import { Readable, RendererContext, type Renderer } from "@stax-ui/core";

import { runEnterAnimation, runExitAnimation } from "../Animation/core.js";
import { parseClasses, runHook } from "../Animation/helpers.js";
import type { AnimationOptions } from "../Animation/types.js";
import type { Element } from "./types.js";

/**
 * The value written to the `hidden` attribute when the element is
 * hidden.
 *
 * - `""` — the standard `hidden` attribute (which the UA renders as
 *   `display: none`).
 * - `"until-found"` — the "hidden until found" state. The browser can
 *   reveal the element via find-in-page or fragment navigation and
 *   fires `beforematch` on it before doing so. Pair with a
 *   `beforematch` listener in the consumer that flips `visible` to
 *   `true`; `bindVisible` detects the browser-driven reveal (the
 *   `hidden` attribute is already gone when it processes the change)
 *   and skips the enter animation so the browser's own scroll-to isn't
 *   interrupted.
 */
export type HiddenValue = "" | "until-found";

export interface BindVisibleOptions {
  /**
   * Same shape as `when` / `each` / `match` accept — `enter` / `enterFrom`
   * / `enterTo` / `exit` / `exitTo` plus `onBefore*` / `on*` hooks and
   * `respectReducedMotion`.
   */
  readonly animate?: AnimationOptions;
  /**
   * Value written to the `hidden` attribute while hidden. Defaults to
   * `""` (standard `hidden`). Set to `"until-found"` for find-in-page
   * support.
   */
  readonly hiddenValue?: HiddenValue;
  /**
   * Run the enter animation on first mount when the initial value is
   * `true`. Default `false` — SSR-rendered content that starts visible
   * doesn't re-animate on hydration, matching the `intro` contract on
   * control-flow functions. Set `true` for decorative sequences where
   * the animation *is* the point.
   */
  readonly intro?: boolean;
  /**
   * When `true` (default), `bindVisible` sets an inline
   * `display: none !important` alongside the `hidden` attribute while
   * hidden, and clears it on show. This beats Tailwind's `display:
   * block` / `flex` utilities (which otherwise override the UA's
   * `[hidden] { display: none }` rule and leave the element visible).
   * Set to `false` when you want to control `display` entirely from
   * your own CSS — e.g. `[hidden] { display: none !important }` as a
   * global, or a layout that uses `visibility: hidden` to preserve
   * geometry.
   */
  readonly manageDisplay?: boolean;
}

const DISPLAY_HIDDEN = "none";
const DISPLAY_PRIORITY = "important";

/**
 * Apply the hidden attribute (and optional inline display) directly to
 * the resolved element. Shared between the initial-render path and the
 * post-exit path. Idempotent — safe to call multiple times.
 */
const applyHidden = (
  el: HTMLElement | SVGElement,
  hiddenValue: HiddenValue,
  manageDisplay: boolean,
): void => {
  el.setAttribute("hidden", hiddenValue);
  if (manageDisplay && el instanceof HTMLElement) {
    el.style.setProperty("display", DISPLAY_HIDDEN, DISPLAY_PRIORITY);
  }
};

/**
 * Remove the hidden attribute (and optional inline display). Idempotent.
 */
const applyVisible = (
  el: HTMLElement | SVGElement,
  manageDisplay: boolean,
): void => {
  el.removeAttribute("hidden");
  if (manageDisplay && el instanceof HTMLElement) {
    el.style.removeProperty("display");
  }
};

/**
 * Strip `enterTo` classes before an exit animation runs. `enterTo` is
 * the final-state class the enter animation leaves on the element (the
 * module docs recommend `!` prefix on it for specificity). For
 * `when`/`each`/`match` the element is removed after exit, so leftover
 * `enterTo` doesn't matter. For `bindVisible` the element stays mounted
 * and comes back, so `enterTo` would still be applied during the next
 * exit and fight `exitTo`. Strip it; the next enter re-adds.
 */
const stripEnterTo = (
  el: HTMLElement | SVGElement,
  animate: AnimationOptions | undefined,
): void => {
  const enterTo = animate?.enterTo;
  if (!enterTo) return;
  for (const c of parseClasses(enterTo)) el.classList.remove(c);
};

/**
 * Set up the hidden attribute (and, when `manageDisplay`, the inline
 * display rule) on the initial render path. Split out of the main
 * builder so each branch is one `yield*` or one DOM write — not a stack
 * of nested conditionals.
 *
 * SSR goes through the renderer so the output lands in the attribute
 * string. The client / hydration branch calls `style.setProperty`
 * directly so it can pass `important` (the renderer interface has no
 * priority slot), which is what beats Tailwind's `display: block /
 * flex` utilities.
 */
const applyInitialHidden = (
  el: HTMLElement | SVGElement,
  renderer: Renderer<unknown>,
  hiddenValue: HiddenValue,
  manageDisplay: boolean,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* renderer.setAttribute(el, "hidden", hiddenValue);
    if (!manageDisplay) return;
    if (renderer.environment === "ssr") {
      yield* renderer.setStyleProperty(el, "display", DISPLAY_HIDDEN);
      return;
    }
    if (el instanceof HTMLElement) {
      el.style.setProperty("display", DISPLAY_HIDDEN, DISPLAY_PRIORITY);
    }
  });

/**
 * Reactive show/hide binding. See the file-level docs for the full
 * contract.
 *
 * @example
 * ```ts
 * const open = yield* Signal.make(false);
 * yield* $.div({ class: "panel" }, ...content).pipe(
 *   Element.bindVisible(open, {
 *     animate: {
 *       enterFrom: "opacity-0 transition-opacity duration-150",
 *       enter: "!opacity-100",
 *       exit: "transition-opacity duration-150",
 *       exitTo: "!opacity-0",
 *     },
 *   }),
 * );
 * ```
 */
export const bindVisible =
  (visible: Readable.Readable<boolean>, options: BindVisibleOptions = {}) =>
  <A extends HTMLElement | SVGElement, E, R>(
    self: Element<A, E, R>,
  ): Element<A, E, R> =>
    Effect.gen(function* () {
      const el = yield* self;
      const renderer = yield* RendererContext;
      const hiddenValue: HiddenValue = options.hiddenValue ?? "";
      const manageDisplay = options.manageDisplay ?? true;
      const animate = options.animate;

      const initial = yield* visible.get;

      // Initial render: emit the attribute and style so the markup is
      // correct before hydration (SSR) and the element renders invisibly
      // on mount (client). During hydration the attributes are already
      // there from SSR; re-applying them is a no-op.
      if (!initial) {
        yield* applyInitialHidden(el, renderer, hiddenValue, manageDisplay);
      }

      // Server rendering stops here — no fibers, no animation
      // subscriptions. The subscribe-to-changes path is client-only.
      if (renderer.environment === "ssr") return el as A;

      const current = yield* Ref.make<Fiber.RuntimeFiber<void, unknown> | null>(
        null,
      );

      const show = Effect.gen(function* () {
        // Browser-driven reveal (`hidden='until-found'` + beforematch):
        // if the attribute is already gone, the browser revealed the
        // content and scrolled to it. Don't re-animate — just make sure
        // our inline display:none is cleared and run the `onEnter`
        // hook so consumers get the lifecycle signal.
        const browserRevealed = !el.hasAttribute("hidden");
        applyVisible(el, manageDisplay);
        if (browserRevealed) {
          yield* runHook(animate?.onEnter, Effect.succeed(el as HTMLElement));
          return;
        }
        if (!animate) return;
        yield* runEnterAnimation(Effect.succeed(el as HTMLElement), animate);
      });

      const hide = Effect.gen(function* () {
        // Strip the `enterTo` final-state before starting the exit.
        // Otherwise it stays on through the exit and fights `exitTo`.
        stripEnterTo(el, animate);
        if (animate) {
          yield* runExitAnimation(Effect.succeed(el as HTMLElement), animate);
        }
        applyHidden(el, hiddenValue, manageDisplay);
      });

      const runPhase = (next: boolean) =>
        Effect.gen(function* () {
          const prev = yield* Ref.get(current);
          if (prev) yield* Fiber.interrupt(prev);
          const run = next ? show : hide;
          const fiber = yield* Effect.forkScoped(run);
          yield* Ref.set(current, fiber as Fiber.RuntimeFiber<void, unknown>);
        });

      if (initial && options.intro) {
        yield* runPhase(true);
      }

      // Subscribe to changes. `dedupe` collapses redundant emissions so
      // a Signal that fires with the same value twice doesn't restart
      // the animation.
      yield* Stream.runForEach(Readable.dedupe(visible).changes, runPhase).pipe(
        Effect.forkScoped,
      );

      return el as A;
    }) as Element<A, E, R>;
