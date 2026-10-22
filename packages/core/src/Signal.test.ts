import { Effect, HashMap, Logger, LogLevel, Option, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { Readable } from "./Readable.js";
import { Signal } from "./Signal.js";

describe("Signal.fromNullable", () => {
  it("should return existing signal when provided", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const existing = yield* Signal.make(42);
          const signal = yield* Signal.fromNullable(existing, 0);
          return signal === existing;
        }),
      ),
    );
    expect(result).toBe(true);
  });

  it("should create new signal with default when existing is undefined", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const signal = yield* Signal.fromNullable(undefined, 42);
          return yield* signal.get;
        }),
      ),
    );
    expect(result).toBe(42);
  });

  it("should work with pipeable equals", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const signal = yield* Signal.fromNullable(undefined, { id: 1 }).pipe(
            Signal.equals((a, b) => a.id === b.id),
          );
          // Same id, should not update
          yield* signal.set({ id: 1 });
          const value = yield* signal.get;
          return value.id;
        }),
      ),
    );
    expect(result).toBe(1);
  });
});

describe("Signal.fromReactive", () => {
  it("should return existing Signal when provided", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const existing = yield* Signal.make(42);
          const signal = yield* Signal.fromReactive(existing, 0);
          return signal === existing;
        }),
      ),
    );
    expect(result).toBe(true);
  });

  it("should create Signal from Readable with its current value", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          // Create a pure Readable using Readable.of
          const readable = Readable.of(42);
          const signal = yield* Signal.fromReactive(readable, 0);
          return yield* signal.get;
        }),
      ),
    );
    expect(result).toBe(42);
  });

  it("should create Signal from plain value", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const signal = yield* Signal.fromReactive(42, 0);
          return yield* signal.get;
        }),
      ),
    );
    expect(result).toBe(42);
  });

  it("should use default when value is undefined", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const signal = yield* Signal.fromReactive(undefined, 99);
          return yield* signal.get;
        }),
      ),
    );
    expect(result).toBe(99);
  });

  it("should create writable Signal from Readable", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          // Create a pure Readable using Readable.of
          const readable = Readable.of(10);
          const signal = yield* Signal.fromReactive(readable, 0);
          yield* signal.set(20);
          return yield* signal.get;
        }),
      ),
    );
    expect(result).toBe(20);
  });

  it("tracks later Readable emissions, not just the initial read", async () => {
    // Regression: `fromReactive`'s Readable path used to call .get once
    // and bake the value into a new Signal, so later consumer updates
    // never reached the component. The fix subscribes to the Readable
    // and writes each emission into the returned Signal.
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const source = yield* Signal.make(0);
          const derived = source.pipe(Readable.map((n) => n + 100));
          const signal = yield* Signal.fromReactive(derived, -1);
          yield* source.set(5);
          // Let the forked subscription catch up.
          yield* Effect.sleep("10 millis");
          return yield* signal.get;
        }),
      ),
    );
    expect(result).toBe(105);
  });
});

describe("Signal reactivity", () => {
  it("should emit values on the values stream after set", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const sig = yield* Signal.make(0);

          const emissions: number[] = [];
          yield* Stream.runForEach(sig.values, (val) =>
            Effect.sync(() => {
              emissions.push(val);
            }),
          ).pipe(Effect.fork);

          yield* Effect.sleep("20 millis");

          yield* sig.set(1);
          yield* Effect.sleep("20 millis");

          yield* sig.set(2);
          yield* Effect.sleep("20 millis");

          yield* sig.set(3);
          yield* Effect.sleep("20 millis");

          expect(emissions).toEqual([0, 1, 2, 3]);
        }),
      ),
    );
  });

  it("should emit only future changes on the changes stream (not current value)", async () => {
    // Note: Signal.changes does NOT include the current value - only future changes.
    // Use Signal.values if you need the current value followed by changes.
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const sig = yield* Signal.make(0);

          const emissions: number[] = [];
          yield* Stream.runForEach(sig.changes, (val) =>
            Effect.sync(() => {
              emissions.push(val);
            }),
          ).pipe(Effect.fork);

          yield* Effect.sleep("20 millis");

          yield* sig.set(1);
          yield* Effect.sleep("20 millis");

          yield* sig.set(2);
          yield* Effect.sleep("20 millis");

          // changes only includes future changes (1, 2), not the current value (0)
          expect(emissions).toEqual([1, 2]);
        }),
      ),
    );
  });

  it("should support multiple subscribers", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const sig = yield* Signal.make(0);

          const emissions1: number[] = [];
          const emissions2: number[] = [];

          yield* Stream.runForEach(sig.values, (val) =>
            Effect.sync(() => {
              emissions1.push(val);
            }),
          ).pipe(Effect.fork);

          yield* Stream.runForEach(sig.values, (val) =>
            Effect.sync(() => {
              emissions2.push(val);
            }),
          ).pipe(Effect.fork);

          yield* Effect.sleep("20 millis");

          yield* sig.set(1);
          yield* Effect.sleep("20 millis");

          yield* sig.set(2);
          yield* Effect.sleep("20 millis");

          expect(emissions1).toEqual([0, 1, 2]);
          expect(emissions2).toEqual([0, 1, 2]);
        }),
      ),
    );
  });

  it("should handle rapid sequential updates", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const sig = yield* Signal.make(0);

          const emissions: number[] = [];
          yield* Stream.runForEach(sig.values, (val) =>
            Effect.sync(() => {
              emissions.push(val);
            }),
          ).pipe(Effect.fork);

          yield* Effect.sleep("10 millis");

          // Rapid updates
          for (let i = 1; i <= 10; i++) {
            yield* sig.set(i);
          }

          yield* Effect.sleep("50 millis");

          // Should have initial + all 10 updates
          expect(emissions.length).toBe(11);
          expect(emissions[0]).toBe(0);
          expect(emissions[10]).toBe(10);
        }),
      ),
    );
  });

  it("should properly clean up subscriptions when scope closes", async () => {
    let emissionsAfterScopeClose = 0;
    const sig = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const sig = yield* Signal.make(0);

          yield* Stream.runForEach(sig.values, (_val) =>
            Effect.sync(() => {
              emissionsAfterScopeClose++;
            }),
          ).pipe(Effect.fork);

          yield* Effect.sleep("10 millis");
          yield* sig.set(1);
          yield* Effect.sleep("10 millis");

          // Return the ref (not the signal since it's scope-bound)
          return sig;
        }),
      ),
    );

    // Scope closed, subscription should be cleaned up
    const countBeforeSet = emissionsAfterScopeClose;

    // This set should NOT trigger the subscription (it was cleaned up)
    await Effect.runPromise(sig.set(99));
    await new Promise((r) => setTimeout(r, 50));

    // The subscription should NOT have received the value after scope closed
    // Note: This tests that forked fibers are properly interrupted on scope close
    expect(emissionsAfterScopeClose).toBe(countBeforeSet);
  });
});

describe("Signal memory stress tests", () => {
  it("should handle many signals in sequence without memory issues", async () => {
    // Create and destroy many signals in sequence
    for (let i = 0; i < 50; i++) {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const sig = yield* Signal.make(i);
            const emissions: number[] = [];

            yield* Stream.runForEach(sig.values, (val) =>
              Effect.sync(() => {
                emissions.push(val);
              }),
            ).pipe(Effect.fork);

            yield* Effect.sleep("5 millis");
            yield* sig.set(i + 1);
            yield* Effect.sleep("5 millis");

            expect(emissions).toEqual([i, i + 1]);
          }),
        ),
      );
    }
    // If we get here without heap overflow, the test passes
    expect(true).toBe(true);
  });

  it("should handle many subscriptions without memory issues", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const sig = yield* Signal.make(0);
          const allEmissions: number[][] = [];

          // Create 20 subscribers
          for (let i = 0; i < 20; i++) {
            const emissions: number[] = [];
            allEmissions.push(emissions);

            yield* Stream.runForEach(sig.values, (val) =>
              Effect.sync(() => {
                emissions.push(val);
              }),
            ).pipe(Effect.fork);
          }

          yield* Effect.sleep("20 millis");

          // Update the signal
          yield* sig.set(1);
          yield* Effect.sleep("20 millis");

          yield* sig.set(2);
          yield* Effect.sleep("20 millis");

          // All subscribers should have received the values
          for (const emissions of allEmissions) {
            expect(emissions).toEqual([0, 1, 2]);
          }
        }),
      ),
    );
  });

  it("should handle many updates without memory issues", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const sig = yield* Signal.make(0);
          const emissions: number[] = [];

          yield* Stream.runForEach(sig.values, (val) =>
            Effect.sync(() => {
              emissions.push(val);
            }),
          ).pipe(Effect.fork);

          yield* Effect.sleep("10 millis");

          // Many updates
          for (let i = 1; i <= 100; i++) {
            yield* sig.set(i);
          }

          yield* Effect.sleep("50 millis");

          // Should have initial + 100 updates
          expect(emissions.length).toBe(101);
          expect(emissions[0]).toBe(0);
          expect(emissions[100]).toBe(100);
        }),
      ),
    );
  });
});

describe("Signal", () => {
  it("should create a signal with initial value", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const count = yield* Signal.make(0);
          return yield* count.get;
        }),
      ),
    );
    expect(result).toBe(0);
  });

  it("should update value with set", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const count = yield* Signal.make(0);
          yield* count.set(5);
          return yield* count.get;
        }),
      ),
    );
    expect(result).toBe(5);
  });

  it("should update value with update function", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const count = yield* Signal.make(10);
          yield* count.update((n) => n + 5);
          return yield* count.get;
        }),
      ),
    );
    expect(result).toBe(15);
  });

  it("should skip update if value equals (default ===)", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const count = yield* Signal.make(5);
          yield* count.set(5); // Same value, should not change
          yield* count.set(5); // Same value again
          return yield* count.get;
        }),
      ),
    );
    expect(result).toBe(5);
  });

  it("should use custom equality function", async () => {
    interface User {
      id: number;
      name: string;
    }

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const user = yield* Signal.make<User>({ id: 1, name: "Alice" }).pipe(
            Signal.equals((a: User, b: User) => a.id === b.id),
          );
          // Same id, different name - should NOT update (considered equal)
          yield* user.set({ id: 1, name: "Alice Updated" });
          const current = yield* user.get;
          return current.name;
        }),
      ),
    );
    expect(result).toBe("Alice"); // Original value kept since ids are equal
  });

  it("should map to a new Readable", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const count = yield* Signal.make(5);
          const doubled = count.pipe(Readable.map((n) => n * 2));
          return yield* doubled.get;
        }),
      ),
    );
    expect(result).toBe(10);
  });

  it("should chain multiple updates", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const count = yield* Signal.make(0);
          yield* count.update((n) => n + 1);
          yield* count.update((n) => n + 1);
          yield* count.update((n) => n + 1);
          return yield* count.get;
        }),
      ),
    );
    expect(result).toBe(3);
  });

  it("should be recognized by isSignal", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const signal = yield* Signal.make(0);
          return Signal.isSignal(signal);
        }),
      ),
    );
    expect(result).toBe(true);
  });

  it("should be recognized by isReadable", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const signal = yield* Signal.make(0);
          return Readable.isReadable(signal);
        }),
      ),
    );
    expect(result).toBe(true);
  });

  it("plain Readable should not be recognized as Signal", () => {
    const readable = Readable.of(42);
    expect(Signal.isSignal(readable)).toBe(false);
    expect(Readable.isReadable(readable)).toBe(true);
  });
});

describe("Signal.trace", () => {
  interface Captured {
    readonly level: string;
    readonly message: unknown;
    readonly subsystem: string | undefined;
  }

  const capture = () => {
    const sink: Captured[] = [];
    const layer = Logger.replace(
      Logger.defaultLogger,
      Logger.make((opts) => {
        const sub = HashMap.get(opts.annotations, "subsystem");
        sink.push({
          level: opts.logLevel.label,
          message: opts.message,
          subsystem: Option.isSome(sub) ? String(sub.value) : undefined,
        });
      }),
    );
    return { sink, layer };
  };

  it("logs every set call under stax.signal at Debug level", async () => {
    const { sink, layer } = capture();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const count = yield* Signal.make(0).pipe(Signal.trace("count"));
          yield* count.set(1);
          yield* count.set(2);
        }),
      ).pipe(Logger.withMinimumLogLevel(LogLevel.Debug), Effect.provide(layer)),
    );
    const writes = sink.filter(
      (l) =>
        l.subsystem === "stax.signal" && String(l.message).includes("write"),
    );
    expect(writes).toHaveLength(2);
    expect(writes[0].level).toBe("DEBUG");
  });

  it("logs every update call", async () => {
    const { sink, layer } = capture();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const count = yield* Signal.make(0).pipe(Signal.trace("count"));
          yield* count.update((c) => c + 1);
          yield* count.update((c) => c + 10);
        }),
      ).pipe(Logger.withMinimumLogLevel(LogLevel.Debug), Effect.provide(layer)),
    );
    const updates = sink.filter(
      (l) =>
        l.subsystem === "stax.signal" && String(l.message).includes("update"),
    );
    expect(updates).toHaveLength(2);
  });

  it("includes id, from, to, and callSite in the log payload", async () => {
    const { sink, layer } = capture();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const count = yield* Signal.make(5).pipe(Signal.trace("count"));
          yield* count.set(9);
        }),
      ).pipe(Logger.withMinimumLogLevel(LogLevel.Debug), Effect.provide(layer)),
    );
    const write = sink.find(
      (l) =>
        l.subsystem === "stax.signal" &&
        Array.isArray(l.message) &&
        l.message[0] === "write",
    );
    expect(write).toBeDefined();
    // Effect emits message as a tuple: [<label>, <data>]
    const payload = (write?.message as [string, Record<string, unknown>])[1];
    expect(payload.id).toBe("count");
    expect(payload.from).toBe(5);
    expect(payload.to).toBe(9);
    // callSite is populated and header/internals are stripped
    // (V8 doesn't preserve generator-body frames, so we can't assert on
    //  the test file itself — see parseCallSite unit tests for full
    //  strip-behavior coverage against synthetic stacks.)
    expect(typeof payload.callSite).toBe("string");
    expect(String(payload.callSite)).not.toMatch(/^Error/);
    expect(String(payload.callSite)).not.toContain("/packages/core/");
    expect(String(payload.callSite)).not.toContain("/@stax-ui/core/");
  });

  it("still applies writes — the wrapper is transparent to state", async () => {
    const { layer } = capture();
    const finalValue = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const count = yield* Signal.make(0).pipe(Signal.trace("count"));
          yield* count.set(42);
          yield* count.update((c) => c + 1);
          return yield* count.get;
        }),
      ).pipe(Logger.withMinimumLogLevel(LogLevel.Debug), Effect.provide(layer)),
    );
    expect(finalValue).toBe(43);
  });

  it("returns the original Signal unwrapped when log level is above Debug", async () => {
    // We can't observe "unwrapped" from the outside easily, so we prove it
    // indirectly: with Debug off, no stax.signal logs are ever emitted, even
    // for a signal that was piped through trace.
    const { sink, layer } = capture();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const count = yield* Signal.make(0).pipe(Signal.trace("count"));
          yield* count.set(1);
          yield* count.update((c) => c + 1);
        }),
      ).pipe(Effect.provide(layer)),
    );
    const staxSignalLogs = sink.filter((l) => l.subsystem === "stax.signal");
    expect(staxSignalLogs).toEqual([]);
  });

  it("runs update reducer once even when tracing is enabled", async () => {
    // Non-pure reducers shouldn't double-fire — the wrapper computes `to`
    // once and applies via `set`, not by re-running `signal.update(fn)`.
    const { layer } = capture();
    let calls = 0;
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const count = yield* Signal.make(0).pipe(Signal.trace("count"));
          yield* count.update((c) => {
            calls++;
            return c + 1;
          });
        }),
      ).pipe(Logger.withMinimumLogLevel(LogLevel.Debug), Effect.provide(layer)),
    );
    expect(calls).toBe(1);
  });
});

describe("Signal.controllable", () => {
  describe("uncontrolled", () => {
    it("writes commit when value is omitted", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const sig = yield* Signal.controllable({ defaultValue: 0 });
            yield* sig.set(5);
            return yield* sig.get;
          }),
        ),
      );
      expect(result).toBe(5);
    });

    it("fires onChange after a committed write", async () => {
      const changes: number[] = [];
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const sig = yield* Signal.controllable({
              defaultValue: 0,
              onChange: (v) => Effect.sync(() => changes.push(v)),
            });
            yield* sig.set(1);
            yield* sig.set(2);
            yield* sig.update((n) => n + 10);
          }),
        ),
      );
      expect(changes).toEqual([1, 2, 12]);
    });

    it("skips onChange and does not write when the new value is equal", async () => {
      const changes: number[] = [];
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const sig = yield* Signal.controllable({
              defaultValue: 7,
              onChange: (v) => Effect.sync(() => changes.push(v)),
            });
            yield* sig.set(7); // same value
            return yield* sig.get;
          }),
        ),
      );
      expect(result).toBe(7);
      expect(changes).toEqual([]);
    });

    it("respects a custom equals", async () => {
      const changes: Array<{ id: number }> = [];
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const sig = yield* Signal.controllable({
              defaultValue: { id: 1, label: "a" } as {
                id: number;
                label: string;
              },
              equals: (a, b) => a.id === b.id,
              onChange: (v) => Effect.sync(() => changes.push(v)),
            });
            yield* sig.set({ id: 1, label: "b" }); // same id, skipped
            yield* sig.set({ id: 2, label: "c" });
            return yield* sig.get;
          }),
        ),
      );
      expect(result).toEqual({ id: 2, label: "c" });
      expect(changes.map((c) => c.id)).toEqual([2]);
    });

    it("serializes update so N increments give +N", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const sig = yield* Signal.controllable({ defaultValue: 0 });
            yield* Effect.all(
              [sig.update((n) => n + 1), sig.update((n) => n + 1)],
              { concurrency: "unbounded" },
            );
            return yield* sig.get;
          }),
        ),
      );
      expect(result).toBe(2);
    });

    it("waits for a suspending onChange before releasing the semaphore", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const observed: number[] = [];
            const sig = yield* Signal.controllable({
              defaultValue: 0,
              onChange: (v) =>
                Effect.gen(function* () {
                  // Observe the committed value from inside onChange.
                  // Semaphore held → subsequent set hasn't started yet.
                  yield* Effect.sleep("10 millis");
                  observed.push(v);
                }),
            });
            yield* Effect.all([sig.set(1), sig.set(2), sig.set(3)], {
              concurrency: "unbounded",
            });
            return observed;
          }),
        ),
      );
      // The exact ordering depends on scheduler, but set(2) and set(3)
      // can't start until set(1)'s onChange finishes, so observed sees
      // each in-order.
      expect(result).toEqual([1, 2, 3]);
    });
  });

  describe("controlled", () => {
    it("reads delegate to the consumer's Readable", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const consumer = yield* Signal.make(10);
            const sig = yield* Signal.controllable({
              value: consumer,
              defaultValue: 0, // ignored in controlled mode
            });
            return yield* sig.get;
          }),
        ),
      );
      expect(result).toBe(10);
    });

    it("set fires onChange but does not write to the consumer", async () => {
      const changes: number[] = [];
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const consumer = yield* Signal.make(10);
            const sig = yield* Signal.controllable({
              value: consumer,
              defaultValue: 0,
              onChange: (v) => Effect.sync(() => changes.push(v)),
            });
            yield* sig.set(99);
            return {
              component: yield* sig.get,
              consumer: yield* consumer.get,
            };
          }),
        ),
      );
      expect(changes).toEqual([99]);
      expect(result.component).toBe(10); // unchanged — consumer didn't apply
      expect(result.consumer).toBe(10);
    });

    it("follows consumer updates reactively", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const consumer = yield* Signal.make(1);
            const sig = yield* Signal.controllable({
              value: consumer,
              defaultValue: 0,
            });
            yield* consumer.set(42);
            return yield* sig.get;
          }),
        ),
      );
      expect(result).toBe(42);
    });

    it("does not fire onChange when the consumer updates on its own", async () => {
      // Fire-on-outside-change would be a feedback-loop trap.
      const changes: number[] = [];
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const consumer = yield* Signal.make(1);
            const sig = yield* Signal.controllable({
              value: consumer,
              defaultValue: 0,
              onChange: (v) => Effect.sync(() => changes.push(v)),
            });
            yield* consumer.set(2);
            yield* Effect.sleep("10 millis");
            // sanity: component sees the external change via .get
            yield* sig.get;
          }),
        ),
      );
      expect(changes).toEqual([]);
    });

    it("accepts a plain value and renders a read-only Signal", async () => {
      const changes: boolean[] = [];
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const sig = yield* Signal.controllable({
              value: true, // plain value — pinned, read-only
              defaultValue: false,
              onChange: (v) => Effect.sync(() => changes.push(v)),
            });
            yield* sig.set(false); // request change
            return yield* sig.get;
          }),
        ),
      );
      expect(result).toBe(true); // never changes
      expect(changes).toEqual([false]); // request still routes
    });

    it("accepts a Readable (non-Signal) and tracks its emissions", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const source = yield* Signal.make(0);
            const derived = source.pipe(Readable.map((n) => n * 2));
            const sig = yield* Signal.controllable({
              value: derived,
              defaultValue: -1,
            });
            yield* source.set(5);
            return yield* sig.get;
          }),
        ),
      );
      expect(result).toBe(10);
    });
  });

  describe("Signal interface", () => {
    it("the returned value passes isSignal and isReadable", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const sig = yield* Signal.controllable({ defaultValue: 0 });
            return {
              sig: Signal.isSignal(sig),
              readable: Readable.isReadable(sig),
            };
          }),
        ),
      );
      expect(result).toEqual({ sig: true, readable: true });
    });

    it("writes propagate on the changes stream in uncontrolled mode", async () => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const sig = yield* Signal.controllable({ defaultValue: 0 });
            const emissions: number[] = [];
            yield* Stream.runForEach(sig.changes, (v) =>
              Effect.sync(() => emissions.push(v)),
            ).pipe(Effect.fork);
            yield* Effect.sleep("10 millis");
            yield* sig.set(1);
            yield* sig.set(2);
            yield* Effect.sleep("10 millis");
            expect(emissions).toEqual([1, 2]);
          }),
        ),
      );
    });

    it("consumer updates propagate on the changes stream in controlled mode", async () => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const consumer = yield* Signal.make(0);
            const sig = yield* Signal.controllable({
              value: consumer,
              defaultValue: -1,
            });
            const emissions: number[] = [];
            yield* Stream.runForEach(sig.changes, (v) =>
              Effect.sync(() => emissions.push(v)),
            ).pipe(Effect.fork);
            yield* Effect.sleep("10 millis");
            yield* consumer.set(1);
            yield* consumer.set(2);
            yield* Effect.sleep("10 millis");
            expect(emissions).toEqual([1, 2]);
          }),
        ),
      );
    });
  });
});
