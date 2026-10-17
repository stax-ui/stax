import { Effect, Either, Exit, Fiber, Option, Scope, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { Signal } from "./Signal.js";
import { OpticOutOfBoundsError } from "./SignalOptic.js";

const runScoped = <A, E>(
  program: Effect.Effect<A, E, Scope.Scope>,
): Promise<A> => Effect.runPromise(Effect.scoped(program));

describe("Signal.Optic", () => {
  interface Nested {
    readonly a: {
      readonly b: { readonly c: number };
      readonly d: number;
    };
    readonly e: number;
  }
  const initial: Nested = { a: { b: { c: 0 }, d: 1 }, e: 2 };

  describe("make", () => {
    it("is a Readable of the whole tree", async () => {
      const value = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make(initial);
          return yield* state.get;
        }),
      );
      expect(value).toEqual(initial);
    });

    it("is recognized by the OpticTypeId brand", async () => {
      await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make(initial);
          expect(Signal.Optic.isOptic(state)).toBe(true);
        }),
      );
    });

    it("does NOT expose a `.set` on the root handle", async () => {
      await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make(initial);
          expect((state as unknown as { set?: unknown }).set).toBeUndefined();
        }),
      );
    });
  });

  describe("get (Option-wrapped)", () => {
    it("returns Some(value) when the path resolves", async () => {
      const value = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make(initial);
          const c = yield* Signal.Optic.get(state, "a.b.c");
          return yield* c.get;
        }),
      );
      expect(value).toEqual(Option.some(0));
    });

    it("returns None when an array index is out of bounds", async () => {
      // TypeScript's `Paths<T>` allows any `${number}` index; only the
      // runtime knows the array is currently short. `get` surfaces
      // that as `Option.none()`.
      const value = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make({
            items: [{ n: 1 }, { n: 2 }],
          });
          const missing = yield* Signal.Optic.get(state, "items.5.n");
          return yield* missing.get;
        }),
      );
      expect(value).toEqual(Option.none());
    });

    it("distinguishes Some(undefined) — stored undefined — from None — missing key", async () => {
      // A field explicitly set to `undefined` is reachable, so its
      // resolution is `Some(undefined)`. A field that was never set
      // is unreachable → `None`.
      const value = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make<{
            readonly x?: number | undefined;
          }>({ x: undefined });
          const x = yield* Signal.Optic.get(state, "x");
          return yield* x.get;
        }),
      );
      expect(value).toEqual(Option.some(undefined));
    });
  });

  describe("getUnsafe (raw)", () => {
    it("returns the value directly, no Option wrap", async () => {
      const value = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make(initial);
          const c = yield* Signal.Optic.getUnsafe(state, "a.b.c");
          return yield* c.get;
        }),
      );
      expect(value).toBe(0);
    });

    it("returns undefined at runtime for a missing path (type says otherwise)", async () => {
      // The type says `number` because the path is statically valid;
      // the runtime returns `undefined` because the array is short.
      // That's the "unsafe" tradeoff — caller opted into it.
      const value = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make({
            items: [{ n: 1 }, { n: 2 }],
          });
          const missing = yield* Signal.Optic.getUnsafe(state, "items.5.n");
          return yield* missing.get;
        }),
      );
      expect(value).toBeUndefined();
    });
  });

  describe("set + reads propagate", () => {
    it("reading via getUnsafe after set returns the new value", async () => {
      const value = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make(initial);
          const c = yield* Signal.Optic.getUnsafe(state, "a.b.c");
          yield* Signal.Optic.set(state, "a.b.c", 3);
          return yield* c.get;
        }),
      );
      expect(value).toBe(3);
    });

    it("a leaf write propagates up to ancestor readables", async () => {
      const bAfter = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make(initial);
          const b = yield* Signal.Optic.getUnsafe(state, "a.b");
          yield* Signal.Optic.set(state, "a.b.c", 42);
          return yield* b.get;
        }),
      );
      expect(bAfter).toEqual({ c: 42 });
    });

    it("an ancestor write propagates down to leaf readables", async () => {
      const cAfter = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make(initial);
          const c = yield* Signal.Optic.getUnsafe(state, "a.b.c");
          yield* Signal.Optic.set(state, "a.b", { c: 99 });
          return yield* c.get;
        }),
      );
      expect(cAfter).toBe(99);
    });

    it("the whole-tree readable reflects every write", async () => {
      const tree = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make(initial);
          yield* Signal.Optic.set(state, "a.b.c", 7);
          yield* Signal.Optic.set(state, "e", 8);
          return yield* state.get;
        }),
      );
      expect(tree).toEqual({ a: { b: { c: 7 }, d: 1 }, e: 8 });
    });

    it("preserves structural sharing on unaffected branches", async () => {
      const { sameE } = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make({
            a: { b: { c: 0 } },
            e: { greeting: "hi" },
          });
          const before = yield* state.get;
          yield* Signal.Optic.set(state, "a.b.c", 42);
          const after = yield* state.get;
          return { sameE: before.e === after.e };
        }),
      );
      expect(sameE).toBe(true);
    });
  });

  describe("change notifications", () => {
    const collectChanges = <A>(
      readable: { changes: Stream.Stream<A> },
      n: number,
    ) =>
      readable.changes.pipe(
        Stream.take(n),
        Stream.runCollect,
        Effect.map((chunk) => Array.from(chunk)),
      );

    it("a leaf write fires the leaf's `.changes` (getUnsafe: raw value)", async () => {
      const events = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make(initial);
          const c = yield* Signal.Optic.getUnsafe(state, "a.b.c");
          const collector = yield* Effect.fork(collectChanges(c, 2));
          yield* Effect.sleep("5 millis");
          yield* Signal.Optic.set(state, "a.b.c", 1);
          yield* Signal.Optic.set(state, "a.b.c", 2);
          return yield* Fiber.join(collector);
        }),
      );
      expect(events).toEqual([1, 2]);
    });

    it("a leaf write fires the leaf's `.changes` (get: Option-wrapped)", async () => {
      const events = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make(initial);
          const c = yield* Signal.Optic.get(state, "a.b.c");
          const collector = yield* Effect.fork(collectChanges(c, 2));
          yield* Effect.sleep("5 millis");
          yield* Signal.Optic.set(state, "a.b.c", 1);
          yield* Signal.Optic.set(state, "a.b.c", 2);
          return yield* Fiber.join(collector);
        }),
      );
      expect(events).toEqual([Option.some(1), Option.some(2)]);
    });

    it("a leaf write fires ancestor `.changes` with the rebuilt subtree", async () => {
      const events = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make(initial);
          const b = yield* Signal.Optic.getUnsafe(state, "a.b");
          const collector = yield* Effect.fork(collectChanges(b, 1));
          yield* Effect.sleep("5 millis");
          yield* Signal.Optic.set(state, "a.b.c", 42);
          return yield* Fiber.join(collector);
        }),
      );
      expect(events).toEqual([{ c: 42 }]);
    });

    it("sibling writes do NOT fire a leaf's `.changes`", async () => {
      const events = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make(initial);
          const c = yield* Signal.Optic.getUnsafe(state, "a.b.c");
          const seen: number[] = [];
          const collector = yield* Effect.fork(
            c.changes.pipe(
              Stream.runForEach((v) => Effect.sync(() => seen.push(v))),
            ),
          );
          yield* Effect.sleep("5 millis");
          yield* Signal.Optic.set(state, "a.d", 99);
          yield* Signal.Optic.set(state, "e", 100);
          yield* Effect.sleep("20 millis");
          yield* Fiber.interrupt(collector);
          return seen;
        }),
      );
      expect(events).toEqual([]);
    });

    it("writing the same value doesn't fire `.changes`", async () => {
      const events = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make(initial);
          const c = yield* Signal.Optic.getUnsafe(state, "a.b.c");
          const seen: number[] = [];
          const collector = yield* Effect.fork(
            c.changes.pipe(
              Stream.runForEach((v) => Effect.sync(() => seen.push(v))),
            ),
          );
          yield* Effect.sleep("5 millis");
          yield* Signal.Optic.set(state, "a.b.c", 0);
          yield* Effect.sleep("10 millis");
          yield* Fiber.interrupt(collector);
          return seen;
        }),
      );
      expect(events).toEqual([]);
    });
  });

  describe("update / updateUnsafe", () => {
    it("update applies a reducer at path", async () => {
      const value = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make(initial);
          yield* Signal.Optic.update(state, "a.b.c", (n) => n + 10);
          const c = yield* Signal.Optic.getUnsafe(state, "a.b.c");
          return yield* c.get;
        }),
      );
      expect(value).toBe(10);
    });

    it("update skips when the reducer returns the same value", async () => {
      const events = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make(initial);
          const c = yield* Signal.Optic.getUnsafe(state, "a.b.c");
          const seen: number[] = [];
          const collector = yield* Effect.fork(
            c.changes.pipe(
              Stream.runForEach((v) => Effect.sync(() => seen.push(v))),
            ),
          );
          yield* Effect.sleep("5 millis");
          yield* Signal.Optic.update(state, "a.b.c", (n) => n);
          yield* Effect.sleep("10 millis");
          yield* Fiber.interrupt(collector);
          return seen;
        }),
      );
      expect(events).toEqual([]);
    });
  });

  describe("scope cleanup", () => {
    it("unsubscribes when the enclosing scope of `get`'s stream closes", async () => {
      const info = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make(initial);
          const c = yield* Signal.Optic.get(state, "a.b.c");
          const fiber = yield* c.changes.pipe(
            Stream.runDrain,
            Effect.forkScoped,
          );
          yield* Effect.sleep("5 millis");
          const during =
            (
              state as unknown as { _subs: Map<string, Set<unknown>> }
            )._subs.get("a.b.c")?.size ?? 0;
          yield* Fiber.interrupt(fiber);
          yield* Effect.sleep("5 millis");
          const after =
            (
              state as unknown as { _subs: Map<string, Set<unknown>> }
            )._subs.get("a.b.c")?.size ?? 0;
          return { during, after };
        }),
      );
      expect(info.during).toBe(1);
      expect(info.after).toBe(0);
    });
  });

  describe("path types (compile-time)", () => {
    it("infers Option<ValueAtPath> for `get`", async () => {
      await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make(initial);
          const c = yield* Signal.Optic.get(state, "a.b.c");
          const b = yield* Signal.Optic.get(state, "a.b");
          const e = yield* Signal.Optic.get(state, "e");

          const cValue: Option.Option<number> = yield* c.get;
          const bValue: Option.Option<{ readonly c: number }> = yield* b.get;
          const eValue: Option.Option<number> = yield* e.get;

          expect(cValue).toEqual(Option.some(0));
          expect(Option.getOrThrow(bValue).c).toBe(0);
          expect(eValue).toEqual(Option.some(2));
        }),
      );
    });

    it("infers raw ValueAtPath for `getUnsafe`", async () => {
      await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make(initial);
          const c = yield* Signal.Optic.getUnsafe(state, "a.b.c");
          const cValue: number = yield* c.get;
          expect(cValue).toBe(0);
        }),
      );
    });
  });

  describe("arrays (numeric-segment paths)", () => {
    interface WithItems {
      readonly items: { readonly name: string; readonly n: number }[];
      readonly meta: { readonly total: number };
    }
    const initialItems = (): WithItems => ({
      items: [
        { name: "a", n: 1 },
        { name: "b", n: 2 },
        { name: "c", n: 3 },
      ],
      meta: { total: 3 },
    });

    it("reads a field through a numeric segment (getUnsafe)", async () => {
      const value = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make(initialItems());
          const firstName = yield* Signal.Optic.getUnsafe(
            state,
            "items.0.name",
          );
          return yield* firstName.get;
        }),
      );
      expect(value).toBe("a");
    });

    it("get returns None on an out-of-bounds index", async () => {
      const value = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make(initialItems());
          const missing = yield* Signal.Optic.get(state, "items.5.name");
          return yield* missing.get;
        }),
      );
      expect(value).toEqual(Option.none());
    });

    it("writes through a numeric segment; ancestor + descendant readables see the change", async () => {
      const result = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make(initialItems());
          const firstName = yield* Signal.Optic.getUnsafe(
            state,
            "items.0.name",
          );
          const firstItem = yield* Signal.Optic.getUnsafe(state, "items.0");
          yield* Signal.Optic.set(state, "items.0.name", "A");
          return {
            firstName: yield* firstName.get,
            firstItem: yield* firstItem.get,
          };
        }),
      );
      expect(result.firstName).toBe("A");
      expect(result.firstItem).toEqual({ name: "A", n: 1 });
    });

    it("preserves array-ness on writes (setIn uses slice, not spread)", async () => {
      const result = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make(initialItems());
          yield* Signal.Optic.set(state, "items.1.n", 99);
          const tree = yield* state.get;
          return {
            isArray: Array.isArray(tree.items),
            length: tree.items.length,
            values: tree.items,
          };
        }),
      );
      expect(result.isArray).toBe(true);
      expect(result.length).toBe(3);
      expect(result.values).toEqual([
        { name: "a", n: 1 },
        { name: "b", n: 99 },
        { name: "c", n: 3 },
      ]);
    });

    it("preserves structural sharing on sibling array indices", async () => {
      const result = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make(initialItems());
          const before = yield* state.get;
          yield* Signal.Optic.set(state, "items.1.name", "B");
          const after = yield* state.get;
          return {
            item0Same: before.items[0] === after.items[0],
            item2Same: before.items[2] === after.items[2],
            item1Changed: before.items[1] !== after.items[1],
          };
        }),
      );
      expect(result).toEqual({
        item0Same: true,
        item2Same: true,
        item1Changed: true,
      });
    });

    it("sibling-index writes do NOT fire other indices' `.changes`", async () => {
      const events = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make(initialItems());
          const firstName = yield* Signal.Optic.getUnsafe(
            state,
            "items.0.name",
          );
          const seen: string[] = [];
          const collector = yield* Effect.fork(
            firstName.changes.pipe(
              Stream.runForEach((v) => Effect.sync(() => seen.push(v))),
            ),
          );
          yield* Effect.sleep("5 millis");
          yield* Signal.Optic.set(state, "items.1.name", "B");
          yield* Signal.Optic.set(state, "items.2.name", "C");
          yield* Effect.sleep("20 millis");
          yield* Fiber.interrupt(collector);
          return seen;
        }),
      );
      expect(events).toEqual([]);
    });

    it("appends via write at index === length", async () => {
      // Index === length is the legitimate "append" case — allowed.
      const result = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make(initialItems());
          yield* Signal.Optic.set(state, "items.3", { name: "d", n: 4 });
          const tree = yield* state.get;
          return tree.items;
        }),
      );
      expect(result).toEqual([
        { name: "a", n: 1 },
        { name: "b", n: 2 },
        { name: "c", n: 3 },
        { name: "d", n: 4 },
      ]);
    });
  });

  describe("set — bounds-checked", () => {
    it("fails with OpticOutOfBoundsError when writing past `length`", async () => {
      const result = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make({
            items: [{ n: 1 }, { n: 2 }],
          });
          return yield* Signal.Optic.set(state, "items.5.n", 99).pipe(
            Effect.either,
          );
        }),
      );
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        const err = result.left;
        expect(err).toBeInstanceOf(OpticOutOfBoundsError);
        expect(err.path).toBe("items.5.n");
        expect(err.index).toBe(5);
        expect(err.length).toBe(2);
      }
    });

    it("fails with OpticOutOfBoundsError for a negative index", async () => {
      const result = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make({
            items: [{ n: 1 }] as { readonly n: number }[],
          });
          // Cast around Paths<T>'s ${number} branch to reach a negative
          // — no legitimate typed code path emits a negative index.
          return yield* (
            Signal.Optic.set as unknown as (
              o: unknown,
              p: string,
              v: unknown,
            ) => Effect.Effect<void, OpticOutOfBoundsError>
          )(state, "items.-1.n", 99).pipe(Effect.either);
        }),
      );
      expect(Either.isLeft(result)).toBe(true);
    });

    it("does NOT fail when index === length (append)", async () => {
      const result = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make({ items: [1, 2, 3] });
          return yield* Signal.Optic.set(state, "items.3", 4).pipe(
            Effect.either,
          );
        }),
      );
      expect(Either.isRight(result)).toBe(true);
    });

    it("auto-creates missing object intermediates (unchanged from setUnsafe)", async () => {
      // `set` is bounds-checked but still willingly builds up object
      // intermediates — that's a deliberate feature, distinct from the
      // array bounds rule.
      const result = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make(
            {} as { readonly a?: { readonly b?: number } },
          );
          yield* Signal.Optic.set(state, "a.b", 5);
          return yield* state.get;
        }),
      );
      expect(result).toEqual({ a: { b: 5 } });
    });

    it("leaves state and subscribers untouched when the write fails", async () => {
      const result = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make({
            items: [{ n: 1 }],
          });
          const item0 = yield* Signal.Optic.getUnsafe(state, "items.0");
          const seen: unknown[] = [];
          const collector = yield* Effect.fork(
            item0.changes.pipe(
              Stream.runForEach((v) => Effect.sync(() => seen.push(v))),
            ),
          );
          yield* Effect.sleep("5 millis");

          const exit = yield* Effect.exit(
            Signal.Optic.set(state, "items.5.n", 99),
          );
          expect(Exit.isFailure(exit)).toBe(true);

          yield* Effect.sleep("10 millis");
          yield* Fiber.interrupt(collector);

          return {
            tree: yield* state.get,
            emissions: seen,
          };
        }),
      );
      expect(result.tree).toEqual({ items: [{ n: 1 }] });
      expect(result.emissions).toEqual([]);
    });
  });

  describe("setUnsafe — unchecked", () => {
    it("silently creates holes when writing past `length`", async () => {
      // This is the "you own the resulting type violation" branch.
      const tree = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make({
            items: [{ n: 1 }] as ({ readonly n: number } | undefined)[],
          });
          yield* Signal.Optic.setUnsafe(state, "items.3.n", 99);
          return yield* state.get;
        }),
      );
      expect(tree.items.length).toBe(4);
      expect(tree.items[0]).toEqual({ n: 1 });
      expect(tree.items[1]).toBeUndefined();
      expect(tree.items[2]).toBeUndefined();
      expect(tree.items[3]).toEqual({ n: 99 });
    });
  });

  describe("update — bounds-checked", () => {
    it("fails with OpticOutOfBoundsError when updating past `length`", async () => {
      const result = await runScoped(
        Effect.gen(function* () {
          const state = yield* Signal.Optic.make({
            items: [{ n: 1 }, { n: 2 }],
          });
          return yield* Signal.Optic.update(
            state,
            "items.5.n",
            (n) => n + 1,
          ).pipe(Effect.either);
        }),
      );
      expect(Either.isLeft(result)).toBe(true);
    });
  });
});
