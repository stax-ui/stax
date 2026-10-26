---
title: "Advanced Features"
description: "Condition-wait transitions, state-scoped finalizers, global fallback handlers, and error absorption."
order: 3
---

# Advanced Features

The patterns on this page are what make `Machine` worth reaching for when a plain reducer would otherwise do the job. Each one solves a specific problem that shows up once a machine owns actual running work — timers, sockets, retried fetches — not just state transitions.

## `self.transitionAwait` — Condition-Wait Transitions

For states that transition out when some external thing happens: a timer fires, a child machine reaches a state, a socket closes. Shape is the same as `Effect.async`:

```ts
pending: (self) =>
  self.transitionAwait(
    (go) => {
      const timer = setInterval(() => go(), 1000);
      return () => clearInterval(timer); // runs on state exit
    },
    "done",
  ),
```

The unsubscribe fn is registered as a state-scope finalizer, so it fires on any transition out — including a sibling path (a global `on:` handler, a `transitionAwait` on a parallel branch) winning the race. You don't have to track "did my timer fire or did a reset event come in first?" The runtime handles the race, and whichever path wins the finalizer still runs.

## `self.onExit` — Scope-Level Finalizers Inside a State Fn

`self.onExit` is sugar over `Effect.addFinalizer`, scoped to the current state. It reads as intent at the call site, which matters when a state owns a resource:

```ts
listening: (self) =>
  Effect.gen(function* () {
    const socket = yield* openSocket();
    yield* self.onExit(socket.close);
    return {
      MESSAGE: (msg) => self.assign({ lastMessage: msg }),
    };
  }),
```

Any `Effect.addFinalizer` call inside the state fn works too. `self.onExit` is the version that says "this is cleanup for the state," which future-you will thank present-you for.

## Spec-level `on:` — Fallback Handlers in Any State

An `on:` map at the spec level installs handlers that fire in *any* state that doesn't already have one for that event. Per-state wins — if a state's own handler map includes `RESET`, the global `RESET` is ignored for that dispatch.

```ts
return {
  initial: "idle",
  context: { count: 0 },
  on: {
    RESET: (self) =>
      Effect.gen(function* () {
        yield* self.assign({ count: 0 });
        return yield* self.transition("idle");
      }),
  },
  states: {
    /* ... */
  },
};
```

Globals fire even during `transitionAwait`-held states and task states — the point is "respond regardless of state." They share the current state's scope, same as any other handler.

## Spec-level `catch` — Absorb Errors at the Machine, Not Every Call Site

Handlers can yield `Data.TaggedError` subclasses declared on the class's `UserE` slot. Those errors flow through `dispatch`'s error channel so the caller handles them per-call-site — or you absorb a subset of them once, at the machine, with `catch`.

By default:

```ts
// With `UserE = DbError`, no catch block
handle.dispatch(event)
// → Effect<void, DbError>  — caller handles with Effect.catchTag
```

With a `catch` block declaring the tag:

```ts
class DbError extends Data.TaggedError("DbError")<{
  readonly cause: string;
}> {}

class SessionMachine extends Machine.Service<
  SessionMachine,
  States,
  Events,
  Context,
  Output,
  Deps,
  "DbError",  // CaughtTags
  DbError     // UserE
>()("SessionMachine") {}

Machine.serviceLayer(
  SessionMachine,
  Effect.succeed({
    initial: "idle",
    catch: {
      DbError: (e) => Effect.logError("db write failed", e),
    },
    // ...
  }),
);

handle.dispatch(event)
// → Effect<void>  — DbError absorbed by the machine, call site needs no .pipe
```

Keys in `catch` are the exact `_tag` strings each `TaggedError` subclass carries. The runtime routes incoming errors through `Effect.catchTags` matching on `_tag` — nothing special-cased.

The policy applies uniformly to every dispatch surface: `handle.dispatch`, `handle.dispatchOrFail` (still carries `UnhandledEvent`), `self.dispatch`, `self.dispatchOrFail`. The class's `CaughtTags` generic enforces consistency: declaring a tag at the class level requires providing a handler for it in `catch` (and no others); declaring none forbids `catch` entirely. Mismatches are compile errors.

Any `UserE` tag **not** listed in `CaughtTags` flows through on the dispatch error channel for the caller to handle inline. "Trust the caller" for errors the machine itself has no opinion about.

## `awaitState` — External Coordination

Suspend a program until the machine enters a given state:

```ts
yield* session.dispatch("SIGN_IN", { email, password });
yield* session.awaitState("signedIn");
// Now safe to proceed as a signed-in user.
```

Short-circuits if the machine is already in that state when `awaitState` is called. Useful inside loaders, inside tests, and anywhere "run this once the machine reaches X" is clearer than wiring a one-off subscription.

## Effect-Flavored Subscribers

Every callback-based subscribe method has an `Effect`-flavored sibling that takes an Effect-returning callback and ties cleanup to the caller's `Scope`:

```ts
yield* session.subscribeStateEffect((state) =>
  Effect.sync(() => console.log(`entered ${state}`)),
);
// Automatically unsubscribes when the enclosing scope closes.
```

Each notification forks the callback Effect, so a slow callback can't stall subsequent notifications or the event loop.

## Runtime Invariants

A handful of guarantees the runtime makes, worth knowing when reasoning about ordering:

- **Context assigns within a single handler batch into one subscriber notification.** Assigns from outside a handler (e.g. a mirror subscription callback) notify immediately.
- **The event queue is FIFO under a per-machine mutex.** One handler runs at a time; events dispatched mid-handler queue and drain after.
- **Each state gets its own `Scope.Scope` that closes on transition out,** firing finalizers and canceling forked fibers.
- **Output projection is pure.** Subscribers are notified only when the projected value differs by reference (shallow equal on top-level fields).
- **Synchronous transition cycles aren't blocked.** `A → B → A → …` forever won't stack-overflow (the entry chain is trampolined), but will spin until something interrupts it. Trust the test suite to catch non-convergent cycles.

## Error Types

| Error | Surface | Raised when |
|---|---|---|
| `UnhandledEvent` | Typed error on `dispatchOrFail` | `dispatchOrFail` called with no matching handler (local or global). |
| `MalformedSpec` | **Defect** (`Effect.die`) | Transition targets a state name that doesn't exist. The type system rejects this at compile time; landing here at runtime requires `as never` or dynamic key access, so it's treated as a programmer bug. |

User-defined `TaggedError` tags listed in `CaughtTags` are absorbed by the machine's `catch` block (see above); any `UserE` tag not listed flows on the dispatch error channel for the caller to handle inline.

`MalformedSpec` is not catchable via `catch`. Intercepting it requires `Effect.catchAllCause` or a fiber-level defect reporter upstream; the usual move is to let the fiber crash and surface in the error-reporting layer.

## When to Reach Back for `Transition` Instead

Not every state machine needs the full `Machine` surface. If none of these apply to the thing you're building, [`Transition`](/docs/04-reactivity/03-state-machines) is the cheaper primitive:

- No forked work per state (no sockets, no timers, no subscriptions that should die on state exit).
- No per-state payloads — the state name alone is enough.
- No event payloads — a bare `transition()` call does the job.
- No reactive guards that would otherwise live on `canDispatch`.

If any of those *do* apply, you're in `Machine` territory and it's worth the ceremony.
