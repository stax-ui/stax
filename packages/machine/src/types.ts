/**
 * Pure type declarations for `@stax-ui/machine`. Split out from
 * `index.ts` so the runtime can import type-only symbols cleanly
 * without pulling in the whole public surface.
 *
 * Consumers should import from `@stax-ui/machine` (the package
 * root), not from this file directly.
 */

import { Data, type Effect, type Scope } from "effect";

// =============================================================================
// Core value types
// =============================================================================

export const TransitionTypeId = Symbol.for("@stax-ui/machine/Transition");
export type TransitionTypeId = typeof TransitionTypeId;

/**
 * Internal marker — stamped on the Transition returned by
 * `self.transitionAwait`. Tells the runtime "this is a pending
 * async wait; register's `go` will fire later and drive the
 * transition externally — don't chain to the target yet."
 *
 * Not part of the public surface. Users only observe plain
 * `Transition`s; the sentinel bit is handled inside `enterStateRec`.
 */
export const TransitionAwaitTypeId = Symbol.for(
  "@stax-ui/machine/TransitionAwait",
);
export type TransitionAwaitTypeId = typeof TransitionAwaitTypeId;

/**
 * A state-change instruction — returned from a state fn or handler.
 * The runtime interprets it and drives the transition; state fns
 * don't call any `transition()` method imperatively.
 */
export interface Transition<S extends string = string, P = unknown> {
  readonly [TransitionTypeId]: TransitionTypeId;
  readonly target: S;
  readonly payload: P;
}

/**
 * Failure produced by `machine.dispatchOrFail` (and `self.dispatchOrFail`)
 * when the current state has no handler for the dispatched event.
 * Carries both the event name and the current state name so error
 * messages are actionable.
 */
export class UnhandledEvent extends Data.TaggedError("UnhandledEvent")<{
  readonly event: string;
  readonly state: string;
}> {}

/**
 * Raised as an Effect **defect** (`Effect.die`) when the runtime
 * tries to enter a state whose name doesn't appear in the spec's
 * `states` map. The type system already rejects
 * `self.transition("bogus")` at compile time; landing here at runtime
 * requires fighting the types with `as never` or dynamic key access,
 * so it's treated as a programmer bug rather than a recoverable
 * condition.
 *
 * Not a typed error — it never appears on `dispatch`'s error
 * channel. Recovery requires `Effect.catchAllCause` /
 * `Effect.catchAllDefect` upstream; the common case is "let it crash
 * the fiber and surface in the defect reporter."
 */
export class MalformedSpec extends Data.TaggedError("MalformedSpec")<{
  readonly reason: string;
  readonly state?: string;
}> {}

// =============================================================================
// Error catching
// =============================================================================

/**
 * Structural constraint for anything that can appear in a machine's
 * error channel. Any `Data.TaggedError` subclass satisfies this —
 * the runtime routes caught tags through `Effect.catchTags`, which
 * matches on `_tag` and nothing else.
 */
export type TaggedError = { readonly _tag: string };

/**
 * Spec-level `catch` block — one handler per tagged error the user
 * wants the runtime to absorb at the dispatch boundary. Keys are
 * the `_tag` strings of the `UserE` subclasses the machine
 * declared. Each value takes the specific error whose `_tag`
 * matches and returns an `Effect<void>` — die, log, no-op, whatever
 * recovery policy fits.
 *
 * `CaughtTags` is the subset of tags the user declared the machine
 * would catch (via the Service/Factory class's `CaughtTags`
 * generic); keys are typed against that subset so the compiler
 * refuses incomplete maps. Framework runtime bugs (`MalformedSpec`)
 * are not catchable here — they die as defects.
 */
export type CatchHandlerMap<
  CaughtTags extends string,
  UserE extends TaggedError = never,
> = {
  readonly [T in CaughtTags]: (
    e: Extract<UserE, { readonly _tag: T }>,
  ) => Effect.Effect<void>;
};

// =============================================================================
// Generic helpers
// =============================================================================

/**
 * Discriminated union of every valid transition for a machine's
 * state map. State fns and handlers return one of these (or a
 * handler map, or void).
 */
export type AnyTransition<States> = {
  [K in keyof States]: Transition<K & string, States[K]>;
}[keyof States];

/**
 * `UserE` with any tags listed in `CaughtTags` excluded. Shared
 * helper for the dispatch surfaces — the declared error channel on
 * `handle.dispatch` / `self.dispatch` / their `OrFail` siblings is
 * this type.
 *
 * Framework runtime bugs (`MalformedSpec`, formerly `TransitionLimit`)
 * are never on this channel — they die as defects. The whole dispatch
 * error channel is user-domain errors only.
 */
export type UncaughtErrors<
  CaughtTags extends string,
  UserE extends TaggedError = never,
> = Exclude<UserE, { readonly _tag: CaughtTags }>;

/**
 * `[payload?]` tuple when a state or event carries no payload,
 * `[payload]` tuple otherwise. Lets `self.transition("booting")`
 * skip the payload arg for empty payloads while requiring
 * `self.transition("signedIn", {user})` where user data is needed.
 *
 * "No payload" is spelled `undefined` in `States` / `Events` maps —
 * `@typescript-eslint/no-empty-object-type` flags the historical
 * `{}` spelling as ambiguous ("any non-nullish"), so machines
 * written with linting on prefer `undefined`. The legacy
 * `Record<string, never>` / `{}` shapes still work for backward
 * compatibility.
 */
export type PayloadArg<T> = [T] extends [undefined | Record<string, never>]
  ? [payload?: T]
  : [payload: T];

// =============================================================================
// self — the machine's own-operation surface
// =============================================================================

/**
 * The handle passed as the first (Service) or second (Factory)
 * argument to a machine builder. Typed against the machine's own
 * generics so `self.transition("name", payload)` narrows against
 * the state map and `self.assign(patch)` checks against Context.
 */
export interface MachineSelf<
  States,
  Events,
  Context,
  CaughtTags extends string = never,
  UserE extends TaggedError = never,
> {
  /**
   * Current committed context. Plain getter — no yield. Always
   * safe: `self` is only reachable from callbacks the runtime
   * invokes post-init (state fns, handlers, `ready`), so context
   * is guaranteed populated by the time this is read.
   */
  readonly context: Context;

  /** Merge a patch into context via the event loop. */
  assign(patch: Partial<Context>): Effect.Effect<void>;
  /** Computed-patch form for when the new value depends on the old. */
  assign(fn: (ctx: Context) => Partial<Context>): Effect.Effect<void>;

  /**
   * Put an event on this instance's queue. Silent no-op if the
   * current state has no handler. Used mainly by async external
   * event producers (stream `onChunk`, socket message handler,
   * `setInterval`) registered inside a state fn or `ready` — the
   * producer's callback closes over `self` and dispatches whenever
   * it emits.
   */
  dispatch<K extends keyof Events & string>(
    event: K,
    ...args: PayloadArg<Events[K]>
  ): Effect.Effect<void, UncaughtErrors<CaughtTags, UserE>>;

  /**
   * Same as `dispatch`, but fails with `UnhandledEvent` when the
   * current state has no handler. Use when the caller knows the
   * machine should be able to handle the event — assertions in
   * tests, coordinated transitions where state was already checked.
   */
  dispatchOrFail<K extends keyof Events & string>(
    event: K,
    ...args: PayloadArg<Events[K]>
  ): Effect.Effect<void, UnhandledEvent | UncaughtErrors<CaughtTags, UserE>>;

  /**
   * Construct a transition to `name` with `payload`. Return the
   * result from a state fn or handler to trigger the state change.
   * Typing enforces that `name` is a valid state and `payload`
   * matches that state's declared shape.
   *
   * Returns an Effect so the one-line case (`() =>
   * self.transition("name")`) reads clean without an
   * `Effect.succeed(...)` wrapper. From inside a `gen`, use
   * `return yield* self.transition(...)` — same shape as
   * `self.transitionAwait`.
   */
  transition<K extends keyof States & string>(
    name: K,
    ...args: PayloadArg<States[K]>
  ): Effect.Effect<Transition<K, States[K]>>;

  /**
   * Construct a transition that fires when `register`'s `go`
   * callback is invoked. `register` sets up any listener (child
   * machine state, DOM event, socket, timer) and returns an
   * unsubscribe fn that fires when the state scope closes. Same
   * shape as `Effect.async`.
   */
  transitionAwait<K extends keyof States & string>(
    register: (go: () => void) => () => void,
    name: K,
    ...args: PayloadArg<States[K]>
  ): Effect.Effect<Transition<K, States[K]>>;

  /**
   * Sugar over `Effect.addFinalizer` scoped to the current state's
   * scope. Reads intent ("run this when I leave this state") vs.
   * mechanism ("register a cleanup"). Called from inside a state
   * fn, which already runs in a Scope, so no additional context is
   * required at the call site.
   */
  onExit(effect: Effect.Effect<void>): Effect.Effect<void, never, Scope.Scope>;
}

// =============================================================================
// Handler map and state fn
// =============================================================================

/**
 * Default error channel for state fns and handlers. Empty by
 * construction — runtime bugs (`MalformedSpec` from a bad transition
 * target) die as defects rather than propagating through the typed
 * error channel, and user errors are opt-in via the Service/Factory
 * class's `UserE` generic.
 *
 * Kept as a named alias so widening the implicit channel in the
 * future (e.g., adding a cancellation signal) has one place to
 * touch.
 */
type SelfMethodErrors = never;

/**
 * Per-state handler map. Each key is an event name; each handler
 * takes the event's payload and returns an Effect that resolves to
 * a Transition (state change) or void (stay in this state).
 *
 * Handlers close over their state fn's `self` — the runtime does
 * not pass self to handlers directly. That keeps the common case
 * (small handlers that mutate a bit of context and transition)
 * readable, and self is always the same reference the state fn
 * just received.
 */
export type HandlerMap<States, Events, E = SelfMethodErrors, R = never> = {
  [K in keyof Events]?: (
    payload: Events[K],
  ) => Effect.Effect<AnyTransition<States> | void, E, R>;
};

/**
 * A state fn. Runs on entry with `(self, payload)`. Everything up
 * to the return is entry setup; the return value determines what
 * happens next:
 *
 * - Returns a `HandlerMap` → active state, waits for events. The
 *   handlers close over `self` from the state fn's argument.
 * - Returns `AnyTransition` → task state, transitions immediately.
 * - Returns void → no-op state, no handlers install.
 *
 * Condition-waiters return `self.transitionAwait(...)`, which
 * resolves to an `AnyTransition` on the register callback firing.
 *
 * State fns run with the state's `Scope` auto-provided, so entry
 * code can use `self.onExit`, `Effect.addFinalizer`,
 * `Effect.forkScoped`, or any other scoped effect without the
 * caller having to add `Scope.Scope` to the Spec's `R`. (The
 * `HandlerMap` handlers themselves don't get a Scope — they run
 * from the drain loop. Scoped work goes in state-fn entry, not in
 * handlers.)
 */
export type StateFn<
  K extends keyof States,
  States,
  Events,
  Context,
  E = SelfMethodErrors,
  R = never,
  CaughtTags extends string = never,
  UserE extends TaggedError = never,
> = (
  self: MachineSelf<States, Events, Context, CaughtTags, UserE>,
  payload: States[K],
) => Effect.Effect<
  HandlerMap<States, Events, E, R> | AnyTransition<States> | void,
  E,
  R | Scope.Scope
>;

// =============================================================================
// Spec
// =============================================================================

/**
 * The object shape a builder returns. `context` is required (initial
 * context); `output` projects context to the public shape; `states`
 * maps every state name to its state fn; `on` is optional handlers
 * that fire in every state (unless a state overrides); `ready` is
 * an optional post-init hook — runs once with `self`, in the
 * machine's parent scope, for machine-lifetime setup (cross-machine
 * mirror subscriptions, background workers, etc.).
 */
/**
 * Core spec fields shared by every machine. Extracted so the
 * `catch` requirement can be added conditionally based on
 * `CaughtTags`.
 */
interface SpecBase<
  States,
  Events,
  Context,
  Output,
  E,
  R,
  CaughtTags extends string,
  UserE extends TaggedError,
> {
  readonly initial: keyof States & string;
  readonly context: Context;
  readonly output: (ctx: Context) => Output;
  /**
   * Spec-level fallback handlers that fire in any state. Precedence
   * is per-state wins: when a dispatched event has both a handler on
   * the current state's handler map AND a handler here, the per-state
   * one runs and this one is ignored for that dispatch.
   *
   * Handlers receive `(self, payload)` — the state-fn's closure
   * isn't available at spec level, so `self` is passed explicitly.
   *
   * Fires even while the machine is in a `transitionAwait`-held
   * state or a task state with no local handler map, since the whole
   * point of a global handler is "respond regardless of state." If a
   * global handler returns a transition during such a hold, the
   * state scope closes (firing `transitionAwait`'s unsubscribe) and
   * the machine transitions as directed. `canDispatch`,
   * `availableEvents`, and their `subscribe*` siblings reflect the
   * union of per-state + global handleable events, so UI can wire
   * against the real "will this be handled?" surface.
   */
  readonly on?: {
    [K in keyof Events]?: (
      self: MachineSelf<States, Events, Context, CaughtTags, UserE>,
      payload: Events[K],
    ) => Effect.Effect<AnyTransition<States> | void, E, R>;
  };
  readonly states: {
    [K in keyof States]: StateFn<
      K,
      States,
      Events,
      Context,
      E,
      R,
      CaughtTags,
      UserE
    >;
  };
  /**
   * Machine-lifetime setup — runs once, immediately after the
   * runtime initializes and before the initial state fn is called.
   * Receives `self` (always safe here — post-init by construction).
   * The Effect runs in the machine's parent scope, so anything
   * scope-registered (`subscribeToEffect`, `forkScoped`,
   * `addFinalizer`) lives for the machine's entire lifetime.
   */
  readonly ready?: (
    self: MachineSelf<States, Events, Context, CaughtTags, UserE>,
  ) => Effect.Effect<void, E, R | Scope.Scope>;
}

/**
 * The object shape a builder returns. `context` is required (initial
 * context); `output` projects context to the public shape; `states`
 * maps every state name to its state fn; `on` is optional handlers
 * that fire in every state (unless a state overrides); `ready` is
 * an optional post-init hook — runs once with `self`, in the
 * machine's parent scope, for machine-lifetime setup (cross-machine
 * mirror subscriptions, background workers, etc.).
 *
 * When `CaughtTags` is non-empty (set at the Service/Factory class
 * level), the spec must also declare a `catch` block with a handler
 * per tag — see `catch` doc on the Catch branch below.
 */
export type Spec<
  States,
  Events,
  Context,
  Output,
  E = SelfMethodErrors,
  R = never,
  CaughtTags extends string = never,
  UserE extends TaggedError = never,
> = SpecBase<States, Events, Context, Output, E, R, CaughtTags, UserE> &
  // `unknown` is the identity for intersection — when `CaughtTags`
  // is empty we don't layer any extra requirement onto SpecBase.
  // `{}` would have worked here too, but
  // `@typescript-eslint/no-empty-object-type` flags it.
  ([CaughtTags] extends [never]
    ? unknown
    : {
        /**
         * Spec-level catch handlers, one per user-defined tagged
         * error the machine declared it would absorb. When a
         * dispatch surface (`handle.dispatch` / `handle.dispatchOrFail`
         * / `self.dispatch` / `self.dispatchOrFail`) would fail with
         * one of the listed tags, the runtime routes to the matching
         * handler instead and the tag drops out of the method's
         * declared error channel. The handler can die, log, no-op —
         * whatever recovery policy the machine wants.
         *
         * Keys match the Service/Factory class's `CaughtTags`
         * generic exactly — a subset of the `UserE` subclasses'
         * `_tag` strings. Framework runtime bugs (`MalformedSpec`)
         * are not catchable here; they always die as defects and
         * `Effect.catchAllCause` is the only way to intercept them.
         */
        readonly catch: CatchHandlerMap<CaughtTags, UserE>;
      });

// =============================================================================
// Consumer-facing handle
// =============================================================================

/**
 * What consumers get from `yield* MyMachine` (Service) or
 * `factory.spawn(args)` (Factory). Backend-neutral: snapshot
 * methods return plain values, subscribes take plain callbacks.
 * Effect-flavored subscribe siblings (`subscribeEffect`, etc.)
 * live alongside the callback-based ones for Effect-using
 * consumers.
 */
export interface MachineHandle<
  States,
  Events,
  Output,
  CaughtTags extends string = never,
  UserE extends TaggedError = never,
> {
  // -------- Snapshots --------
  snapshot(): Output;
  state(): keyof States & string;
  inState<K extends keyof States & string>(name: K): boolean;
  canDispatch<K extends keyof Events & string>(event: K): boolean;
  availableEvents(): ReadonlyArray<keyof Events & string>;

  /** Snapshot of the current output. Mirrors the shape of `Output`. */
  readonly output: Output;

  // -------- Callback-based subscribes (framework-neutral) --------
  subscribe(cb: (output: Output) => void): () => void;
  subscribeTo<K extends keyof Output>(
    field: K,
    cb: (value: Output[K]) => void,
  ): () => void;
  subscribeState(cb: (state: keyof States & string) => void): () => void;
  /** Edge-triggered: fires when the machine enters `name`. */
  subscribeInState<K extends keyof States & string>(
    name: K,
    cb: () => void,
  ): () => void;
  subscribeCanDispatch<K extends keyof Events & string>(
    event: K,
    cb: (canDispatch: boolean) => void,
  ): () => void;
  subscribeAvailableEvents(
    cb: (events: ReadonlyArray<keyof Events & string>) => void,
  ): () => void;

  // -------- Effect-flavored subscribes (Stax-friendly) --------
  subscribeEffect(
    cb: (output: Output) => Effect.Effect<void>,
  ): Effect.Effect<void, never, Scope.Scope>;
  subscribeToEffect<K extends keyof Output>(
    field: K,
    cb: (value: Output[K]) => Effect.Effect<void>,
  ): Effect.Effect<void, never, Scope.Scope>;
  subscribeStateEffect(
    cb: (state: keyof States & string) => Effect.Effect<void>,
  ): Effect.Effect<void, never, Scope.Scope>;
  subscribeInStateEffect<K extends keyof States & string>(
    name: K,
    cb: () => Effect.Effect<void>,
  ): Effect.Effect<void, never, Scope.Scope>;
  subscribeCanDispatchEffect<K extends keyof Events & string>(
    event: K,
    cb: (canDispatch: boolean) => Effect.Effect<void>,
  ): Effect.Effect<void, never, Scope.Scope>;
  subscribeAvailableEventsEffect(
    cb: (events: ReadonlyArray<keyof Events & string>) => Effect.Effect<void>,
  ): Effect.Effect<void, never, Scope.Scope>;

  // -------- Dispatch --------
  dispatch<K extends keyof Events & string>(
    event: K,
    ...args: PayloadArg<Events[K]>
  ): Effect.Effect<void, UncaughtErrors<CaughtTags, UserE>>;
  dispatchOrFail<K extends keyof Events & string>(
    event: K,
    ...args: PayloadArg<Events[K]>
  ): Effect.Effect<void, UnhandledEvent | UncaughtErrors<CaughtTags, UserE>>;

  // -------- External coordination --------
  /** Suspends until the machine enters `name`. */
  awaitState<K extends keyof States & string>(name: K): Effect.Effect<void>;
}

/**
 * What a Factory's Layer provides. `spawn` produces a fresh
 * `MachineHandle` per call, scoped to the caller's Scope. The
 * spawn Effect has an empty error channel — runtime bugs die as
 * defects, and the per-instance spec is already built when `spawn`
 * is called.
 */
export interface MachineFactory<
  States,
  Events,
  Inputs,
  Output,
  CaughtTags extends string = never,
  UserE extends TaggedError = never,
> {
  spawn(
    args: Inputs,
  ): Effect.Effect<
    MachineHandle<States, Events, Output, CaughtTags, UserE>,
    never,
    Scope.Scope
  >;
}
