import {
  Context,
  Effect,
  FiberRef,
  Function as Fn,
  Layer,
  LogLevel,
  Predicate,
  Scope,
  Stream,
  SubscriptionRef,
} from "effect";

import { logDebug, parseCallSite } from "./Debug.js";
import { Readable, TypeId as ReadableTypeId } from "./Readable.js";
import {
  SignalArray,
  type SignalArray as SignalArrayType,
} from "./SignalArray.js";
import { SignalMap, type SignalMap as SignalMapType } from "./SignalMap.js";
import { SignalSet, type SignalSet as SignalSetType } from "./SignalSet.js";
import {
  SignalStruct,
  type SignalStruct as SignalStructType,
} from "./SignalStruct.js";

// -----------------------------------------------------------------------------
// TypeId
// -----------------------------------------------------------------------------

export const SignalTypeId: unique symbol = Symbol.for("stax/Signal");
export type SignalTypeId = typeof SignalTypeId;

// -----------------------------------------------------------------------------
// Models
// -----------------------------------------------------------------------------

/**
 * A mutable reactive value that extends Readable with write capabilities.
 * @template A - The type of the value
 */
export interface Signal<A> extends Readable.Readable<A> {
  readonly [SignalTypeId]: SignalTypeId;
  /** Set the signal to a new value */
  readonly set: (a: A) => Effect.Effect<void>;
  /** Update the signal value using a function */
  readonly update: (f: (a: A) => A) => Effect.Effect<void>;
}

/**
 * @category models
 */
export declare namespace Signal {
  /**
   * A mutable reactive value that extends Readable with write capabilities.
   * @template A - The type of the value
   */
  export interface Signal<A> extends Readable.Readable<A> {
    readonly [SignalTypeId]: SignalTypeId;
    /** Set the signal to a new value */
    readonly set: (a: A) => Effect.Effect<void>;
    /** Update the signal value using a function */
    readonly update: (f: (a: A) => A) => Effect.Effect<void>;
  }

  /**
   * Options for creating a Signal.
   * @template A - The type of the value
   */
  export interface Options<A> {
    /** Custom equality function to determine if the value has changed */
    readonly equals?: (a: A, b: A) => boolean;
  }
}

/**
 * Options for creating a Signal.
 * @template A - The type of the value
 * @deprecated Use `Signal.make(value).pipe(Signal.equals(fn))` instead
 */
export interface SignalOptions<A> {
  /** Custom equality function to determine if the value has changed */
  readonly equals?: (a: A, b: A) => boolean;
}

// -----------------------------------------------------------------------------
// Type Guards
// -----------------------------------------------------------------------------

/**
 * Check if a value is a Signal.
 */
export const isSignal = (value: unknown): value is Signal<unknown> =>
  Predicate.hasProperty(value, SignalTypeId);

// -----------------------------------------------------------------------------
// FiberRef for pipeable configuration
// -----------------------------------------------------------------------------

/**
 * FiberRef used to pass the equals function to Signal.make via the pipeable pattern.
 * @internal
 */
const EqualsRef = FiberRef.unsafeMake<
  ((a: unknown, b: unknown) => boolean) | undefined
>(undefined);

// -----------------------------------------------------------------------------
// Constructors
// -----------------------------------------------------------------------------

/**
 * Create a new Signal with an initial value.
 *
 * @example
 * ```ts
 * // Basic usage
 * const counter = yield* Signal.make(0);
 *
 * // With custom equality (pipeable)
 * const user = yield* Signal.make({ id: 1, name: "John" }).pipe(
 *   Signal.equals((a, b) => a.id === b.id)
 * );
 * ```
 *
 * @param initial - The initial value
 */
export const make = <A>(
  initial: A,
): Effect.Effect<Signal<A>, never, Scope.Scope> =>
  Effect.gen(function* () {
    // Read equals function from FiberRef (set via Signal.equals combinator)
    const equalsFn = yield* FiberRef.get(EqualsRef);
    const equals = (equalsFn ?? ((a, b) => a === b)) as (a: A, b: A) => boolean;

    const ref = yield* SubscriptionRef.make(initial);

    // SubscriptionRef.changes emits current value on subscription, then all future changes.
    // But Readable.changes contract says "does not include current value", so we drop the first.
    const getChanges = () => Stream.drop(ref.changes, 1);

    const readable = Readable.make(SubscriptionRef.get(ref), getChanges);

    const signal: Signal<A> = {
      ...readable,
      [SignalTypeId]: SignalTypeId,
      set: (a) =>
        Effect.gen(function* () {
          const current = yield* SubscriptionRef.get(ref);
          if (!equals(current, a)) {
            yield* SubscriptionRef.set(ref, a);
          }
        }),
      update: (f) =>
        Effect.gen(function* () {
          const current = yield* SubscriptionRef.get(ref);
          const next = f(current);
          if (!equals(current, next)) {
            yield* SubscriptionRef.set(ref, next);
          }
        }),
    };

    return signal;
  });

// -----------------------------------------------------------------------------
// Combinators
// -----------------------------------------------------------------------------

/**
 * Configure a custom equality function for a Signal.
 * The equality function determines when updates are skipped (if values are "equal").
 *
 * @example
 * ```ts
 * // Compare users by id only
 * const user = yield* Signal.make({ id: 1, name: "John" }).pipe(
 *   Signal.equals((a, b) => a.id === b.id)
 * );
 *
 * // This won't trigger an update (same id)
 * yield* user.set({ id: 1, name: "Johnny" });
 * ```
 */
export const equals: {
  <A>(
    f: (a: A, b: A) => boolean,
  ): (
    self: Effect.Effect<Signal<A>, never, Scope.Scope>,
  ) => Effect.Effect<Signal<A>, never, Scope.Scope>;
  <A>(
    self: Effect.Effect<Signal<A>, never, Scope.Scope>,
    f: (a: A, b: A) => boolean,
  ): Effect.Effect<Signal<A>, never, Scope.Scope>;
} = Fn.dual(
  2,
  <A>(
    self: Effect.Effect<Signal<A>, never, Scope.Scope>,
    f: (a: A, b: A) => boolean,
  ): Effect.Effect<Signal<A>, never, Scope.Scope> =>
    Effect.locally(self, EqualsRef, f as (a: unknown, b: unknown) => boolean),
);

/**
 * Log every `set` and `update` call on a Signal at Debug level, tagged
 * under the `stax.signal` subsystem, with the call site captured at the
 * caller's frame.
 *
 * A pipeable pass-through observer — mirrors {@link Readable.debug}
 * (which covers *reads*) for the *write* side. Zero cost at the default
 * log level: the pipe reads the current minimum log level once at
 * construction, and if Debug isn't enabled it returns the underlying
 * Signal unwrapped — no proxy `set`/`update`, no `new Error()` per
 * write, no branch.
 *
 * Each emitted event carries the label, the previous value, the value
 * being written, and the stack trace at the write's call site (so you
 * can answer "where in the code did this update come from"). Source
 * maps make the stack readable in browser devtools automatically; in
 * Node, run with `--enable-source-maps`.
 *
 * @example
 * ```ts
 * const count = yield* Signal.make(0).pipe(Signal.trace("count"));
 * yield* count.set(1);
 * // Debug logs:
 * //   stax.signal  "write"  { id: "count", from: 0, to: 1, callSite: "Error\n    at ..." }
 * ```
 *
 * `update`'s reducer function runs once (to compute the value we log),
 * then the result is applied via the underlying `set` — so non-pure
 * reducers don't double-fire. Trades the atomic read-modify-write
 * semantics of `signal.update` for observability; if you need the
 * atomicity, don't pipe `trace` on that signal.
 *
 * The log-level check is captured at pipe time — a later
 * `Logger.withMinimumLogLevel` won't toggle an already-piped signal.
 * That matches how tracing is usually enabled (once, at startup) and
 * keeps the fast path branchless.
 */
export const trace =
  (id: string) =>
  <A>(
    self: Effect.Effect<Signal<A>, never, Scope.Scope>,
  ): Effect.Effect<Signal<A>, never, Scope.Scope> =>
    Effect.gen(function* () {
      const minLevel = yield* FiberRef.get(FiberRef.currentMinimumLogLevel);
      const signal = yield* self;

      // Fast path — Debug not enabled, no wrapper installed.
      if (!LogLevel.lessThanEqual(minLevel, LogLevel.Debug)) {
        return signal;
      }

      return {
        ...signal,
        set: (value) => {
          const err = new Error();
          return Effect.gen(function* () {
            const from = yield* signal.get;
            yield* logDebug("write", "stax.signal", {
              id,
              from,
              to: value,
              callSite: parseCallSite(err.stack),
            });
            yield* signal.set(value);
          });
        },
        update: (fn) => {
          const err = new Error();
          return Effect.gen(function* () {
            const from = yield* signal.get;
            const to = fn(from);
            yield* logDebug("update", "stax.signal", {
              id,
              from,
              to,
              callSite: parseCallSite(err.stack),
            });
            yield* signal.set(to);
          });
        },
      };
    });

/**
 * Use an existing Signal if provided, otherwise create a new one with the default value.
 *
 * @deprecated Use {@link controllable} instead. This helper hands the
 * consumer's Signal through unmodified, so the component writes to it
 * directly — the consumer has no veto, no transform, no notification
 * hook, and a component can mutate state it doesn't own.
 * `Signal.controllable` makes change requests go through an `onChange`
 * callback the consumer owns.
 */
export const fromNullable = <A>(
  existing: Signal<A> | undefined,
  defaultValue: A,
): Effect.Effect<Signal<A>, never, Scope.Scope> =>
  existing !== undefined ? Effect.succeed(existing) : make(defaultValue);

/**
 * Create a Signal from a reactive value (Signal, Readable, or plain value).
 *
 * @deprecated Use {@link controllable} instead. The Readable path here
 * historically read the Readable's value *once* and never followed later
 * changes — a component using this with a Readable prop looked
 * controlled but silently stopped tracking the consumer after the first
 * render. That bug is now patched (changes propagate into the returned
 * Signal), but the broader design problem remains: the Signal case
 * still hands the consumer's Signal through, so the component writes
 * directly to it with no hook for validation or notification.
 * `Signal.controllable` fixes both. This helper will be removed in a
 * future release.
 */
export const fromReactive = <A>(
  value: Signal<A> | Readable.Readable<A> | A | undefined,
  defaultValue: A,
): Effect.Effect<Signal<A>, never, Scope.Scope> =>
  Effect.gen(function* () {
    // Handle undefined - use default value
    if (value === undefined) {
      return yield* make(defaultValue);
    }

    // Check if it's a Signal (has SignalTypeId)
    if (isSignal(value)) {
      return value as Signal<A>;
    }

    // Check if it's a Readable (has ReadableTypeId but not SignalTypeId).
    // Historically this read the Readable once and never followed later
    // changes; now we subscribe so a controlled-via-Readable component
    // actually tracks the consumer. Writes to the returned Signal stay
    // local (the consumer's Readable is not written back to); the
    // consumer emitting a new value overwrites any local write with the
    // next upstream value, matching "the consumer owns the state."
    if (Readable.isReadable(value)) {
      const readable = value as Readable.Readable<A>;
      const current = yield* readable.get;
      const signal = yield* make(current ?? defaultValue);
      yield* Readable.tap(readable, (v) => signal.set(v));
      return signal;
    }

    // Otherwise, it's a plain value
    return yield* make(value as A);
  });

// -----------------------------------------------------------------------------
// Controllable (controlled/uncontrolled component pattern)
// -----------------------------------------------------------------------------

/**
 * Options for {@link controllable}.
 *
 * @template A - The value type.
 */
export interface ControllableOptions<A> {
  /**
   * If defined, the component is **controlled** — the consumer owns the
   * state. Accepts a Readable (incl. a Signal, which is used as a
   * Readable) or a plain value. If omitted, the component is
   * **uncontrolled** and the returned Signal owns its own state.
   */
  readonly value?: Readable.Reactive<A>;
  /**
   * Initial value used when `value` is omitted. Ignored in controlled
   * mode.
   */
  readonly defaultValue: A;
  /**
   * Called with the requested next value whenever the component asks
   * for a change via `.set` or `.update`. Fires in both modes — use it
   * for notification. In controlled mode, `onChange` is also how the
   * consumer learns the component wants to change state; the consumer
   * updates their own Readable in response (or declines to).
   *
   * Does **not** fire for value changes that arrive from outside — if
   * the consumer updates their Readable, the returned Signal's
   * `.changes` already emits for it; firing `onChange` on top would
   * invite feedback loops.
   */
  readonly onChange?: (next: A) => Effect.Effect<void>;
  /**
   * Same-value guard. If `equals(current, next)` is true, no `onChange`
   * fires and no write happens. Defaults to `===`.
   */
  readonly equals?: (a: A, b: A) => boolean;
}

/**
 * The controlled/uncontrolled component pattern as a Signal factory.
 *
 * - **Uncontrolled** (`value` omitted). The returned Signal owns its
 *   own state, initialised to `defaultValue`. `.set` / `.update` write
 *   to it and then fire `onChange` with the committed value.
 * - **Controlled** (`value` defined). The returned Signal's reads
 *   delegate to the consumer's Readable, so it always reflects whatever
 *   the consumer currently holds. `.set` / `.update` fire `onChange`
 *   with the requested value and otherwise do nothing — the value only
 *   changes when the consumer updates their own state in response.
 *
 * From the component author's perspective it's a Signal either way:
 * read via `.get` / `.changes` / `.values`, write via `.set` /
 * `.update`. Which of those writes stick is the consumer's call, which
 * is the whole point of the pattern.
 *
 * **Mode is fixed at construction.** Props on stax components are
 * evaluated once (unlike React's per-render props), so `value` can't
 * flip from defined to undefined later. A plain value in controlled
 * mode is legitimate — the component is read-only, pinned to that
 * value.
 *
 * **Writes are serialized.** A one-permit semaphore holds across each
 * `.set` / `.update` (including the `onChange` call), so two quick
 * `update(f)` calls see the previous commit — in uncontrolled mode,
 * `update((n) => n + 1)` called twice goes 0 → 1 → 2. In controlled
 * mode "committed" is up to the consumer; if the consumer applies the
 * change asynchronously, the second `update` may still see the old
 * value. React has the same caveat.
 *
 * @example
 * ```ts
 * interface ToggleProps {
 *   readonly pressed?: Readable.Reactive<boolean>;
 *   readonly defaultPressed?: boolean;
 *   readonly onPressedChange?: (pressed: boolean) => Effect.Effect<void>;
 * }
 *
 * const Toggle = (props: ToggleProps) =>
 *   Effect.gen(function* () {
 *     const pressed = yield* Signal.controllable({
 *       value: props.pressed,
 *       defaultValue: props.defaultPressed ?? false,
 *       onChange: props.onPressedChange,
 *     });
 *     return yield* $.button(
 *       {
 *         "aria-pressed": pressed,
 *         onClick: () => pressed.update((p) => !p),
 *       },
 *       "Bold",
 *     );
 *   });
 *
 * // Uncontrolled
 * Toggle({ defaultPressed: true });
 *
 * // Controlled — the consumer owns the state
 * const bold = yield* Signal.make(false);
 * Toggle({ pressed: bold, onPressedChange: (p) => bold.set(p) });
 *
 * // Controlled, with the consumer refusing some changes
 * Toggle({
 *   pressed: bold,
 *   onPressedChange: (p) => (locked ? Effect.void : bold.set(p)),
 * });
 * ```
 */
export const controllable = <A>(
  options: ControllableOptions<A>,
): Effect.Effect<Signal<A>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const equals = options.equals ?? ((a: A, b: A) => a === b);
    const onChange = options.onChange;
    const semaphore = yield* Effect.makeSemaphore(1);

    if (options.value !== undefined) {
      // Controlled: proxy over the consumer's Readable. `.set` / `.update`
      // do NOT write to the consumer — they only fire `onChange`.
      const external = Readable.normalize(options.value);

      const request = (next: A) =>
        semaphore.withPermits(1)(
          Effect.gen(function* () {
            const current = yield* external.get;
            if (equals(current, next)) return;
            if (onChange) yield* onChange(next);
          }),
        );

      const signal: Signal<A> = {
        ...external,
        [SignalTypeId]: SignalTypeId,
        set: request,
        update: (f) =>
          semaphore.withPermits(1)(
            Effect.gen(function* () {
              const current = yield* external.get;
              const next = f(current);
              if (equals(current, next)) return;
              if (onChange) yield* onChange(next);
            }),
          ),
      };
      return signal;
    }

    // Uncontrolled: real backing SubscriptionRef. Mirrors Signal.make
    // but routes commits through onChange after writing.
    const ref = yield* SubscriptionRef.make(options.defaultValue);
    const getChanges = () => Stream.drop(ref.changes, 1);
    const readable = Readable.make(SubscriptionRef.get(ref), getChanges);

    const commit = (next: A) =>
      Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(ref);
        if (equals(current, next)) return;
        yield* SubscriptionRef.set(ref, next);
        if (onChange) yield* onChange(next);
      });

    const signal: Signal<A> = {
      ...readable,
      [SignalTypeId]: SignalTypeId,
      set: (a) => semaphore.withPermits(1)(commit(a)),
      update: (f) =>
        semaphore.withPermits(1)(
          Effect.gen(function* () {
            const current = yield* SubscriptionRef.get(ref);
            yield* commit(f(current));
          }),
        ),
    };
    return signal;
  });

/**
 * Context service for creating and managing Signals within a scope.
 */
export class SignalRegistry extends Context.Tag("stax/SignalRegistry")<
  SignalRegistry,
  {
    readonly make: <A>(
      initial: A,
    ) => Effect.Effect<Signal<A>, never, Scope.Scope>;
    readonly scoped: <A, E, R>(
      effect: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E, Exclude<R, Scope.Scope>>;
  }
>() {
  static Live = Layer.succeed(SignalRegistry, {
    make: (initial) => make(initial),
    scoped: (effect) => Effect.scoped(effect),
  });
}

// -----------------------------------------------------------------------------
// Namespace Export
// -----------------------------------------------------------------------------

export const Signal = {
  SignalTypeId,
  isSignal,
  make,
  equals,
  trace,
  controllable,
  fromNullable,
  fromReactive,
  SignalRegistry,
  /**
   * Create a reactive array with in-place mutation methods.
   * @see SignalArray
   */
  Array: SignalArray,
  /**
   * Create a reactive Map with in-place mutation methods.
   * @see SignalMap
   */
  Map: SignalMap,
  /**
   * Create a reactive Set with in-place mutation methods.
   * @see SignalSet
   */
  Set: SignalSet,
  /**
   * Create a reactive struct with fixed keys, where each key is accessible as a Signal.
   * @see SignalStruct
   */
  Struct: SignalStruct,
};

// Re-export types for convenience
export type { SignalArrayType as SignalArray };
export type { SignalMapType as SignalMap };
export type { SignalSetType as SignalSet };
export type { SignalStructType as SignalStruct };

// Re-export ReadableTypeId for reference
export { ReadableTypeId };
