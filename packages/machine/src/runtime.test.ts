/**
 * Integration tests for the first-pass runtime. Builds real
 * machines via Machine.Service + serviceLayer, provides the layer
 * into a scoped Effect, and drives dispatch → transition → subscribe
 * end-to-end.
 */

import { Cause, Data, Effect, Exit, Option, Scope } from "effect";
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
          return yield* self.transition("idle");
        }),
    },
    states: {
      idle: (self) =>
        Effect.succeed({
          INC: () => self.assign((ctx) => ({ count: ctx.count + 1 })),
          DEC: () => self.assign((ctx) => ({ count: ctx.count - 1 })),
          FREEZE: () => self.transition("frozen"),
        }),
      frozen: (self) =>
        Effect.succeed({
          UNFREEZE: () => self.transition("idle"),
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

  it("global `on` handlers fire in any state and transition correctly", () =>
    withCounter((counter) =>
      Effect.gen(function* () {
        // Counter's spec has `on: { RESET: ... }` — a global that
        // resets count and transitions to idle. The per-state maps
        // for `idle` and `frozen` have no RESET.
        yield* counter.dispatch("INC");
        yield* counter.dispatch("INC");
        yield* counter.dispatch("INC");
        yield* counter.dispatch("FREEZE");
        expect(counter.state()).toBe("frozen");
        expect(counter.snapshot().count).toBe(3);

        // RESET from frozen — only global handles it.
        yield* counter.dispatch("RESET");
        expect(counter.state()).toBe("idle");
        expect(counter.snapshot().count).toBe(0);
      }),
    ));

  it("canDispatch reports true for events handled only by the global `on` map", () =>
    withCounter((counter) =>
      Effect.gen(function* () {
        // In frozen, no local RESET — but global handles it.
        yield* counter.dispatch("FREEZE");
        expect(counter.canDispatch("RESET")).toBe(true);
      }),
    ));

  it("dispatchOrFail succeeds when only the global `on` map handles the event", () =>
    withCounter((counter) =>
      Effect.gen(function* () {
        yield* counter.dispatch("FREEZE");
        // Pre-change this would fail (no local handler for RESET in
        // frozen). Now the global handles it, so dispatchOrFail
        // settles the transition cleanly.
        yield* counter.dispatchOrFail("RESET");
        expect(counter.state()).toBe("idle");
      }),
    ));

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
          a: (self) => self.transition("b"),
          b: (self) => self.transition("a"),
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
              GO_BAD: () => self.transition("bogus" as never, {} as never),
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

// -----------------------------------------------------------------------------
// Factory machines — .spawn(args), per-instance state, caller-scoped lifetime.
// -----------------------------------------------------------------------------

interface CountUpStates {
  idle: {};
}
interface CountUpEvents {
  INC: {};
}
interface CountUpInputs {
  start: number;
}
interface CountUpContext {
  count: number;
}
interface CountUpOutput {
  count: number;
}

class CountUp extends Machine.Factory<
  CountUp,
  CountUpStates,
  CountUpEvents,
  CountUpInputs,
  CountUpContext,
  CountUpOutput,
  never
>()("CountUp") {}

const CountUpLayer = Machine.factoryLayer(
  CountUp,
  Effect.succeed({
    spawn: ({ start }: CountUpInputs) =>
      Effect.succeed({
        initial: "idle" as const,
        context: { count: start },
        output: (ctx: CountUpContext) => ({ count: ctx.count }),
        states: {
          idle: (self) =>
            Effect.succeed({
              INC: () => self.assign((ctx) => ({ count: ctx.count + 1 })),
            }),
        },
      }),
  }),
);

describe("Machine runtime — Factory", () => {
  it("spawn produces a handle whose initial context reflects the spawn args", () =>
    runScoped(
      Effect.gen(function* () {
        const factory = yield* CountUp;
        const counter = yield* factory.spawn({ start: 7 });
        expect(counter.state()).toBe("idle");
        expect(counter.snapshot().count).toBe(7);
      }).pipe(Effect.provide(CountUpLayer)),
    ));

  it("two spawns from the same factory are independent instances", () =>
    runScoped(
      Effect.gen(function* () {
        const factory = yield* CountUp;
        const a = yield* factory.spawn({ start: 0 });
        const b = yield* factory.spawn({ start: 100 });

        yield* a.dispatch("INC");
        yield* a.dispatch("INC");
        yield* b.dispatch("INC");

        expect(a.snapshot().count).toBe(2);
        expect(b.snapshot().count).toBe(101);
      }).pipe(Effect.provide(CountUpLayer)),
    ));

  it("instance lifetime is tied to the caller's Scope (per-instance ready + finalizer)", () => {
    // Same shape as the Service ready-hook test, but per-instance:
    // each spawn's `ready` runs once, its finalizer tears down when
    // the *spawn's* scope closes — not the layer's.
    interface EphStates {
      idle: {};
    }
    interface EphInputs {
      tag: string;
    }
    class Ephemeral extends Machine.Factory<
      Ephemeral,
      EphStates,
      {},
      EphInputs,
      { tag: string },
      { tag: string },
      never
    >()("Ephemeral") {}

    let readyRuns = 0;
    const finalized: string[] = [];

    const layer = Machine.factoryLayer(
      Ephemeral,
      Effect.succeed({
        spawn: ({ tag }: EphInputs) =>
          Effect.succeed({
            initial: "idle" as const,
            context: { tag },
            output: (ctx: { tag: string }) => ({ tag: ctx.tag }),
            ready: (_self) =>
              Effect.gen(function* () {
                readyRuns++;
                yield* Effect.addFinalizer(() =>
                  Effect.sync(() => {
                    finalized.push(tag);
                  }),
                );
              }),
            states: { idle: () => Effect.succeed({}) },
          }),
      }),
    );

    return Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const factory = yield* Ephemeral;

          // Spawn "a" in a nested scope; it should die when that
          // scope closes, even though the outer scope (holding the
          // layer + factory) is still open.
          yield* Effect.scoped(
            Effect.gen(function* () {
              const a = yield* factory.spawn({ tag: "a" });
              expect(a.snapshot().tag).toBe("a");
              expect(readyRuns).toBe(1);
              expect(finalized).toEqual([]);
            }),
          );
          // Inner scope closed → a's finalizer fired.
          expect(finalized).toEqual(["a"]);

          // Spawn "b" in the outer scope — survives until the outer
          // Effect.scoped closes below.
          const b = yield* factory.spawn({ tag: "b" });
          expect(b.snapshot().tag).toBe("b");
          expect(readyRuns).toBe(2);
          expect(finalized).toEqual(["a"]);
        }).pipe(Effect.provide(layer)),
      ),
    ).then(() => {
      // Outer scope closed → b's finalizer fired.
      expect(finalized).toEqual(["a", "b"]);
    });
  });
});

// -----------------------------------------------------------------------------
// transitionAwait, awaitState, and the Effect-flavored subscribe siblings
// -----------------------------------------------------------------------------

describe("Machine runtime — transitionAwait", () => {
  interface WaiterStates {
    pending: {};
    done: {};
  }
  class Waiter extends Machine.Service<
    Waiter,
    WaiterStates,
    {},
    {},
    {},
    never
  >()("Waiter") {}

  it("transitions to the named state when the register's `go` is called", () => {
    let capturedGo: (() => void) | null = null;
    const layer = Machine.serviceLayer(
      Waiter,
      Effect.succeed({
        initial: "pending" as const,
        context: {},
        output: () => ({}),
        states: {
          pending: (self) =>
            self.transitionAwait((go) => {
              capturedGo = go;
              return () => {};
            }, "done"),
          done: () => Effect.succeed(undefined),
        },
      }),
    );

    return runScoped(
      Effect.gen(function* () {
        const waiter = yield* Waiter;
        expect(waiter.state()).toBe("pending");
        expect(capturedGo).not.toBeNull();

        // Fire the register's `go` from outside — this should drive
        // the machine into `done` on the next event-loop turn.
        capturedGo!();
        yield* Effect.yieldNow();

        expect(waiter.state()).toBe("done");
      }).pipe(Effect.provide(layer)),
    );
  });

  it("fires the register's unsubscribe fn when the state is left", () => {
    let unsubscribeFires = 0;
    let capturedGo: (() => void) | null = null;
    const layer = Machine.serviceLayer(
      Waiter,
      Effect.succeed({
        initial: "pending" as const,
        context: {},
        output: () => ({}),
        states: {
          pending: (self) =>
            self.transitionAwait((go) => {
              capturedGo = go;
              return () => {
                unsubscribeFires++;
              };
            }, "done"),
          done: () => Effect.succeed(undefined),
        },
      }),
    );

    return runScoped(
      Effect.gen(function* () {
        const waiter = yield* Waiter;
        expect(unsubscribeFires).toBe(0);
        capturedGo!();
        yield* Effect.yieldNow();
        expect(waiter.state()).toBe("done");
        // State scope closed → register's cleanup ran exactly once.
        expect(unsubscribeFires).toBe(1);
      }).pipe(Effect.provide(layer)),
    );
  });

  it("ignores subsequent `go` calls after the first", () => {
    let transitions = 0;
    let capturedGo: (() => void) | null = null;
    const layer = Machine.serviceLayer(
      Waiter,
      Effect.succeed({
        initial: "pending" as const,
        context: {},
        output: () => ({}),
        states: {
          pending: (self) =>
            self.transitionAwait((go) => {
              capturedGo = go;
              return () => {};
            }, "done"),
          done: () =>
            Effect.sync(() => {
              transitions++;
            }),
        },
      }),
    );

    return runScoped(
      Effect.gen(function* () {
        yield* Waiter;
        capturedGo!();
        capturedGo!();
        capturedGo!();
        yield* Effect.yieldNow();
        expect(transitions).toBe(1);
      }).pipe(Effect.provide(layer)),
    );
  });
});

describe("Machine runtime — awaitState", () => {
  it("resolves immediately when the machine is already in the target state", () =>
    withCounter((counter) =>
      Effect.gen(function* () {
        // Counter starts in `idle`; awaitState("idle") should resolve
        // without waiting for any dispatch.
        yield* counter.awaitState("idle");
        expect(counter.state()).toBe("idle");
      }),
    ));

  it("suspends until the machine enters the target state", () =>
    withCounter((counter) =>
      Effect.gen(function* () {
        let arrived = false;
        // Fork the waiter so we can dispatch the transition ourselves.
        const fiber = yield* Effect.fork(
          counter.awaitState("frozen").pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                arrived = true;
              }),
            ),
          ),
        );
        // Still in idle — the fiber hasn't resolved.
        yield* Effect.yieldNow();
        expect(arrived).toBe(false);

        yield* counter.dispatch("FREEZE");
        yield* fiber.await;
        expect(arrived).toBe(true);
      }),
    ));

  it("cleans up its subInState entry on interruption", () =>
    withCounter((counter) =>
      Effect.gen(function* () {
        // Start a waiter and immediately interrupt it. The entry
        // should be gone so a later subscribeInState doesn't trip
        // over the stale cb.
        const fiber = yield* Effect.fork(counter.awaitState("frozen"));
        yield* Effect.yieldNow();
        yield* fiber.interruptAsFork(fiber.id());
        yield* fiber.await;

        // Nothing listening → entering `frozen` wires the normal
        // path without surprises.
        let frozenEntries = 0;
        counter.subscribeInState("frozen", () => frozenEntries++);
        yield* counter.dispatch("FREEZE");
        expect(frozenEntries).toBe(1);
      }),
    ));
});

describe("Machine runtime — Effect-flavored subscribes", () => {
  it("subscribeEffect fires the callback Effect on each output change", () =>
    withCounter((counter) =>
      Effect.gen(function* () {
        const seen: number[] = [];
        yield* counter.subscribeEffect((out) =>
          Effect.sync(() => {
            seen.push(out.count);
          }),
        );

        yield* counter.dispatch("INC");
        yield* counter.dispatch("INC");
        // Forked callback Effects — give them a turn to run.
        yield* Effect.yieldNow();
        yield* Effect.yieldNow();

        expect(seen).toEqual([1, 2]);
      }),
    ));

  it("subscribeEffect unsubscribes when the caller's scope closes", async () => {
    const seen: number[] = [];

    await runScoped(
      Effect.gen(function* () {
        const counter = yield* Counter;

        // Inner scope: subscription lives only for its duration.
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* counter.subscribeEffect((out) =>
              Effect.sync(() => {
                seen.push(out.count);
              }),
            );
            yield* counter.dispatch("INC");
            yield* Effect.yieldNow();
          }),
        );

        // After the inner scope closed, the subscription is gone.
        yield* counter.dispatch("INC");
        yield* counter.dispatch("INC");
        yield* Effect.yieldNow();
      }).pipe(Effect.provide(CounterLayer)),
    );

    expect(seen).toEqual([1]);
  });

  it("subscribeToEffect only fires when the specified field changes", () =>
    withCounter((counter) =>
      Effect.gen(function* () {
        const seen: number[] = [];
        yield* counter.subscribeToEffect("count", (v) =>
          Effect.sync(() => {
            seen.push(v);
          }),
        );
        yield* counter.dispatch("INC");
        yield* counter.dispatch("INC");
        yield* Effect.yieldNow();
        yield* Effect.yieldNow();
        expect(seen).toEqual([1, 2]);
      }),
    ));

  it("subscribeStateEffect fires on each transition", () =>
    withCounter((counter) =>
      Effect.gen(function* () {
        const seen: string[] = [];
        yield* counter.subscribeStateEffect((s) =>
          Effect.sync(() => {
            seen.push(s);
          }),
        );
        yield* counter.dispatch("FREEZE");
        yield* counter.dispatch("UNFREEZE");
        yield* Effect.yieldNow();
        yield* Effect.yieldNow();
        expect(seen).toEqual(["frozen", "idle"]);
      }),
    ));

  it("subscribeInStateEffect fires only on entry to the named state", () =>
    withCounter((counter) =>
      Effect.gen(function* () {
        let frozenEntries = 0;
        yield* counter.subscribeInStateEffect("frozen", () =>
          Effect.sync(() => {
            frozenEntries++;
          }),
        );
        yield* counter.dispatch("FREEZE");
        yield* counter.dispatch("UNFREEZE");
        yield* counter.dispatch("FREEZE");
        yield* Effect.yieldNow();
        yield* Effect.yieldNow();
        expect(frozenEntries).toBe(2);
      }),
    ));

  it("subscribeCanDispatchEffect reflects handler-map changes", () =>
    withCounter((counter) =>
      Effect.gen(function* () {
        const seen: boolean[] = [];
        yield* counter.subscribeCanDispatchEffect("INC", (can) =>
          Effect.sync(() => {
            seen.push(can);
          }),
        );
        // idle → frozen: INC's handler disappears.
        yield* counter.dispatch("FREEZE");
        // frozen → idle: INC's handler returns.
        yield* counter.dispatch("UNFREEZE");
        yield* Effect.yieldNow();
        yield* Effect.yieldNow();
        expect(seen).toEqual([false, true]);
      }),
    ));

  it("subscribeAvailableEventsEffect reflects the current state's event set", () =>
    withCounter((counter) =>
      Effect.gen(function* () {
        const seen: ReadonlyArray<string>[] = [];
        yield* counter.subscribeAvailableEventsEffect((events) =>
          Effect.sync(() => {
            seen.push([...events].sort());
          }),
        );
        yield* counter.dispatch("FREEZE");
        yield* counter.dispatch("UNFREEZE");
        yield* Effect.yieldNow();
        yield* Effect.yieldNow();
        // Counter's spec also has a global `on.RESET` — it shows up
        // in every state's available-events set.
        expect(seen).toEqual([
          ["RESET", "UNFREEZE"],
          ["DEC", "FREEZE", "INC", "RESET"],
        ]);
      }),
    ));
});

// -----------------------------------------------------------------------------
// Global `on:` edge cases — precedence against a per-state handler
// for the same event, and firing during a `transitionAwait`-held
// state. The Counter machine can't exercise either (no event
// collisions, no condition-waits), so build dedicated specs.
// -----------------------------------------------------------------------------

describe("Machine runtime — global `on:` edge cases", () => {
  it("per-state handler wins over the spec-level `on:` handler for the same event", () => {
    // Both layers have a BUMP handler. The per-state one adds 10 to
    // ctx.count; the global one adds 1. The per-state handler is
    // the one that should run while in `idle`.
    interface PrecedenceStates {
      idle: {};
    }
    interface PrecedenceEvents {
      BUMP: {};
    }
    interface PrecedenceContext {
      count: number;
    }
    interface PrecedenceOutput {
      count: number;
    }
    class Precedence extends Machine.Service<
      Precedence,
      PrecedenceStates,
      PrecedenceEvents,
      PrecedenceContext,
      PrecedenceOutput,
      never
    >()("Precedence") {}

    const layer = Machine.serviceLayer(
      Precedence,
      Effect.succeed({
        initial: "idle" as const,
        context: { count: 0 },
        output: (ctx: PrecedenceContext) => ({ count: ctx.count }),
        on: {
          BUMP: (self) =>
            self.assign((ctx: PrecedenceContext) => ({ count: ctx.count + 1 })),
        },
        states: {
          idle: (self) =>
            Effect.succeed({
              BUMP: () =>
                self.assign((ctx: PrecedenceContext) => ({
                  count: ctx.count + 10,
                })),
            }),
        },
      }),
    );

    return runScoped(
      Effect.gen(function* () {
        const machine = yield* Precedence;
        yield* machine.dispatch("BUMP");
        // Per-state handler ran (+10), not the global (+1).
        expect(machine.snapshot().count).toBe(10);
      }).pipe(Effect.provide(layer)),
    );
  });

  it("global `on:` handler fires during a `transitionAwait`-held state and transitions out cleanly", () => {
    // A machine in `waiting` is holding on a transitionAwait for
    // a `GO` register. Separately, the spec has a global
    // `on.CANCEL` that transitions to `cancelled`. Dispatching
    // CANCEL mid-wait should fire the global, close the pending
    // state scope (firing `transitionAwait`'s unsubscribe), and
    // land in `cancelled` — all without the `go` ever firing.
    interface GuardedStates {
      waiting: {};
      done: {};
      cancelled: {};
    }
    interface GuardedEvents {
      CANCEL: {};
    }
    class Guarded extends Machine.Service<
      Guarded,
      GuardedStates,
      GuardedEvents,
      {},
      {},
      never
    >()("Guarded") {}

    let unsubscribeFires = 0;
    const layer = Machine.serviceLayer(
      Guarded,
      Effect.succeed({
        initial: "waiting" as const,
        context: {},
        output: () => ({}),
        on: {
          CANCEL: (self) => self.transition("cancelled"),
        },
        states: {
          waiting: (self) =>
            // Never-firing register — go is captured but we never
            // call it. CANCEL has to be the only path out.
            self.transitionAwait(() => {
              return () => {
                unsubscribeFires++;
              };
            }, "done"),
          done: () => Effect.succeed(undefined),
          cancelled: () => Effect.succeed(undefined),
        },
      }),
    );

    return runScoped(
      Effect.gen(function* () {
        const machine = yield* Guarded;
        expect(machine.state()).toBe("waiting");
        expect(unsubscribeFires).toBe(0);

        yield* machine.dispatch("CANCEL");
        yield* Effect.yieldNow();

        expect(machine.state()).toBe("cancelled");
        // State scope closed → register's unsubscribe ran.
        expect(unsubscribeFires).toBe(1);
      }).pipe(Effect.provide(layer)),
    );
  });
});

// -----------------------------------------------------------------------------
// Spec-level `catch` — routes runtime errors away from the
// dispatch surfaces and into user-supplied handlers, narrowing the
// error channel on both `handle.dispatch` and `self.dispatch`.
// -----------------------------------------------------------------------------

describe("Machine runtime — spec-level `catch`", () => {
  it("`catch.MalformedSpec` fires on dispatch when a handler returns a bogus transition", () => {
    // Same shape as the earlier MalformedSpec test, but with a
    // spec-level catch that routes the error to a handler instead
    // of surfacing it on dispatch.
    interface BadStates {
      good: {};
    }
    class Bad extends Machine.Service<
      Bad,
      BadStates,
      { GO_BAD: {} },
      {},
      {},
      never,
      "MalformedSpec"
    >()("Bad") {}

    let caught: MalformedSpec | null = null;
    const layer = Machine.serviceLayer(
      Bad,
      Effect.succeed({
        initial: "good" as const,
        context: {},
        output: () => ({}),
        catch: {
          MalformedSpec: (e) =>
            Effect.sync(() => {
              caught = e;
            }),
        },
        states: {
          good: (self) =>
            Effect.succeed({
              GO_BAD: () => self.transition("bogus" as never, {} as never),
            }),
        },
      }),
    );

    return runScoped(
      Effect.gen(function* () {
        const machine = yield* Bad;
        // The dispatch Effect's error channel narrowed to `never`
        // via the Service class's `"MalformedSpec"` generic.
        // Compile-time: no `.pipe(Effect.catchAll(...))` needed.
        yield* machine.dispatch("GO_BAD");
        expect(caught).not.toBeNull();
        expect(caught).toBeInstanceOf(MalformedSpec);
      }).pipe(Effect.provide(layer)),
    );
  });

  it("`catch.TransitionLimit` fires on dispatch when a transition chain runs away", () => {
    // `stable` is normal; its START handler kicks off a two-task-
    // state ping-pong (ping ↔ pong) that recurses past
    // REENTRY_DEPTH_CAP via `enterStateRec`.
    interface LoopStates {
      stable: {};
      ping: {};
      pong: {};
    }
    interface LoopEvents {
      START: {};
    }
    class Loop extends Machine.Service<
      Loop,
      LoopStates,
      LoopEvents,
      {},
      {},
      never,
      "TransitionLimit"
    >()("Loop") {}

    let caught: TransitionLimit | null = null;
    const layer = Machine.serviceLayer(
      Loop,
      Effect.succeed({
        initial: "stable" as const,
        context: {},
        output: () => ({}),
        catch: {
          TransitionLimit: (e) =>
            Effect.sync(() => {
              caught = e;
            }),
        },
        states: {
          stable: (self) =>
            Effect.succeed({
              START: () => self.transition("ping"),
            }),
          ping: (self) => self.transition("pong"),
          pong: (self) => self.transition("ping"),
        },
      }),
    );

    return runScoped(
      Effect.gen(function* () {
        const machine = yield* Loop;
        yield* machine.dispatch("START");
        expect(caught).not.toBeNull();
        expect(caught).toBeInstanceOf(TransitionLimit);
      }).pipe(Effect.provide(layer)),
    );
  });

  it("declaring multiple tags requires providing all of them in `catch`", () => {
    // Narrows both error types out of dispatch's channel. Compiles
    // because we provide both handlers; TypeScript would reject at
    // compile time if we only declared "MalformedSpec" at the
    // class level and tried to catch TransitionLimit here (or
    // vice versa).
    interface S {
      good: {};
    }
    class Both extends Machine.Service<
      Both,
      S,
      { GO: {} },
      {},
      {},
      never,
      "MalformedSpec" | "TransitionLimit"
    >()("Both") {}

    let seen: string[] = [];
    const layer = Machine.serviceLayer(
      Both,
      Effect.succeed({
        initial: "good" as const,
        context: {},
        output: () => ({}),
        catch: {
          MalformedSpec: () =>
            Effect.sync(() => {
              seen.push("MalformedSpec");
            }),
          TransitionLimit: () =>
            Effect.sync(() => {
              seen.push("TransitionLimit");
            }),
        },
        states: {
          good: (self) =>
            Effect.succeed({
              GO: () => self.transition("bogus" as never, {} as never),
            }),
        },
      }),
    );

    return runScoped(
      Effect.gen(function* () {
        const machine = yield* Both;
        yield* machine.dispatch("GO");
        expect(seen).toEqual(["MalformedSpec"]);
      }).pipe(Effect.provide(layer)),
    );
  });

  it("absorbs a user-defined `TaggedError` yielded from a handler", () => {
    // Opening the `UserE` slot lets a handler yield its own
    // tagged error; declaring the tag at the class level and
    // providing a catch handler for it narrows the error out of
    // the dispatch channel at compile time and runtime alike.
    class DbError extends Data.TaggedError("DbError")<{
      readonly cause: string;
    }> {}
    interface S {
      ready: {};
    }
    class WithUserError extends Machine.Service<
      WithUserError,
      S,
      { WRITE: {} },
      {},
      {},
      never,
      "DbError",
      DbError
    >()("WithUserError") {}

    let caught: DbError | null = null;
    const layer = Machine.serviceLayer(
      WithUserError,
      Effect.succeed({
        initial: "ready" as const,
        context: {},
        output: () => ({}),
        catch: {
          DbError: (e) =>
            Effect.sync(() => {
              caught = e;
            }),
        },
        states: {
          ready: () =>
            Effect.succeed({
              WRITE: () =>
                Effect.gen(function* () {
                  return yield* new DbError({ cause: "simulated" });
                }),
            }),
        },
      }),
    );

    return runScoped(
      Effect.gen(function* () {
        const machine = yield* WithUserError;
        // Compile-time: dispatch's error channel narrowed to `never`
        // via `CaughtTags = "DbError"`. No `.pipe(Effect.catchAll)`
        // needed around the call.
        yield* machine.dispatch("WRITE");
        expect(caught).not.toBeNull();
        expect(caught).toBeInstanceOf(DbError);
        expect(caught?.cause).toBe("simulated");
      }).pipe(Effect.provide(layer)),
    );
  });

  it("mixes user and runtime tags in a single `catch` block", () => {
    // Declaring both the built-in runtime tag and a user-defined
    // one at the class level requires catch handlers for each; the
    // runtime routes each incoming error to the right handler via
    // `Effect.catchTags` matching on `_tag`.
    class ValidationError extends Data.TaggedError("ValidationError")<{
      readonly field: string;
    }> {}
    interface S {
      ok: {};
    }
    class Mixed extends Machine.Service<
      Mixed,
      S,
      { BAD_TRANSITION: {}; BAD_INPUT: {} },
      {},
      {},
      never,
      "MalformedSpec" | "ValidationError",
      ValidationError
    >()("Mixed") {}

    const seen: string[] = [];
    const layer = Machine.serviceLayer(
      Mixed,
      Effect.succeed({
        initial: "ok" as const,
        context: {},
        output: () => ({}),
        catch: {
          MalformedSpec: () =>
            Effect.sync(() => {
              seen.push("MalformedSpec");
            }),
          ValidationError: (e) =>
            Effect.sync(() => {
              seen.push(`ValidationError:${e.field}`);
            }),
        },
        states: {
          ok: (self) =>
            Effect.succeed({
              BAD_TRANSITION: () =>
                self.transition("nope" as never, {} as never),
              BAD_INPUT: () =>
                Effect.gen(function* () {
                  return yield* new ValidationError({ field: "email" });
                }),
            }),
        },
      }),
    );

    return runScoped(
      Effect.gen(function* () {
        const machine = yield* Mixed;
        yield* machine.dispatch("BAD_INPUT");
        yield* machine.dispatch("BAD_TRANSITION");
        expect(seen).toEqual(["ValidationError:email", "MalformedSpec"]);
      }).pipe(Effect.provide(layer)),
    );
  });
});
