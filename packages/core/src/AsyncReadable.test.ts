import { Effect, Option, Schedule, Scope } from "effect";
import { describe, expect, it } from "vitest";

import { AsyncReadable } from "./AsyncReadable.js";
import { Signal } from "./Signal.js";

const runTest = <A>(effect: Effect.Effect<A, never, Scope.Scope>): Promise<A> =>
  Effect.runPromise(Effect.scoped(effect));

// Wait for the AsyncReadable's initial (or refetch) fetch to settle.
// `make` no longer suspends its caller — the initial fetch runs in a
// forked fiber — so tests reading `value`/`error` after construction
// must first give that fiber a chance to run and flip isLoading back
// to false. Polls with a Schedule so the wait is bounded by settlement,
// not a fixed sleep.
const settle = <A, E>(ar: AsyncReadable<A, E>): Effect.Effect<void> =>
  ar.isLoading.get.pipe(
    Effect.repeat({
      while: (loading) => loading,
      schedule: Schedule.spaced("1 millis"),
    }),
    Effect.timeout("1 second"),
    Effect.asVoid,
    Effect.orDie,
  );

describe("AsyncReadable", () => {
  describe("make", () => {
    it("returns the handle synchronously without suspending on the initial fetch", () =>
      runTest(
        Effect.gen(function* () {
          let fetchStarted = false;
          let fetchCompleted = false;
          const ar = yield* AsyncReadable.make(() =>
            Effect.gen(function* () {
              fetchStarted = true;
              // Yield so the parent Effect sees the pre-settlement state
              // before we complete.
              yield* Effect.sleep(0);
              fetchCompleted = true;
              return 42;
            }),
          );

          // Handle is available immediately; fetch hasn't completed yet.
          expect(fetchCompleted).toBe(false);
          expect(yield* ar.isLoading.get).toBe(true);
          expect(Option.isNone(yield* ar.value.get)).toBe(true);

          yield* settle(ar);

          expect(fetchStarted).toBe(true);
          expect(fetchCompleted).toBe(true);
          expect(yield* ar.isLoading.get).toBe(false);
          expect(Option.getOrThrow(yield* ar.value.get)).toBe(42);
        }),
      ));

    it("should create with initial fetched value", () =>
      runTest(
        Effect.gen(function* () {
          const ar = yield* AsyncReadable.make(() => Effect.succeed(42));

          yield* settle(ar);
          const value = yield* ar.value.get;
          expect(Option.getOrThrow(value)).toBe(42);
        }),
      ));

    it("should end with isLoading false after initial fetch", () =>
      runTest(
        Effect.gen(function* () {
          const ar = yield* AsyncReadable.make(() => Effect.succeed(42));

          yield* settle(ar);
          const isLoading = yield* ar.isLoading.get;
          expect(isLoading).toBe(false);
        }),
      ));

    it("should end with no error on success", () =>
      runTest(
        Effect.gen(function* () {
          const ar = yield* AsyncReadable.make(() => Effect.succeed(42));

          yield* settle(ar);
          const error = yield* ar.error.get;
          expect(Option.isNone(error)).toBe(true);
        }),
      ));

    it("should capture errors", () =>
      runTest(
        Effect.gen(function* () {
          const ar = yield* AsyncReadable.make(() =>
            Effect.fail("fetch failed" as const),
          );

          yield* settle(ar);
          const error = yield* ar.error.get;
          expect(Option.getOrThrow(error)).toBe("fetch failed");
        }),
      ));

    it("should have no value on error", () =>
      runTest(
        Effect.gen(function* () {
          const ar = yield* AsyncReadable.make(() =>
            Effect.fail("fetch failed"),
          );

          yield* settle(ar);
          const value = yield* ar.value.get;
          expect(Option.isNone(value)).toBe(true);
        }),
      ));
  });

  describe("refetch", () => {
    it("should refetch when called", () =>
      runTest(
        Effect.gen(function* () {
          let counter = 0;
          const ar = yield* AsyncReadable.make(() =>
            Effect.sync(() => ++counter),
          );

          yield* settle(ar);
          const value1 = yield* ar.value.get;
          expect(Option.getOrThrow(value1)).toBe(1);

          yield* ar.refetch();

          const value2 = yield* ar.value.get;
          expect(Option.getOrThrow(value2)).toBe(2);
        }),
      ));

    it("should clear error on successful refetch", () =>
      runTest(
        Effect.gen(function* () {
          let shouldFail = true;
          const ar = yield* AsyncReadable.make(() =>
            shouldFail ? Effect.fail("error") : Effect.succeed(42),
          );

          yield* settle(ar);
          // Initially has error
          const error1 = yield* ar.error.get;
          expect(Option.isSome(error1)).toBe(true);

          // Fix and refetch
          shouldFail = false;
          yield* ar.refetch();

          // Error cleared, value available
          const error2 = yield* ar.error.get;
          expect(Option.isNone(error2)).toBe(true);

          const value = yield* ar.value.get;
          expect(Option.getOrThrow(value)).toBe(42);
        }),
      ));
  });

  describe("reset", () => {
    it("should reset to initial state", () =>
      runTest(
        Effect.gen(function* () {
          const ar = yield* AsyncReadable.make(() => Effect.succeed(42));

          yield* settle(ar);
          // Has value after settlement
          const value1 = yield* ar.value.get;
          expect(Option.isSome(value1)).toBe(true);

          // Reset
          yield* ar.reset();

          // All cleared
          const isLoading = yield* ar.isLoading.get;
          const value = yield* ar.value.get;
          const error = yield* ar.error.get;

          expect(isLoading).toBe(false);
          expect(Option.isNone(value)).toBe(true);
          expect(Option.isNone(error)).toBe(true);
        }),
      ));

    it("should reset error state", () =>
      runTest(
        Effect.gen(function* () {
          const ar = yield* AsyncReadable.make(() => Effect.fail("error"));

          yield* settle(ar);
          // Has error
          const error1 = yield* ar.error.get;
          expect(Option.isSome(error1)).toBe(true);

          // Reset
          yield* ar.reset();

          // Error cleared
          const error2 = yield* ar.error.get;
          expect(Option.isNone(error2)).toBe(true);
        }),
      ));
  });

  describe("promise", () => {
    it("should create from a promise", () =>
      runTest(
        Effect.gen(function* () {
          const ar = yield* AsyncReadable.promise(() => Promise.resolve(42));

          yield* settle(ar);
          const value = yield* ar.value.get;
          expect(Option.getOrThrow(value)).toBe(42);
        }),
      ));
  });

  describe("tryPromise", () => {
    it("should create from a promise with error handling", () =>
      runTest(
        Effect.gen(function* () {
          const ar = yield* AsyncReadable.tryPromise(
            () => Promise.reject(new Error("oops")),
            (e) => `caught: ${(e as Error).message}`,
          );

          yield* settle(ar);
          const error = yield* ar.error.get;
          expect(Option.getOrThrow(error)).toBe("caught: oops");
        }),
      ));
  });

  describe("fromReadable", () => {
    it("returns the handle synchronously without suspending on the initial computation", () =>
      runTest(
        Effect.gen(function* () {
          const count = yield* Signal.make(5);
          let computationCompleted = false;
          const ar = yield* AsyncReadable.fromReadable(count, (n) =>
            Effect.gen(function* () {
              yield* Effect.sleep(0);
              computationCompleted = true;
              return n * 2;
            }),
          );

          expect(computationCompleted).toBe(false);
          expect(yield* ar.isLoading.get).toBe(true);
          expect(Option.isNone(yield* ar.value.get)).toBe(true);

          yield* settle(ar);

          expect(computationCompleted).toBe(true);
          expect(Option.getOrThrow(yield* ar.value.get)).toBe(10);
        }),
      ));

    it("should compute from a readable value", () =>
      runTest(
        Effect.gen(function* () {
          const count = yield* Signal.make(5);
          const ar = yield* AsyncReadable.fromReadable(count, (n) =>
            Effect.succeed(n * 2),
          );

          yield* settle(ar);
          const value = yield* ar.value.get;
          expect(Option.getOrThrow(value)).toBe(10);
        }),
      ));

    it("should recompute when readable changes", () =>
      runTest(
        Effect.gen(function* () {
          const count = yield* Signal.make(5);
          const ar = yield* AsyncReadable.fromReadable(count, (n) =>
            Effect.succeed(n * 2),
          );

          yield* settle(ar);
          // Initial value
          const value1 = yield* ar.value.get;
          expect(Option.getOrThrow(value1)).toBe(10);

          // Update and wait for recomputation
          yield* count.set(10);
          yield* Effect.sleep(10);

          const value2 = yield* ar.value.get;
          expect(Option.getOrThrow(value2)).toBe(20);
        }),
      ));

    it("should work with pipeable syntax", () =>
      runTest(
        Effect.gen(function* () {
          const count = yield* Signal.make(5);
          const ar = yield* count.pipe(
            AsyncReadable.fromReadable((n) => Effect.succeed(n * 2)),
          );

          yield* settle(ar);
          const value = yield* ar.value.get;
          expect(Option.getOrThrow(value)).toBe(10);
        }),
      ));

    it("should capture errors from computation", () =>
      runTest(
        Effect.gen(function* () {
          const shouldFail = yield* Signal.make(true);
          const ar = yield* AsyncReadable.fromReadable(shouldFail, (fail) =>
            fail ? Effect.fail("computation failed") : Effect.succeed(42),
          );

          yield* settle(ar);
          const error = yield* ar.error.get;
          expect(Option.getOrThrow(error)).toBe("computation failed");
        }),
      ));

    it("should clear error on successful recomputation", () =>
      runTest(
        Effect.gen(function* () {
          const shouldFail = yield* Signal.make(true);
          const ar = yield* AsyncReadable.fromReadable(shouldFail, (fail) =>
            fail ? Effect.fail("error") : Effect.succeed(42),
          );

          yield* settle(ar);
          // Initially has error
          const error1 = yield* ar.error.get;
          expect(Option.isSome(error1)).toBe(true);

          // Fix and trigger recomputation
          yield* shouldFail.set(false);
          yield* Effect.sleep(10);

          // Error cleared, value available
          const error2 = yield* ar.error.get;
          expect(Option.isNone(error2)).toBe(true);

          const value = yield* ar.value.get;
          expect(Option.getOrThrow(value)).toBe(42);
        }),
      ));
  });

  describe("map", () => {
    it("should map the successful value", () =>
      runTest(
        Effect.gen(function* () {
          const ar = yield* AsyncReadable.make(() =>
            Effect.succeed({ name: "Alice", age: 30 }),
          );
          const mapped = ar.pipe(AsyncReadable.map((user) => user.name));

          yield* settle(ar);
          const value = yield* mapped.value.get;
          expect(Option.getOrThrow(value)).toBe("Alice");
        }),
      ));

    it("should preserve isLoading state after settlement", () =>
      runTest(
        Effect.gen(function* () {
          const ar = yield* AsyncReadable.make(() => Effect.succeed(42));
          const mapped = ar.pipe(AsyncReadable.map((n) => n * 2));

          yield* settle(ar);
          const isLoading = yield* mapped.isLoading.get;
          expect(isLoading).toBe(false);
        }),
      ));

    it("should preserve error state", () =>
      runTest(
        Effect.gen(function* () {
          const ar = yield* AsyncReadable.make(() =>
            Effect.fail("error" as const),
          );
          const mapped = ar.pipe(AsyncReadable.map((n: number) => n * 2));

          yield* settle(ar);
          const error = yield* mapped.error.get;
          expect(Option.getOrThrow(error)).toBe("error");
        }),
      ));

    it("should delegate refetch to source", () =>
      runTest(
        Effect.gen(function* () {
          let counter = 0;
          const ar = yield* AsyncReadable.make(() =>
            Effect.sync(() => ++counter),
          );
          const mapped = ar.pipe(AsyncReadable.map((n) => n * 10));

          yield* settle(ar);
          const value1 = yield* mapped.value.get;
          expect(Option.getOrThrow(value1)).toBe(10);

          yield* mapped.refetch();

          const value2 = yield* mapped.value.get;
          expect(Option.getOrThrow(value2)).toBe(20);
        }),
      ));
  });

  describe("type guard", () => {
    it("should identify AsyncReadable instances", () =>
      runTest(
        Effect.gen(function* () {
          const ar = yield* AsyncReadable.make(() => Effect.succeed(42));
          const signal = yield* Signal.make(42);

          expect(AsyncReadable.isAsyncReadable(ar)).toBe(true);
          expect(AsyncReadable.isAsyncReadable(signal)).toBe(false);
          expect(AsyncReadable.isAsyncReadable({})).toBe(false);
          expect(AsyncReadable.isAsyncReadable(null)).toBe(false);
        }),
      ));
  });
});
