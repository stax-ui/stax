# @stax-ui/machine

Framework-neutral state machines for Effect. Declarative reducers with typed events, per-state payloads, and reactive snapshot/subscribe outputs that any UI framework can wrap.

> **Note:** This package is runtime-only — it doesn't depend on `@stax-ui/dom` or any renderer. Machines produce plain callback-based subscribers (framework-neutral) and Effect-flavored siblings (ergonomic from inside an Effect program). Point whichever system you prefer at the `MachineHandle` and you're done.

## Installation

```bash
pnpm add @stax-ui/machine effect
```

## Subpath exports

| Import path | Purpose | Extra install |
|---|---|---|
| `@stax-ui/machine` | The runtime: `Machine.Service`, `Machine.Factory`, their Layer constructors, `MachineHandle` / `MachineSelf` types. Framework-neutral — no UI dependency. | — |
| `@stax-ui/machine/stax` | Readable adapters for Stax: turns a `MachineHandle`'s snapshot + subscribe surface into `@stax-ui/core` Readables so Stax components can bind to the machine declaratively. | `@stax-ui/core` (optional peer) |

The target UI library for each framework-specific subpath is an **optional peer dependency**, so you only install what you actually use. Any real Stax app already has `@stax-ui/core` via `@stax-ui/dom`, so there's nothing extra to add in that case — the peer flag just makes the dependency explicit for consumers using the runtime without Stax.

Peer adapters for other UI libraries (React, Vue, Solid, …) can land under `@stax-ui/machine/<framework>` the same way. The core runtime is UI-neutral; the adapters just translate the subscription primitives into whatever reactive shape the target library uses.

## Why

State machines are reducers with a shape. Where a bare reducer lets any event mutate any field, a machine says "in this state, these events apply; everything else is noise." That constraint is what makes them debuggable at scale — the handler surface is finite and inspectable per state, so "why did my app get into this weird state" is a lookup, not an archaeology dig.

Compared to [XState](https://xstate.js.org/):

- **Effect-native.** Every handler returns an `Effect`, so you compose with services, retries, interrupts, scoped resources, and the rest of the Effect ecosystem natively. No separate "actors" layer.
- **Per-state Scopes.** Each state gets its own `Scope.Scope` that closes on transition out. Any `Effect.addFinalizer` / forked fiber registered inside a state fn tears down automatically when you leave that state.
- **Typed events + per-state payloads.** The TS types catch "wrong payload shape" and "transition to a non-existent state" at the call site, not at runtime.

## Core concepts

A machine is defined by four generic parameters plus a spec:

| Generic | What it is |
|---|---|
| `States` | Map of state name → payload type. Payload is the data the state fn receives on entry. |
| `Events` | Map of event name → payload type. The payload a handler receives on dispatch. |
| `Context` | Private mutable state (shared across all states). Updated via `self.assign`. |
| `Output` | Public projection of `Context` — what subscribers see. Pure fn of context, recomputed on every assign. |

The spec is:

```ts
{
  initial: /* name of the starting state */,
  context: /* initial context */,
  output: (ctx) => /* public projection */,
  on?: { /* spec-level fallback handlers, see below */ },
  states: { /* state name → state fn */ },
  ready?: (self) => /* optional one-shot setup, runs after init */,
}
```

Each state fn runs on entry and returns an Effect that resolves to one of three things:

- **A `HandlerMap`** — the state is "active", waiting for events. Each key is an event name; each handler is `(payload) => Effect<Transition | void>`.
- **A `Transition`** — the state is "task-like" and immediately transitions elsewhere. Produced via `self.transition("name", payload?)`.
- **`void` / `undefined`** — the state is a no-op. No handlers install, no automatic transition. Something external (a global `on:` handler, `self.transitionAwait`'s `go`) has to drive the next move.

## Service machines — one instance per app

Reach for `Machine.Service` when there's logically one of these in your program (session, feature flags, a global websocket).

```ts
import { Effect, Layer } from "effect";
import { Machine } from "@stax-ui/machine";

// `undefined` is the "no payload" spelling for states and events.
// `{}` works too, but `@typescript-eslint/no-empty-object-type`
// flags it as ambiguous ("any non-nullish value"), so `undefined`
// is preferred under default lint settings.
interface SessionStates {
  signedOut: undefined;
  signingIn: { email: string };
  signedIn: { user: User };
}

interface SessionEvents {
  SIGN_IN: { email: string; password: string };
  SIGN_OUT: undefined;
}

interface SessionContext {
  user: User | null;
}

interface SessionOutput {
  user: User | null;
  isAuthenticated: boolean;
}

// The class is both the Context tag and the thing Layer registers against.
// The double-paren pattern matches `Effect.Service` — splitting class
// declaration from the type-parameter site lets TS carry `Self` cleanly.
class SessionMachine extends Machine.Service<
  SessionMachine,
  SessionStates,
  SessionEvents,
  SessionContext,
  SessionOutput,
  AuthAPI // services the builder depends on
>()("SessionMachine") {}

export const SessionLive = Machine.serviceLayer(
  SessionMachine,
  Effect.gen(function* () {
    const auth = yield* AuthAPI;
    return {
      initial: "signedOut" as const,
      context: { user: null },
      output: (ctx) => ({
        user: ctx.user,
        isAuthenticated: ctx.user !== null,
      }),
      states: {
        signedOut: (self) =>
          Effect.succeed({
            SIGN_IN: ({ email, password }) =>
              self.transition("signingIn", { email }),
          }),
        signingIn: (self, { email }) =>
          Effect.gen(function* () {
            const user = yield* auth.signIn({ email });
            yield* self.assign({ user });
            return yield* self.transition("signedIn", { user });
          }),
        signedIn: (self) =>
          Effect.succeed({
            SIGN_OUT: () =>
              Effect.gen(function* () {
                yield* self.assign({ user: null });
                return yield* self.transition("signedOut");
              }),
          }),
      },
    };
  }),
);
```

Consuming it is the same as any Effect service:

```ts
const program = Effect.gen(function* () {
  const session = yield* SessionMachine;
  yield* session.dispatch("SIGN_IN", { email, password });
  yield* session.awaitState("signedIn");
  return session.snapshot();
});

Effect.runPromise(
  program.pipe(
    Effect.scoped,
    Effect.provide(SessionLive),
    Effect.provide(AuthAPILive),
  ),
);
```

## Factory machines — N instances, one per `.spawn(args)`

Reach for `Machine.Factory` when you need many of them — one per dialog, one per chat conversation, one per polling fetcher. Each spawned instance is a fresh `MachineHandle` scoped to the caller's Scope, so it tears down with whatever component spawned it.

```ts
interface FetcherStates {
  idle: undefined;
  fetching: undefined;
  loaded: { data: Data };
  failed: { error: FetchError };
}
interface FetcherEvents {
  FETCH: undefined;
  RETRY: undefined;
}
interface FetcherContext {
  url: string;
  data: Data | null;
  error: FetchError | null;
}
interface FetcherOutput {
  url: string;
  data: Data | null;
  error: FetchError | null;
}
// Inputs — the args shape for `.spawn(args)`.
interface FetcherInputs {
  url: string;
}

class FetcherMachine extends Machine.Factory<
  FetcherMachine,
  FetcherStates,
  FetcherEvents,
  FetcherInputs,
  FetcherContext,
  FetcherOutput,
  HttpClient
>()("FetcherMachine") {}

export const FetcherLive = Machine.factoryLayer(
  FetcherMachine,
  Effect.gen(function* () {
    // Services yielded here are shared across every spawn.
    const http = yield* HttpClient;
    return {
      spawn: ({ url }) =>
        Effect.succeed({
          initial: "idle" as const,
          context: { url, data: null, error: null },
          output: (ctx) => ({
            url: ctx.url,
            data: ctx.data,
            error: ctx.error,
          }),
          states: {
            idle: (self) =>
              Effect.succeed({
                FETCH: () => self.transition("fetching"),
              }),
            fetching: (self) =>
              http.get(self.context.url).pipe(
                Effect.flatMap((data) =>
                  Effect.gen(function* () {
                    yield* self.assign({ data });
                    return yield* self.transition("loaded", { data });
                  }),
                ),
                Effect.catchAll((error) =>
                  Effect.gen(function* () {
                    yield* self.assign({ error });
                    return yield* self.transition("failed", { error });
                  }),
                ),
              ),
            loaded: (self) =>
              Effect.succeed({
                FETCH: () => self.transition("fetching"),
              }),
            failed: (self) =>
              Effect.succeed({
                RETRY: () => self.transition("fetching"),
              }),
          },
        }),
    };
  }),
);
```

Consume by yielding the factory, then calling `.spawn(args)` for each instance:

```ts
const program = Effect.gen(function* () {
  const fetchers = yield* FetcherMachine;
  const posts = yield* fetchers.spawn({ url: "/api/posts" });
  yield* posts.dispatch("FETCH");
  yield* posts.awaitState("loaded");
  return posts.snapshot();
});
```

## Features worth knowing about

### `self.transitionAwait` — condition-wait transitions

For states that transition out when some external thing happens (a timer fires, a child machine reaches a state, a socket closes). Same shape as `Effect.async`:

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

The unsubscribe fn is registered as a state-scope finalizer, so it fires on any transition out — including a sibling path (a global `on:` handler, a `transitionAwait` on a parallel branch) winning the race.

### `self.onExit` — scope-level finalizers inside a state fn

Sugar over `Effect.addFinalizer`, but reads as intent at the call site:

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

### Spec-level `catch` — absorb user errors at the machine, not at every call site

A machine's handlers can yield `Data.TaggedError` subclasses declared on the `UserE` slot. Those errors flow through `handle.dispatch`'s error channel so the caller can handle them per-call-site — or you can absorb a subset of them once, inside the machine, with `catch`.

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
    initial: ...,
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

The policy applies uniformly to **every** dispatch surface:
- `handle.dispatch(event)`
- `handle.dispatchOrFail(event)` (still carries `UnhandledEvent`)
- `self.dispatch(event)` inside handlers
- `self.dispatchOrFail(event)` inside handlers

The class's `CaughtTags` generic enforces consistency: declaring a tag at the class level requires providing a handler for it in `catch` (and no others); declaring none forbids `catch` entirely. Mismatches are compile errors. Any `UserE` tags **not** listed in `CaughtTags` flow through on the dispatch error channel for the caller to handle inline — "trust the caller" for errors the machine itself has no opinion about.

Framework runtime bugs (`MalformedSpec`, from a dynamic transition target that beat the type system via `as never` or a dynamic key) are not catchable here — they die as defects. See [Error types](#error-types).

### Spec-level `on:` — fallback handlers that fire in any state

Precedence is per-state wins. If both layers have a handler for the dispatched event, the per-state one runs and the global is ignored for that dispatch.

```ts
return {
  // ...
  on: {
    // Fires in any state that doesn't have its own RESET handler.
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

Globals fire even during `transitionAwait`-held states and task states — the whole point is "respond regardless of state." They share the current state's scope, same as any other handler.

### `awaitState` — external coordination

Suspend a program until the machine enters a given state:

```ts
yield* session.dispatch("SIGN_IN", { email, password });
yield* session.awaitState("signedIn");
// Now safe to proceed as a signed-in user.
```

Short-circuits if the machine is already in that state when `awaitState` is called.

### Stax Readable adapters (`@stax-ui/machine/stax`)

For Stax components, you usually want a `Readable` so you can bind a value into the DOM declaratively via `$.div({ class: readable.map(...) })`, `when(readable, { … })`, etc. The `stax` subpath wraps the handle's subscription methods and returns `Readable`s directly:

```ts
import { MachineReadable } from "@stax-ui/machine/stax";

const UserGreeting = () =>
  Effect.gen(function* () {
    const session = yield* SessionMachine;
    const user = MachineReadable.field(session, "user");
    const isAuthed = MachineReadable.inState(session, "signedIn");

    return $.div(
      { class: isAuthed.map((v) => (v ? "signed-in" : "signed-out")) },
      when(isAuthed, {
        true: () => $.p({}, "Hello, ", user.map((u) => u?.name ?? "")),
        false: () => $.p({}, "Please sign in."),
      }),
    );
  });
```

One factory per subscription surface:

| Factory | Readable |
|---|---|
| `MachineReadable.output(handle)` | `Readable<Output>` |
| `MachineReadable.field(handle, key)` | `Readable<Output[K]>` |
| `MachineReadable.state(handle)` | `Readable<keyof States>` |
| `MachineReadable.inState(handle, name)` | `Readable<boolean>` |
| `MachineReadable.canDispatch(handle, event)` | `Readable<boolean>` |
| `MachineReadable.availableEvents(handle)` | `Readable<ReadonlyArray<keyof Events>>` |

`inState` and `canDispatch` are deduped — a transition that doesn't flip the predicate doesn't emit. The others rely on the runtime's existing dedup (output + field use shallow-equal / `Object.is`; `state` only fires on real transitions).

### Effect-flavored subscribers

Every callback-based subscribe method has an Effect-flavored sibling that takes an Effect-returning callback and ties cleanup to the caller's `Scope`:

```ts
yield* session.subscribeStateEffect((state) =>
  Effect.sync(() => console.log(`entered ${state}`)),
);
// Automatically unsubscribes when the enclosing scope closes.
```

Each notification forks the callback Effect, so a slow callback can't stall subsequent notifications or the event loop.

## Runtime invariants

- Context assigns within a single handler batch into one subscriber notification; assigns from outside a handler (e.g. a mirror subscription callback) notify immediately.
- The event queue is FIFO under a per-machine mutex. One handler at a time; events dispatched mid-handler queue and drain after.
- Each state gets its own `Scope.Scope` that closes on transition out, firing finalizers and canceling forked fibers.
- Output projection is pure; subscribers are notified only when the projected value differs by reference (shallow equal on top-level fields).
- `self` is only ever handed to callbacks the runtime invokes post-init, so it can't be observed before the machine's spec is built.

## API

### Namespace

| Export | Purpose |
|---|---|
| `Machine.Service<Self, States, Events, Context, Output, R>()` | Base class factory for singleton machines. |
| `Machine.Factory<Self, States, Events, Inputs, Context, Output, R>()` | Base class factory for instanced machines. |
| `Machine.serviceLayer(cls, builder)` | Produces a `Layer` from a Service class and an `Effect<Spec>` builder. |
| `Machine.factoryLayer(cls, builder)` | Produces a `Layer` from a Factory class and an `Effect<{ spawn }>` builder. |

### `self` (passed to state fns, handlers, and `ready`)

| Member | Signature |
|---|---|
| `self.context` | Current context (getter — no yield). |
| `self.assign(patch \| fn)` | Merge a patch into context. |
| `self.transition(name, payload?)` | Build a `Transition` value to return. |
| `self.transitionAwait(register, name, payload?)` | Condition-wait transition. |
| `self.dispatch(event, payload?)` | Enqueue an event on this instance. |
| `self.dispatchOrFail(event, payload?)` | Same, fails with `UnhandledEvent` if no handler matches. |
| `self.onExit(effect)` | Sugar for `Effect.addFinalizer` scoped to the current state. |

### `MachineHandle` (what consumers get from `yield* MyMachine` / `.spawn`)

| Member | Purpose |
|---|---|
| `snapshot()` / `output` | Current output value. |
| `state()` / `inState(name)` | Current state name + predicate. |
| `canDispatch(event)` / `availableEvents()` | Union of per-state and global handleable events. |
| `dispatch(event, payload?)` | Enqueue an event. |
| `dispatchOrFail(event, payload?)` | Same, fails with `UnhandledEvent` if neither layer handles it. |
| `awaitState(name)` | Suspend until the machine enters `name`. |
| `subscribe` / `subscribeTo` / `subscribeState` / `subscribeInState` / `subscribeCanDispatch` / `subscribeAvailableEvents` | Callback-based subscribers (framework-neutral). Return an unsubscribe fn. |
| `subscribeEffect` / `subscribeToEffect` / … | Effect-flavored siblings. Scope-tied cleanup, forked per notification. |

### Error types

| Error | Surface | Raised when |
|---|---|---|
| `UnhandledEvent` | Typed error on `dispatchOrFail` | `dispatchOrFail` called with no matching handler (local or global). |
| `MalformedSpec` | **Defect** (`Effect.die`) | Transition targets a state name that doesn't exist. The type system rejects this at compile time; landing here at runtime requires `as never` or dynamic key access, so it's treated as a programmer bug. |

"Use `self` before init" is unrepresentable by construction — `self` is only handed to callbacks the runtime invokes post-init (state fns, handlers, `ready`), so there's no `MachineUninitialized` to carry on method signatures or in the exported error set.

User-defined `TaggedError` subclasses declared on the Service/Factory class's `UserE` slot flow on the dispatch channel for the caller to handle inline. Tags listed in `CaughtTags` are absorbed by the machine's `catch` block instead — see the ["Spec-level `catch`"](#spec-level-catch--absorb-user-errors-at-the-machine-not-at-every-call-site) section.

Framework runtime bugs (`MalformedSpec`) are not catchable via `catch` — they die as defects. Intercepting them requires `Effect.catchAllCause` or a fiber-level defect reporter upstream; the common case is "let the fiber crash and surface in the error-reporting layer."

Infinite synchronous transition cycles (state A → B → A → … forever) are not blocked by the runtime. The entry chain is trampolined, so there's no stack overflow — the fiber spins until something interrupts it (scope close, parent fiber kill, timeout). The design trusts the consumer: a convergent cycle (`A → B → A → C` where B flipped a condition) runs through cleanly, and a non-convergent one is a bug the test suite catches as a hung fiber.
