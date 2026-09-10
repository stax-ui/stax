/**
 * @module @stax-ui/machine
 *
 * Framework-neutral state machines for Effect. Declarative reducers
 * with typed events, per-state payloads, and snapshot/subscribe
 * outputs that any reactive framework can wrap.
 *
 * See `dev_notes/STATE_MACHINE_PROPOSAL.md` for the design rationale.
 *
 * ## Status
 *
 * First-pass runtime landed. Covered:
 *
 * - `Machine.Service` (singleton machines) + `Machine.serviceLayer`
 * - `self.context` / `self.assign` / `self.dispatch` /
 *   `self.dispatchOrFail` / `self.transition` / `self.onExit`
 * - Context store with per-handler batching (subscribers see one
 *   atomic notification per event)
 * - Event queue with per-machine mutex (FIFO, serial)
 * - State scope machinery — each state gets its own scope that
 *   closes on transition, firing finalizers and canceling
 *   forked fibers
 * - Output projection with reference-equal-diff notifications
 * - `snapshot` / `output` / `state` / `inState` / `canDispatch` /
 *   `availableEvents` / `dispatch` / `dispatchOrFail` on the handle
 * - `subscribe` / `subscribeTo` / `subscribeState` /
 *   `subscribeInState` — callback-based
 *
 * Not yet:
 * - `Machine.Factory` + `Machine.factoryLayer` + `.spawn(args)`
 * - `self.transitionAwait` (register/go primitive)
 * - `awaitState` (external coordination)
 * - `subscribeEffect` / `subscribeToEffect` / etc. — Effect-flavored
 *   subscribe siblings
 * - `subscribeCanDispatch` / `subscribeAvailableEvents`
 * - Global `on:` handler map
 */

import { Context, Effect, Layer, type Scope } from "effect";
import type * as ContextModule from "effect/Context";

import { createRuntime } from "./runtime.js";
import {
  MalformedSpec,
  NotImplemented,
  TransitionLimit,
  type MachineFactory,
  type MachineHandle,
  type MachineSelf,
  type Spec,
} from "./types.js";

// =============================================================================
// Type re-exports
// =============================================================================

export type {
  AnyTransition,
  HandlerMap,
  MachineFactory,
  MachineHandle,
  MachineSelf,
  PayloadArg,
  Spec,
  StateFn,
  Transition,
} from "./types.js";

export {
  MalformedSpec,
  NotImplemented,
  TransitionLimit,
  UnhandledEvent,
} from "./types.js";

// =============================================================================
// Class-based declaration
// =============================================================================

// Phantom markers so the class carries the machine's generics past
// the Context.Tag machinery — used to reconstruct the types at
// layer-construction sites without re-declaring them.
declare const _states: unique symbol;
declare const _events: unique symbol;
declare const _context: unique symbol;
declare const _output: unique symbol;
declare const _inputs: unique symbol;
declare const _deps: unique symbol;

/**
 * Marker interface held on the Service base class. Extends
 * `Context.TagClass` so the class remains yieldable / usable
 * anywhere an Effect `Tag` is expected — `yield* MyMachine` works
 * the same as it does for any other service.
 */
export interface ServiceClass<
  Self,
  States,
  Events,
  Context,
  Output,
  R = never,
> extends ContextModule.TagClass<
  Self,
  string,
  MachineHandle<States, Events, Output>
> {
  // Phantom markers so the class carries the machine's generics —
  // used by serviceLayer to recover them. Optional so `class Foo
  // extends Machine.Service<...>()("Foo") {}` doesn't need to
  // "implement" them.
  readonly [_states]?: States;
  readonly [_events]?: Events;
  readonly [_context]?: Context;
  readonly [_output]?: Output;
  readonly [_deps]?: R;
  Default?: Layer.Layer<Self, MalformedSpec | TransitionLimit, R>;
}

/**
 * Marker interface held on the Factory base class. Extends
 * `Context.TagClass` so the class remains yieldable — `yield*
 * MyFactory` gives you the factory, then `.spawn(args)` produces
 * a fresh instance.
 */
export interface FactoryClass<
  Self,
  States,
  Events,
  Inputs,
  Context,
  Output,
  R = never,
> extends ContextModule.TagClass<
  Self,
  string,
  MachineFactory<States, Events, Inputs, Output>
> {
  readonly [_states]?: States;
  readonly [_events]?: Events;
  readonly [_inputs]?: Inputs;
  readonly [_context]?: Context;
  readonly [_output]?: Output;
  readonly [_deps]?: R;
  Default?: Layer.Layer<Self, NotImplemented, R>;
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
 * The double-paren pattern matches `Effect.Service` — separating
 * the class-declaration call from the type-parameter site lets TS
 * carry the `Self` binding through cleanly.
 *
 * Under the hood: the returned class extends `Context.Tag(name)`
 * with `MachineHandle<States, Events, Output>` as its service type.
 * `yield* MyMachine` produces the handle.
 */
export const Service =
  <Self, States, Events, Context, Output, R = never>() =>
  (name: string): ServiceClass<Self, States, Events, Context, Output, R> => {
    class ServiceBase extends Context.Tag(name)<
      Self,
      MachineHandle<States, Events, Output>
    >() {}
    return ServiceBase as unknown as ServiceClass<
      Self,
      States,
      Events,
      Context,
      Output,
      R
    >;
  };

/**
 * Base class factory for instanced machines. See `Service`. The
 * yielded service is a `MachineFactory` — call `.spawn(args)` on it
 * to produce a fresh instance per parent.
 *
 * **Runtime not implemented in this commit** — the class factory
 * compiles for use-site type-checking but attempting to actually
 * yield or spawn will die. Wiring lands in a follow-up alongside
 * `factoryLayer`.
 */
export const Factory =
  <Self, States, Events, Inputs, Context, Output, R = never>() =>
  (
    name: string,
  ): FactoryClass<Self, States, Events, Inputs, Context, Output, R> => {
    class FactoryBase extends Context.Tag(name)<
      Self,
      MachineFactory<States, Events, Inputs, Output>
    >() {}
    return FactoryBase as unknown as FactoryClass<
      Self,
      States,
      Events,
      Inputs,
      Context,
      Output,
      R
    >;
  };

// =============================================================================
// Layer constructors
// =============================================================================

/**
 * Layer constructor for a Service machine. The builder receives
 * `self` (typed against the class's generics) and returns an Effect
 * that resolves to the spec.
 *
 * ```ts
 * SessionMachine.Default = Machine.serviceLayer(
 *   SessionMachine,
 *   (self) => Effect.gen(function* () {
 *     const authAPI = yield* AuthAPI;
 *     return {
 *       initial: "booting",
 *       context: { user: null },
 *       output: (ctx) => ({ user: ctx.user }),
 *       on: { ... },
 *       states: { ... },
 *     };
 *   }),
 * );
 * ```
 */
export const serviceLayer = <Self, States, Events, Context, Output, R>(
  cls: ServiceClass<Self, States, Events, Context, Output, R>,
  builder: (
    self: MachineSelf<States, Events, Context>,
  ) => Effect.Effect<Spec<States, Events, Context, Output>, never, R>,
): Layer.Layer<Self, MalformedSpec | TransitionLimit, R> => {
  const tag = cls as unknown as Context.Tag<
    Self,
    MachineHandle<States, Events, Output>
  >;
  return Layer.scoped(
    tag,
    createRuntime<States, Events, Context, Output, R>(builder),
  );
};

/**
 * Layer constructor for a Factory machine. **Not implemented in this
 * commit.** Will build a `MachineFactory` whose `.spawn(args)` runs
 * per instance and returns a fresh `MachineHandle`.
 */
export const factoryLayer = <Self, States, Events, Inputs, Context, Output, R>(
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
): Layer.Layer<Self, NotImplemented, R> => {
  const tag = cls as unknown as Context.Tag<
    Self,
    MachineFactory<States, Events, Inputs, Output>
  >;
  return Layer.scoped(
    tag,
    Effect.gen(function* () {
      // Consume `builder` at the type level so its generics stay bound;
      // real wiring in the follow-up commit.
      void builder;
      return yield* Effect.fail(
        new NotImplemented({ feature: "Machine.factoryLayer" }),
      );
    }),
  );
};

// =============================================================================
// Namespace re-export
// =============================================================================

/**
 * Public namespace. Value-side: `Machine.Service`, `Machine.Factory`,
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
