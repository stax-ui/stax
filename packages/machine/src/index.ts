/**
 * @module @stax-ui/machine
 *
 * Framework-neutral state machines for Effect. Declarative reducers
 * with typed events, per-state payloads, and snapshot/subscribe
 * outputs that any reactive framework can wrap.
 *
 * **Status: TYPE SKETCH ONLY.** Runtime is stubbed with `throw new
 * Error("not implemented")`. This file exists to validate that the
 * type-level story compiles cleanly — that `self.transition("state",
 * payload)` narrows against the machine's state map, that handler
 * maps accept the right event payloads, that `self.assign(patch)`
 * checks against the Context type, and so on. Runtime lands in a
 * separate commit once the types are solid.
 */

import { Data, type Effect, type Layer, type Scope } from "effect";

// =============================================================================
// Core value types
// =============================================================================

/**
 * A state-change instruction — returned from a state fn or handler.
 * The runtime interprets it and drives the transition; state fns
 * don't call any `transition()` method imperatively.
 */
export interface Transition<S extends string = string, P = unknown> {
  readonly _tag: "@stax-ui/machine/Transition";
  readonly target: S;
  readonly payload: P;
}

/**
 * Failure produced by `machine.dispatchOrFail` (and `self.dispatchOrFail`)
 * when the current state has no handler for the dispatched event.
 * Carries both the event name and the current state name so error
 * messages are actionable.
 */
export class UnhandledEvent extends Data.TaggedError(
  "@stax-ui/machine/UnhandledEvent",
)<{
  readonly event: string;
  readonly state: string;
}> {}

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
 * `[payload?]` tuple if a state's payload has no keys (`{}`),
 * `[payload]` tuple otherwise. Lets `self.transition("booting")`
 * skip the payload arg for empty payloads while requiring
 * `self.transition("signedIn", {user})` where user data is needed.
 */
export type PayloadArg<T> = [T] extends [Record<string, never>]
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
export interface MachineSelf<States, Events, Context> {
  /** Current committed context. Plain getter — no yield. */
  readonly context: Context;

  /** Merge a patch into context via the event loop. */
  assign(patch: Partial<Context>): Effect.Effect<void>;
  /** Computed-patch form for when the new value depends on the old. */
  assign(fn: (ctx: Context) => Partial<Context>): Effect.Effect<void>;

  /**
   * Put an event on this instance's queue. Silent no-op if the
   * current state has no handler. Used mainly by async external
   * event producers (stream `onChunk`, socket message handler,
   * `setInterval`) registered via `Effect.addFinalizer` in a state fn.
   */
  dispatch<K extends keyof Events & string>(
    event: K,
    ...args: PayloadArg<Events[K]>
  ): Effect.Effect<void>;

  /**
   * Same as `dispatch`, but fails with `UnhandledEvent` when the
   * current state has no handler. Use when the caller knows the
   * machine should be able to handle the event — assertions in
   * tests, coordinated transitions where state was already checked.
   */
  dispatchOrFail<K extends keyof Events & string>(
    event: K,
    ...args: PayloadArg<Events[K]>
  ): Effect.Effect<void, UnhandledEvent>;

  /**
   * Construct a transition to `name` with `payload`. Return the
   * result from a state fn or handler to trigger the state change.
   * Typing enforces that `name` is a valid state and `payload`
   * matches that state's declared shape.
   */
  transition<K extends keyof States & string>(
    name: K,
    ...args: PayloadArg<States[K]>
  ): Transition<K, States[K]>;

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
   * mechanism ("register a cleanup").
   */
  onExit(effect: Effect.Effect<void>): Effect.Effect<void>;
}

// =============================================================================
// Handler map and state fn
// =============================================================================

/**
 * Per-state handler map. Each key is an event name; each handler
 * takes the event's payload and returns an Effect that resolves to
 * a Transition (state change) or void (stay in this state).
 */
export type HandlerMap<States, Events, E = never, R = never> = {
  [K in keyof Events]?: (
    payload: Events[K],
  ) => Effect.Effect<AnyTransition<States> | void, E, R>;
};

/**
 * A state fn. Everything up to the return is entry setup; the
 * return value determines what happens next:
 *
 * - Returns a `HandlerMap` → active state, waits for events.
 * - Returns `AnyTransition` → task state, transitions immediately.
 * - Returns void → no-op state, no handlers install.
 *
 * Condition-waiters return `self.transitionAwait(...)`, which
 * resolves to an `AnyTransition` on the register callback firing.
 */
export type StateFn<
  K extends keyof States,
  States,
  Events,
  E = never,
  R = never,
> = (
  payload: States[K],
) => Effect.Effect<
  HandlerMap<States, Events, E, R> | AnyTransition<States> | void,
  E,
  R
>;

// =============================================================================
// Spec — what a machine builder returns
// =============================================================================

/**
 * The object shape a builder returns. `context` is required (initial
 * context); `output` projects context to the public shape; `states`
 * maps every state name to its state fn; `on` is optional handlers
 * that fire in every state (unless a state overrides).
 */
export interface Spec<States, Events, Context, Output, E = never, R = never> {
  readonly initial: keyof States & string;
  readonly context: Context;
  readonly output: (ctx: Context) => Output;
  readonly on?: HandlerMap<States, Events, E, R>;
  readonly states: {
    [K in keyof States]: StateFn<K, States, Events, E, R>;
  };
}

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
export interface MachineHandle<States, Events, Output> {
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
  ): Effect.Effect<void>;
  dispatchOrFail<K extends keyof Events & string>(
    event: K,
    ...args: PayloadArg<Events[K]>
  ): Effect.Effect<void, UnhandledEvent>;

  // -------- External coordination --------
  awaitState<K extends keyof States & string>(name: K): Effect.Effect<void>;
}

/**
 * What a Factory's Layer provides. `spawn` produces a fresh
 * `MachineHandle` per call, scoped to the caller's Scope.
 */
export interface MachineFactory<States, Events, Inputs, Output> {
  spawn(
    args: Inputs,
  ): Effect.Effect<MachineHandle<States, Events, Output>, never, Scope.Scope>;
}

// =============================================================================
// Class-based declaration + layer constructors
// =============================================================================

// Phantom markers so the class carries the generics past the Effect.Tag
// machinery — used to reconstruct the types at layer-construction sites
// without re-declaring them.
declare const _states: unique symbol;
declare const _events: unique symbol;
declare const _context: unique symbol;
declare const _output: unique symbol;
declare const _inputs: unique symbol;
declare const _deps: unique symbol;

/** Marker type held on the Service base class. */
export interface ServiceClass<
  Self,
  States,
  Events,
  Context,
  Output,
  R = never,
> {
  new (_: never): MachineHandle<States, Events, Output>;
  readonly _tag: string;
  readonly [_states]: States;
  readonly [_events]: Events;
  readonly [_context]: Context;
  readonly [_output]: Output;
  readonly [_deps]: R;
  Default: Layer.Layer<Self, never, R>;
}

/** Marker type held on the Factory base class. */
export interface FactoryClass<
  Self,
  States,
  Events,
  Inputs,
  Context,
  Output,
  R = never,
> {
  new (_: never): MachineFactory<States, Events, Inputs, Output>;
  readonly _tag: string;
  readonly [_states]: States;
  readonly [_events]: Events;
  readonly [_inputs]: Inputs;
  readonly [_context]: Context;
  readonly [_output]: Output;
  readonly [_deps]: R;
  Default: Layer.Layer<Self, never, R>;
}

/**
 * Base class factory for singleton machines. Use as:
 *
 * ```ts
 * class SessionMachine extends Machine.Service<
 *   SessionMachine, States, Events, Context, Output, Deps
 * >()("SessionMachine") {}
 * ```
 *
 * The double-paren pattern matches `Effect.Service` — the `<Self>`
 * generic is separated from the runtime call so TS can infer other
 * generics from usage sites cleanly.
 */
export declare const Service: <
  Self,
  States,
  Events,
  Context,
  Output,
  R = never,
>() => (name: string) => ServiceClass<Self, States, Events, Context, Output, R>;

/** Base class factory for instanced machines. See `Service`. */
export declare const Factory: <
  Self,
  States,
  Events,
  Inputs,
  Context,
  Output,
  R = never,
>() => (
  name: string,
) => FactoryClass<Self, States, Events, Inputs, Context, Output, R>;

/**
 * Layer constructor for a Service machine. The builder receives
 * `self` (typed against the class's generics) and returns an Effect
 * that resolves to the spec.
 */
export declare const serviceLayer: <Self, States, Events, Context, Output, R>(
  cls: ServiceClass<Self, States, Events, Context, Output, R>,
  builder: (
    self: MachineSelf<States, Events, Context>,
  ) => Effect.Effect<Spec<States, Events, Context, Output>, never, R>,
) => Layer.Layer<Self, never, R>;

/**
 * Layer constructor for a Factory machine. The outer Effect runs
 * once at Layer build; the returned `spawn` fn runs per instance
 * with `(args, self)`.
 */
export declare const factoryLayer: <
  Self,
  States,
  Events,
  Inputs,
  Context,
  Output,
  R,
>(
  cls: FactoryClass<Self, States, Events, Inputs, Context, Output, R>,
  builder: Effect.Effect<
    {
      spawn: (
        args: Inputs,
        self: MachineSelf<States, Events, Context>,
      ) => Effect.Effect<
        Spec<States, Events, Context, Output>,
        never,
        Scope.Scope
      >;
    },
    never,
    R
  >,
) => Layer.Layer<Self, never, R>;

// =============================================================================
// Namespace re-export
// =============================================================================

/**
 * Public namespace. `Machine.Service`, `Machine.Factory`,
 * `Machine.serviceLayer`, `Machine.factoryLayer`. Types
 * (`Transition`, `MachineSelf`, `HandlerMap`, `Spec`, etc.) are
 * exported at module top-level.
 */
export const Machine = {
  Service,
  Factory,
  serviceLayer,
  factoryLayer,
} as const;
