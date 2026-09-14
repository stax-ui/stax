/**
 * State machine runtime.
 *
 * Scope of this file (first-pass runtime):
 * - Context store with `self.assign` (per-handler batching)
 * - Event queue with per-machine mutex — one handler at a time, FIFO
 * - State scope machinery — each state gets its own CloseableScope
 *   that closes on transition, firing any `addFinalizer`s and
 *   canceling any `forkScoped` fibers registered inside the state fn
 * - Output projection — pure fn of context, recomputed on any assign,
 *   subscribers notified when the projected value differs by reference
 * - Handler installation timing — state fn's Effect runs first,
 *   handlers install on return; events dispatched during the state
 *   fn queue and drain after
 * - Transition value interpretation — `self.transition(...)`'s
 *   returned value drives the next state entry; reentrant transitions
 *   are supported with a depth cap
 * - Basic MachineHandle: `snapshot`, `output`, `state`, `inState`,
 *   `subscribe`, `subscribeTo`, `subscribeState`, `subscribeInState`,
 *   `dispatch`, `dispatchOrFail`
 *
 * Not yet:
 * - `self.transitionAwait` — needs register/go/scope lifecycle wiring
 * - `awaitState` — needs Deferred wiring keyed per state name
 * - `subscribeEffect` / `subscribeToEffect` / etc. — Effect-flavored
 *   siblings of the callback subscribers
 * - `canDispatch` + `subscribeCanDispatch` — reactive predicate for UI
 * - `availableEvents` + `subscribeAvailableEvents`
 * - `self.onExit` sugar (Effect.addFinalizer works today)
 * - Machine.Factory + Machine.factoryLayer + `.spawn(args)`
 * - Global `on:` handler map (spec-level fallback handlers)
 */

import { Effect, Exit, Predicate, Scope } from "effect";

import {
  MalformedSpec,
  NotImplemented,
  TransitionLimit,
  TransitionTypeId,
  UnhandledEvent,
  type HandlerMap,
  type MachineHandle,
  type MachineSelf,
  type Spec,
  type Transition,
} from "./types.js";

// =============================================================================
// Internal helpers
// =============================================================================

/** Duck-type check for a Transition value returned from a state fn / handler. */
const isTransition = (value: unknown): value is Transition =>
  Predicate.hasProperty(value, TransitionTypeId);

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

/** Max chained transitions in a single event-processing cycle. */
const REENTRY_DEPTH_CAP = 32;

// =============================================================================
// Runtime state
// =============================================================================

interface QueuedEvent {
  readonly event: string;
  readonly payload: unknown;
}

interface Runtime<States, Events, Context, Output> {
  // Machine identity + spec
  readonly spec: Spec<States, Events, Context, Output>;

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
export const createRuntime = <States, Events, Context, Output, R>(
  builder: Effect.Effect<Spec<States, Events, Context, Output>, never, R>,
): Effect.Effect<
  MachineHandle<States, Events, Output>,
  MalformedSpec | TransitionLimit,
  R | Scope.Scope
> =>
  Effect.gen(function* () {
    const parentScope = yield* Effect.scope;

    // Build the spec first — no `self` involved, so no
    // initialization race possible by construction.
    const spec = yield* builder;

    // ---- Runtime init ----
    // Two-step: allocate with a placeholder `self` so `self`
    // itself can close over `runtime` (their references are
    // mutually cyclic). Patch in the real `self` below.
    const runtime: Runtime<States, Events, Context, Output> = {
      spec,
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
        enqueue(runtime, event, args[0], /* orFail */ false),
      dispatchOrFail: (event: string, ...args: [] | [unknown]) =>
        enqueue(runtime, event, args[0], /* orFail */ true),
      transition: (name: string, ...args: [] | [unknown]) =>
        ({
          [TransitionTypeId]: TransitionTypeId,
          target: name,
          payload: args[0] ?? {},
        }) as Transition,
      transitionAwait: (
        _register: (go: () => void) => () => void,
        _name: string,
        ..._args: [] | [unknown]
      ) => Effect.fail(new NotImplemented({ feature: "self.transitionAwait" })),
      onExit: (effect: Effect.Effect<void>) =>
        Effect.addFinalizer(() => effect),
    } as unknown as MachineSelf<States, Events, Context>;
    runtime.self = self;

    // Run the `ready` hook if provided, in the machine's parent
    // scope so anything scope-registered lives for the machine's
    // whole lifetime.
    if (spec.ready) {
      const readyEffect = (
        spec.ready as (
          s: MachineSelf<States, Events, Context>,
        ) => Effect.Effect<void, unknown, Scope.Scope>
      )(self);
      yield* readyEffect.pipe(
        Effect.provideService(Scope.Scope, parentScope),
      ) as Effect.Effect<void, MalformedSpec | TransitionLimit>;
    }

    // Enter the initial state synchronously so consumers hold a
    // fully-ready handle when `createRuntime` returns. If the initial
    // state is a task state that immediately transitions, we settle
    // through the chain here; if it installs handlers, they're
    // installed by the time dispatch calls arrive.
    yield* enterState(runtime, spec.initial, {});

    return buildHandle(runtime);
  });

// =============================================================================
// Enter state
// =============================================================================

/**
 * Enter a state: close the previous state scope, create a new one,
 * run the state fn in it, install handlers or interpret the returned
 * Transition, then drain the event queue.
 */
const enterState = <States, Events, Context, Output>(
  runtime: Runtime<States, Events, Context, Output>,
  name: string,
  payload: unknown,
): Effect.Effect<void, MalformedSpec | TransitionLimit> =>
  enterStateRec(runtime, name, payload, 0, []);

const enterStateRec = <States, Events, Context, Output>(
  runtime: Runtime<States, Events, Context, Output>,
  name: string,
  payload: unknown,
  depth: number,
  trace: readonly string[],
): Effect.Effect<void, MalformedSpec | TransitionLimit> =>
  Effect.gen(function* () {
    if (depth > REENTRY_DEPTH_CAP) {
      return yield* new TransitionLimit({ depth, trace: [...trace, name] });
    }

    // Close the previous state scope (fires finalizers, cancels forked fibers).
    if (runtime.stateScope) {
      const closing = runtime.stateScope;
      runtime.stateScope = null;
      yield* Scope.close(closing, Exit.void);
    }

    // Clear handlers — new state hasn't installed its map yet.
    runtime.handlers = null;

    // Enter the new state.
    runtime.currentState = name;
    runtime.currentPayload = payload;
    notifyState(runtime, name);

    // New scope for this state.
    const stateScope = yield* Scope.make();
    runtime.stateScope = stateScope;

    // Locate the state fn.
    const stateFn = (
      runtime.spec.states as Record<
        string,
        (
          self: MachineSelf<States, Events, Context>,
          payload: unknown,
        ) => Effect.Effect<unknown>
      >
    )[name];
    if (!stateFn) {
      return yield* new MalformedSpec({
        reason: `state machine has no state named "${name}"`,
        state: name,
      });
    }

    // Run the state fn in the state's scope, passing self.
    const result = yield* stateFn(runtime.self, payload).pipe(
      Effect.provideService(Scope.Scope, stateScope),
    );

    // Interpret the return value.
    if (isTransition(result)) {
      // Task state / condition-waiter that resolved — chain to next.
      yield* enterStateRec(runtime, result.target, result.payload, depth + 1, [
        ...trace,
        name,
      ]);
      return;
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
  orFail: boolean,
): Effect.Effect<void, UnhandledEvent | MalformedSpec | TransitionLimit> =>
  Effect.gen(function* () {
    if (orFail) {
      // Strict variant: check right now whether we'd handle this.
      // If not, fail immediately without queuing.
      const handler = runtime.handlers?.[event as never] as
        ((payload: unknown) => Effect.Effect<unknown>) | undefined;
      if (!handler) {
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
 * Drain the event queue serially. One handler at a time; assigns
 * within a handler batch into a single output notification when the
 * handler resolves.
 *
 * If handlers aren't installed (state is entering, or state is a
 * task/no-op with no handler map), the queue holds events — they'll
 * drain when the next handler-installing state entry completes.
 * Bail out immediately in that case rather than dropping events.
 */
const drainQueue = <States, Events, Context, Output>(
  runtime: Runtime<States, Events, Context, Output>,
): Effect.Effect<void, MalformedSpec | TransitionLimit> =>
  Effect.gen(function* () {
    if (runtime.isProcessing) return;
    runtime.isProcessing = true;

    try {
      while (runtime.eventQueue.length > 0 && runtime.handlers) {
        const next = runtime.eventQueue.shift();
        if (!next) break;
        const handler = (runtime.handlers as Record<string, unknown> | null)?.[
          next.event
        ] as ((payload: unknown) => Effect.Effect<unknown>) | undefined;
        if (!handler) {
          // Current state has no handler for this specific event —
          // drop it (silent dispatch semantics; strict callers used
          // dispatchOrFail which checked at enqueue time).
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
          // enterStateRec can re-enter drainQueue cleanly after the
          // new state's handlers install.
          runtime.isProcessing = false;
          yield* enterStateRec(runtime, result.target, result.payload, 0, [
            runtime.currentState,
          ]);
          return; // enterStateRec will drain any remaining events
        }
        // Non-transition returns keep us in the current state; loop continues.
      }
    } finally {
      runtime.isProcessing = false;
    }
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
const notifyHandlersChanged = <States, Events, Context, Output>(
  runtime: Runtime<States, Events, Context, Output>,
): void => {
  const handlers = runtime.handlers as Record<string, unknown> | null;

  // canDispatch subscribers — fire per-event.
  for (const [event, subs] of runtime.subCanDispatch) {
    const canNow = handlers?.[event] != null;
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
    const events = handlers
      ? (Object.keys(handlers) as ReadonlyArray<string>)
      : ([] as ReadonlyArray<string>);
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

const buildHandle = <States, Events, Context, Output>(
  runtime: Runtime<States, Events, Context, Output>,
): MachineHandle<States, Events, Output> => {
  const dispatchFn = (event: string, ...args: [] | [unknown]) =>
    enqueue(runtime, event, args[0], false);
  const dispatchOrFailFn = (event: string, ...args: [] | [unknown]) =>
    enqueue(runtime, event, args[0], true);

  const handle = {
    snapshot: () => runtime.currentOutput,
    state: () => runtime.currentState,
    inState: (name: string) => runtime.currentState === name,
    canDispatch: (event: string) => runtime.handlers?.[event as never] != null,
    availableEvents: () =>
      runtime.handlers
        ? (Object.keys(runtime.handlers) as unknown as ReadonlyArray<never>)
        : ([] as ReadonlyArray<never>),

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

    // Effect-flavored subscribes — deferred. Fail with typed
    // NotImplemented so callers see it in the error channel;
    // wiring lands in a follow-up commit.
    subscribeEffect: (_cb: (output: Output) => Effect.Effect<void>) =>
      Effect.fail(new NotImplemented({ feature: "subscribeEffect" })),
    subscribeToEffect: (
      _field: string,
      _cb: (value: unknown) => Effect.Effect<void>,
    ) => Effect.fail(new NotImplemented({ feature: "subscribeToEffect" })),
    subscribeStateEffect: (_cb: (state: string) => Effect.Effect<void>) =>
      Effect.fail(new NotImplemented({ feature: "subscribeStateEffect" })),
    subscribeInStateEffect: (_name: string, _cb: () => Effect.Effect<void>) =>
      Effect.fail(new NotImplemented({ feature: "subscribeInStateEffect" })),
    subscribeCanDispatchEffect: (
      _event: string,
      _cb: (canDispatch: boolean) => Effect.Effect<void>,
    ) =>
      Effect.fail(
        new NotImplemented({ feature: "subscribeCanDispatchEffect" }),
      ),
    subscribeAvailableEventsEffect: (
      _cb: (events: ReadonlyArray<never>) => Effect.Effect<void>,
    ) =>
      Effect.fail(
        new NotImplemented({ feature: "subscribeAvailableEventsEffect" }),
      ),

    dispatch: dispatchFn,
    dispatchOrFail: dispatchOrFailFn,

    awaitState: (_name: string) =>
      Effect.fail(new NotImplemented({ feature: "awaitState" })),
  };

  return handle as unknown as MachineHandle<States, Events, Output>;
};
