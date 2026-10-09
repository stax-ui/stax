/**
 * Tests for the UniqueId service — the core guarantee being tested is
 * SSR/hydration ID matching per #173.
 *
 * The underlying mechanics:
 * - `UniqueId.make` draws from a scoped `IdGenerator` when one is in
 *   scope, otherwise falls back to a module-global counter.
 * - `makeIdGeneratorLayer()` returns a fresh counter each call.
 * - Entry points (`mount`, `hydrate`, `toHttpRoutes`, `buildStaticSite`)
 *   each provide their own layer, so counters are per-render.
 */

import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { makeIdGeneratorLayer, UniqueId } from "./UniqueId.js";

describe("UniqueId", () => {
  describe("scoped IdGenerator", () => {
    it("counts from 1 inside a freshly-provided IdGenerator layer", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const a = yield* UniqueId.make("panel");
          const b = yield* UniqueId.make("panel");
          const c = yield* UniqueId.make("input");
          return [a, b, c];
        }).pipe(Effect.provide(makeIdGeneratorLayer())),
      );
      expect(result).toEqual(["panel-1", "panel-2", "input-3"]);
    });

    it("gives a fresh counter per layer instance", async () => {
      // Two separate 'renders' — each gets its own layer. Both should
      // see ids starting at 1. This is the core SSR fix: request N
      // doesn't leak into request N+1.
      const render = Effect.gen(function* () {
        const a = yield* UniqueId.make("panel");
        const b = yield* UniqueId.make("panel");
        return [a, b];
      });

      const first = await Effect.runPromise(
        render.pipe(Effect.provide(makeIdGeneratorLayer())),
      );
      const second = await Effect.runPromise(
        render.pipe(Effect.provide(makeIdGeneratorLayer())),
      );

      expect(first).toEqual(["panel-1", "panel-2"]);
      expect(second).toEqual(["panel-1", "panel-2"]);
    });

    it("produces identical sequences for identical render orders — SSR/hydration contract", async () => {
      // The invariant hydrate relies on: as long as the client renders
      // the same tree in the same order as the server, ids match.
      const sameTree = Effect.gen(function* () {
        return {
          label: yield* UniqueId.make("label"),
          input: yield* UniqueId.make("input"),
          hint: yield* UniqueId.make("hint"),
        };
      });

      const serverIds = await Effect.runPromise(
        sameTree.pipe(Effect.provide(makeIdGeneratorLayer())),
      );
      const clientIds = await Effect.runPromise(
        sameTree.pipe(Effect.provide(makeIdGeneratorLayer())),
      );

      expect(clientIds).toEqual(serverIds);
    });
  });

  describe("fallback counter (no IdGenerator in scope)", () => {
    it("still produces unique sequential ids without a provided layer", async () => {
      await Effect.runPromise(UniqueId._reset());
      const a = await Effect.runPromise(UniqueId.make("fallback"));
      const b = await Effect.runPromise(UniqueId.make("fallback"));
      // Fallback counter is module-global; values are sequential but
      // their absolute number depends on test order. Just check they
      // differ and share the prefix.
      expect(a).toMatch(/^fallback-\d+$/);
      expect(b).toMatch(/^fallback-\d+$/);
      expect(a).not.toBe(b);
    });

    it("default prefix is 'uid'", async () => {
      await Effect.runPromise(UniqueId._reset());
      const id = await Effect.runPromise(UniqueId.make());
      expect(id).toMatch(/^uid-\d+$/);
    });

    it("_reset only resets the fallback counter, not scoped layers", async () => {
      // Scoped layers have their own counters and ignore _reset entirely.
      const run = Effect.gen(function* () {
        const first = yield* UniqueId.make("x");
        yield* UniqueId._reset();
        const second = yield* UniqueId.make("x");
        return [first, second];
      });
      const [a, b] = await Effect.runPromise(
        run.pipe(Effect.provide(makeIdGeneratorLayer())),
      );
      expect(a).toBe("x-1");
      expect(b).toBe("x-2");
    });
  });

  describe("prefix handling", () => {
    it("preserves the caller's prefix across calls", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          return [
            yield* UniqueId.make("alpha"),
            yield* UniqueId.make("beta"),
            yield* UniqueId.make("gamma"),
          ];
        }).pipe(Effect.provide(makeIdGeneratorLayer())),
      );
      expect(result).toEqual(["alpha-1", "beta-2", "gamma-3"]);
    });
  });
});
