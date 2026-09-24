/**
 * Animation groups: declarative sequencing across multiple animated blocks.
 *
 * A group is a shared handle that any animated control (`each`, `when`,
 * `match`, ...) can attach to via `animate.group`. When groups are wired
 * with `sequence()`, later groups' animations wait for the prior group's
 * animations to complete before starting.
 *
 * @example Chained word-by-word intro:
 * ```ts
 * const App = () =>
 *   Effect.gen(function* () {
 *     const [greeting, name, tagline] = yield* Animation.sequence(3);
 *     return $.div(
 *       {},
 *       each(greetingLetters, {
 *         key: (l) => l.id,
 *         render: (l) => $.span({}, l.char),
 *         animate: { enter: "letter-in", stagger: stagger(40), group: greeting },
 *       }),
 *       each(nameLetters, {
 *         key: (l) => l.id,
 *         render: (l) => $.span({}, l.char),
 *         animate: { enter: "letter-in", stagger: stagger(40), group: name },
 *       }),
 *       each(taglineLetters, {
 *         key: (l) => l.id,
 *         render: (l) => $.span({}, l.char),
 *         animate: { enter: "letter-in", stagger: stagger(40), group: tagline },
 *       }),
 *     );
 *   });
 * ```
 *
 * A group's `done` signal fires when its pending count reaches zero
 * with the gate open. Empty groups (no registrations by the time the
 * gate opens and one tick has elapsed) complete automatically — a
 * downstream sequence step doesn't stall waiting on animations that
 * were never mounted (e.g. a desktop-only branch omitted on mobile).
 *
 * Late registrations that arrive after the group is already done run
 * immediately without gating and don't re-open the signal — intended
 * for one-shot intros where new items added after the sequence
 * completes should behave like ordinary animations.
 *
 * Consumers can also force completion explicitly with `Animation.skip`
 * — useful for "skip intro" buttons, reduced-motion escape hatches,
 * or any orchestrator logic that wants to advance a sequence beyond
 * what its registered animations dictate.
 */

import { Deferred, Effect, Scope } from "effect";

/**
 * Opaque handle representing a group of animations that can be gated and
 * awaited together. Construct via `group()`, `sequence()`, or `parallel()`.
 */
export interface AnimationGroup {
  readonly _tag: "AnimationGroup";
  readonly _gate: Deferred.Deferred<void>;
  readonly _done: Deferred.Deferred<void>;
  readonly _state: {
    pending: number;
    started: boolean;
    doneResolved: boolean;
    gateResolved: boolean;
  };
}

/**
 * Create a fresh group whose gate is closed. Use `sequence()` or `parallel()`
 * for the common case of building wired chains; call `group()` directly only
 * if you need custom gating logic.
 */
export const group = (): Effect.Effect<AnimationGroup> =>
  Effect.gen(function* () {
    const gate = yield* Deferred.make<void>();
    const done = yield* Deferred.make<void>();
    return {
      _tag: "AnimationGroup" as const,
      _gate: gate,
      _done: done,
      _state: {
        pending: 0,
        started: false,
        doneResolved: false,
        gateResolved: false,
      },
    };
  });

/**
 * Options accepted by `sequence` and `parallel` for nesting the returned
 * groups under a parent.
 */
export interface GroupOptions {
  /**
   * Nest the resulting groups under a parent group. When set:
   * - The first (or only) child group's gate is chained to `parent._gate`
   *   instead of opening immediately.
   * - The whole child chain is registered against `parent` as one virtual
   *   animation, so parent's `_done` waits for it in addition to any
   *   directly-attached animations.
   *
   * Enables nested sequences without users touching internal wiring:
   *
   * ```ts
   * const [greeting, nameChunk, tagline] = yield* Animation.sequence(3);
   * const [firstName, lastName] = yield* Animation.sequence(2, {
   *   group: nameChunk,
   * });
   * // Timeline: greeting → firstName → lastName → tagline
   * ```
   */
  readonly group?: AnimationGroup;
}

/**
 * Create `count` groups where each opens after the prior's animations
 * complete. Group 0's gate is open immediately; groups 1..N-1 gate on the
 * prior group's `_done`.
 *
 * When `options.group` is set, group 0 gates on the parent's `_gate` and the
 * chain's completion drives the parent's `_done` through a virtual
 * registration — the parent effectively "contains" the sequence.
 */
// The impl always returns `Effect<_, _, Scope>` because it installs a scope
// finalizer when `options.group` is set. When no parent is passed the
// finalizer path is never reached and the runtime doesn't touch Scope, so
// the no-parent overload widens Scope back to `never` — the cast at the end
// bridges the impl's static type to the overload set the exported name
// exposes to callers.
const sequenceImpl = (
  count: number,
  options?: GroupOptions,
): Effect.Effect<AnimationGroup[], never, Scope.Scope> =>
  Effect.gen(function* () {
    if (count <= 0) return [];

    const groups: AnimationGroup[] = [];
    for (let i = 0; i < count; i++) {
      groups.push(yield* group());
    }

    const parent = options?.group;
    if (parent) {
      // The whole child chain counts as one virtual animation on the parent —
      // register up front so parent's pending count reflects it before any
      // sibling completions can drive it to zero.
      _register(parent);
      // Scope-aware release: whichever fires first — the last child's
      // `_done` OR this call site's scope closing — decrements parent's
      // virtual registration exactly once. The scope path is the one
      // that handles reactive branch swaps: `when(cond, {onTrue: A, onFalse: B})`
      // where each branch owns a nested `sequence(_, {group: parent})`
      // would otherwise leak the losing branch's `_register` forever —
      // parent's `pending` would never balance because the losing branch's
      // last group never completes.
      yield* releaseParentOnDoneOrScopeClose(
        parent,
        Deferred.await(groups[count - 1]._done),
      );
      // Open child 0's gate when parent's gate opens. Daemon so the wiring
      // outlives the render scope.
      yield* Effect.forkDaemon(
        Deferred.await(parent._gate).pipe(
          Effect.andThen(() => openGate(groups[0])),
        ),
      );
    } else {
      // Top-level: first group opens immediately.
      yield* openGate(groups[0]);
    }

    // Chain: groups 1..N-1 gate on the prior group's `_done`. Independent of
    // whether we're nested — the intra-chain sequencing is the same either way.
    for (let i = 1; i < count; i++) {
      const prev = groups[i - 1];
      const curr = groups[i];
      // Daemon so the wiring outlives the render scope — deferreds get GC'd
      // when the groups are unreachable.
      yield* Effect.forkDaemon(
        Deferred.await(prev._done).pipe(Effect.andThen(() => openGate(curr))),
      );
    }
    return groups;
  });

export const sequence: {
  (count: number): Effect.Effect<AnimationGroup[]>;
  (
    count: number,
    options: GroupOptions,
  ): Effect.Effect<AnimationGroup[], never, Scope.Scope>;
} = sequenceImpl as {
  (count: number): Effect.Effect<AnimationGroup[]>;
  (
    count: number,
    options: GroupOptions,
  ): Effect.Effect<AnimationGroup[], never, Scope.Scope>;
};

/**
 * Create `count` groups whose gates are all open immediately. Useful nested
 * inside `sequence` for concurrent segments.
 *
 * When `options.group` is set, all child gates open when the parent's gate
 * opens, and the child chain's completion drives the parent's `_done`
 * through a virtual registration.
 */
const parallelImpl = (
  count: number,
  options?: GroupOptions,
): Effect.Effect<AnimationGroup[], never, Scope.Scope> =>
  Effect.gen(function* () {
    if (count <= 0) return [];

    const groups: AnimationGroup[] = [];
    for (let i = 0; i < count; i++) {
      groups.push(yield* group());
    }

    const parent = options?.group;
    if (parent) {
      // Register the child chain as one virtual animation on the parent.
      _register(parent);
      // Scope-aware release: parent's virtual registration completes
      // when EVERY child's `_done` has fired OR when this call site's
      // scope closes — whichever comes first. See `sequence` for the
      // rationale (reactive branch swaps would otherwise leak).
      yield* releaseParentOnDoneOrScopeClose(
        parent,
        Effect.forEach(groups, (g) => Deferred.await(g._done), {
          concurrency: "unbounded",
          discard: true,
        }).pipe(Effect.asVoid),
      );
      // All child gates open in unison when parent's gate does.
      yield* Effect.forkDaemon(
        Deferred.await(parent._gate).pipe(
          Effect.andThen(() =>
            Effect.forEach(groups, openGate, { discard: true }),
          ),
        ),
      );
    } else {
      // Top-level: open every child's gate immediately.
      for (const g of groups) {
        yield* openGate(g);
      }
    }

    return groups;
  });

export const parallel: {
  (count: number): Effect.Effect<AnimationGroup[]>;
  (
    count: number,
    options: GroupOptions,
  ): Effect.Effect<AnimationGroup[], never, Scope.Scope>;
} = parallelImpl as {
  (count: number): Effect.Effect<AnimationGroup[]>;
  (
    count: number,
    options: GroupOptions,
  ): Effect.Effect<AnimationGroup[], never, Scope.Scope>;
};

const openGate = (g: AnimationGroup): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (g._state.gateResolved) return;
    g._state.gateResolved = true;
    yield* Deferred.succeed(g._gate, void 0);
    // Empty-group fast-path. If no one has registered by the next tick
    // (all synchronous `_register` calls from the render fiber have
    // drained), fire `_done` so the downstream sequence step doesn't
    // stall waiting on animations that will never arrive. Registrations
    // arriving AFTER this point — reactive controls, late-mounted
    // children — still run their animations; they just don't gate
    // downstream, matching the existing "late arrivals don't re-open
    // the signal" contract.
    yield* Effect.forkDaemon(
      Effect.sleep(0).pipe(
        Effect.andThen(() =>
          Effect.gen(function* () {
            if (
              g._state.pending === 0 &&
              g._state.gateResolved &&
              !g._state.doneResolved
            ) {
              g._state.doneResolved = true;
              yield* Deferred.succeed(g._done, void 0);
            }
          }),
        ),
      ),
    );
  });

/**
 * Force a group's `_done` to fire without waiting for any registered
 * animations to finish. Useful when a downstream sequence step should
 * advance even though the current step's animations aren't going to
 * run — e.g. a mobile branch that skips a desktop-only animated block,
 * a "skip intro" button, or a reduced-motion escape hatch. Idempotent —
 * safe to call any number of times; only the first call fires `_done`.
 *
 * Does NOT cancel in-flight animation fibers. Animations that are
 * already running continue to their natural end; they just no longer
 * gate anything downstream because the group has been sealed.
 *
 * @example
 * ```ts
 * const [logo, chips, cta] = yield* Animation.sequence(3);
 * if (yield* isMobile.get) {
 *   yield* Animation.skip(chips);
 * }
 * ```
 */
export const skip = (g: AnimationGroup): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (g._state.doneResolved) return;
    g._state.doneResolved = true;
    // If the gate hasn't opened yet, open it too — a downstream step
    // sequenced on this group would otherwise wait for both the gate
    // and the done signal, and skipping should unblock everything.
    if (!g._state.gateResolved) {
      g._state.gateResolved = true;
      yield* Deferred.succeed(g._gate, void 0);
    }
    yield* Deferred.succeed(g._done, void 0);
  });

/**
 * Register an animation with the group synchronously — must be called from
 * the calling fiber before its animation fiber is forked, so the counter
 * reflects all sibling animations before any completion decrements it.
 * Internal — invoked by the ControlCtx slot machinery.
 */
export const _register = (g: AnimationGroup): void => {
  g._state.pending += 1;
  g._state.started = true;
};

/**
 * Balance the parent-side `_register` from `sequence` / `parallel` against
 * two possible completion signals: the child chain's natural `_done` OR the
 * enclosing scope closing before that ever happens (e.g. the `when` branch
 * that owned the sub-sequence got unmounted mid-hydration).
 *
 * `_complete(parent)` is idempotent within one registration — a shared
 * `released` flag ensures whichever completion signal wins fires the
 * decrement exactly once. Without the scope-close arm, a swap between two
 * `when` branches that each nest a `sequence(_, { group: parent })` under
 * the same parent leaks the losing branch's `_register` forever — parent's
 * `pending` never balances, and every downstream sibling of the parent
 * hangs.
 *
 * Internal.
 */
const releaseParentOnDoneOrScopeClose = (
  parent: AnimationGroup,
  awaitNaturalDone: Effect.Effect<void>,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    let released = false;
    const releaseOnce = Effect.suspend(() => {
      if (released) return Effect.void;
      released = true;
      return _complete(parent);
    });

    // Natural completion path — daemon so the wiring outlives the render
    // scope (matches how the pre-fix `_done → _complete` daemon behaved).
    yield* Effect.forkDaemon(
      awaitNaturalDone.pipe(Effect.andThen(releaseOnce)),
    );

    // Scope-close path — fires only if the enclosing scope tears down
    // before the natural path won. Idempotent via `released`.
    yield* Effect.addFinalizer(() => releaseOnce);
  });

/**
 * Signal that a registered animation has finished. When the pending
 * count returns to zero after having been non-zero, the group's `_done`
 * fires. Idempotent past the first firing. Internal.
 *
 * `_complete` deliberately doesn't require the gate to be open — a
 * caller using `group()` directly can drive `_register` / `_complete`
 * manually without ever opening the gate, and the done signal should
 * still fire once the pending count balances. Gate-driven empty
 * completion happens on a separate path inside `openGate`.
 */
export const _complete = (g: AnimationGroup): Effect.Effect<void> =>
  Effect.gen(function* () {
    g._state.pending -= 1;
    if (g._state.pending === 0 && g._state.started && !g._state.doneResolved) {
      g._state.doneResolved = true;
      yield* Deferred.succeed(g._done, void 0);
    }
  });

/**
 * Wait until the group's gate is open. Once open, returns immediately on
 * subsequent calls. Internal.
 */
export const _awaitGate = (g: AnimationGroup): Effect.Effect<void> =>
  Deferred.await(g._gate);

/**
 * Wait until the group's `_done` signal has fired — i.e. all registered
 * animations have completed (or the empty-group fast-path resolved).
 * Returns immediately if `_done` has already fired.
 *
 * Public wrapper around the internal `Deferred.await(g._done)` so
 * downstream code (custom `Router.scrollBehavior` fns, page components
 * that want to sequence an intro AFTER a parent transition, etc.) can
 * coordinate off a group without dipping into its internals.
 *
 * @example Defer a `Router.scrollBehavior` custom fn until the outlet's
 * transition finishes:
 * ```ts
 * Router.scrollBehavior((from, to) =>
 *   Effect.gen(function* () {
 *     const outlet = yield* OutletCtx;
 *     yield* Animation.awaitDone(outlet.transition);
 *     window.scrollTo(0, 0);
 *   }),
 * );
 * ```
 */
export const awaitDone = (g: AnimationGroup): Effect.Effect<void> =>
  Deferred.await(g._done);
