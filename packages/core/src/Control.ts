import { Cause, Clock, Effect, Either, Option } from "effect";

import { ControlCtx } from "./ControlCtx.js";
import { logDebug, logError } from "./Debug.js";
import type { Element } from "./Element.js";
import { Readable } from "./Readable.js";
import type { Signal } from "./Signal.js";

// -----------------------------------------------------------------------------
// ReconcileConfig
// -----------------------------------------------------------------------------

/**
 * Configuration for the reconcile function.
 * @template A - The type of the reactive value
 * @template E - Error type
 * @template R - Requirements type
 */
export interface ReconcileConfig<A, E = never, R = never> {
  /** Optional custom container factory */
  readonly container?: () => Element<unknown, E, R>;
  /** Derive target slot keys from the current value */
  readonly getTargetKeys: (value: A) => readonly string[];
  /** Render a slot given its key and the current value */
  readonly renderSlot: (
    key: string,
    value: A,
    ctx: { item: Signal.Signal<unknown>; index: Signal.Signal<number> },
  ) => Element<unknown, E, R>;
  /**
   * Optional per-sync precomputation. Called exactly once at the start of
   * each sync; the result is threaded into every `getItemForKey` call for
   * that sync and then discarded.
   *
   * Exists so `each` can build a key→item index once per update instead of
   * scanning the list per slot. Deliberately NOT cached across syncs:
   * `SignalArray` mutates its backing array in place and re-emits the same
   * reference, so any identity-keyed memo would go stale and mis-render.
   */
  readonly prepare?: (value: A) => unknown;
  /**
   * Get the item value for a given key (used by `each`). Receives the
   * result of the optional `prepare` hook — for `each`, that's a
   * `Map<string, A>` built once per sync, turning per-slot lookup from
   * O(n) into O(1).
   */
  readonly getItemForKey?: (
    key: string,
    value: A,
    prepared: unknown,
  ) => unknown;
  /** Whether slot order matters (true for `each`) */
  readonly ordered?: boolean;
}

// -----------------------------------------------------------------------------
// reconcile
// -----------------------------------------------------------------------------

/**
 * Core reconciliation function for control flow.
 * All control flow functions (`when`, `match`, `each`) are thin wrappers over this.
 *
 * @param readable - The reactive value to reconcile against
 * @param config - Configuration for how to reconcile
 * @returns An Element representing the container with managed slots
 */
export const reconcile = <A, E, R>(
  readable: Readable.Readable<A>,
  config: ReconcileConfig<A, E, R>,
): Element<unknown, E, R | ControlCtx> =>
  Effect.gen(function* () {
    const parentCtx = yield* ControlCtx;
    // Fork to get isolated state (own container and slots)
    const ctx = yield* parentCtx.fork();

    // Get container (uses defaultContainer if not provided)
    const container = yield* ctx.getContainer(config.container);

    const sync = (value: A) =>
      Effect.gen(function* () {
        // Reference point for stagger delays. All new slots in this batch
        // compute their fire time as `batchStart + index * staggerStep`, so
        // slot N's animation fires at the same moment regardless of how
        // long reconcile takes to iterate to it. Sourced from Effect.Clock
        // (not Date.now()) so tests can substitute a TestClock.
        const batchStart = yield* Clock.currentTimeMillis;
        const currentKeys = yield* ctx.getSlotKeys();
        const targetKeys = config.getTargetKeys(value);
        const targetSet = new Set(targetKeys);
        // Per-sync precomputation (see ReconcileConfig.prepare). Runs
        // exactly once, before any slot lookups, and threads through
        // getItemForKey. `undefined` when unused — the existing guards
        // on getItemForKey below are unchanged.
        const prepared = config.prepare?.(value);

        yield* logDebug("reconcile sync", "stax.reconcile", {
          value,
          currentKeys,
          targetKeys,
        });

        // Bracket the batch so ControlCtx implementations that need a
        // pre-mutation view of the container (Client mode's FLIP snapshot)
        // get a chance to capture it before removes/moves start. Hydration
        // and SSR are no-ops.
        yield* ctx.beginSync();

        // Step 1: Remove slots not in target
        for (const key of currentKeys) {
          if (!targetSet.has(key)) {
            yield* ctx.removeSlot(key);
          }
        }

        // Step 2: Add/update slots in target order
        // `i` is the TARGET position where this key should end up
        for (let i = 0; i < targetKeys.length; i++) {
          const key = targetKeys[i];
          const existing = yield* ctx.getSlot(key);

          if (existing) {
            // Update existing slot's reactive values
            if (existing.item && config.getItemForKey) {
              yield* existing.item.set(
                config.getItemForKey(key, value, prepared),
              );
            }
            if (existing.index) {
              yield* existing.index.set(i);
            }
            // Reorder DOM if needed
            if (config.ordered) {
              yield* ctx.moveSlot(key, i);
            }
          } else {
            // Create new slot
            const itemValue = config.getItemForKey?.(key, value, prepared);
            yield* ctx.addSlot(
              key,
              ({ item, index }) =>
                config.renderSlot(key, value, { item, index }),
              {
                atIndex: i,
                initialItem: itemValue,
                initialIndex: i,
                totalItems: targetKeys.length,
                staggerStartAt: batchStart,
              },
            );
          }
        }

        // Close the batch — Client mode measures deltas and forks the
        // FLIP release here. Runs after every add/move so the DOM has
        // fully settled into its post-batch shape.
        yield* ctx.endSync();
      });

    // Initial sync — errors here are load-bearing (the whole tree failed
    // to render) so let them propagate to the caller. Subsequent syncs
    // driven by subscribe are wrapped below so a single bad update
    // doesn't kill the subscription.
    const initialValue = yield* readable.get;
    yield* sync(initialValue);

    // Pop the container from the hydration stack (no-op in client/SSR)
    yield* ctx.finalizeContainer();

    // Wrap sync for the subscribe path: log every failure with an
    // stax.reconcile subsystem tag and swallow the cause so the
    // subscription fiber survives. Without this, one bad update freezes
    // all future updates too — a user who navigates to a broken route
    // can't recover by navigating away. The wrapping lives in core
    // rather than each ControlCtx's subscribe impl because the semantics
    // are inherent to reconcile (any subscribe strategy needs this),
    // not to any particular DOM/hydration wiring.
    const safeSync = (value: A) =>
      sync(value).pipe(
        Effect.tapErrorCause((cause) =>
          logError("reconcile handler failed", "stax.reconcile", {
            value,
            cause: Cause.pretty(cause),
          }),
        ),
        Effect.catchAllCause(() => Effect.void),
      );

    // Subscribe to future changes
    yield* ctx.subscribe(readable, safeSync);

    return container;
  }) as Element<unknown, E, R | ControlCtx>;

// -----------------------------------------------------------------------------
// Thin Wrappers
// -----------------------------------------------------------------------------

/**
 * Configuration for `when`.
 */
export interface WhenConfig<E1 = never, R1 = never, E2 = never, R2 = never> {
  readonly onTrue?: () => Element<unknown, E1, R1>;
  readonly onFalse?: () => Element<unknown, E2, R2>;
  readonly container?: () => Element<unknown, E1 | E2, R1 | R2>;
}

/**
 * Conditionally render one of two elements based on a reactive boolean.
 *
 * @example
 * ```ts
 * when(isLoggedIn, {
 *   onTrue: () => $.div("Welcome back!"),
 *   onFalse: () => $.div("Please log in"),
 * })
 * ```
 */
export const when = <E1 = never, R1 = never, E2 = never, R2 = never>(
  condition: Readable.Readable<boolean>,
  config: WhenConfig<E1, R1, E2, R2>,
): Element<unknown, E1 | E2, R1 | R2 | ControlCtx> =>
  reconcile(condition, {
    container: config.container,
    getTargetKeys: (v) =>
      v ? (config.onTrue ? ["true"] : []) : config.onFalse ? ["false"] : [],
    renderSlot: (key) =>
      key === "true" ? config.onTrue!() : config.onFalse!(),
  });

/**
 * Configuration for `match`.
 */
export interface MatchCase<A, E = never, R = never> {
  readonly pattern: A;
  readonly render: () => Element<unknown, E, R>;
}

export interface MatchConfig<A, E = never, R = never, E2 = never, R2 = never> {
  readonly cases: readonly MatchCase<A, E, R>[];
  readonly fallback?: () => Element<unknown, E2, R2>;
  readonly container?: () => Element<unknown, E | E2, R | R2>;
}

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
 *   ],
 * })
 * ```
 */
export const match = <A, E = never, R = never, E2 = never, R2 = never>(
  value: Readable.Readable<A>,
  config: MatchConfig<A, E, R, E2, R2>,
): Element<unknown, E | E2, R | R2 | ControlCtx> =>
  reconcile(value, {
    container: config.container,
    getTargetKeys: (v) => {
      const matchedCase = config.cases.find((c) => c.pattern === v);
      if (matchedCase) return [String(matchedCase.pattern)];
      if (config.fallback) return ["__fallback__"];
      return [];
    },
    renderSlot: (key) => {
      if (key === "__fallback__") return config.fallback!();
      const matchedCase = config.cases.find((c) => String(c.pattern) === key);
      return matchedCase!.render();
    },
  });

/**
 * Configuration for `matchOption`.
 */
export interface MatchOptionConfig<
  A,
  E1 = never,
  R1 = never,
  E2 = never,
  R2 = never,
> {
  readonly onSome: (value: Readable.Readable<A>) => Element<unknown, E1, R1>;
  readonly onNone: () => Element<unknown, E2, R2>;
  readonly container?: () => Element<unknown, E1 | E2, R1 | R2>;
}

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
 */
export const matchOption = <A, E1 = never, R1 = never, E2 = never, R2 = never>(
  option: Readable.Readable<Option.Option<A>>,
  config: MatchOptionConfig<A, E1, R1, E2, R2>,
): Element<unknown, E1 | E2, R1 | R2 | ControlCtx> => {
  // Create unwrapped value Readable (safe because only used when isSome)
  const unwrapped = Readable.map(option, (opt) =>
    Option.isSome(opt) ? opt.value : (undefined as never),
  );

  return reconcile(option, {
    container: config.container,
    getTargetKeys: (opt) => [Option.isSome(opt) ? "some" : "none"],
    renderSlot: (key) =>
      key === "some" ? config.onSome(unwrapped) : config.onNone(),
  });
};

/**
 * Configuration for `matchEither`.
 */
export interface MatchEitherConfig<
  A,
  E,
  E1 = never,
  R1 = never,
  E2 = never,
  R2 = never,
> {
  readonly onRight: (value: Readable.Readable<A>) => Element<unknown, E1, R1>;
  readonly onLeft: (error: Readable.Readable<E>) => Element<unknown, E2, R2>;
  readonly container?: () => Element<unknown, E1 | E2, R1 | R2>;
}

/**
 * Match on an Either and render different elements for Right/Left cases.
 *
 * @example
 * ```ts
 * matchEither(result, {
 *   onRight: (value) => $.div(value.map(v => v.formatted)),
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
>(
  either: Readable.Readable<Either.Either<A, E>>,
  config: MatchEitherConfig<A, E, E1, R1, E2, R2>,
): Element<unknown, E1 | E2, R1 | R2 | ControlCtx> => {
  // Create unwrapped value Readables using Readable.map
  const rightValue = Readable.map(either, (e) =>
    Either.isRight(e) ? e.right : (undefined as never),
  );

  const leftValue = Readable.map(either, (e) =>
    Either.isLeft(e) ? e.left : (undefined as never),
  );

  return reconcile(either, {
    container: config.container,
    getTargetKeys: (e) => [Either.isRight(e) ? "right" : "left"],
    renderSlot: (key) =>
      key === "right" ? config.onRight(rightValue) : config.onLeft(leftValue),
  });
};

/**
 * Configuration for `each`.
 */
export interface EachConfig<A, E = never, R = never> {
  readonly key: (item: A) => string;
  readonly render: (
    item: Readable.Readable<A>,
    index: Readable.Readable<number>,
  ) => Element<unknown, E, R>;
  readonly container?: () => Element<unknown, E, R>;
}

/**
 * Render a list of items with efficient updates using keys.
 *
 * @example
 * ```ts
 * each(todos, {
 *   key: (todo) => todo.id,
 *   render: (todo, index) => $.li(todo.map(t => t.text)),
 *   container: () => $.ul({ class: "todo-list" }),
 * })
 * ```
 */
export const each = <A, E = never, R = never>(
  items: Readable.Readable<readonly A[]>,
  config: EachConfig<A, E, R>,
): Element<unknown, E, R | ControlCtx> =>
  reconcile(items, {
    container: config.container,
    getTargetKeys: (arr) => arr.map(config.key),
    renderSlot: (_, __, ctx) =>
      config.render(
        ctx.item as Readable.Readable<A>,
        ctx.index as Readable.Readable<number>,
      ),
    // Build a key→item index once per sync, then look up in O(1) per slot.
    // Without this, `getItemForKey` was a linear scan (`arr.find`) called
    // once per slot per sync, making `each` O(n²) in list length.
    prepare: (arr) => {
      const index = new Map<string, A>();
      for (const item of arr) {
        const k = config.key(item);
        // First occurrence wins — preserves `Array.prototype.find`
        // semantics exactly when keys collide. `new Map(arr.map(…))`
        // would keep the LAST and silently change behaviour for
        // duplicate-key lists.
        if (!index.has(k)) index.set(k, item);
      }
      return index;
    },
    getItemForKey: (key, _arr, prepared) =>
      (prepared as Map<string, A> | undefined)?.get(key),
    ordered: true,
  });

// -----------------------------------------------------------------------------
// redraw
// -----------------------------------------------------------------------------

/**
 * Helper type to extract values from an array of Readables.
 * `[Readable<A>, Readable<B>]` -> `[A, B]`
 */
type ExtractReadableValue<T extends Readable.Readable<unknown>> =
  T extends Readable.Readable<infer V> ? V : never;

/**
 * Configuration for `redraw`.
 */
export interface RedrawConfig<
  T extends Readable.Readable<unknown>,
  E = never,
  R = never,
> {
  readonly render: (value: ExtractReadableValue<T>) => Element<unknown, E, R>;
  readonly container?: () => Element<unknown, E, R>;
}

/**
 * Re-render a component whenever any of the provided Readables change.
 * Unlike other control functions that switch between states, `redraw` always
 * renders one element that gets completely recreated on each change.
 *
 * This is useful when you need to rebuild a component tree based on reactive
 * values, rather than just updating individual properties.
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
  E = never,
  R = never,
>(
  readable: T,
  config: RedrawConfig<T, E, R>,
): Element<unknown, E, R | ControlCtx> =>
  reconcile(readable, {
    container: config.container,
    getTargetKeys: () => [String(Math.random())],
    renderSlot: (_, a) => config.render(a as ExtractReadableValue<T>),
  });
