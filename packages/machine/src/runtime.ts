/**
 * State machine runtime.
 *
 * Invariants:
 * - Context store with `self.assign` — assigns within a single
 *   handler batch into one subscriber notification; assigns from
 *   outside a handler (e.g. a mirror subscription callback) notify
 *   immediately.
 * - Event queue with per-machine mutex — one handler at a time,
 *   FIFO. Events dispatched mid-handler queue and drain after.
 * - State scope machinery — each state gets its own CloseableScope
 *   that closes on transition, firing any `addFinalizer`s and
 *   canceling any `forkScoped` fibers registered inside the state fn.
 * - Output projection — pure fn of context, recomputed on any
 *   assign, subscribers notified when the projected value differs
 *   by reference (shallow equal on top-level fields).
 * - Handler installation timing — state fn's Effect runs first,
 *   handlers install on return.
 * - Transition value interpretation — `self.transition(...)`'s
 *   returned value drives the next state entry. Sync-transition
 *   chains are trampolined (loop, not recursion), so cycles are
 *   stack-safe. There's no depth cap: convergent cycles run through
 *   cleanly, non-convergent ones spin the fiber until interrupted.
 * - Event dispatch precedence — per-state handler map first, then
 *   spec-level `on:` map. Globals fire even in condition-wait or
 *   task states (no local handler map); if a global returns a
 *   transition it closes the pending state scope cleanly.
 */

import { Effect, Exit, Predicate, Record, Runtime, Scope } from "effect";

import {
  MalformedSpec,
  TransitionAwaitTypeId,
  TransitionTypeId,
  UnhandledEvent,
  type HandlerMap,
  type MachineFactory,
  type MachineHandle,
  type MachineSelf,
  type Spec,
  type TaggedError,
  type Transition,
} from "./types.js";

// =============================================================================
// Internal helpers
// =============================================================================

/** Duck-type check for a Transition value returned from a state fn / handler. */
const isTransition = (value: unknown): value is Transition =>
  Predicate.hasProperty(value, TransitionTypeId);

/**
 * Duck-type check for the pending-async-wait sentinel from
 * `self.transitionAwait`. These are regular Transitions decorated
 * with an internal marker so `enterStateRec` can recognize them and
 * hold the state (no handlers, no chaining) until the register's
 * `go` fires.
 */
const isTransitionAwait = (value: Transition): boolean =>
  Predicate.hasProperty(value, TransitionAwaitTypeId);

/** Reference-equality shallow-object equality for output projection. */
const shallowEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return false;
  }
  const ka = Object.keys(a as Record<string, unknown>);
  const kb = Object.keys(b as Record<string, unknown>);
  if (ka.length !== kb.length) return false;
  for (const key of ka) {
    if (
      !Object.is(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      )
    ) {
      return false;
    }
  }
  return true;
};

/**
 * Wrap an Effect with `Effect.catchTags` for each handler the spec
 * declared under `catch`. Once applied, the handled tags drop out
 * of the Effect's error channel. Called at every dispatch surface
 * (`handle.dispatch` / `handle.dispatchOrFail` / `self.dispatch` /
 * `self.dispatchOrFail`) so the catch policy applies uniformly to
 * any path that could surface a runtime error.
 *
 * The runtime impl stays type-opaque — the handle/self interfaces
 * carry the `CaughtTags` generic, which does the narrowing at the
 * boundary. The spec's `catch` keys are the exact `_tag` strings
 * of the errors they absorb (built-in `"MalformedSpec"` /
 * `"TransitionLimit"`, or whatever `_tag` the user's own
 * `TaggedError` subclasses carry), so the map we hand to
 * `Effect.catchTags` is already keyed correctly — no translation
 * step needed.
 */
const applyCatches = <E>(
  catches: RuntimeCatches,
  effect: Effect.Effect<void, E>,
): Effect.Effect<void, E> => {
  if (!catches) return effect;
  // Open the Effect's error channel to a tagged shape so
  // `Effect.catchTags` can match on `_tag`. The return cast closes
  // it back to the original `E`, minus whatever `catchTags` handled
  // — the handle/self interface types reflect that at the boundary.
  return (
    effect as unknown as Effect.Effect<void, { readonly _tag: string }>
  ).pipe(Effect.catchTags(catches)) as Effect.Effect<void, E>;
};

// =============================================================================
// Runtime state
// =============================================================================

interface QueuedEvent {
  readonly event: string;
  readonly payload: unknown;
}

/**
 * Runtime-side type for the catch handler map. The user-facing
 * `CatchHandlerMap<CaughtTags, UserE>` has concrete tag keys with
 * per-tag payload types; here we treat the map as a plain
 * `_tag`-keyed record so the dispatch sites don't need to carry
 * the user's `CaughtTags` / `UserE` generics.
 */
type RuntimeCatches =
  | Record<string, (e: { readonly _tag: string }) => Effect.Effect<void>>
  | undefined;

interface Runtime<States, Events, Context, Output> {
  // Machine identity + spec. Spec's generics are opaque at the
  // runtime layer — the type-safe narrowing (CaughtTags, UserE)
  // happens at the handle/self boundary, not inside the loop. We
  // widen the E channel here so the spec stored can carry any
  // user-level tagged errors the handlers may yield.
  readonly spec: Spec<
    States,
    Events,
    Context,
    Output,
    { readonly _tag: string }
  >;

  /**
   * Pre-extracted spec-level catches, keyed by error `_tag`.
   * `undefined` when the spec has no catch block. Pulled off the
   * spec once at `instantiateMachine` so the dispatch surfaces don't
   * re-read the field (or re-assert its runtime type) on every call.
   */
  readonly catches: RuntimeCatches;

  // The `self` handle for this runtime — passed to state fns,
  // handlers, `ready`, and any callback the runtime invokes.
  // Populated immediately after runtime init (so it can reference
  // `runtime` in its closures).
  self: MachineSelf<States, Events, Context>;

  // Live state
  currentState: string;
  currentPayload: unknown;
  context: Context;
  currentOutput: Output;
  handlers: HandlerMap<States, Events> | null;

  // Event loop
  readonly eventQueue: Array<QueuedEvent>;
  isProcessing: boolean;
  dirtyOutput: boolean;

  // State scope — closes on transition out
  stateScope: Scope.CloseableScope | null;
  // The machine's parent scope — everything nested closes when this does
  readonly parentScope: Scope.Scope;

  // Subscribers
  readonly subOutput: Set<(output: Output) => void>;
  readonly subOutputField: Map<string, Set<(value: unknown) => void>>;
  readonly subState: Set<(state: string) => void>;
  readonly subInState: Map<string, Set<() => void>>;
  readonly subCanDispatch: Map<string, Set<(canDispatch: boolean) => void>>;
  readonly subAvailableEvents: Set<(events: ReadonlyArray<string>) => void>;
}

// =============================================================================
// Public: build a runtime
// =============================================================================

/**
 * Construct a Service machine's runtime from a builder. Returns a
 * `MachineHandle` scoped to the caller's Scope. Called by
 * `Machine.serviceLayer` to produce the service value.
 *
 * The builder is an `Effect<Spec>` — no `self` in scope. Everything
 * `self`-touching (state fns, handlers, `ready`) receives `self`
 * from the runtime at invocation time, post-init.
 */
export const createRuntime = <
  States,
  Events,
  Context,
  Output,
  R,
  CaughtTags extends string = never,
  UserE extends TaggedError = never,
>(
  builder: Effect.Effect<
    Spec<States, Events, Context, Output, UserE, never, CaughtTags, UserE>,
    never,
    R
  >,
): Effect.Effect<
  MachineHandle<States, Events, Output, CaughtTags, UserE>,
  never,
  R | Scope.Scope
> =>
  Effect.gen(function* () {
    const parentScope = yield* Effect.scope;
    // Build the spec first — no `self` involved, so no
    // initialization race possible by construction.
    const spec = yield* builder;
    return yield* instantiateMachine(spec, parentScope);
  });

/**
 * Construct a Factory machine's runtime from a builder. Returns a
 * `MachineFactory` whose `.spawn(args)` produces a fresh instance
 * scoped to the caller's Scope. Called by `Machine.factoryLayer`
 * to produce the service value.
 *
 * The outer builder runs once at layer-construction time and yields
 * services shared across every instance the factory produces. The
 * per-instance `spawn(args): Effect<Spec>` runs on each call to
 * `.spawn` and produces the instance's spec. Same "no self in
 * outer scope" story as `createRuntime` — `self` is handed to
 * state fns, `on:` handlers, and `ready` at invocation time.
 */
export const createFactoryRuntime = <
  States,
  Events,
  Inputs,
  Context,
  Output,
  R,
  CaughtTags extends string = never,
  UserE extends TaggedError = never,
>(
  builder: Effect.Effect<
    {
      spawn: (
        args: Inputs,
      ) => Effect.Effect<
        Spec<States, Events, Context, Output, UserE, never, CaughtTags, UserE>,
        never,
        Scope.Scope
      >;
    },
    never,
    R
  >,
): Effect.Effect<
  MachineFactory<States, Events, Inputs, Output, CaughtTags, UserE>,
  never,
  R
> =>
  Effect.gen(function* () {
    const { spawn } = yield* builder;
    return {
      spawn: (args: Inputs) =>
        Effect.gen(function* () {
          // The caller's Scope becomes the instance's parent scope —
          // `ready`-registered work, mirror subscriptions, and any
          // spawn-time Scope-registered work live for the instance's
          // lifetime (i.e., until the caller's scope closes).
          const callerScope = yield* Effect.scope;
          const spec = yield* spawn(args);
          return yield* instantiateMachine(spec, callerScope);
        }),
    };
  });

// =============================================================================
// Shared instantiation
// =============================================================================

/**
 * Stand up a runtime from a fully-built spec. Shared between Service
 * (one instance per layer) and Factory (one instance per `.spawn`).
 *
 * The caller is responsible for having yielded whatever builder
 * Effect produced the spec, and for passing the parent scope the
 * instance should be tied to — for Service, that's the layer's
 * scope; for Factory, that's the caller's scope at `.spawn` time.
 */
const instantiateMachine = <
  States,
  Events,
  Context,
  Output,
  CaughtTags extends string,
  UserE extends TaggedError,
>(
  spec: Spec<States, Events, Context, Output, UserE, never, CaughtTags, UserE>,
  parentScope: Scope.Scope,
): Effect.Effect<MachineHandle<States, Events, Output, CaughtTags, UserE>> =>
  Effect.gen(function* () {
    // ---- Runtime init ----
    // Two-step: allocate with a placeholder `self` so `self`
    // itself can close over `runtime` (their references are
    // mutually cyclic). Patch in the real `self` below.
    // The `catch` field is present on specs whose `CaughtTags` is
    // non-empty — read it off the spec here with an opaque cast so
    // the dispatch sites don't need to re-cast each time.
    const catches = (spec as { readonly catch?: RuntimeCatches }).catch;

    // The runtime struct is generic-free in `CaughtTags`/`UserE` —
    // those live only at the handle/self boundary — so widen the
    // stored spec here through the type-opaque Runtime shape.
    const runtime: Runtime<States, Events, Context, Output> = {
      spec: spec as unknown as Runtime<States, Events, Context, Output>["spec"],
      catches,
      self: null as unknown as MachineSelf<States, Events, Context>,
      currentState: spec.initial,
      currentPayload: {},
      context: spec.context,
      currentOutput: spec.output(spec.context),
      handlers: null,
      eventQueue: [],
      isProcessing: false,
      dirtyOutput: false,
      stateScope: null,
      parentScope,
      subOutput: new Set(),
      subOutputField: new Map(),
      subState: new Set(),
      subInState: new Map(),
      subCanDispatch: new Map(),
      subAvailableEvents: new Set(),
    };

    // ---- self construction — post-init, so no guards needed ----
    // Built as an unknown-typed struct then cast to the strict
    // MachineSelf interface at the boundary. The runtime doesn't
    // have the machine's generics available at value time —
    // enforcement is via the interface, satisfied by shape.
    const self = {
      get context() {
        return runtime.context;
      },
      assign: (patchOrFn: unknown) => applyAssign(runtime, patchOrFn),
      dispatch: (event: string, ...args: [] | [unknown]) =>
        applyCatches(runtime.catches, enqueue(runtime, event, args[0])),
      dispatchOrFail: (event: string, ...args: [] | [unknown]) =>
        applyCatches(runtime.catches, enqueue(runtime, event, args[0], "fail")),
      transition: (name: string, ...args: [] | [unknown]) =>
        Effect.succeed({
          [TransitionTypeId]: TransitionTypeId,
          target: name,
          payload: args[0] ?? {},
        } as Transition),
      transitionAwait: (
        register: (go: () => void) => () => void,
        name: string,
        ...args: [] | [unknown]
      ) =>
        // Sync setup — no Effect-level suspension. The state fn
        // continues to return value synchronously; the returned
        // Transition carries the TransitionAwaitTypeId sentinel so
        // enterStateRec knows to hold the state rather than chain
        // to `name` immediately. The actual transition happens
        // later, when the register's `go` fires and triggers
        // enterStateRec externally.
        Effect.gen(function* () {
          const payload = args[0] ?? {};
          let fired = false;
          const unsubscribe = register(() => {
            if (fired) return;
            fired = true;
            // Fire-and-forget: entering the next state (which
            // starts by closing the current state scope) can't
            // happen on the Effect that invoked `go` — that's an
            // external callback with no fiber of its own. Run the
            // transition on a fresh fiber. MalformedSpec /
            // User errors or MalformedSpec defects from the state
            // graph are unrecoverable at this entry point — the
            // register's go callback has no caller to surface them
            // to — so orDie. Subscribers observe the transition
            // settle (or not) via subscribeState etc.
            Effect.runFork(
              enterState(runtime, name, payload).pipe(Effect.orDie),
            );
          });
          // Register unsubscribe on the state scope — if the
          // machine leaves this state via another path (e.g.,
          // another transitionAwait or a sibling event handler
          // fires first), the listener cleanup still runs.
          const stateScope = runtime.stateScope;
          if (stateScope) {
            yield* Scope.addFinalizer(stateScope, Effect.sync(unsubscribe));
          }
          return {
            [TransitionTypeId]: TransitionTypeId,
            [TransitionAwaitTypeId]: TransitionAwaitTypeId,
            target: name,
            payload,
          } as unknown as Transition;
        }),
      onExit: (effect: Effect.Effect<void>) =>
        Effect.addFinalizer(() => effect),
    } as unknown as MachineSelf<States, Events, Context>;

    runtime.self = self;

    // Run the `ready` hook if provided, in the machine's parent
    // scope so anything scope-registered lives for the machine's
    // whole lifetime.
    if (spec.ready) {
      // `self` is stored at the runtime's generic-free shape; the
      // spec's `ready` is typed with the user's full `CaughtTags` /
      // `UserE` generics. The runtime treats the two as the same
      // shape — the generics only narrow the dispatch error
      // channel, which is irrelevant inside the ready hook here.
      const readyEffect = spec.ready(
        self as unknown as Parameters<NonNullable<typeof spec.ready>>[0],
      );
      // `ready` may fail with user-defined errors from its handler
      // body; the runtime treats those as initialization failures
      // and lets them die rather than threading a user error
      // channel through the layer-level signature.
      yield* readyEffect.pipe(
        Effect.orDie,
        Effect.provideService(Scope.Scope, parentScope),
      );
    }

    // Enter the initial state synchronously so consumers hold a
    // fully-ready handle when instantiation returns. If the initial
    // state is a task state that immediately transitions, we settle
    // through the chain here; if it installs handlers, they're
    // installed by the time dispatch calls arrive.
    //
    // Bootstrap failures (MalformedSpec defect, user errors from
    // the initial state fn) die rather than widen the Layer error
    // channel: a machine that can't finish entering its initial
    // state is a hard configuration bug, not something an app
    // should "handle."
    yield* enterState(runtime, spec.initial, {}).pipe(Effect.orDie);

    // The runtime-side handle is built with the generic-free self
    // shape; cast at the boundary to the caller's full generics.
    return buildHandle(runtime) as MachineHandle<
      States,
      Events,
      Output,
      CaughtTags,
      UserE
    >;
  });

// =============================================================================
// Enter state
// =============================================================================

/**
 * Enter a state and process its chain of synchronous transitions.
 *
 * Trampolined: each sync `self.transition(...)` from a task state
 * loops back into the next iteration rather than recursing. There
 * is no depth cap — a legitimate conditional cycle (A → B → A → C,
 * where B flipped the condition) runs through cleanly, and an
 * infinite loop spins the fiber instead of overflowing the stack.
 * The fiber stays interruptable (scope close kills it) and
 * convergent cycles cost nothing.
 *
 * Three exit paths per iteration:
 * - `transitionAwait` sentinel → hold the state, no handlers
 *   install, no drain. The register's `go` fires enterState
 *   externally on resolution.
 * - plain `Transition` → loop with new target/payload (task state
 *   chain).
 * - `HandlerMap` / void → install handlers, notify
 *   handleable-events subscribers, drain the queue, return.
 *
 * Error channel is wide (`unknown`) so user-defined tagged errors
 * from state fns propagate up to whichever caller is wrapping this
 * entry: `applyCatches` on the dispatch surfaces, or `Effect.orDie`
 * for bootstrap entry and `transitionAwait` go callbacks.
 */
const enterState = <States, Events, Context, Output>(
  runtime: Runtime<States, Events, Context, Output>,
  initialName: string,
  initialPayload: unknown,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    let name = initialName;
    let payload = initialPayload;

    while (true) {
      // Close the previous state scope (fires finalizers, cancels
      // forked fibers).
      if (runtime.stateScope) {
        const closing = runtime.stateScope;
        runtime.stateScope = null;
        yield* Scope.close(closing, Exit.void);
      }

      // Clear handlers — new state hasn't installed its map yet.
      runtime.handlers = null;

      // Locate the state fn. Missing name is a type-system escape
      // (dynamic key, `as never`, etc.) — treat as a defect.
      const stateFn = runtime.spec.states[name as keyof States];
      if (!stateFn) {
        return yield* Effect.die(
          new MalformedSpec({
            reason: `state machine has no state named "${name}"`,
            state: name,
          }),
        );
      }

      // Enter the new state.
      runtime.currentState = name;
      runtime.currentPayload = payload;
      notifyState(runtime, name);

      // New scope for this state.
      const stateScope = yield* Scope.make();
      runtime.stateScope = stateScope;

      // Run the state fn in the state's scope, passing self. User
      // errors propagate through the Effect error channel; the
      // runtime treats them as opaque tagged values here and lets
      // them bubble to whichever boundary is wrapping this entry.
      const result = yield* (
        stateFn(
          runtime.self,
          payload as States[keyof States],
        ) as unknown as Effect.Effect<unknown, unknown, Scope.Scope>
      ).pipe(Effect.provideService(Scope.Scope, stateScope));

      // Interpret the return value.
      if (isTransition(result)) {
        if (isTransitionAwait(result)) {
          // Pending async wait — the state fn's transitionAwait set
          // up a register listener and returned a sentinel. Hold
          // the state here: no handlers install, no chaining
          // happens. The register's `go` will fire enterState
          // externally when the condition resolves.
          runtime.handlers = null;
          notifyHandlersChanged(runtime);
          return;
        }
        // Task state / condition-waiter that resolved — loop to
        // the next state entry with the fresh target/payload.
        name = result.target;
        payload = result.payload;
        continue;
      }

      if (result && typeof result === "object") {
        // Active state — install handlers.
        runtime.handlers = result as HandlerMap<States, Events>;
      } else {
        // void — no-op state. Handlers stay null.
        runtime.handlers = null;
      }

      // Now that the handler map is settled for this state, notify
      // canDispatch / availableEvents subscribers.
      notifyHandlersChanged(runtime);

      // Drain any events queued during entry.
      yield* drainQueue(runtime);
      return;
    }
  });

// =============================================================================
// Event queue
// =============================================================================

/**
 * Push an event on the queue. If the loop isn't running, start it.
 * `orFail` controls what happens when the current state has no
 * handler: `false` silently drops (Effect<void>), `true` fails with
 * `UnhandledEvent`.
 */
const enqueue = <States, Events, Context, Output>(
  runtime: Runtime<States, Events, Context, Output>,
  event: string,
  payload: unknown,
  mode: "ignore" | "fail" = "ignore",
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    if (mode === "fail") {
      const localHas =
        runtime.handlers && Record.has(runtime.handlers, event as never);
      const globalHas =
        runtime.spec.on &&
        Record.has(runtime.spec.on as Record<string, unknown>, event);
      if (!localHas && !globalHas) {
        return yield* new UnhandledEvent({
          event,
          state: runtime.currentState,
        });
      }
    }

    runtime.eventQueue.push({ event, payload });
    if (!runtime.isProcessing) {
      yield* drainQueue(runtime);
    }
  });

/**
 * Resolve an event to its handler Effect, preferring the current
 * state's handler map over the spec-level `on:` map. Returns
 * undefined when neither layer handles the event.
 *
 * Per-state handlers close over the state fn's `self` and take just
 * `(payload)`. Global handlers run outside any state fn and have no
 * such closure, so they take `(self, payload)` from the spec — we
 * normalize by invoking the global one with `runtime.self` and
 * returning a Pre-closed `(payload) => Effect<unknown>` so the drain
 * loop treats both uniformly.
 */
const resolveHandler = <States, Events, Context, Output>(
  runtime: Runtime<States, Events, Context, Output>,
  event: string,
): ((payload: unknown) => Effect.Effect<unknown>) | undefined => {
  const local = runtime.handlers?.[event as keyof Events] as
    ((payload: unknown) => Effect.Effect<unknown>) | undefined;
  if (local) return local;

  const global = runtime.spec.on?.[event as keyof Events] as
    | ((
        self: MachineSelf<States, Events, Context>,
        payload: unknown,
      ) => Effect.Effect<unknown>)
    | undefined;
  if (global) {
    return (payload: unknown) => global(runtime.self, payload);
  }
  return undefined;
};

/**
 * Does the runtime have any handler-matchable surface? True if the
 * current state installed a handler map, or if the spec has a
 * non-empty global `on:` map. Used to decide whether `drainQueue`
 * should loop or hold events — a state in condition-wait
 * (`transitionAwait`, task state) has `runtime.handlers === null`,
 * but if the spec has globals those can still fire against the
 * queue.
 */
const hasAnyHandlers = <States, Events, Context, Output>(
  runtime: Runtime<States, Events, Context, Output>,
): boolean => {
  if (runtime.handlers) return true;
  const on = runtime.spec.on as Record<string, unknown> | undefined;
  if (on && Object.keys(on).length > 0) return true;
  return false;
};

/**
 * Drain the event queue serially. One handler at a time; assigns
 * within a handler batch into a single output notification when the
 * handler resolves.
 *
 * Lookup order per event: current state's handler map first, then
 * the spec-level `on:` map. Only when neither matches is the event
 * silently dropped (dispatchOrFail checks the same OR at enqueue
 * time, so strict callers still get `UnhandledEvent`).
 *
 * If no handler surface is installed at all (`runtime.handlers`
 * null AND no spec-level `on:`), events stay queued — they'll drain
 * on the next state entry that installs handlers, or never, if the
 * machine stays in that state forever.
 */
const drainQueue = <States, Events, Context, Output>(
  runtime: Runtime<States, Events, Context, Output>,
): Effect.Effect<void, unknown> =>
  Effect.suspend(() => {
    if (runtime.isProcessing) return Effect.void;

    runtime.isProcessing = true;

    return Effect.gen(function* () {
      while (runtime.eventQueue.length > 0 && hasAnyHandlers(runtime)) {
        const next = runtime.eventQueue.shift();

        if (!next) break;

        const handler = resolveHandler(runtime, next.event);

        if (!handler) {
          // Neither the current state's handler map nor the
          // spec-level `on:` map has this event — drop it (silent
          // dispatch semantics; strict callers used dispatchOrFail
          // which checked both layers at enqueue time).
          continue;
        }

        // Run the handler; capture its return value.
        runtime.dirtyOutput = false;
        const result = yield* handler(next.payload);

        // Notify output subscribers if any assign fired.
        if (runtime.dirtyOutput) {
          runtime.dirtyOutput = false;
          const newOutput = runtime.spec.output(runtime.context);
          notifyOutput(runtime, newOutput);
        }

        if (isTransition(result)) {
          // Transition mid-drain — release the processing flag so
          // enterState can re-enter drainQueue cleanly after the
          // new state's handlers install. (The ensuring below would
          // also clear it after enterState returns; clearing early
          // is what lets the nested drain proceed.)
          runtime.isProcessing = false;
          yield* enterState(runtime, result.target, result.payload);
          return; // enterState will drain any remaining events
        }
        // Non-transition returns keep us in the current state; loop continues.
      }
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          runtime.isProcessing = false;
        }),
      ),
    );
  });

// =============================================================================
// Assign
// =============================================================================

const applyAssign = <States, Events, Context, Output>(
  runtime: Runtime<States, Events, Context, Output>,
  patchOrFn: unknown,
): Effect.Effect<void> =>
  Effect.sync(() => {
    const patch =
      typeof patchOrFn === "function"
        ? (patchOrFn as (ctx: Context) => Partial<Context>)(runtime.context)
        : (patchOrFn as Partial<Context>);

    runtime.context = { ...runtime.context, ...patch };

    if (runtime.isProcessing) {
      // Inside a handler — batch: mark dirty, notify at handler end.
      runtime.dirtyOutput = true;
    } else {
      // Outside handler context (e.g., from a mirror subscription
      // callback): notify immediately.
      const newOutput = runtime.spec.output(runtime.context);
      notifyOutput(runtime, newOutput);
    }
  });

// =============================================================================
// Subscriber notification
// =============================================================================

const notifyOutput = <States, Events, Context, Output>(
  runtime: Runtime<States, Events, Context, Output>,
  newOutput: Output,
): void => {
  const oldOutput = runtime.currentOutput;

  if (shallowEqual(oldOutput, newOutput)) return;

  runtime.currentOutput = newOutput;

  for (const sub of runtime.subOutput) {
    try {
      sub(newOutput);
    } catch {
      // Subscriber errors don't propagate — machine keeps running.
    }
  }

  for (const [field, subs] of runtime.subOutputField) {
    const oldValue = (oldOutput as Record<string, unknown>)[field];
    const newValue = (newOutput as Record<string, unknown>)[field];

    if (Object.is(oldValue, newValue)) continue;

    for (const sub of subs) {
      try {
        sub(newValue);
      } catch {
        /* swallow */
      }
    }
  }
};

const notifyState = <States, Events, Context, Output>(
  runtime: Runtime<States, Events, Context, Output>,
  name: string,
): void => {
  for (const sub of runtime.subState) {
    try {
      sub(name);
    } catch {
      /* swallow */
    }
  }

  const inStateSubs = runtime.subInState.get(name);

  if (inStateSubs) {
    for (const sub of inStateSubs) {
      try {
        sub();
      } catch {
        /* swallow */
      }
    }
  }
};

/**
 * Fire `subscribeCanDispatch` and `subscribeAvailableEvents`
 * subscribers when the handler map changes (i.e., after a transition
 * settles). Called from `enterStateRec` once handlers are installed.
 */
/**
 * Snapshot of what events are handleable right now — the union of
 * the current state's handler map keys and the spec-level `on:`
 * map keys. Shared by `canDispatch`, `availableEvents`, and
 * `notifyHandlersChanged` so consumers see consistent semantics.
 *
 * De-duplicated by Set, so an event handled by both layers appears
 * once. Order isn't guaranteed — callers should treat the result
 * as a set.
 */
const computeHandleableEvents = <States, Events, Context, Output>(
  runtime: Runtime<States, Events, Context, Output>,
): ReadonlyArray<string> => {
  const seen = new Set<string>();
  if (runtime.handlers) {
    for (const key of Object.keys(runtime.handlers)) seen.add(key);
  }
  const on = runtime.spec.on as Record<string, unknown> | undefined;
  if (on) {
    for (const key of Object.keys(on)) seen.add(key);
  }
  return Array.from(seen);
};

const canDispatchEvent = <States, Events, Context, Output>(
  runtime: Runtime<States, Events, Context, Output>,
  event: string,
): boolean => {
  if (
    runtime.handlers &&
    (runtime.handlers as Record<string, unknown>)[event] != null
  ) {
    return true;
  }
  const on = runtime.spec.on as Record<string, unknown> | undefined;
  return on?.[event] != null;
};

const notifyHandlersChanged = <States, Events, Context, Output>(
  runtime: Runtime<States, Events, Context, Output>,
): void => {
  // canDispatch subscribers — fire per-event. OR across local
  // state handlers and spec-level `on:`.
  for (const [event, subs] of runtime.subCanDispatch) {
    const canNow = canDispatchEvent(runtime, event);

    for (const sub of subs) {
      try {
        sub(canNow);
      } catch {
        /* swallow */
      }
    }
  }

  // availableEvents subscribers — fire once with the current list.
  if (runtime.subAvailableEvents.size > 0) {
    const events = computeHandleableEvents(runtime);

    for (const sub of runtime.subAvailableEvents) {
      try {
        sub(events);
      } catch {
        /* swallow */
      }
    }
  }
};

// =============================================================================
// MachineHandle construction
// =============================================================================

/**
 * Shared machinery for the Effect-flavored subscribe siblings. Each
 * one captures the caller's Effect runtime at subscribe time, wraps
 * the user's Effect-returning callback as a plain callback that
 * forks the Effect into that runtime, inserts the wrapped callback
 * into the given subscriber set, and registers a finalizer that
 * removes it when the caller's scope closes.
 *
 * Forking (rather than running synchronously) means a slow or
 * long-running callback Effect can't stall subsequent subscriber
 * notifications or the event loop. If a user needs sequencing, they
 * can serialize work inside the callback themselves.
 */
const subscribeEffectShared = <Value>(
  add: (cb: (value: Value) => void) => () => void,
  cb: (value: Value) => Effect.Effect<void>,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const effectRuntime = yield* Effect.runtime<never>();
    const runFork = Runtime.runFork(effectRuntime);
    const wrapped = (value: Value) => {
      runFork(cb(value));
    };
    const remove = add(wrapped);
    yield* Effect.addFinalizer(() => Effect.sync(remove));
  });

const buildHandle = <States, Events, Context, Output>(
  runtime: Runtime<States, Events, Context, Output>,
): MachineHandle<States, Events, Output> => {
  const handle = {
    snapshot: () => runtime.currentOutput,
    state: () => runtime.currentState,
    inState: (name: string) => runtime.currentState === name,
    canDispatch: (event: string) => canDispatchEvent(runtime, event),
    availableEvents: () =>
      computeHandleableEvents(runtime) as unknown as ReadonlyArray<never>,

    get output() {
      return runtime.currentOutput;
    },

    subscribe: (cb: (output: Output) => void) => {
      runtime.subOutput.add(cb);
      return () => {
        runtime.subOutput.delete(cb);
      };
    },

    subscribeTo: (field: string, cb: (value: unknown) => void) => {
      let subs = runtime.subOutputField.get(field);
      if (!subs) {
        subs = new Set();
        runtime.subOutputField.set(field, subs);
      }
      subs.add(cb);
      return () => {
        subs?.delete(cb);
        if (subs?.size === 0) runtime.subOutputField.delete(field);
      };
    },

    subscribeState: (cb: (state: string) => void) => {
      runtime.subState.add(cb);
      return () => {
        runtime.subState.delete(cb);
      };
    },

    subscribeInState: (name: string, cb: () => void) => {
      let subs = runtime.subInState.get(name);
      if (!subs) {
        subs = new Set();
        runtime.subInState.set(name, subs);
      }
      subs.add(cb);
      return () => {
        subs?.delete(cb);
        if (subs?.size === 0) runtime.subInState.delete(name);
      };
    },

    subscribeCanDispatch: (
      event: string,
      cb: (canDispatch: boolean) => void,
    ) => {
      let subs = runtime.subCanDispatch.get(event);
      if (!subs) {
        subs = new Set();
        runtime.subCanDispatch.set(event, subs);
      }
      subs.add(cb);
      return () => {
        subs?.delete(cb);
        if (subs?.size === 0) runtime.subCanDispatch.delete(event);
      };
    },

    subscribeAvailableEvents: (cb: (events: ReadonlyArray<never>) => void) => {
      // Runtime uses ReadonlyArray<string>; the interface types it
      // as ReadonlyArray<keyof Events & string>. Cast at the
      // boundary — the actual values are always string.
      runtime.subAvailableEvents.add(
        cb as (events: ReadonlyArray<string>) => void,
      );
      return () => {
        runtime.subAvailableEvents.delete(
          cb as (events: ReadonlyArray<string>) => void,
        );
      };
    },

    // Effect-flavored subscribes — each defers to the callback-based
    // sibling above via `subscribeEffectShared`, which captures the
    // caller's Effect runtime, forks the callback Effect on each
    // notification, and ties cleanup to the caller's scope.
    subscribeEffect: (cb: (output: Output) => Effect.Effect<void>) =>
      subscribeEffectShared<Output>(handle.subscribe, cb),
    subscribeToEffect: (
      field: string,
      cb: (value: unknown) => Effect.Effect<void>,
    ) =>
      subscribeEffectShared<unknown>(
        (wrapped) => handle.subscribeTo(field, wrapped),
        cb,
      ),
    subscribeStateEffect: (cb: (state: string) => Effect.Effect<void>) =>
      subscribeEffectShared<string>(handle.subscribeState, cb),
    subscribeInStateEffect: (name: string, cb: () => Effect.Effect<void>) =>
      subscribeEffectShared<void>(
        (wrapped) => handle.subscribeInState(name, wrapped),
        cb,
      ),
    subscribeCanDispatchEffect: (
      event: string,
      cb: (canDispatch: boolean) => Effect.Effect<void>,
    ) =>
      subscribeEffectShared<boolean>(
        (wrapped) => handle.subscribeCanDispatch(event, wrapped),
        cb,
      ),
    subscribeAvailableEventsEffect: (
      cb: (events: ReadonlyArray<never>) => Effect.Effect<void>,
    ) =>
      subscribeEffectShared<ReadonlyArray<never>>(
        handle.subscribeAvailableEvents,
        cb,
      ),

    dispatch: (event: string, ...args: [] | [unknown]) =>
      applyCatches(runtime.catches, enqueue(runtime, event, args[0])),
    dispatchOrFail: (event: string, ...args: [] | [unknown]) =>
      applyCatches(runtime.catches, enqueue(runtime, event, args[0], "fail")),

    // Suspend until the machine enters `name`. Short-circuits if we're
    // already there (otherwise consumers of a settle-detector would
    // hang if the machine happens to be settled on entry). Otherwise
    // registers a one-shot entry in the same `subInState` set the
    // callback-based `subscribeInState` uses; the next entry into
    // `name` fires it and the async resolves. The cb removes itself
    // whether it fires naturally or via Effect.async's interruption
    // cleanup — Effect.async only invokes the returned Effect on
    // interruption, so natural resolution needs the same removal
    // inline inside the cb.
    awaitState: (name: string) =>
      Effect.async<void>((resume) => {
        if (runtime.currentState === name) {
          resume(Effect.void);
          return;
        }
        let fired = false;
        const removeFromSubs = (): void => {
          const current = runtime.subInState.get(name);
          if (!current) return;
          current.delete(cb);
          if (current.size === 0) runtime.subInState.delete(name);
        };
        const cb = () => {
          if (fired) return;
          fired = true;
          removeFromSubs();
          resume(Effect.void);
        };
        let subs = runtime.subInState.get(name);
        if (!subs) {
          subs = new Set();
          runtime.subInState.set(name, subs);
        }
        subs.add(cb);
        return Effect.sync(removeFromSubs);
      }),
  };

  return handle as unknown as MachineHandle<States, Events, Output>;
};
