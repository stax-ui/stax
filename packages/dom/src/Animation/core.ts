import { Effect } from "effect";

import { logDebug } from "@stax-ui/core";

import * as Element from "../Element/index.js";
import {
  parseClasses,
  prefersReducedMotion,
  runHook,
  waitForAnimationEvent,
} from "./helpers.js";
import type { AnimationHook, AnimationOptions } from "./types.js";

const DEFAULT_TIMEOUT = 5000;

/**
 * Internal configuration for running an animation.
 */
interface AnimationConfig {
  /** Which lifecycle this is — surfaced in debug logs so callers can trace enter vs exit */
  readonly kind: "enter" | "exit";
  /** Classes to check - if all are missing, skip animation */
  readonly triggerClasses: readonly (string | undefined)[];
  /** Class to apply even when skipping (for final state) */
  readonly skipFinalClass?: string;
  /** Classes to add before reflow */
  readonly addBeforeReflow: readonly (string | undefined)[];
  /** Classes to remove after reflow (triggers CSS transitions) */
  readonly removeAfterReflow: readonly (string | undefined)[];
  /** Classes to add after reflow */
  readonly addAfterReflow: readonly (string | undefined)[];
  /** Classes to remove after animation completes (cleanup) */
  readonly removeAfterAnimation: readonly (string | undefined)[];
  /** Timeout in milliseconds */
  readonly timeout: number;
  /** Hook to run before animation */
  readonly onBefore?: AnimationHook;
  /** Hook to run after animation */
  readonly onAfter?: AnimationHook;
  /** Whether to respect reduced motion preference */
  readonly respectReducedMotion: boolean;
}

/**
 * Core animation runner that handles the common animation lifecycle.
 *
 * **Interrupt behavior.** The run tracks every class it adds or removes
 * in a `touched` set. On interrupt (e.g. a rapid `when` flip reverses a
 * mid-flight exit), we remove each `touched` class in a finalizer so
 * the element starts the next run from a clean slate — no leftover
 * `enterFrom`, `exit`, or `exitTo` fighting the reverse animation.
 * On normal completion the finalizer never fires, so the final-state
 * classes (`enterTo` for enter) stay on the element.
 */
const runAnimation = <E, R>(
  element: Element.Element<HTMLElement, E, R>,
  config: AnimationConfig,
): Effect.Effect<void, E, R> =>
  Effect.gen(function* () {
    const {
      kind,
      triggerClasses,
      skipFinalClass,
      addBeforeReflow,
      removeAfterReflow,
      addAfterReflow,
      removeAfterAnimation,
      timeout,
      onBefore,
      onAfter,
      respectReducedMotion,
    } = config;

    const shouldSkip =
      (respectReducedMotion && prefersReducedMotion()) ||
      triggerClasses.every((c) => !c);

    if (shouldSkip) {
      yield* logDebug(`${kind} animation: skipped`, "stax.animation", {
        reason:
          respectReducedMotion && prefersReducedMotion()
            ? "reduced-motion"
            : "no-trigger-classes",
      });
      yield* runHook(onBefore, element);
      if (skipFinalClass) {
        yield* Element.addClass(element, ...parseClasses(skipFinalClass));
      }
      yield* runHook(onAfter, element);
      return;
    }

    // Resolve the raw element once. Everything below writes to it via
    // `classList` directly so the interrupt finalizer can remove exactly
    // the classes we added without going through the Element pipe —
    // `touched` is scoped to this run and dies with it on completion.
    const el = yield* element;
    const touched = new Set<string>();

    // Flatten groups to a single de-duplicated class list once per
    // phase, so each add/remove is a single variadic classList call
    // instead of nested per-group iteration.
    const addBeforeReflowClasses = flattenGroups(addBeforeReflow);
    const removeAfterReflowClasses = flattenGroups(removeAfterReflow);
    const addAfterReflowClasses = flattenGroups(addAfterReflow);
    const removeAfterAnimationClasses = flattenGroups(removeAfterAnimation);

    const addClasses = (classes: readonly string[]) => {
      if (classes.length === 0) return;
      for (const c of classes) touched.add(c);
      el.classList.add(...classes);
    };
    const removeClasses = (classes: readonly string[]) => {
      if (classes.length === 0) return;
      for (const c of classes) touched.add(c);
      el.classList.remove(...classes);
    };

    yield* logDebug(`${kind} animation: begin`, "stax.animation", {
      addBeforeReflow: addBeforeReflowClasses,
      addAfterReflow: addAfterReflowClasses,
    });

    const body = Effect.gen(function* () {
      yield* runHook(onBefore, element);

      addClasses(addBeforeReflowClasses);
      void el.offsetHeight; // force reflow

      removeClasses(removeAfterReflowClasses);
      addClasses(addAfterReflowClasses);

      const outcome = yield* waitForAnimationEvent(el, timeout);

      removeClasses(removeAfterAnimationClasses);

      yield* runHook(onAfter, element);

      yield* logDebug(`${kind} animation: end`, "stax.animation", {
        endedBy: outcome.endedBy,
      });
    });

    let completed = false;
    yield* body.pipe(
      Effect.tap(() => Effect.sync(() => (completed = true))),
      Effect.ensuring(
        Effect.sync(() => {
          if (completed || touched.size === 0) return;
          // Interrupt mid-run: strip every class the run put on the
          // element so a subsequent run (e.g. a reverse exit after an
          // enter was interrupted) doesn't inherit stale state. Removing
          // a class that was never added is a no-op, so this is safe
          // even when the interrupt fires early.
          el.classList.remove(...touched);
        }),
      ),
    );
  }) as Effect.Effect<void, E, R>;

/**
 * Collapse a list of space-separated class groups (any of which may be
 * `undefined`) into a flat array of individual classes. Removes the
 * group→class→class nested-iteration pattern at every call site.
 */
const flattenGroups = (groups: readonly (string | undefined)[]): string[] => {
  const out: string[] = [];
  for (const g of groups) {
    if (!g) continue;
    for (const c of parseClasses(g)) out.push(c);
  }
  return out;
};

/**
 * Run an enter animation on an element.
 *
 * Sequence:
 * 1. Call onBeforeEnter hook
 * 2. Add enterFrom classes (if provided)
 * 3. Add enter classes
 * 4. Force reflow
 * 5. Remove enterFrom classes (triggers transition)
 * 6. Add enterTo classes
 * 7. Wait for animation/transition to complete
 * 8. Remove enter classes
 * 9. Call onEnter hook
 */
export const runEnterAnimation = <E, R>(
  element: Element.Element<HTMLElement, E, R>,
  options: AnimationOptions,
): Effect.Effect<void, E, R> => {
  const {
    enter,
    enterFrom,
    enterTo,
    timeout = DEFAULT_TIMEOUT,
    respectReducedMotion = true,
    onBeforeEnter,
    onEnter,
  } = options;

  return runAnimation(element, {
    kind: "enter",
    triggerClasses: [enter, enterFrom],
    skipFinalClass: enterTo,
    addBeforeReflow: [enterFrom, enter],
    removeAfterReflow: [enterFrom],
    addAfterReflow: [enterTo],
    removeAfterAnimation: [enter],
    timeout,
    onBefore: onBeforeEnter,
    onAfter: onEnter,
    respectReducedMotion,
  });
};

/**
 * Run an exit animation on an element.
 *
 * Sequence:
 * 1. Call onBeforeExit hook
 * 2. Add exit classes (starting state + transition)
 * 3. Force reflow
 * 4. Add exitTo classes (triggers transition to target state)
 * 5. Wait for animation/transition to complete
 * 6. Remove exit classes
 * 7. Call onExit hook
 *
 * Note: Element is NOT removed from DOM by this function.
 * The caller is responsible for DOM removal after this completes.
 */
export const runExitAnimation = <E, R>(
  element: Element.Element<HTMLElement, E, R>,
  options: AnimationOptions,
): Effect.Effect<void, E, R> => {
  const {
    exit,
    exitTo,
    timeout = DEFAULT_TIMEOUT,
    respectReducedMotion = true,
    onBeforeExit,
    onExit,
  } = options;

  return runAnimation(element, {
    kind: "exit",
    triggerClasses: [exit, exitTo],
    skipFinalClass: undefined,
    addBeforeReflow: [exit],
    removeAfterReflow: [],
    addAfterReflow: [exitTo],
    removeAfterAnimation: [exit, exitTo],
    timeout,
    onBefore: onBeforeExit,
    onAfter: onExit,
    respectReducedMotion,
  });
};
