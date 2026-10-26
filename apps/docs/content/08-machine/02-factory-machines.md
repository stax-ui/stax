---
title: "Factory Machines"
description: "N instances per app — Machine.Factory, .spawn(args), and per-component lifetimes."
order: 2
---

# Factory Machines

Reach for `Machine.Factory` when there's one of these per thing — one per dialog, one per chat conversation, one per polling fetcher, one per editable row in a table. A Factory is an Effect service too, but instead of being the machine, it's a thing you call `.spawn(args)` on. Each call returns a fresh `MachineHandle` scoped to the caller's `Scope`.

The practical consequence: when the component that called `.spawn` unmounts, its machine's `Scope` closes, its state's finalizers run, forked fibers get interrupted, and the machine is gone. One component owns one instance; cleanup is automatic.

## When to Use Which

| Shape | Reach for |
|---|---|
| "There's one session for the whole app." | `Service` |
| "There's one of these per modal that opens." | `Factory` |
| "There's one of these per polling resource." | `Factory` |
| "There's one global websocket." | `Service` |
| "There's one connection per chat conversation." | `Factory` |

If you're going to call it `.spawn(...)` more than once per program, you want `Factory`. Otherwise `Service`.

## Declaring the Class

The generic list has one extra slot compared to `Service` — `Inputs`, the args shape that `.spawn(args)` takes:

```ts
import { Effect, Layer } from "effect";
import { Machine } from "@stax-ui/machine";

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

interface FetcherInputs {
  url: string;
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

class FetcherMachine extends Machine.Factory<
  FetcherMachine,
  FetcherStates,
  FetcherEvents,
  FetcherInputs,
  FetcherContext,
  FetcherOutput,
  HttpClient
>()("FetcherMachine") {}
```

## Writing the Spec

The builder returns a `spawn` function instead of a spec directly. Dependencies yielded in the outer builder are **shared across every spawn** — one `HttpClient`, N fetcher instances. Per-instance work goes inside the `spawn` fn:

```ts
export const FetcherLive = Machine.factoryLayer(
  FetcherMachine,
  Effect.gen(function* () {
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

Notice that `spawn` returns an `Effect<Spec>` — not a `Spec` directly. That means per-instance setup can involve yielding other services, running an initial fetch, opening a scoped resource, whatever: it's all just Effect code producing the spec the runtime consumes.

## Consuming the Factory

Yield the factory service, then call `.spawn(args)` for each instance you want:

```ts
const program = Effect.gen(function* () {
  const fetchers = yield* FetcherMachine;

  const posts = yield* fetchers.spawn({ url: "/api/posts" });
  const users = yield* fetchers.spawn({ url: "/api/users" });

  yield* posts.dispatch("FETCH");
  yield* users.dispatch("FETCH");

  yield* posts.awaitState("loaded");
  return posts.snapshot();
});
```

Both `posts` and `users` are independent `MachineHandle`s. Dispatching to one doesn't affect the other, and each lives in its own `Scope` — if the enclosing Effect finishes or is interrupted, both machines tear down.

## Spawning Per-Component

The typical Stax pattern: a component spawns an instance in its `Effect.gen` block, which means the instance's lifetime matches the component's `Scope`. When the component unmounts, the scope closes and the machine is cleaned up:

```ts
const UserCard = (userId: string) =>
  Effect.gen(function* () {
    const fetchers = yield* FetcherMachine;
    const fetcher = yield* fetchers.spawn({ url: `/api/users/${userId}` });

    const data = MachineReadable.field(fetcher, "data");
    const state = MachineReadable.state(fetcher);

    yield* fetcher.dispatch("FETCH");

    const isLoaded = Readable.map(state, (s) => s === "loaded");

    return $.div(
      { class: "user-card" },
      when(isLoaded, {
        onTrue: () => $.p({}, Readable.map(data, (d) => d?.name ?? "")),
        onFalse: () => $.p({}, "Loading..."),
      }),
    );
  });
```

Mount `UserCard("alice")` and `UserCard("bob")` side by side and you get two independent fetchers, each with its own state. Unmount one and only that fetcher's work tears down.

## Spawn Signature

```ts
fetchers.spawn(args: Inputs): Effect<MachineHandle<...>, never, Scope>
```

The result requires `Scope` — hence the earlier note that each instance's lifetime is the caller's `Scope`. In practice `Effect.gen` already provides a `Scope`, so you rarely write this out; it's just worth knowing when the handle goes away.

The `MachineHandle` you get back has the same surface as the Service handle — `dispatch`, `awaitState`, `snapshot`, `inState`, every `subscribe*`. Factory and Service only differ in how instances are produced; what they produce is identical.

Next: [Advanced Features](/docs/08-machine/03-advanced-features) — `transitionAwait`, scope-level finalizers, global fallback handlers, and error absorption.
