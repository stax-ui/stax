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
import { Optic as SignalOptic } from "./SignalOptic.js";
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
 * This enables the controlled/uncontrolled component pattern.
 *
 * @param existing - An optional Signal to use if provided
 * @param defaultValue - The default value to use when creating a new Signal
 *
 * @example
 * ```ts
 * // In a component that supports both controlled and uncontrolled modes:
 * const value = yield* Signal.fromNullable(props.value, props.defaultValue ?? "");
 *
 * // If props.value is a Signal, it will be used directly
 * // If props.value is undefined, a new Signal is created with defaultValue
 *
 * // With custom equality:
 * const value = yield* Signal.fromNullable(props.value, defaultUser).pipe(
 *   Signal.equals((a, b) => a.id === b.id)
 * );
 * ```
 */
export const fromNullable = <A>(
  existing: Signal<A> | undefined,
  defaultValue: A,
): Effect.Effect<Signal<A>, never, Scope.Scope> =>
  existing !== undefined ? Effect.succeed(existing) : make(defaultValue);

/**
 * Create a Signal from a reactive value (Signal, Readable, or plain value).
 *
 * - If input is already a Signal, returns it as-is
 * - If input is a Readable, creates a new Signal initialized with the Readable's current value
 * - If input is a plain value, creates a new Signal with that value
 *
 * This is useful for controlled/uncontrolled component patterns where a prop
 * can be either a Signal (controlled), a Readable, or a plain value (uncontrolled).
 *
 * @param value - A Signal, Readable, or plain value
 * @param defaultValue - Default value to use if the input value is undefined
 *
 * @example
 * ```ts
 * // In a component that accepts flexible input:
 * interface CheckboxProps {
 *   checked?: Signal<boolean> | Readable<boolean> | boolean;
 *   defaultChecked?: boolean;
 * }
 *
 * const Checkbox = (props: CheckboxProps) =>
 *   Effect.gen(function* () {
 *     // Works with Signal (controlled), Readable, or boolean (uncontrolled)
 *     const checked = yield* Signal.fromReactive(
 *       props.checked,
 *       props.defaultChecked ?? false
 *     );
 *
 *     // With custom equality:
 *     const user = yield* Signal.fromReactive(props.user, defaultUser).pipe(
 *       Signal.equals((a, b) => a.id === b.id)
 *     );
 *   });
 * ```
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

    // Check if it's a Readable (has ReadableTypeId but not SignalTypeId)
    if (Readable.isReadable(value)) {
      const currentValue = yield* (value as Readable.Readable<A>).get;
      return yield* make(currentValue ?? defaultValue);
    }

    // Otherwise, it's a plain value
    return yield* make(value as A);
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
  /**
   * Lens-projected root over a deeply nested value. Hands out
   * fine-grained `Readable`s for arbitrary sub-paths and routes all
   * writes through `Signal.Optic.set` / `Signal.Optic.update`.
   * @see SignalOptic
   */
  Optic: SignalOptic,
};

// Re-export types for convenience
export type { SignalArrayType as SignalArray };
export type { SignalMapType as SignalMap };
export type { SignalSetType as SignalSet };
export type { SignalStructType as SignalStruct };

// Re-export ReadableTypeId for reference
export { ReadableTypeId };
