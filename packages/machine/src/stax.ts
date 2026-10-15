/**
 * Stax adapters — turn a `MachineHandle`'s subscription surface into
 * `@stax-ui/core` Readables, so Stax components can bind to a
 * machine's state and output declaratively (via `$.div`, `when`,
 * `match`, etc.) without writing a `yield* MyMachine.subscribe(...)`
 * dance by hand.
 *
 * Lives in its own subpath (`@stax-ui/machine/stax`) so the runtime
 * itself doesn't drag `@stax-ui/core` into every machine import —
 * only consumers using machines with Stax pay for it. Peer adapters
 * for other UI libraries (React, Vue, Solid, …) can land under
 * `@stax-ui/machine/<framework>` the same way.
 *
 * @example
 * ```ts
 * import { MachineReadable } from "@stax-ui/machine/stax";
 *
 * const UserGreeting = () =>
 *   Effect.gen(function* () {
 *     const session = yield* SessionMachine;
 *     const user = MachineReadable.field(session, "user");
 *     const isAuthed = MachineReadable.inState(session, "signedIn");
 *
 *     return $.div(
 *       { class: isAuthed.map((v) => (v ? "signed-in" : "signed-out")) },
 *       when(isAuthed, {
 *         true: () => $.p({}, "Hello, ", user.map((u) => u?.name ?? "")),
 *         false: () => $.p({}, "Please sign in."),
 *       }),
 *     );
 *   });
 * ```
 *
 * @module
 */

import { Effect, Stream } from "effect";

import { Readable } from "@stax-ui/core";

import type { MachineHandle, TaggedError } from "./types.js";

/**
 * Each adapter below takes a `MachineHandle` by its first three
 * generics only (`States`, `Events`, `Output`) and treats
 * `CaughtTags` / `UserE` as pass-through. The adapters only touch
 * the snapshot and subscribe surfaces — not `dispatch` — so the
 * dispatch error channel's shape doesn't affect them. Fixing the
 * handle param at a wildcard (`AnyMachineHandle` below) sidesteps
 * contravariance on `dispatch`'s return type that would otherwise
 * reject a handle whose dispatch channel the caller widened.
 */
type AnyMachineHandle<States, Events, Output> = MachineHandle<
  States,
  Events,
  Output,
  string,
  TaggedError
>;

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Build a Readable from a current-value getter and a callback-style
 * subscribe. The Readable's `get` reads the current value; its
 * `changes` Stream emits each subscription notification. Cleanup
 * (returned from the subscribe fn) is tied to the Stream's own
 * lifecycle — the fiber consuming the Stream unsubscribes when it
 * ends.
 *
 * `dedupe` applies `Stream.changes` on top of the raw emission
 * stream, for sources where the subscribe may fire the same value
 * twice in a row (e.g., `subscribeCanDispatch` emits per state
 * transition even if the specific event's handleability didn't
 * change; a derived boolean from `subscribeState` emits per state
 * change even if both states map to the same boolean).
 */
const readableFromCallback = <A>(
  getCurrent: () => A,
  subscribe: (cb: (value: A) => void) => () => void,
  dedupe = false,
): Readable.Readable<A> => {
  const getChanges = () => {
    const raw = Stream.async<A>((emit) => {
      const unsubscribe = subscribe((value) => {
        emit.single(value);
      });
      return Effect.sync(unsubscribe);
    });
    return dedupe ? raw.pipe(Stream.changes) : raw;
  };
  return Readable.make(Effect.sync(getCurrent), getChanges);
};

// =============================================================================
// Public factories
// =============================================================================

/**
 * Readable of the machine's full output. Pairs with
 * `handle.output` + `handle.subscribe`.
 */
export const outputReadable = <States, Events, Output>(
  handle: AnyMachineHandle<States, Events, Output>,
): Readable.Readable<Output> =>
  readableFromCallback(
    () => handle.output,
    (cb) => handle.subscribe(cb),
  );

/**
 * Readable of one field of the output. Pairs with the matching
 * `subscribeTo(key, …)` which only fires when that field changes
 * (by `Object.is`).
 */
export const fieldReadable = <States, Events, Output, K extends keyof Output>(
  handle: AnyMachineHandle<States, Events, Output>,
  key: K,
): Readable.Readable<Output[K]> =>
  readableFromCallback(
    () => handle.output[key],
    (cb) => handle.subscribeTo(key, cb),
  );

/**
 * Readable of the current state name. Pairs with `handle.state()` +
 * `handle.subscribeState`. Emits on every transition.
 */
export const stateReadable = <States, Events, Output>(
  handle: AnyMachineHandle<States, Events, Output>,
): Readable.Readable<keyof States & string> =>
  readableFromCallback(
    () => handle.state(),
    (cb) => handle.subscribeState(cb),
  );

/**
 * Readable of "is the machine currently in `name`". Derived from
 * `subscribeState` — the raw `subscribeInState` is edge-triggered
 * on entry only, which can't tell us when the predicate flips to
 * `false`. Deduped so transitions between two non-matching states
 * don't double-emit `false`.
 */
export const inStateReadable = <
  States,
  Events,
  Output,
  K extends keyof States & string,
>(
  handle: AnyMachineHandle<States, Events, Output>,
  name: K,
): Readable.Readable<boolean> =>
  readableFromCallback(
    () => handle.inState(name),
    (cb) => handle.subscribeState((s) => cb(s === name)),
    true,
  );

/**
 * Readable of "can this event be dispatched right now". Pairs with
 * `subscribeCanDispatch(event, …)`. Deduped — the runtime fires the
 * subscriber on every transition with the current boolean, which
 * can repeat the same value when the event's handleability didn't
 * actually change (e.g., a global `on:` keeps it true across
 * states).
 */
export const canDispatchReadable = <
  States,
  Events,
  Output,
  K extends keyof Events & string,
>(
  handle: AnyMachineHandle<States, Events, Output>,
  event: K,
): Readable.Readable<boolean> =>
  readableFromCallback(
    () => handle.canDispatch(event),
    (cb) => handle.subscribeCanDispatch(event, cb),
    true,
  );

/**
 * Readable of the current set of handleable events (union of
 * per-state and spec-level `on:`). Pairs with
 * `handle.availableEvents()` + `handle.subscribeAvailableEvents`.
 *
 * Not deduped — the runtime emits a fresh array per transition, so
 * reference equality always differs. Shallow-array equality isn't
 * trivially correct for every consumer, so if that matters, pipe
 * through `Stream.changesWith` with your own equality.
 */
export const availableEventsReadable = <States, Events, Output>(
  handle: AnyMachineHandle<States, Events, Output>,
): Readable.Readable<ReadonlyArray<keyof Events & string>> =>
  readableFromCallback(
    () => handle.availableEvents(),
    (cb) => handle.subscribeAvailableEvents(cb),
  );

/**
 * Namespace grouping all `MachineHandle` → `Readable` factories.
 * Call-site reads nicely: `MachineReadable.field(session, "user")`.
 */
export const MachineReadable = {
  output: outputReadable,
  field: fieldReadable,
  state: stateReadable,
  inState: inStateReadable,
  canDispatch: canDispatchReadable,
  availableEvents: availableEventsReadable,
} as const;
