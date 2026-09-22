import {
  Effect,
  Either,
  Option,
  Pipeable,
  Predicate,
  Scope,
  Stream,
} from "effect";

import { Readable } from "./Readable.js";
import { make as makeSignal } from "./Signal.js";

// -----------------------------------------------------------------------------
// TypeId
// -----------------------------------------------------------------------------

export const AsyncReadableTypeId: unique symbol =
  Symbol.for("stax/AsyncReadable");
export type AsyncReadableTypeId = typeof AsyncReadableTypeId;

// -----------------------------------------------------------------------------
// Type Guards
// -----------------------------------------------------------------------------

/**
 * Check if a value is an AsyncReadable.
 */
export const isAsyncReadable = (
  value: unknown,
): value is AsyncReadable<unknown, unknown> =>
  Predicate.hasProperty(value, AsyncReadableTypeId);

// -----------------------------------------------------------------------------
// Models
// -----------------------------------------------------------------------------

/**
 * A reactive async state container that tracks loading, value, and error states.
 * Useful for managing async operations like data fetching.
 *
 * @template A - The type of the successful value
 * @template E - The type of the error
 *
 * @example
 * ```ts
 * const userData = yield* AsyncReadable.make(() =>
 *   Effect.gen(function* () {
 *     const response = yield* fetchUser(userId)
 *     return response.data
 *   })
 * )
 *
 * // Reactive state properties
 * userData.isLoading  // Readable<boolean>
 * userData.value      // Readable<Option<User>>
 * userData.error      // Readable<Option<E>>
 *
 * // Manually trigger refetch
 * yield* userData.refetch()
 *
 * // Reset to initial state
 * yield* userData.reset()
 * ```
 */
export interface AsyncReadable<A, E = never> extends Pipeable.Pipeable {
  readonly [AsyncReadableTypeId]: AsyncReadableTypeId;

  /**
   * Whether a fetch is currently in progress.
   */
  readonly isLoading: Readable.Readable<boolean>;

  /**
   * The most recent successful value, if any.
   */
  readonly value: Readable.Readable<Option.Option<A>>;

  /**
   * The most recent error, if any.
   */
  readonly error: Readable.Readable<Option.Option<E>>;

  /**
   * Manually trigger a refetch.
   */
  readonly refetch: () => Effect.Effect<void>;

  /**
   * Reset to initial state: isLoading=false, value=None, error=None.
   */
  readonly reset: () => Effect.Effect<void>;
}

// -----------------------------------------------------------------------------
// Constructors
// -----------------------------------------------------------------------------

/**
 * Create an AsyncReadable from an Effect-returning fetch function.
 * Returns the handle synchronously; the initial fetch runs in the
 * background under the caller's scope.
 *
 * On construction the handle reads `isLoading = true`, `value = None`,
 * `error = None`. When the fetch settles, `isLoading` flips to `false`
 * and either `value` or `error` fills in. Consumers can subscribe to
 * `isLoading` for a loading indicator or wrap the whole thing in
 * `Boundary.suspense` when a blocking UX is wanted — the split between
 * "observable loading" and "suspending" is deliberate.
 *
 * @param fetch - Effect-returning function to fetch the value
 *
 * @example
 * ```ts
 * const userData = yield* AsyncReadable.make(() =>
 *   Effect.gen(function* () {
 *     const response = yield* fetchUser(userId)
 *     return response.data
 *   })
 * )
 * ```
 */
export const make = <A, E = never, R = never>(
  fetch: () => Effect.Effect<A, E, R>,
): Effect.Effect<AsyncReadable<A, E>, never, Scope.Scope | R> =>
  Effect.gen(function* () {
    const isLoadingSignal = yield* makeSignal(false);
    const valueSignal = yield* makeSignal<Option.Option<A>>(Option.none());
    const errorSignal = yield* makeSignal<Option.Option<E>>(Option.none());

    const runFetch = (): Effect.Effect<void, never, R> =>
      Effect.gen(function* () {
        yield* isLoadingSignal.set(true);
        yield* errorSignal.set(Option.none());

        const result = yield* fetch().pipe(Effect.either);

        if (Either.isRight(result)) {
          yield* valueSignal.set(Option.some(result.right));
        } else {
          yield* errorSignal.set(Option.some(result.left));
        }

        yield* isLoadingSignal.set(false);
      });

    // Flip isLoading synchronously in the outer scope so consumers
    // reading it on the very next line (or in a subscribe callback
    // wired up right after make() returns) see the loading state.
    // Without this, there's a small window between make() returning
    // and the forked fetch's first line running where isLoading is
    // still its initial false — long enough for a first render to
    // miss the loading UI.
    yield* isLoadingSignal.set(true);

    // Kick off the initial fetch in the background — do NOT suspend
    // the caller. Suspending would block the component tree above the
    // creator until the request settles, which (a) makes `isLoading`
    // unobservable on first load and (b) can silently desync sibling
    // animation gates (see docs/STAX-ASYNCREADABLE-SUSPEND.md). Use
    // Boundary.suspense at the call site when a blocking UX is wanted.
    yield* Effect.forkScoped(runFetch());

    const resetEffect = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* isLoadingSignal.set(false);
        yield* valueSignal.set(Option.none());
        yield* errorSignal.set(Option.none());
      });

    const asyncReadable: AsyncReadable<A, E> = {
      [AsyncReadableTypeId]: AsyncReadableTypeId,

      pipe() {
        return Pipeable.pipeArguments(this, arguments);
      },

      isLoading: isLoadingSignal,
      value: valueSignal,
      error: errorSignal,
      refetch: () => runFetch() as Effect.Effect<void>,
      reset: resetEffect,
    };

    return asyncReadable;
  });

/**
 * Create an AsyncReadable from a Promise-returning function.
 *
 * @param fetch - Function that returns a Promise
 *
 * @example
 * ```ts
 * const userData = yield* AsyncReadable.promise(() =>
 *   fetch('/api/user').then(r => r.json())
 * )
 * ```
 */
export const promise = <A>(
  fetch: () => Promise<A>,
): Effect.Effect<AsyncReadable<A, never>, never, Scope.Scope> =>
  make(() => Effect.promise(fetch));

/**
 * Create an AsyncReadable from a Promise-returning function with error handling.
 *
 * @param fetch - Function that returns a Promise
 * @param onError - Function to transform caught errors
 *
 * @example
 * ```ts
 * const userData = yield* AsyncReadable.tryPromise(
 *   () => fetch('/api/user').then(r => r.json()),
 *   (error) => new FetchError(error)
 * )
 * ```
 */
export const tryPromise = <A, E>(
  fetch: () => Promise<A>,
  onError: (error: unknown) => E,
): Effect.Effect<AsyncReadable<A, E>, never, Scope.Scope> =>
  make(() => Effect.tryPromise({ try: fetch, catch: onError }));

/**
 * Create an AsyncReadable that recomputes when a source Readable changes.
 * Similar to a derived async value.
 *
 * @param f - Function that takes the current value and returns an Effect
 *
 * @example
 * ```ts
 * const userId = yield* Signal.make(1)
 * const userData = yield* userId.pipe(
 *   AsyncReadable.fromReadable((id) =>
 *     Effect.gen(function* () {
 *       const response = yield* fetchUser(id)
 *       return response.data
 *     })
 *   )
 * )
 * ```
 */
export const fromReadable: {
  <A, B, E, R>(
    f: (a: A) => Effect.Effect<B, E, R>,
  ): (
    self: Readable.Readable<A>,
  ) => Effect.Effect<AsyncReadable<B, E>, never, Scope.Scope | R>;
  <A, B, E, R>(
    self: Readable.Readable<A>,
    f: (a: A) => Effect.Effect<B, E, R>,
  ): Effect.Effect<AsyncReadable<B, E>, never, Scope.Scope | R>;
} = <A, B, E, R>(
  ...args:
    | [f: (a: A) => Effect.Effect<B, E, R>]
    | [self: Readable.Readable<A>, f: (a: A) => Effect.Effect<B, E, R>]
): any => {
  if (args.length === 1) {
    const [f] = args;
    return (self: Readable.Readable<A>) => fromReadableImpl(self, f);
  }
  const [self, f] = args;
  return fromReadableImpl(self, f);
};

const fromReadableImpl = <A, B, E, R>(
  self: Readable.Readable<A>,
  f: (a: A) => Effect.Effect<B, E, R>,
): Effect.Effect<AsyncReadable<B, E>, never, Scope.Scope | R> =>
  Effect.gen(function* () {
    const isLoadingSignal = yield* makeSignal(false);
    const valueSignal = yield* makeSignal<Option.Option<B>>(Option.none());
    const errorSignal = yield* makeSignal<Option.Option<E>>(Option.none());

    const scope = yield* Effect.scope;

    const runComputation = (input: A): Effect.Effect<void, never, R> =>
      Effect.gen(function* () {
        yield* isLoadingSignal.set(true);
        yield* errorSignal.set(Option.none());

        const result = yield* f(input).pipe(Effect.either);

        if (Either.isRight(result)) {
          yield* valueSignal.set(Option.some(result.right));
        } else {
          yield* errorSignal.set(Option.some(result.left));
        }

        yield* isLoadingSignal.set(false);
      });

    // Kick off the initial computation in the background — same
    // rationale as `make`: never suspend the caller on the first
    // computation. `isLoading` is observable from the moment the
    // handle is returned (flipped synchronously below, before the
    // fork's first line has a chance to run).
    const initialValue = yield* self.get;
    yield* isLoadingSignal.set(true);
    yield* Effect.forkScoped(runComputation(initialValue));

    // Subscribe to changes and recompute
    const changesStream = self.changes.pipe(
      Stream.flatMap(
        (value) => Stream.fromEffect(runComputation(value)),
        { switch: true }, // Cancel in-flight on new values
      ),
    );

    // Fork the stream processing to run in background
    yield* Stream.runDrain(changesStream).pipe(Effect.forkIn(scope));

    // Give the forked fiber time to start and establish its subscription
    yield* Effect.sleep(0);

    const refetchEffect = (): Effect.Effect<void, never, R> =>
      Effect.gen(function* () {
        const currentValue = yield* self.get;
        yield* runComputation(currentValue);
      });

    const resetEffect = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* isLoadingSignal.set(false);
        yield* valueSignal.set(Option.none());
        yield* errorSignal.set(Option.none());
      });

    const asyncReadable: AsyncReadable<B, E> = {
      [AsyncReadableTypeId]: AsyncReadableTypeId,

      pipe() {
        return Pipeable.pipeArguments(this, arguments);
      },

      isLoading: isLoadingSignal,
      value: valueSignal,
      error: errorSignal,
      refetch: () => refetchEffect() as Effect.Effect<void>,
      reset: resetEffect,
    };

    return asyncReadable;
  });

/**
 * Map the successful value of an AsyncReadable.
 *
 * @param f - Function to transform the value
 *
 * @example
 * ```ts
 * const userData = yield* AsyncReadable.make(fetchUser)
 * const userName = userData.pipe(AsyncReadable.map(user => user.name))
 * ```
 */
export const map: {
  <A, B>(f: (a: A) => B): <E>(self: AsyncReadable<A, E>) => AsyncReadable<B, E>;
  <A, E, B>(self: AsyncReadable<A, E>, f: (a: A) => B): AsyncReadable<B, E>;
} = <A, B, E>(
  ...args: [f: (a: A) => B] | [self: AsyncReadable<A, E>, f: (a: A) => B]
): any => {
  if (args.length === 1) {
    const [f] = args;
    return (self: AsyncReadable<A, E>) => mapImpl(self, f);
  }
  const [self, f] = args;
  return mapImpl(self, f);
};

const mapImpl = <A, E, B>(
  self: AsyncReadable<A, E>,
  f: (a: A) => B,
): AsyncReadable<B, E> => {
  const mappedValue = self.value.pipe(
    Readable.map((opt) => Option.map(opt, f)),
  );

  return {
    [AsyncReadableTypeId]: AsyncReadableTypeId,

    pipe() {
      return Pipeable.pipeArguments(this, arguments);
    },

    isLoading: self.isLoading,
    value: mappedValue,
    error: self.error,
    refetch: self.refetch,
    reset: self.reset,
  };
};

// -----------------------------------------------------------------------------
// Namespace
// -----------------------------------------------------------------------------

/**
 * AsyncReadable namespace.
 */
export const AsyncReadable = {
  AsyncReadableTypeId,
  isAsyncReadable,
  make,
  promise,
  tryPromise,
  fromReadable,
  map,
};
