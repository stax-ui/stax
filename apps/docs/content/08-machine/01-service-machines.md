---
title: "Service Machines"
description: "One instance per app — Machine.Service, Layer wiring, and consuming from Effect code."
order: 1
---

# Service Machines

Reach for `Machine.Service` when there's logically one of these per program. A session machine, a feature-flag store, a global websocket connection — anything with "there's only one of these, and it lives for the lifetime of the app."

A Service machine registers as an ordinary Effect service: consumers `yield* MyMachine` to get the handle, same shape as any Effect-ts tag.

## Declaring the Class

```ts
import { Effect, Layer } from "effect";
import { Machine } from "@stax-ui/machine";

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

class SessionMachine extends Machine.Service<
  SessionMachine,
  SessionStates,
  SessionEvents,
  SessionContext,
  SessionOutput,
  AuthAPI  // services the builder depends on
>()("SessionMachine") {}
```

Two things worth calling out:

- **`undefined` is the "no payload" spelling.** For states and events that carry no data, use `undefined`, not `{}`. `{}` passes the typechecker but means "any non-nullish value," which `@typescript-eslint/no-empty-object-type` flags for ambiguity.
- **The double-paren pattern matches `Effect.Service`.** Splitting the class declaration from the type-parameter site is what lets TypeScript carry `Self` cleanly through the subclass chain. Copy the shape and it works.

## Writing the Spec

The Layer is what actually wires the machine up. `Machine.serviceLayer` takes the class and an `Effect<Spec>` builder — anything the builder yields becomes a dependency the Layer requires:

```ts
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

Reading the spec:

- **`output` is a pure projection of context.** Subscribers see the output, not the context. Keep private bookkeeping — a cache, a last-event timestamp, retry counters — in context, and expose only what consumers need.
- **State fns return one of three shapes.** `signedOut` returns a `HandlerMap` and waits for events. `signingIn` returns a `Transition` built with `self.transition(...)` and moves on without waiting. `signedIn` is back to a `HandlerMap`.
- **`self.assign` updates context, `self.transition` moves state.** Both are composable Effects, so you compose them with the rest of your flow.

## Consuming the Machine

A Service machine is just an Effect service. Yield it, dispatch events, wait for states, read snapshots:

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

The important handle methods:

| Method | Purpose |
|---|---|
| `dispatch(event, payload?)` | Enqueue an event. Returns an Effect that completes once the handler batch (and any synchronous transitions it triggers) finish. |
| `dispatchOrFail(event, payload?)` | Same, but fails with `UnhandledEvent` if no handler matches. |
| `awaitState(name)` | Suspend until the machine enters `name`. Short-circuits if already there. |
| `snapshot()` | Current output value (synchronous, no yield). |
| `state()` / `inState(name)` | Current state name, and a predicate. |
| `canDispatch(event)` | Does the current state (or a global `on:`) handle this event? |

Every subscribe method has a callback flavor and an `Effect`-flavored sibling (`subscribeEffect`, `subscribeStateEffect`, etc.) that ties cleanup to the caller's `Scope`. The Stax Readable adapters build on top of those — see [Advanced Features](/docs/08-machine/03-advanced-features) for the full table.

## Binding to Stax UI

For Stax components, you usually want a `Readable` so a value binds declaratively. The `@stax-ui/machine/stax` subpath wraps the handle's subscribers and returns Readables directly:

```ts
import { Effect } from "effect";
import { $, Readable, when } from "@stax-ui/dom";
import { MachineReadable } from "@stax-ui/machine/stax";

const UserGreeting = () =>
  Effect.gen(function* () {
    const session = yield* SessionMachine;
    const user = MachineReadable.field(session, "user");
    const isAuthed = MachineReadable.inState(session, "signedIn");

    return $.div(
      { class: Readable.map(isAuthed, (v) => (v ? "signed-in" : "signed-out")) },
      when(isAuthed, {
        onTrue: () =>
          $.p({}, "Hello, ", Readable.map(user, (u) => u?.name ?? "")),
        onFalse: () => $.p({}, "Please sign in."),
      }),
    );
  });
```

| Factory | Readable |
|---|---|
| `MachineReadable.output(handle)` | `Readable<Output>` |
| `MachineReadable.field(handle, key)` | `Readable<Output[K]>` |
| `MachineReadable.state(handle)` | `Readable<keyof States>` |
| `MachineReadable.inState(handle, name)` | `Readable<boolean>` |
| `MachineReadable.canDispatch(handle, event)` | `Readable<boolean>` |
| `MachineReadable.availableEvents(handle)` | `Readable<ReadonlyArray<keyof Events>>` |

`inState` and `canDispatch` dedupe — a transition that doesn't flip the predicate doesn't emit. The others rely on the runtime's existing dedup: output and field use shallow-equal / `Object.is`; `state` only fires on real transitions.

Next: [Factory machines](/docs/08-machine/02-factory-machines) for the N-instances-per-call pattern.
