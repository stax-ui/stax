import { describe, it } from "@effect/vitest";
import { Deferred, Effect } from "effect";
import { beforeEach, expect } from "vitest";

import { Animation } from "../Animation/index.js";
import { AnimationConfigCtx } from "./AnimationConfigCtx.js";
import { forkSlotRemoval } from "./slotAnimation.js";

describe("slotAnimation", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  describe("forkSlotRemoval", () => {
    // Regression: exit-side `_register` used to live inside the
    // forked body — the fork itself yielded to the scheduler, and
    // the body's `yield* readAnimation → yield* resolveGroup` chain
    // ran on subsequent ticks. `Animation.parallel(N)` opens the
    // group's gate and schedules `Effect.forkDaemon(sleep(0))` to
    // fire `_done` if `pending === 0` on the next tick; the daemon
    // could win the race and fire `_done` before `_register`
    // landed. Downstream `Animation.awaitDone(exitGroup)` then
    // resolved immediately instead of gating on the exit animation.
    //
    // The fix moves resolution + `_register` into the caller's
    // fiber (matches `forkSlotEnter`'s pattern) so `pending` is >=
    // 1 by the time `yield* forkSlotRemoval(...)` returns —
    // synchronously with the caller (reconcile's removeSlot
    // dispatch).
    it.scopedLive(
      "registers on the exit group in the caller's fiber (before the forked body runs)",
      () =>
        Effect.gen(function* () {
          const [g] = yield* Animation.parallel(1);
          const el = document.createElement("div");
          document.body.appendChild(el);

          // Verify the fast-path is armed but hasn't fired yet — the
          // register we're about to observe needs to beat it.
          expect(yield* Deferred.isDone(g._done)).toBe(false);
          expect(g._state.pending).toBe(0);

          yield* forkSlotRemoval({ element: el, scope: null }, () => {}).pipe(
            Effect.provideService(AnimationConfigCtx, {
              single: {
                exit: "transition-opacity duration-30",
                exitTo: "opacity-0",
                exitGroup: g,
                timeout: 30,
              },
            }),
          );

          // Same synchronous chunk — no `Effect.sleep`, no yield
          // that would let the fast-path daemon or the forked
          // exit-animation body run. Register MUST have happened in
          // the caller's fiber.
          expect(g._state.pending).toBeGreaterThanOrEqual(1);
          expect(yield* Deferred.isDone(g._done)).toBe(false);
        }),
    );
  });
});
