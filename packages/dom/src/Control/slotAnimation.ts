/**
 * Shared animation-fork helpers used by every ControlCtx implementation
 * (Client, HydrationClient-like, Hydration-root).
 *
 * The reconcile loop invokes addSlot/removeSlot sequentially. If enter/exit
 * animations were awaited inline, every slot's animation would block the
 * next slot's turn — so we fork them:
 *
 * - Enter animations fork into the slot's own scope; closing the slot's
 *   scope (e.g. via removeSlot) interrupts an in-flight enter.
 * - Exit animations fork into the *parent* scope so removeSlot returns
 *   right away and the exit continues even if a fresh slot re-uses the
 *   same key immediately.
 *
 * AnimationConfigCtx is read lazily inside the forked fiber so nested
 * control flow sees the config its parent provided (rather than whatever
 * was in scope at Layer construction).
 */

import { Clock, Effect, Exit, Option, Scope } from "effect";

import {
  _awaitGate,
  _complete,
  _register,
  type AnimationGroup,
} from "../Animation/groups.js";
import { prefersReducedMotion } from "../Animation/helpers.js";
import {
  runEnterAnimation,
  runExitAnimation,
  type AnimationGroupRef,
  type ListAnimationOptions,
  type MoveAnimation,
  type MoveDelta,
  type StaggerFunction,
} from "../Animation/index.js";
import { AnimationConfigCtx } from "./AnimationConfigCtx.js";

type DOMElement = HTMLElement | SVGElement;

type AnimateWithGroup<T> = T & { group?: AnimationGroup };

const staggerDelayMs = (
  stagger: ListAnimationOptions["stagger"] | undefined,
  index: number,
  total: number,
): number => {
  if (stagger === undefined) return 0;
  if (typeof stagger === "number") return index * stagger;
  return (stagger as StaggerFunction)(index, total);
};

interface ResolvedAnimation<T> {
  readonly animate: AnimateWithGroup<T>;
  readonly intro: boolean;
}

const readAnimation = <T>(): Effect.Effect<ResolvedAnimation<T> | undefined> =>
  Effect.gen(function* () {
    const configOpt = yield* Effect.serviceOption(AnimationConfigCtx);
    const config = Option.getOrUndefined(configOpt);
    if (!config) return undefined;
    const animate = (config.list ?? config.single) as
      AnimateWithGroup<T> | undefined;
    if (!animate) return undefined;
    return { animate, intro: config.intro === true };
  });

/**
 * Apply the configured `enterFrom` classes to an element *before* it is
 * inserted into the DOM. Without this, on client-mode mounts (fresh
 * addSlot outside the hydration path) the browser paints the element in
 * its final state before `forkSlotEnter`'s forked fiber gets a chance to
 * apply `enterFrom` — producing a one-frame flash of the resolved state
 * followed by the animation playing "backwards" from the end.
 *
 * SSR already emits `enterFrom` classes in the HTML for `intro: true`
 * controls, so hydration paths don't need this. This is the client-only
 * equivalent: same guarantee, applied synchronously in JS instead of in
 * the SSG output.
 *
 * Only touches `enterFrom` — the transition setup and target state stay
 * with `runEnterAnimation`, which will re-add `enterFrom` (no-op),
 * reflow, and swap to enter/enterTo as before.
 */
export const applyPreInsertEnterFrom = (
  element: DOMElement,
): Effect.Effect<void> => {
  if (!(element instanceof HTMLElement)) return Effect.void;
  return Effect.gen(function* () {
    const resolved = yield* readAnimation<{ enterFrom?: string }>();
    if (!resolved) return;
    const { enterFrom } = resolved.animate;
    if (!enterFrom) return;
    const classes = enterFrom.split(/\s+/).filter(Boolean);
    if (classes.length > 0) {
      element.classList.add(...classes);
    }
  });
};

/**
 * Fork an enter animation into the slot's scope. Returns immediately; the
 * animation plays in the background and gets interrupted if the slot scope
 * closes before it finishes. No-op if the element is not an HTMLElement
 * (SVG doesn't support the CSS-class animation path).
 *
 * When `opts.hydrating` is true, the animation only runs if the parent
 * control opted into intro re-animation (`animate.intro` on the config).
 * The default hydration behaviour is to attach handlers to pre-existing
 * DOM without re-animating; the intro flag flips that for decorative
 * sequences.
 *
 * If the animation is attached to an {@link AnimationGroup}, the group is
 * registered synchronously (before the fiber forks) so its pending count
 * reflects every sibling animation before any completion decrements it.
 * The forked fiber then awaits the group's gate before playing.
 */
export const forkSlotEnter = (
  element: DOMElement,
  slotScope: Scope.CloseableScope,
  opts?: {
    readonly hydrating?: boolean;
    /** Position of this slot within its reconcile batch (0-based). */
    readonly index?: number;
    /** Total number of slots in this reconcile batch. */
    readonly total?: number;
    /**
     * `Date.now()` timestamp captured when reconcile started iterating.
     * Used to compute stagger delays relative to a shared reference so
     * items fire at `startAt + delayMs` regardless of how long reconcile
     * takes to reach each slot — otherwise reconcile overhead would
     * compound and each staggered item would drift further behind.
     */
    readonly staggerStartAt?: number;
  },
): Effect.Effect<void> => {
  if (!(element instanceof HTMLElement)) return Effect.void;
  return Effect.gen(function* () {
    const resolved = yield* readAnimation<ListAnimationOptions>();
    if (!resolved) return;
    if (opts?.hydrating && !resolved.intro) return;

    const { animate } = resolved;
    // Resolve the enter-side group: prefer `enterGroup` (a per-nav
    // override handed in by e.g. `OutletCtx`), fall back to `group`.
    // Effect-valued refs are read at animation-fire time so
    // late-binding schemes (a stable AnimationConfigCtx pointing at
    // per-nav Refs) work without freezing the group at Ctx-provision
    // time.
    const grp =
      (yield* resolveGroup(animate.enterGroup)) ??
      (yield* resolveGroup(animate.group));
    if (grp) {
      _register(grp);
    }

    const targetDelay =
      opts?.index !== undefined && opts?.total !== undefined
        ? staggerDelayMs(animate.stagger, opts.index, opts.total)
        : 0;
    const now = yield* Clock.currentTimeMillis;
    const actualDelay =
      targetDelay > 0 && opts?.staggerStartAt !== undefined
        ? Math.max(0, opts.staggerStartAt + targetDelay - now)
        : targetDelay;

    yield* Effect.gen(function* () {
      if (grp) {
        yield* _awaitGate(grp);
      }
      // Wait for the element to be attached to the document before the
      // enter lifecycle starts. On client-mode re-mount (e.g. a router
      // nav-back), the fiber is forked from inside addSlot while the
      // ancestor chain is still being assembled bottom-up in memory.
      // The forked fiber can win the race against the outer flow, and
      // `onBeforeEnter` would then fire against a detached node —
      // `getComputedStyle` returns empty strings on disconnected nodes
      // and browsers won't compute or transition styles against them,
      // so the enter transition never fires and the animation stalls.
      //
      // Effect.yieldNow is not enough — Effect's scheduler can
      // reschedule the fiber right back if no other work is queued.
      // Real browser microtasks (via queueMicrotask) DO defer past
      // the current synchronous+microtask window, so the outer flow's
      // DOM insertion completes before this fiber resumes.
      if (!element.isConnected) {
        yield* waitForConnection(element);
      }
      // On hydration, wait for one paint before starting the enter
      // lifecycle. Vite dev (and any setup that injects stylesheets via
      // JS or defers <link> parsing) can have the module evaluated —
      // and this fiber scheduled — before the browser has actually
      // applied the transition-* CSS from the `enter` class. If that
      // happens, runEnterAnimation's forceReflow captures a "before"
      // state with no transition-property set, then the class swap
      // happens instantly and transitionend never fires — the user
      // sees a 5s timeout warning and no animation. One rAF is enough
      // to guarantee all pending stylesheets have been parsed and
      // applied, so the "before" snapshot is captured against the
      // real post-enter-class computed styles.
      if (opts?.hydrating) {
        yield* waitForPaint;
      }
      // Force a style/layout computation on the (now-connected)
      // element. Some engines defer style computation for freshly-
      // inserted nodes until it's needed; without this, forceReflow
      // inside runEnterAnimation may end up recording the enterFrom-
      // applied state as the initial snapshot for a node that hasn't
      // been styled yet, leaving the browser without a valid "before"
      // to interpolate the transition from.
      if (element instanceof HTMLElement) {
        void element.offsetHeight;
      }
      const run = runEnterAnimation(Effect.succeed(element), animate).pipe(
        Effect.ensuring(grp ? _complete(grp) : Effect.void),
      );
      yield* actualDelay > 0
        ? run.pipe(Effect.delay(`${actualDelay} millis`))
        : run;
    }).pipe(Effect.forkIn(slotScope));
  }).pipe(Effect.asVoid);
};

/**
 * Yield a real browser microtask. Different from `Effect.yieldNow` — that
 * only reschedules the fiber inside Effect's queue and can re-run
 * immediately when nothing else is queued. `queueMicrotask` guarantees
 * the browser will finish the current task's remaining synchronous work
 * and flush other pending microtasks before resuming.
 */
const yieldMicrotask: Effect.Effect<void> = Effect.async<void>((resume) => {
  queueMicrotask(() => resume(Effect.void));
});

/**
 * Wait for the next browser paint. Guarantees any pending stylesheet
 * parsing/application has completed — critical on first-load hydration
 * where Vite dev's JS-injected styles may not yet be in effect when
 * this fiber first gets scheduled.
 */
const waitForPaint: Effect.Effect<void> = Effect.async<void>((resume) => {
  const id = requestAnimationFrame(() => resume(Effect.void));
  return Effect.sync(() => cancelAnimationFrame(id));
});

/**
 * Wait for an element to become connected to the document. On client-mode
 * re-mount, the enter fiber is forked from inside `addSlot` before the
 * outer synchronous render flow has finished appending the wrapper's
 * ancestor chain — but that flow runs entirely within the current task's
 * synchronous+microtask window, so yielding real microtasks in a bounded
 * loop lets it complete and the element becomes connected.
 *
 * The bound is generous (32 microtasks): each takes ~microseconds in
 * modern engines, so a full spin is well under a millisecond even in the
 * worst case, but it comfortably covers any realistic outer-flow depth.
 * Callers that never insert their animated element (e.g. tests that yield
 * `animated(...)` inline without appending) hit the bound and proceed
 * anyway — best-effort rather than hanging.
 */
const waitForConnection = (element: HTMLElement): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let i = 0; i < 32 && !element.isConnected; i++) {
      yield* yieldMicrotask;
    }
  });

/**
 * Read the FLIP `move` config off the ambient AnimationConfigCtx, if any.
 * Same lazy-lookup pattern as `readAnimation` — nested contexts see the
 * config their parent provided.
 */
const readMoveConfig = (): Effect.Effect<MoveAnimation | undefined> =>
  Effect.gen(function* () {
    const configOpt = yield* Effect.serviceOption(AnimationConfigCtx);
    const config = Option.getOrUndefined(configOpt);
    return config?.list?.move;
  });

/**
 * FLIP measurement result for a single slot. `key` is copied so the
 * caller can look the slot back up in its own map after DOM mutations.
 */
export interface SlotRectSnapshot {
  readonly key: string;
  readonly rect: DOMRect;
}

/**
 * Capture bounding rects for a set of slot entries. Called by
 * `ClientControlCtx.beginSync` before any batch mutation runs, so
 * `endSync` can compute per-slot deltas against a pre-mutation view of
 * the container.
 *
 * SVG-only slots are skipped — the FLIP release path applies a CSS
 * transform via `element.style`, which doesn't compose cleanly with
 * SVG element styling (attribute-based `transform` etc.).
 */
export const captureSlotRects = (
  entries: Iterable<{ readonly key: string; readonly element: DOMElement }>,
): Map<string, DOMRect> => {
  const rects = new Map<string, DOMRect>();
  for (const entry of entries) {
    if (entry.element instanceof HTMLElement) {
      rects.set(entry.key, entry.element.getBoundingClientRect());
    }
  }
  return rects;
};

/**
 * Compute the delta from a snapshot rect to the element's current rect.
 * `x` / `y` are (old − new) so translating by (dx, dy) puts the element
 * back at its old spot — the "invert" step of FLIP.
 *
 * Returns undefined when the delta is zero (below a 0.5px threshold to
 * ignore sub-pixel jitter), so callers can skip the whole FLIP dance
 * for elements that didn't actually move.
 */
export const computeMoveDelta = (
  before: DOMRect,
  after: DOMRect,
): MoveDelta | undefined => {
  const dx = before.left - after.left;
  const dy = before.top - after.top;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return undefined;
  return { x: dx, y: dy };
};

/**
 * Fork the FLIP release for a single moved element.
 *
 * The sequence:
 * 1. Read the element's current computed `transform` so any class-based
 *    transform (Tailwind `rotate-[-1deg]`, hover states, etc.) survives
 *    the release — we compose the invert *on top of* it rather than
 *    clobbering `style.transform`.
 * 2. Set `style.transform` to the invert value composed with the base,
 *    parking the element visually at its old spot.
 * 3. Force reflow so the browser commits the invert without transition.
 * 4. Add the transition class from the config.
 * 5. Clear `style.transform` — this triggers the CSS transition back to
 *    the base (class-only) value.
 * 6. Wait for `transitionend` (or a bounded timeout, matching the enter
 *    /exit lifecycle) and remove the transition class.
 *
 * Reduced-motion users skip the animation and just get the layout jump.
 *
 * Forks into the ambient scope via `Effect.forkScoped` — when reconcile
 * runs, that scope is the container's, so if the container unmounts
 * mid-play the fiber is interrupted.
 */
export const forkSlotMove = (
  element: DOMElement,
  delta: MoveDelta,
  move: MoveAnimation,
): Effect.Effect<void, never, Scope.Scope> => {
  if (!(element instanceof HTMLElement)) return Effect.void;
  if (prefersReducedMotion()) return Effect.void;

  const body = Effect.gen(function* () {
    const transitionClasses = move.transition
      .split(/\s+/)
      .filter((c) => c.length > 0);
    const invert = move.transform(delta);

    // Preserve any transform the element already had. Two sources
    // matter and they compose differently:
    //  * `priorInline` — a value the user set via `style.transform`
    //    (or a prop that maps to it). We'll restore this by hand on
    //    release; `removeProperty` would drop it.
    //  * `computed` — the transform the browser is currently
    //    applying, which folds in class-based transforms
    //    (`rotate-1`, hover states, etc.) via the cascade. We prepend
    //    the invert to it so the "invert" frame doesn't visually
    //    lose them. Comes back as `matrix(...)` for any real
    //    transform, `"none"` for none.
    // The release then either restores `priorInline` or clears the
    // property — the class-based part re-enters via the cascade
    // automatically. In both cases the browser transitions
    // `transform` from `composed` to the correct steady-state value.
    const priorInline = element.style.transform;
    const computed = window.getComputedStyle(element).transform;
    const composed =
      computed && computed !== "none" ? `${invert} ${computed}` : invert;

    // Set the invert. No transition rule is on the element yet, so
    // the browser jumps to `composed` instantly for the invert frame.
    element.style.transform = composed;

    // Wait for two `requestAnimationFrame` ticks before adding the
    // transition class and clearing the invert. One rAF only fires
    // *before* the next paint, so any style changes inside a
    // single-rAF callback are batched into the SAME paint as the
    // invert — the browser never actually renders the invert state,
    // sees no change on the transform property between painted
    // frames, and skips the transition (visible as a snap). Double
    // rAF guarantees a frame paints with `transform: composed` in
    // between, so the second callback's `removeProperty` sits
    // against a real "previously-used" invert value and the
    // transition rule interpolates from there. Same idea most
    // FLIP libraries land on after chasing the same bug.
    yield* waitForPaint;
    yield* waitForPaint;

    // Add the transition rule and release. Browser sees
    // `transform: composed` in the previous painted frame,
    // `transform: <base>` now, with `transition-transform` active
    // → interpolates over the configured duration.
    element.classList.add(...transitionClasses);
    if (priorInline) {
      element.style.transform = priorInline;
    } else {
      element.style.removeProperty("transform");
    }

    yield* awaitTransformEnd(element);
    element.classList.remove(...transitionClasses);
  });
  return Effect.asVoid(Effect.forkScoped(body));
};

/**
 * Wait for a `transitionend` for the `transform` property, with a
 * bounded timeout so a missed event (transition never fires because
 * the property didn't change, another selector cancelled it, etc.)
 * doesn't leak the transition class on the element forever.
 *
 * Duration is read from computed style — `transition-duration` +
 * `transition-delay`, whichever transform-column is present — and a
 * 100ms safety margin is added so we don't beat the event by a hair.
 * If the computed duration is zero we resolve on the next microtask.
 */
const awaitTransformEnd = (element: HTMLElement): Effect.Effect<void> =>
  Effect.async<void>((resume) => {
    const style = window.getComputedStyle(element);
    const durationMs = maxTransitionMs(
      style.transitionProperty,
      style.transitionDuration,
      style.transitionDelay,
    );
    if (durationMs <= 0) {
      queueMicrotask(() => resume(Effect.void));
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      element.removeEventListener("transitionend", onEnd);
      clearTimeout(timeoutId);
      resume(Effect.void);
    };
    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName === "transform" && e.target === element) finish();
    };
    element.addEventListener("transitionend", onEnd);
    const timeoutId = setTimeout(finish, durationMs + 100);
    return Effect.sync(() => {
      element.removeEventListener("transitionend", onEnd);
      clearTimeout(timeoutId);
    });
  });

/**
 * Parse the transition columns for the `transform` property and return
 * total duration in ms (duration + delay). If `transition-property` is
 * `all` or doesn't list `transform`, we fall back to the first entry.
 */
const maxTransitionMs = (
  properties: string,
  durations: string,
  delays: string,
): number => {
  const props = properties.split(",").map((s) => s.trim());
  const durs = durations.split(",").map((s) => s.trim());
  const dels = delays.split(",").map((s) => s.trim());
  const parseMs = (v: string): number => {
    if (!v) return 0;
    const n = parseFloat(v);
    if (Number.isNaN(n)) return 0;
    return v.endsWith("ms") ? n : n * 1000;
  };
  let column = props.findIndex((p) => p === "transform" || p === "all");
  if (column < 0) column = 0;
  const dur = parseMs(durs[column] ?? durs[0] ?? "");
  const del = parseMs(dels[column] ?? dels[0] ?? "");
  return dur + del;
};

/**
 * Full end-of-batch FLIP orchestrator. Given the pre-batch rect
 * snapshot (from {@link captureSlotRects}) and the current live slots,
 * compute deltas for each still-present slot and fork the release for
 * any that moved. No-op when no `move` config is provided.
 *
 * Called from `ClientControlCtx.endSync`.
 */
export const flipMovedSlots = (
  before: Map<string, DOMRect>,
  currentSlots: Iterable<{
    readonly key: string;
    readonly element: DOMElement;
  }>,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const move = yield* readMoveConfig();
    if (!move) return;

    for (const entry of currentSlots) {
      const oldRect = before.get(entry.key);
      if (!oldRect) continue; // Entered this batch — enter anim handles it
      if (!(entry.element instanceof HTMLElement)) continue;
      const newRect = entry.element.getBoundingClientRect();
      const delta = computeMoveDelta(oldRect, newRect);
      if (!delta) continue;
      yield* forkSlotMove(entry.element, delta, move);
    }
  });

/**
 * Fork the full slot-removal sequence:
 * 1. Close the slot's scope (interrupts any in-flight enter animation).
 * 2. Play the exit animation (if configured).
 * 3. Call `removeFromDom` to detach the element.
 *
 * `entry.scope` is nullable because hydration seeds slots from existing
 * DOM before their scopes are populated by addSlot; a slot removed in
 * that intermediate state has nothing to close.
 *
 * Forks into the ambient scope via `Effect.forkScoped` — the container
 * scope when called from reconcile — so removeSlot returns right away
 * and the exit continues even if a fresh slot re-uses the same key
 * immediately, and so a container unmount interrupts everything.
 */
export const forkSlotRemoval = (
  entry: {
    readonly element: DOMElement;
    readonly scope: Scope.CloseableScope | null;
  },
  removeFromDom: () => void,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    // Resolve + register on the exit group HERE, in the caller's
    // fiber (i.e. reconcile's removeSlot dispatch), matching what
    // `forkSlotEnter` does for the enter side. If the register moved
    // into the forked body below, it would race the empty-group
    // fast-path: `Animation.parallel(2)` opens the group's gate
    // immediately and schedules `Effect.sleep(0)` to fire `_done`
    // when `pending === 0`. Both the fast-path and the forked body's
    // first steps wake on the next scheduler tick, and the fast-path
    // often wins — spuriously firing `_done` before the exit
    // registration lands, so `Animation.awaitDone(exitGroup)` in a
    // custom scroll behavior would return immediately instead of
    // waiting for the actual exit animation.
    type ExitAnimateOptions = Parameters<typeof runExitAnimation>[1];
    let grp: AnimationGroup | undefined;
    let resolved: ResolvedAnimation<ExitAnimateOptions> | undefined;
    if (entry.element instanceof HTMLElement) {
      resolved = yield* readAnimation<ExitAnimateOptions>();
      if (resolved) {
        // Resolve the exit-side group — `exitGroup` takes precedence
        // over `group`. Register/complete on the group so
        // `Animation.awaitDone(exitGroup)` in a custom scroll
        // behavior (etc.) actually gates on the exit animation
        // completing.
        grp =
          (yield* resolveGroup(resolved.animate.exitGroup)) ??
          (yield* resolveGroup(resolved.animate.group));
        if (grp) {
          _register(grp);
        }
      }
    }

    const body = Effect.gen(function* () {
      if (entry.scope) {
        yield* Scope.close(entry.scope, Exit.void);
      }
      if (resolved && entry.element instanceof HTMLElement) {
        yield* runExitAnimation(
          Effect.succeed(entry.element),
          resolved.animate,
        ).pipe(Effect.ensuring(grp ? _complete(grp) : Effect.void));
      }
      removeFromDom();
    });
    yield* Effect.asVoid(Effect.forkScoped(body));
  });

// Resolve a group ref that may be either a value or an
// `Effect<AnimationGroup | undefined>`. The Effect form is what lets
// a stable `AnimationConfigCtx` point at a group that rotates over
// time (e.g. the current-nav `OutletCtx.enter`, read through a Ref)
// without freezing at Ctx-provision time.
const resolveGroup = (
  ref: AnimationGroupRef | undefined,
): Effect.Effect<AnimationGroup | undefined> => {
  if (ref === undefined) return Effect.succeed(undefined);
  return Effect.isEffect(ref)
    ? (ref as Effect.Effect<AnimationGroup | undefined>)
    : Effect.succeed(ref);
};
