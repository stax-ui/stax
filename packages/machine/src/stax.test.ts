/**
 * Tests for the Stax Readable adapters. Builds a Counter machine
 * (same shape as runtime.test.ts's) and verifies each factory
 * threads the machine's current value into `.get`, the subscription
 * surface into `.values` / `.changes`, and the dedupe behavior
 * where it applies.
 */

import { Chunk, Effect, Exit, Scope, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { Machine, type MachineHandle } from "./index.js";
import { MachineReadable } from "./stax.js";

interface CounterStates {
  idle: {};
  frozen: {};
}
interface CounterEvents {
  INC: {};
  DEC: {};
  FREEZE: {};
  UNFREEZE: {};
  RESET: {};
}
interface CounterContext {
  count: number;
}
interface CounterOutput {
  count: number;
  isFrozen: boolean;
}

class Counter extends Machine.Service<
  Counter,
  CounterStates,
  CounterEvents,
  CounterContext,
  CounterOutput,
  never
>()("Counter") {}

const CounterLayer = Machine.serviceLayer(
  Counter,
  Effect.succeed({
    initial: "idle" as const,
    context: { count: 0 },
    output: (ctx: CounterContext) => ({
      count: ctx.count,
      isFrozen: false,
    }),
    on: {
      RESET: (self) =>
        Effect.gen(function* () {
          yield* self.assign({ count: 0 });
          return self.transition("idle");
        }),
    },
    states: {
      idle: (self) =>
        Effect.succeed({
          INC: () => self.assign((ctx) => ({ count: ctx.count + 1 })),
          DEC: () => self.assign((ctx) => ({ count: ctx.count - 1 })),
          FREEZE: () => Effect.succeed(self.transition("frozen")),
        }),
      frozen: (self) =>
        Effect.succeed({
          UNFREEZE: () => Effect.succeed(self.transition("idle")),
        }),
    },
  }),
);

const runScoped = <A>(
  effect: Effect.Effect<A, unknown, Scope.Scope>,
): Promise<A> => Effect.runPromise(Effect.scoped(effect.pipe(Effect.orDie)));

const withCounter = <A>(
  fn: (
    counter: MachineHandle<CounterStates, CounterEvents, CounterOutput>,
  ) => Effect.Effect<A, unknown, Scope.Scope>,
): Promise<A> =>
  runScoped(
    Effect.gen(function* () {
      const counter = yield* Counter;
      return yield* fn(counter);
    }).pipe(Effect.provide(CounterLayer)),
  );

describe("MachineReadable", () => {
  describe("output", () => {
    it("`.get` reflects the current snapshot", () =>
      withCounter((counter) =>
        Effect.gen(function* () {
          const output = MachineReadable.output(counter);
          expect(yield* output.get).toEqual({ count: 0, isFrozen: false });

          yield* counter.dispatch("INC");
          yield* counter.dispatch("INC");
          expect(yield* output.get).toEqual({ count: 2, isFrozen: false });
        }),
      ));

    it("`.values` stream emits the current value, then each change", () =>
      withCounter((counter) =>
        Effect.gen(function* () {
          const output = MachineReadable.output(counter);
          const fiber = yield* Effect.fork(
            output.values.pipe(Stream.take(3), Stream.runCollect),
          );
          // Give the fork time to subscribe before we dispatch; the
          // Readable.test.ts pattern uses the same sleep.
          yield* Effect.sleep("10 millis");

          yield* counter.dispatch("INC");
          yield* counter.dispatch("INC");

          const chunk = yield* fiber.await;
          expect(Exit.isSuccess(chunk)).toBe(true);
          if (Exit.isSuccess(chunk)) {
            expect(Chunk.toArray(chunk.value).map((o) => o.count)).toEqual([
              0, 1, 2,
            ]);
          }
        }),
      ));
  });

  describe("field", () => {
    it("tracks one field of the output", () =>
      withCounter((counter) =>
        Effect.gen(function* () {
          const count = MachineReadable.field(counter, "count");
          expect(yield* count.get).toBe(0);

          const fiber = yield* Effect.fork(
            count.changes.pipe(Stream.take(2), Stream.runCollect),
          );
          yield* Effect.sleep("10 millis");

          yield* counter.dispatch("INC");
          yield* counter.dispatch("INC");

          const chunk = yield* fiber.await;
          if (Exit.isSuccess(chunk)) {
            expect(Chunk.toArray(chunk.value)).toEqual([1, 2]);
          }
        }),
      ));
  });

  describe("state", () => {
    it("emits each transition's state name", () =>
      withCounter((counter) =>
        Effect.gen(function* () {
          const state = MachineReadable.state(counter);
          expect(yield* state.get).toBe("idle");

          const fiber = yield* Effect.fork(
            state.changes.pipe(Stream.take(2), Stream.runCollect),
          );
          yield* Effect.sleep("10 millis");

          yield* counter.dispatch("FREEZE");
          yield* counter.dispatch("UNFREEZE");

          const chunk = yield* fiber.await;
          if (Exit.isSuccess(chunk)) {
            expect(Chunk.toArray(chunk.value)).toEqual(["frozen", "idle"]);
          }
        }),
      ));
  });

  describe("inState", () => {
    it("`.get` reflects the current predicate", () =>
      withCounter((counter) =>
        Effect.gen(function* () {
          const frozen = MachineReadable.inState(counter, "frozen");
          expect(yield* frozen.get).toBe(false);

          yield* counter.dispatch("FREEZE");
          expect(yield* frozen.get).toBe(true);
        }),
      ));

    it("dedupes — a transition that doesn't change the predicate emits nothing", () =>
      withCounter((counter) =>
        Effect.gen(function* () {
          // Transition idle → frozen → idle → frozen. For
          // `inState("frozen")` that's false→true→false→true.
          const frozen = MachineReadable.inState(counter, "frozen");
          const fiber = yield* Effect.fork(
            frozen.changes.pipe(Stream.take(3), Stream.runCollect),
          );
          yield* Effect.sleep("10 millis");

          yield* counter.dispatch("FREEZE"); // → true
          yield* counter.dispatch("UNFREEZE"); // → false
          yield* counter.dispatch("FREEZE"); // → true

          const chunk = yield* fiber.await;
          if (Exit.isSuccess(chunk)) {
            expect(Chunk.toArray(chunk.value)).toEqual([true, false, true]);
          }
        }),
      ));
  });

  describe("canDispatch", () => {
    it("tracks whether the event is handleable right now", () =>
      withCounter((counter) =>
        Effect.gen(function* () {
          const canInc = MachineReadable.canDispatch(counter, "INC");
          expect(yield* canInc.get).toBe(true);

          const fiber = yield* Effect.fork(
            canInc.changes.pipe(Stream.take(2), Stream.runCollect),
          );
          yield* Effect.sleep("10 millis");

          yield* counter.dispatch("FREEZE"); // INC no longer handleable
          yield* counter.dispatch("UNFREEZE"); // INC handleable again

          const chunk = yield* fiber.await;
          if (Exit.isSuccess(chunk)) {
            expect(Chunk.toArray(chunk.value)).toEqual([false, true]);
          }
        }),
      ));

    it("includes global `on:` events — RESET is always handleable", () =>
      withCounter((counter) =>
        Effect.gen(function* () {
          const canReset = MachineReadable.canDispatch(counter, "RESET");
          expect(yield* canReset.get).toBe(true);
          yield* counter.dispatch("FREEZE");
          expect(yield* canReset.get).toBe(true);
        }),
      ));
  });

  describe("availableEvents", () => {
    it("reports the union of per-state + global `on:` events", () =>
      withCounter((counter) =>
        Effect.gen(function* () {
          const events = MachineReadable.availableEvents(counter);
          const idleEvents = [...(yield* events.get)].sort();
          expect(idleEvents).toEqual(["DEC", "FREEZE", "INC", "RESET"]);

          yield* counter.dispatch("FREEZE");
          const frozenEvents = [...(yield* events.get)].sort();
          expect(frozenEvents).toEqual(["RESET", "UNFREEZE"]);
        }),
      ));
  });
});
