---
"@stax-ui/dom": patch
---

fix(dom): exit-side `_register` now runs in `removeSlot`'s calling fiber

`forkSlotRemoval` used to place group resolution + `_register` inside
its forked animation body. `Animation.parallel(N)` (and `sequence`)
open each group's gate immediately and schedule
`Effect.forkDaemon(sleep(0))` to fire `_done` if `pending === 0` on
the next tick — the empty-group fast-path, so downstream sequence
steps don't stall on animations that never arrive.

The forked body and the fast-path daemon both wake on the next
scheduler tick. When the group is created in a different fiber than
the one that will register on it (e.g. the router outlet's
`getTransitionForKey` creates the exit group in one fiber, and
`reconcile`'s `removeSlot` dispatches `forkSlotRemoval` in another),
the daemon frequently won the race: `_done` fired with `pending ===
0`, before `_register` had a chance to run. Downstream
`Animation.awaitDone(exitGroup)` — the router's per-nav exit gate,
custom `Router.scrollBehavior` fns waiting for the outgoing slot to
finish leaving — resolved immediately instead of gating on the
exit animation.

The fix mirrors `forkSlotEnter`: resolve the group and call
`_register` in the caller's fiber (`removeSlot`'s dispatch), then
fork only the animation body. `pending` is >= 1 by the time
`yield* forkSlotRemoval(...)` returns, so the fast-path check sees a
non-zero count and doesn't misfire.

Regression test in `slotAnimation.test.ts` asserts `pending >= 1`
synchronously after the `yield*` — no sleep between, so the fast-
path daemon can't have run.
