import { Effect } from "effect";

import { logWarn } from "@stax-ui/core";

import * as Element from "../Element/index.js";
import type { AnimationEndResult, AnimationHook } from "./types.js";

const DEFAULT_TIMEOUT = 5000;

/**
 * Check if the user prefers reduced motion
 */
export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Parse space-separated class string into array
 */
export const parseClasses = (classes: string): string[] =>
  classes
    .split(/\s+/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

/**
 * Parse a CSS time-list value (e.g. "0.15s, 0s, 300ms") to the maximum
 * duration in seconds. Returns 0 for an empty/invalid input.
 */
const maxDurationSeconds = (raw: string): number => {
  if (!raw) return 0;
  let max = 0;
  for (const chunk of raw.split(",")) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    // getComputedStyle normalizes ms to seconds, but tolerate either form.
    const num = parseFloat(trimmed);
    if (Number.isNaN(num)) continue;
    const seconds = trimmed.endsWith("ms") ? num / 1000 : num;
    if (seconds > max) max = seconds;
  }
  return max;
};

/**
 * Check whether the CSS animation set on the element will ever fire
 * `animationend`. A live animation with `animation-iteration-count:
 * infinite` never emits it — so the enter/exit lifecycle should treat
 * such an animation as non-blocking (skip immediately).
 *
 * Returns true iff the element has at least one animation with:
 *   - a resolvable name (not "none"),
 *   - a positive duration,
 *   - a finite iteration count.
 *
 * Animation properties can be comma-separated lists that DON'T
 * necessarily align 1:1 with animation-name entries — we take the
 * conservative approach: if ANY iteration count is infinite AND we
 * can't tell them apart by name alignment, treat as non-completing.
 */
const hasCompletingAnimation = (style: CSSStyleDeclaration): boolean => {
  const name = style.animationName;
  if (!name || name === "none") return false;

  if (maxDurationSeconds(style.animationDuration) <= 0) return false;

  // If any iteration count is `infinite`, `animationend` never fires
  // for that animation. For a single-animation element that means we
  // shouldn't wait. For multi-animation, we can't reliably tell if the
  // finite one belongs to a keyframe we care about — bail conservatively.
  const iterations = style.animationIterationCount;
  if (
    iterations &&
    iterations.split(",").some((v) => v.trim() === "infinite")
  ) {
    return false;
  }

  return true;
};

/**
 * Check whether the CSS transition on the element will ever fire
 * `transitionend`. Returns true iff `transition-property` is not `none`
 * and at least one entry in `transition-duration` is > 0.
 */
const hasTransitionThatWillFire = (style: CSSStyleDeclaration): boolean => {
  if (style.transitionProperty === "none") return false;
  return maxDurationSeconds(style.transitionDuration) > 0;
};

/**
 * Check if element has any active CSS animations or transitions
 * that will fire an `animationend` / `transitionend` event. If neither
 * is present, waitForAnimationEvent short-circuits with `endedBy: "skip"`
 * instead of stalling until the timeout — which fixes the 5s FOUC users
 * saw when their intro classes lacked a transition property, or when a
 * living infinite CSS animation (e.g. `animate-pulse`) sat on the
 * element being intro-animated.
 */
const hasActiveAnimations = (element: HTMLElement): boolean => {
  const style = getComputedStyle(element);
  return hasCompletingAnimation(style) || hasTransitionThatWillFire(style);
};

/**
 * Minimal shape of the `Animation` interface we rely on so this file
 * stays usable in environments (older DOM lib targets, jsdom) that
 * don't declare the full API. Field names mirror the Web Animations
 * spec (`Animation.effect`, `Animation.finished`); they are the DOM
 * API we are consuming, not names we chose.
 */
interface AnimationLike {
  readonly effect?: { readonly target?: Node | null } | null;
  readonly finished: Promise<unknown>;
  readonly constructor?: { readonly name?: string };
}

/**
 * Narrow shape of the element's `getAnimations` method used by the fast
 * path. The DOM lib's `Element.getAnimations` returns `Animation[]`
 * (whose `effect` is `AnimationEffect` without `.target`); we work
 * against our own `AnimationLike` so the filter can read what it needs
 * without widening the Web Animations surface. `getAnimationsOf` reads
 * the method off an element through this narrower view in one place so
 * the call site stays free of inline casts.
 */
interface ElementWithGetAnimations {
  readonly getAnimations: (options?: { subtree?: boolean }) => AnimationLike[];
}

const getAnimationsOf = (
  element: HTMLElement,
): ElementWithGetAnimations["getAnimations"] | undefined => {
  const narrowed = element as unknown as Partial<ElementWithGetAnimations>;
  return typeof narrowed.getAnimations === "function"
    ? narrowed.getAnimations.bind(narrowed)
    : undefined;
};

/**
 * Wait for animation or transition to complete on an element.
 *
 * Prefers `element.getAnimations()` when available (every modern
 * browser): it filters to animations/transitions whose effect target
 * is `element` itself (so a descendant's hover transition can't
 * resolve the parent's exit early), and waits on
 * `Promise.allSettled(a.finished)` so the longest-running property
 * decides when the lifecycle ends. If `getAnimations` returns an
 * empty list the wait resolves immediately with `"skip"` — closes
 * the "declared transition that doesn't actually change anything"
 * gap where the event-based path waited out the full timeout.
 *
 * Falls back to the historical event-plus-timeout path for jsdom and
 * other environments without `getAnimations`. That path keeps the
 * same early-skip based on computed style and the same timeout
 * warning. It gains an `event.target === element` guard on the end
 * listeners so a bubbled `transitionend` from a descendant doesn't
 * resolve the wait early.
 */
export const waitForAnimationEvent = (
  element: HTMLElement,
  timeout: number = DEFAULT_TIMEOUT,
): Effect.Effect<AnimationEndResult> =>
  Effect.async<AnimationEndResult>((resume) => {
    // Shared cleanup handle so both the resolve path and Effect
    // cancellation (e.g., a route change unmounting the element mid-
    // animation) tear down the RAF, the listeners, and the timeout.
    let cleanup = (): void => {};
    let resolved = false;

    const rafId = requestAnimationFrame(() => {
      const resolve = (result: AnimationEndResult) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resume(Effect.succeed(result));
      };

      // Fast path — `getAnimations` is the authoritative view of
      // what's actually running on this element.
      const getAnimations = getAnimationsOf(element);
      if (getAnimations) {
        // Default `subtree: false` scopes to this element, but older
        // Firefox builds return descendant animations anyway — filter
        // defensively by effect.target.
        const all = getAnimations();
        const own = all.filter((a) => {
          const target = a.effect?.target;
          return target === undefined || target === null || target === element;
        });

        if (own.length === 0) {
          resolve({ endedBy: "skip" });
          return;
        }

        let settled = false;
        const timeoutId = setTimeout(() => {
          void Effect.runPromise(
            logWarn(
              "animation timeout: running animations did not settle before the configured timeout",
              "stax.animation",
              { timeout },
            ),
          );
          resolve({ endedBy: "timeout" });
        }, timeout);

        cleanup = () => {
          settled = true;
          clearTimeout(timeoutId);
        };

        void Promise.allSettled(own.map((a) => a.finished)).then(() => {
          if (settled) return;
          // Classify as "transition" when the longest matcher was a
          // CSSTransition; otherwise "animation". The DOM exposes the
          // runtime class on the native `constructor.name`.
          const kind = own.some((a) => a.constructor?.name === "CSSTransition")
            ? ("transition" as const)
            : ("animation" as const);
          resolve({ endedBy: kind });
        });
        return;
      }

      // Fallback — no `getAnimations` (jsdom). Keep the computed-style
      // early-skip and the event-plus-timeout path, with a self-target
      // guard on the listeners so a bubbled descendant event can't
      // resolve the parent's wait.
      if (!hasActiveAnimations(element)) {
        resolve({ endedBy: "skip" });
        return;
      }

      const handleAnimationEnd = (e: Event) => {
        if (e.target !== element) return;
        resolve({ endedBy: "animation" });
      };
      const handleTransitionEnd = (e: Event) => {
        if (e.target !== element) return;
        resolve({ endedBy: "transition" });
      };
      const handleTimeout = () => {
        void Effect.runPromise(
          logWarn(
            "animation timeout: transitionend/animationend did not fire — usually a missing transition-* / duration-* pair (Tailwind), or missing ! prefix for specificity",
            "stax.animation",
            { timeout },
          ),
        );
        resolve({ endedBy: "timeout" });
      };

      element.addEventListener("animationend", handleAnimationEnd);
      element.addEventListener("transitionend", handleTransitionEnd);
      const timeoutId = setTimeout(handleTimeout, timeout);

      cleanup = () => {
        element.removeEventListener("animationend", handleAnimationEnd);
        element.removeEventListener("transitionend", handleTransitionEnd);
        clearTimeout(timeoutId);
      };
    });

    // Runs on Effect cancellation. Cancels the pending RAF (in case
    // interruption arrives before it fires) AND tears down anything the
    // RAF might already have set up. `resolved` guards against double-
    // resolving if the interrupt races with a real animationend.
    return Effect.sync(() => {
      cancelAnimationFrame(rafId);
      if (!resolved) {
        resolved = true;
        cleanup();
      }
    });
  });

/**
 * Execute an animation lifecycle hook.
 * The element is passed directly so hooks can use Element combinators.
 */
export const runHook = <E, R>(
  hook: AnimationHook | undefined,
  element: Element.Element<HTMLElement, E, R>,
): Effect.Effect<void, E, R> => {
  if (!hook) return Effect.void as Effect.Effect<void, E, R>;

  // Pass element directly - hooks can pipe Element combinators
  // Cast needed because AnimationHook has simpler type signature
  return Effect.asVoid(
    hook(element as unknown as Effect.Effect<HTMLElement>),
  ) as Effect.Effect<void, E, R>;
};

/**
 * Force a browser reflow to ensure CSS changes take effect before animation starts.
 * Uses tap to access the raw element and trigger layout calculation.
 */
export const forceReflow = <E, R>(
  element: Element.Element<HTMLElement, E, R>,
): Effect.Effect<void, E, R> =>
  Effect.asVoid(
    Element.tap(element, (el: HTMLElement) => {
      // Reading offsetHeight forces the browser to calculate layout
      void el.offsetHeight;
    }),
  ) as Effect.Effect<void, E, R>;

/**
 * Wait for animation or transition to complete on an Element.
 * This is the Element-based version of waitForAnimationEvent.
 */
export const waitForAnimationEnd = <E, R>(
  element: Element.Element<HTMLElement, E, R>,
  timeout: number = DEFAULT_TIMEOUT,
): Effect.Effect<AnimationEndResult, E, R> =>
  Effect.flatMap(element, (el) =>
    waitForAnimationEvent(el, timeout),
  ) as Effect.Effect<AnimationEndResult, E, R>;
