/**
 * @module @stax-ui/machine
 *
 * Framework-neutral state machines for Effect. Declarative reducers
 * with typed events, per-state payloads, and snapshot/subscribe
 * outputs that any reactive framework can wrap.
 *
 * The runtime is Effect-native: each state gets its own `Scope` that
 * closes on transition out (finalizers fire, forked fibers cancel);
 * context updates batch per handler into one subscriber notification;
 * the event queue is FIFO under a per-machine mutex. `self` is only
 * ever handed to callbacks the runtime invokes post-init, so it can't
 * be observed before the machine's spec is built.
 *
 * ---
 *
 * ## Service machine — one instance per app
 *
 * Use `Machine.Service` when there's logically one of these in your
 * program (session, feature flags, a global websocket). The class is
 * both the Context tag and the class the Layer registers against.
 *
 * ```ts
 * import { Effect, Layer } from "effect";
 * import { Machine } from "@stax-ui/machine";
 *
 * // Payload per state — use `{}` where there's no payload. The
 * // state-fn arg and the transition-arg for a given state are both
 * // typed against the value here.
 * interface SessionStates {
 *   signedOut: {};
 *   signingIn: { email: string };
 *   signedIn: { user: User };
 * }
 *
 * interface SessionEvents {
 *   SIGN_IN: { email: string; password: string };
 *   SIGN_OUT: {};
 * }
 *
 * interface SessionContext {
 *   user: User | null;
 * }
 *
 * interface SessionOutput {
 *   user: User | null;
 *   isAuthenticated: boolean;
 * }
 *
 * // Double-paren pattern matches `Effect.Service`: splitting the
 * // class-declaration call from the type-parameter site lets TS
 * // carry the `Self` binding through cleanly. The last generic is
 * // whatever services the builder depends on.
 * class SessionMachine extends Machine.Service<
 *   SessionMachine,
 *   SessionStates,
 *   SessionEvents,
 *   SessionContext,
 *   SessionOutput,
 *   AuthAPI
 * >()("SessionMachine") {}
 *
 * // Live layer. The builder is an `Effect<Spec>` — yield services
 * // in the outer Effect, return the spec. `self` is NOT in scope
 * // here; the runtime passes it to each state fn as `(self, payload)`.
 * export const SessionLive = Machine.serviceLayer(
 *   SessionMachine,
 *   Effect.gen(function* () {
 *     const auth = yield* AuthAPI;
 *     return {
 *       initial: "signedOut" as const,
 *       context: { user: null },
 *       output: (ctx) => ({
 *         user: ctx.user,
 *         isAuthenticated: ctx.user !== null,
 *       }),
 *       states: {
 *         signedOut: (self) =>
 *           Effect.succeed({
 *             SIGN_IN: ({ email, password }) =>
 *               self.transition("signingIn", { email }),
 *           }),
 *         signingIn: (self, { email }) =>
 *           Effect.gen(function* () {
 *             const user = yield* auth.signIn({ email });
 *             yield* self.assign({ user });
 *             return yield* self.transition("signedIn", { user });
 *           }),
 *         signedIn: (self) =>
 *           Effect.succeed({
 *             SIGN_OUT: () =>
 *               Effect.gen(function* () {
 *                 yield* self.assign({ user: null });
 *                 return yield* self.transition("signedOut");
 *               }),
 *           }),
 *       },
 *     };
 *   }),
 * );
 *
 * // Consume. `yield* SessionMachine` gives you the handle.
 * const program = Effect.gen(function* () {
 *   const session = yield* SessionMachine;
 *   yield* session.dispatch("SIGN_IN", { email, password });
 *   yield* session.awaitState("signedIn");
 *   return session.snapshot();
 * });
 *
 * Effect.runPromise(
 *   program.pipe(
 *     Effect.scoped,
 *     Effect.provide(SessionLive),
 *     Effect.provide(AuthAPILive),
 *   ),
 * );
 * ```
 *
 * ---
 *
 * ## Factory machine — N instances, one per `.spawn(args)`
 *
 * Use `Machine.Factory` when you need many of them — one per dialog,
 * one per chat conversation, one per polling fetcher. Each spawned
 * instance is a fresh `MachineHandle` scoped to the caller's Scope,
 * so it tears down with the component that spawned it.
 *
 * ```ts
 * interface FetcherStates {
 *   idle: {};
 *   fetching: {};
 *   loaded: { data: Data };
 *   failed: { error: FetchError };
 * }
 * interface FetcherEvents {
 *   FETCH: {};
 *   RETRY: {};
 * }
 * interface FetcherContext {
 *   url: string;
 *   data: Data | null;
 *   error: FetchError | null;
 * }
 * interface FetcherOutput {
 *   url: string;
 *   data: Data | null;
 *   error: FetchError | null;
 * }
 * // Inputs — the args shape for `.spawn(args)`.
 * interface FetcherInputs {
 *   url: string;
 * }
 *
 * class FetcherMachine extends Machine.Factory<
 *   FetcherMachine,
 *   FetcherStates,
 *   FetcherEvents,
 *   FetcherInputs,
 *   FetcherContext,
 *   FetcherOutput,
 *   HttpClient
 * >()("FetcherMachine") {}
 *
 * // Live layer. The outer `Effect<{ spawn }>` runs once at
 * // layer-construction time — yield services shared across every
 * // spawn. `spawn(args)` runs on each `.spawn` call and returns the
 * // instance's spec.
 * export const FetcherLive = Machine.factoryLayer(
 *   FetcherMachine,
 *   Effect.gen(function* () {
 *     const http = yield* HttpClient;
 *     return {
 *       spawn: ({ url }) =>
 *         Effect.succeed({
 *           initial: "idle" as const,
 *           context: { url, data: null, error: null },
 *           output: (ctx) => ({
 *             url: ctx.url,
 *             data: ctx.data,
 *             error: ctx.error,
 *           }),
 *           states: {
 *             idle: (self) =>
 *               Effect.succeed({
 *                 FETCH: () => self.transition("fetching"),
 *               }),
 *             fetching: (self) =>
 *               http.get(self.context.url).pipe(
 *                 Effect.flatMap((data) =>
 *                   Effect.gen(function* () {
 *                     yield* self.assign({ data });
 *                     return yield* self.transition("loaded", { data });
 *                   }),
 *                 ),
 *                 Effect.catchAll((error) =>
 *                   Effect.gen(function* () {
 *                     yield* self.assign({ error });
 *                     return yield* self.transition("failed", { error });
 *                   }),
 *                 ),
 *               ),
 *             loaded: (self) =>
 *               Effect.succeed({
 *                 FETCH: () => self.transition("fetching"),
 *               }),
 *             failed: (self) =>
 *               Effect.succeed({
 *                 RETRY: () => self.transition("fetching"),
 *               }),
 *           },
 *         }),
 *     };
 *   }),
 * );
 *
 * // Consume. `yield* FetcherMachine` gives you the factory; call
 * // `.spawn(args)` to get a per-instance handle.
 * const program = Effect.gen(function* () {
 *   const fetchers = yield* FetcherMachine;
 *   const posts = yield* fetchers.spawn({ url: "/api/posts" });
 *   yield* posts.dispatch("FETCH");
 *   yield* posts.awaitState("loaded");
 *   return posts.snapshot();
 * });
 *
 * Effect.runPromise(
 *   program.pipe(
 *     Effect.scoped,
 *     Effect.provide(FetcherLive),
 *     Effect.provide(HttpClientLive),
 *   ),
 * );
 * ```
 *
 */

import { Context, Effect, Layer, type Scope } from "effect";
import type * as ContextModule from "effect/Context";

import { createFactoryRuntime, createRuntime } from "./runtime.js";
import {
  MalformedSpec,
  TransitionLimit,
  type MachineFactory,
  type MachineHandle,
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
  MachineUninitialized,
  MalformedSpec,
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
  Default?: Layer.Layer<Self, never, R>;
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
 * Layer constructor for a Service machine. The builder is a plain
 * `Effect<Spec, never, R>` — yield services in the outer Effect and
 * return the spec. `self` is NOT in scope here; it's handed to each
 * state fn as `(self, payload)`, to each spec-level `on:` handler
 * as `(self, payload)`, and to the `ready` hook as `(self)`. That
 * placement makes `MachineUninitialized` unrepresentable by
 * construction — `self` can't even be named before init.
 *
 * ```ts
 * SessionMachine.Default = Machine.serviceLayer(
 *   SessionMachine,
 *   Effect.gen(function* () {
 *     const authAPI = yield* AuthAPI;
 *     return {
 *       initial: "booting",
 *       context: { user: null },
 *       output: (ctx) => ({ user: ctx.user }),
 *       on: { SIGN_OUT: (self) => self.assign({ user: null }) },
 *       ready: (self) => authAPI.subscribeToken((t) =>
 *         self.assign({ token: t }),
 *       ),
 *       states: {
 *         booting: (self) => self.transition("signedOut"),
 *         // ...
 *       },
 *     };
 *   }),
 * );
 * ```
 */
export const serviceLayer = <Self, States, Events, Context, Output, R>(
  cls: ServiceClass<Self, States, Events, Context, Output, R>,
  builder: Effect.Effect<Spec<States, Events, Context, Output>, never, R>,
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
 * Layer constructor for a Factory machine. The outer builder is an
 * `Effect<{ spawn }, never, R>` — it yields shared services once at
 * layer-construction time and returns a `spawn(args)` function.
 * `.spawn(args)` is called per instance and returns an
 * `Effect<Spec, never, Scope>` for that instance; the runtime wraps
 * it into a fresh `MachineHandle` scoped to whatever scope the
 * caller of `.spawn(args)` provides.
 *
 * Same "no `self` in outer scope" story as `serviceLayer`: neither
 * the outer builder nor the per-instance spawn Effect ever sees
 * `self` — it's handed to state fns, `on:` handlers, and `ready`
 * at invocation time.
 *
 * ```ts
 * ConversationMachine.Default = Machine.factoryLayer(
 *   ConversationMachine,
 *   Effect.gen(function* () {
 *     const conversationApi = yield* ConversationAPI;
 *     return {
 *       spawn: ({ initialId }) =>
 *         Effect.gen(function* () {
 *           return {
 *             initial: "idle",
 *             context: { conversationId: initialId ?? null },
 *             output: (ctx) => ({ conversationId: ctx.conversationId }),
 *             states: { ... },
 *           };
 *         }),
 *     };
 *   }),
 * );
 * ```
 */
export const factoryLayer = <Self, States, Events, Inputs, Context, Output, R>(
  cls: FactoryClass<Self, States, Events, Inputs, Context, Output, R>,
  builder: Effect.Effect<
    {
      spawn: (
        args: Inputs,
      ) => Effect.Effect<
        Spec<States, Events, Context, Output>,
        never,
        Scope.Scope
      >;
    },
    never,
    R
  >,
): Layer.Layer<Self, never, R> => {
  const tag = cls as unknown as Context.Tag<
    Self,
    MachineFactory<States, Events, Inputs, Output>
  >;
  return Layer.effect(
    tag,
    createFactoryRuntime<States, Events, Inputs, Context, Output, R>(builder),
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
