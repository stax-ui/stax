---
title: "Machine Overview"
description: "Effect-native state machines with typed events, per-state scopes, and framework-neutral subscribers."
order: 0
---

# Machine Overview

`@stax-ui/machine` is a state-machine runtime built for Effect. Where [`Transition`](/docs/04-reactivity/03-state-machines) is the lightweight "just the state names and the arrows between them" primitive, `Machine` is the whole thing — typed event payloads, per-state scopes that clean up forked work on exit, context separated from the publicly-visible output, and a subscribe surface any UI framework can wrap.

```bash
pnpm add @stax-ui/machine effect
```

The runtime itself has no UI dependency. Stax components bind to a machine through the `@stax-ui/machine/stax` subpath, which turns the machine's subscribers into Readables.

## Why Not Just a Reducer

A reducer lets any event mutate any field. A machine says "in this state, these events apply; everything else is noise." That constraint is what makes a machine debuggable at scale: the handler surface is finite and inspectable per state, so "why did my app get into this weird state" becomes a lookup, not an archaeology dig.

Compared to [XState](https://xstate.js.org/), which covers the same territory:

- **Effect-native.** Every handler returns an `Effect`, so services, retries, interrupts, scoped resources — the usual Effect toolkit — compose directly. There's no separate actors layer.
- **Per-state scopes.** Each state gets its own `Scope.Scope` that closes on transition out. Finalizers and forked fibers registered inside a state fn tear down automatically when the machine leaves that state.
- **Typed events and per-state payloads.** The TypeScript types catch "wrong payload shape" and "transition to a non-existent state" at the call site, not at runtime.

If you only need "the state is one of A, B, C, and some transitions are illegal," reach for `Transition`. Reach for `Machine` when a transition owns running work — a websocket, a polling fetcher, a subscription — that should die when the state exits.

## The Shape

A machine is defined by four generics plus a spec:

| Generic | What it is |
|---|---|
| `States` | Map of state name → payload type. Payload is the data the state fn receives on entry. |
| `Events` | Map of event name → payload type. The payload a handler receives on dispatch. |
| `Context` | Private mutable state shared across all states. Updated via `self.assign`. |
| `Output` | Public projection of `Context` — what subscribers see. Pure fn of context, recomputed on every assign. |

The spec is:

```ts
{
  initial: /* name of the starting state */,
  context: /* initial context */,
  output: (ctx) => /* public projection */,
  on?: { /* fallback handlers, see Advanced Features */ },
  states: { /* state name → state fn */ },
  ready?: (self) => /* optional one-shot setup after init */,
}
```

Each state fn runs on entry and returns an Effect that resolves to one of three things:

- **A `HandlerMap`** — the state is "active," waiting for events. Each key is an event name; each handler is `(payload) => Effect<Transition | void>`.
- **A `Transition`** — the state is "task-like" and immediately moves elsewhere. Produced via `self.transition("name", payload?)`.
- **`void`** — the state is a no-op. Something external (a global `on:` handler, a `transitionAwait` resolver) has to drive the next move.

## Service vs Factory

Two flavors, same runtime underneath:

- **`Machine.Service`** — one instance per Effect program. Reach for this when there's logically one of these in your app: a session, a global websocket, a feature-flag store. Registered as an Effect service; consumers `yield* MyMachine`.
- **`Machine.Factory`** — N instances, one per `.spawn(args)`. Reach for this when there's one per thing: one per dialog, one per chat conversation, one per polling fetcher. Each spawned instance is a fresh `MachineHandle` scoped to the caller's `Scope`, so it tears down with whatever component spawned it.

The next two pages cover each pattern end-to-end. [Service machines](/docs/08-machine/01-service-machines) first.

## Subpaths

| Import path | Purpose | Extra install |
|---|---|---|
| `@stax-ui/machine` | The runtime: `Machine.Service`, `Machine.Factory`, their Layer constructors, `MachineHandle` / `MachineSelf` types. Framework-neutral. | — |
| `@stax-ui/machine/stax` | Readable adapters for Stax: turns a `MachineHandle`'s snapshot and subscribe surface into `@stax-ui/core` Readables. | `@stax-ui/core` (optional peer) |

The target UI library for each framework-specific subpath is an **optional peer dependency** — install only what you use. A Stax app already has `@stax-ui/core` via `@stax-ui/dom`, so there's nothing extra to add. Adapters for other UI libraries can land under `@stax-ui/machine/<framework>` the same way; the core runtime stays UI-neutral.
