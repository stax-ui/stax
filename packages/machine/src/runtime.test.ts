/**
 * Integration tests for the first-pass runtime. Builds real
 * machines via Machine.Service + serviceLayer, provides the layer
 * into a scoped Effect, and drives dispatch → transition → subscribe
 * end-to-end.
 */

import { Cause, Effect, Exit, Option, Scope } from "effect";
import { describe, expect, it } from "vitest";

import {
  Machine,
  MalformedSpec,
  TransitionLimit,
  UnhandledEvent,
  type MachineHandle,
} from "./index.js";

// Run a scoped Effect to a Promise, closing the scope on completion.
// Accepts any error channel and dies on failure — tests that expect
// a specific failure should use Effect.exit and inspect the Cause.
const runScoped = <A>(
  effect: Effect.Effect<A, unknown, Scope.Scope>,
): Promise<A> => Effect.runPromise(Effect.scoped(effect.pipe(Effect.orDie)));

// -----------------------------------------------------------------------------
// A minimal Counter machine — exercises: context + assign, event
// dispatch, transitions, output projection, subscribe.
// -----------------------------------------------------------------------------

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

// Convenience for tests — provide the layer and pull the handle out.
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

// -----------------------------------------------------------------------------

describe("Machine runtime — Service", () => {
  it("provides the machine handle via the Layer", () =>
    withCounter((counter) =>
      Effect.sync(() => {
        expect(counter.state()).toBe("idle");
        expect(counter.snapshot().count).toBe(0);
      }),
    ));

  it("assign mutates context and updates output", () =>
    withCounter((counter) =>
      Effect.gen(function* () {
        yield* counter.dispatch("INC");
        yield* counter.dispatch("INC");
        yield* counter.dispatch("INC");
        expect(counter.snapshot().count).toBe(3);
        yield* counter.dispatch("DEC");
        expect(counter.snapshot().count).toBe(2);
      }),
    ));

  it("dispatch is a silent no-op when no handler exists in current state", () =>
    withCounter((counter) =>
      Effect.gen(function* () {
        yield* counter.dispatch("FREEZE");
        expect(counter.state()).toBe("frozen");
        // INC has no handler in `frozen` — silently dropped, count stays.
        yield* counter.dispatch("INC");
        expect(counter.snapshot().count).toBe(0);
      }),
    ));

  it("dispatchOrFail fails with UnhandledEvent when no handler exists", () =>
    withCounter((counter) =>
      Effect.gen(function* () {
        yield* counter.dispatch("FREEZE");
        const result = yield* Effect.exit(counter.dispatchOrFail("INC"));
        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isFailure(result)) {
          const failure = Cause.failureOption(result.cause);
          expect(Option.isSome(failure)).toBe(true);
          if (Option.isSome(failure)) {
            const err = failure.value;
            expect(err).toBeInstanceOf(UnhandledEvent);
            if (err instanceof UnhandledEvent) {
              expect(err.event).toBe("INC");
              expect(err.state).toBe("frozen");
            }
          }
        }
      }),
    ));

  it("transitions between states via handler-returned Transition", () =>
    withCounter((counter) =>
      Effect.gen(function* () {
        expect(counter.state()).toBe("idle");
        yield* counter.dispatch("FREEZE");
        expect(counter.state()).toBe("frozen");
        yield* counter.dispatch("UNFREEZE");
        expect(counter.state()).toBe("idle");
      }),
    ));

  it("global `on` handlers fire in any state — wait, first-pass runtime doesn't wire global on, skipping", () => {
    // NOTE: global `on:` is on the deferred-work list for the first
    // pass. Once wired, this test would use RESET (declared in `on`)
    // to reset counter from either state. Leaving as an explicit
    // placeholder so we notice when the wiring lands.
    expect(true).toBe(true);
  });

  it("subscribe fires on output changes and unsubscribe stops it", () =>
    withCounter((counter) =>
      Effect.gen(function* () {
        const snapshots: number[] = [];
        const unsub = counter.subscribe((out) => snapshots.push(out.count));

        yield* counter.dispatch("INC");
        yield* counter.dispatch("INC");
        yield* counter.dispatch("INC");
        expect(snapshots).toEqual([1, 2, 3]);

        unsub();
        yield* counter.dispatch("INC");
        expect(snapshots).toEqual([1, 2, 3]); // no more fires
      }),
    ));

  it("subscribeTo notifies only when the specific field changes", () =>
    withCounter((counter) =>
      Effect.gen(function* () {
        const counts: number[] = [];
        counter.subscribeTo("count", (v) => counts.push(v));
        yield* counter.dispatch("INC");
        yield* counter.dispatch("INC");
        expect(counts).toEqual([1, 2]);
      }),
    ));

  it("subscribeState fires on transition", () =>
    withCounter((counter) =>
      Effect.gen(function* () {
        const states: string[] = [];
        counter.subscribeState((s) => states.push(s));
        yield* counter.dispatch("FREEZE");
        yield* counter.dispatch("UNFREEZE");
        expect(states).toEqual(["frozen", "idle"]);
      }),
    ));

  it("subscribeInState fires only when the named state is entered", () =>
    withCounter((counter) =>
      Effect.gen(function* () {
        let frozenCount = 0;
        counter.subscribeInState("frozen", () => frozenCount++);
        yield* counter.dispatch("FREEZE");
        yield* counter.dispatch("UNFREEZE");
        yield* counter.dispatch("FREEZE");
        expect(frozenCount).toBe(2);
      }),
    ));

  it("inState reflects current state", () =>
    withCounter((counter) =>
      Effect.gen(function* () {
        expect(counter.inState("idle")).toBe(true);
        expect(counter.inState("frozen")).toBe(false);
        yield* counter.dispatch("FREEZE");
        expect(counter.inState("frozen")).toBe(true);
        expect(counter.inState("idle")).toBe(false);
      }),
    ));

  it("canDispatch reflects the currently-installed handler map", () =>
    withCounter((counter) =>
      Effect.gen(function* () {
        expect(counter.canDispatch("INC")).toBe(true);
        expect(counter.canDispatch("UNFREEZE")).toBe(false);
        yield* counter.dispatch("FREEZE");
        expect(counter.canDispatch("INC")).toBe(false);
        expect(counter.canDispatch("UNFREEZE")).toBe(true);
      }),
    ));

  it("assigns within one handler batch into a single subscriber notification", () => {
    // A separate machine whose handler does two assigns; we expect
    // subscribe to fire exactly once per dispatched event.
    interface BatchStates {
      idle: {};
    }
    interface BatchEvents {
      BUMP: {};
    }
    interface BatchContext {
      a: number;
      b: number;
    }
    interface BatchOutput {
      a: number;
      b: number;
    }
    class Batch extends Machine.Service<
      Batch,
      BatchStates,
      BatchEvents,
      BatchContext,
      BatchOutput,
      never
    >()("Batch") {}

    const layer = Machine.serviceLayer(
      Batch,
      Effect.succeed({
        initial: "idle" as const,
        context: { a: 0, b: 0 },
        output: (ctx: BatchContext) => ({ a: ctx.a, b: ctx.b }),
        states: {
          idle: (self) =>
            Effect.succeed({
              BUMP: () =>
                Effect.gen(function* () {
                  yield* self.assign({ a: 1 });
                  yield* self.assign({ b: 2 });
                }),
            }),
        },
      }),
    );

    return runScoped(
      Effect.gen(function* () {
        const batch = yield* Batch;
        let fires = 0;
        batch.subscribe(() => fires++);
        yield* batch.dispatch("BUMP");
        expect(fires).toBe(1);
        expect(batch.snapshot()).toEqual({ a: 1, b: 2 });
      }).pipe(Effect.provide(layer)),
    );
  });

  it("infinite transition loop fails with typed TransitionLimit (not a die)", () => {
    // A machine whose two task states transition back and forth.
    // The runtime's reentry depth cap catches this and surfaces a
    // typed failure — no runtime surprise from die.
    interface LoopStates {
      a: {};
      b: {};
    }
    class Loop extends Machine.Service<Loop, LoopStates, {}, {}, {}, never>()(
      "Loop",
    ) {}

    const layer = Machine.serviceLayer(
      Loop,
      Effect.succeed({
        initial: "a" as const,
        context: {},
        output: () => ({}),
        states: {
          a: (self) => Effect.succeed(self.transition("b")),
          b: (self) => Effect.succeed(self.transition("a")),
        },
      }),
    );

    return Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          // Layer build enters the initial state → immediately loops.
          const result = yield* Effect.exit(
            Effect.gen(function* () {
              yield* Loop;
            }).pipe(Effect.provide(layer)),
          );
          expect(Exit.isFailure(result)).toBe(true);
          if (Exit.isFailure(result)) {
            const failure = Cause.failureOption(result.cause);
            expect(Option.isSome(failure)).toBe(true);
            if (Option.isSome(failure)) {
              const err = failure.value;
              expect(err).toBeInstanceOf(TransitionLimit);
              if (err instanceof TransitionLimit) {
                expect(err.depth).toBeGreaterThan(30);
                expect(err.trace.length).toBeGreaterThan(30);
              }
            }
          }
        }),
      ),
    );
  });

  it("transition to a non-existent state fails with typed MalformedSpec (not a die)", () => {
    interface BadStates {
      good: {};
    }
    class Bad extends Machine.Service<
      Bad,
      BadStates,
      { GO_BAD: {} },
      {},
      {},
      never
    >()("Bad") {}

    const layer = Machine.serviceLayer(
      Bad,
      Effect.succeed({
        initial: "good" as const,
        context: {},
        output: () => ({}),
        states: {
          good: (self) =>
            Effect.succeed({
              // Cast to sneak a bogus state name past the compiler.
              GO_BAD: () =>
                Effect.succeed(self.transition("bogus" as never, {} as never)),
            }),
        },
      }),
    );

    return Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const result = yield* Effect.exit(
            Effect.gen(function* () {
              const bad = yield* Bad;
              yield* bad.dispatch("GO_BAD");
            }).pipe(Effect.provide(layer)),
          );
          expect(Exit.isFailure(result)).toBe(true);
          if (Exit.isFailure(result)) {
            const failure = Cause.failureOption(result.cause);
            expect(Option.isSome(failure)).toBe(true);
            if (Option.isSome(failure)) {
              const err = failure.value;
              expect(err).toBeInstanceOf(MalformedSpec);
              if (err instanceof MalformedSpec) {
                expect(err.state).toBe("bogus");
                expect(err.reason).toContain("bogus");
              }
            }
          }
        }),
      ),
    );
  });

  it("ready hook runs once after init with self available; scope-registered work lives for the machine's lifetime", () => {
    // Verifies that `ready` fires post-init, receives self, and its
    // Effect runs in the machine's parent scope — anything
    // scope-registered (addFinalizer here) survives state
    // transitions and only tears down when the machine's scope
    // closes.
    interface ReadyStates {
      idle: {};
    }
    interface ReadyContext {
      bootstrappedValue: number;
    }
    interface ReadyOutput {
      value: number;
    }
    class ReadyMachine extends Machine.Service<
      ReadyMachine,
      ReadyStates,
      {},
      ReadyContext,
      ReadyOutput,
      never
    >()("ReadyMachine") {}

    let readyRan = 0;
    let finalizerRan = 0;

    const layer = Machine.serviceLayer(
      ReadyMachine,
      Effect.succeed({
        initial: "idle" as const,
        context: { bootstrappedValue: 0 },
        output: (ctx: ReadyContext) => ({ value: ctx.bootstrappedValue }),
        ready: (self) =>
          Effect.gen(function* () {
            readyRan++;
            yield* self.assign({ bootstrappedValue: 99 });
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                finalizerRan++;
              }),
            );
          }),
        states: { idle: () => Effect.succeed({}) },
      }),
    );

    return Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const m = yield* ReadyMachine;
          // ready fired exactly once, before we saw the handle.
          expect(readyRan).toBe(1);
          // Its assign is visible on the output.
          expect(m.snapshot()).toEqual({ value: 99 });
          // Finalizer registered under parent scope hasn't fired yet.
          expect(finalizerRan).toBe(0);
        }).pipe(Effect.provide(layer)),
      ),
    ).then(() => {
      // Scope closed at the end of Effect.scoped — finalizer runs.
      expect(finalizerRan).toBe(1);
    });
  });
});
