---
title: "Basic State Machines"
description: "Declarative state machines with type-safe transitions and reactive guards using Transition."
order: 3
---

# Basic State Machines

Complex UI often has states that should only transition in specific ways — a form that can't submit while already loading, a modal that must close before another opens, a wizard that can't skip steps. `Transition` makes these constraints explicit and enforced at both the type level and runtime.

For richer orchestration — per-state scopes, typed event payloads, service and factory patterns — reach for `@stax-ui/machine`. The [Machine](/docs/08-machine/00-introduction) section covers it. `Transition` is the lightweight primitive for small, state-only guards.

## Defining a State Machine

A Transition takes a map of states to their allowed targets and an initial state:

```typescript
import { Transition } from "@stax-ui/dom";

const status = yield* Transition.make(
  {
    idle: ["loading"],
    loading: ["success", "error"],
    success: ["idle"],
    error: ["idle", "loading"],
  },
  "idle"
);
```

This defines a state machine where:
- `idle` can only go to `loading`
- `loading` can go to `success` or `error`
- `success` can go back to `idle`
- `error` can retry (`loading`) or reset (`idle`)

### Reading State

```typescript
// Current state as a reactive Readable
status.current;  // Readable<"idle" | "loading" | "success" | "error">

// Check if in a specific state (reactive)
status.is("idle");     // Readable<boolean>
status.is("loading");  // Readable<boolean>

// Check if a transition is allowed (reactive)
status.canTransitionTo("success");  // Readable<boolean>
```

All of these are Readables, so they work directly with Stax's control flow:

```typescript
match(status.current, {
  cases: [
    { pattern: "idle", render: () => IdleView() },
    { pattern: "loading", render: () => LoadingSpinner() },
    { pattern: "error", render: () => ErrorView() },
  ],
});
```

### Transitioning

```typescript
// Transition to a new state
yield* status.to("loading");  // Effect<void, InvalidTransition>

// If the transition isn't allowed, it fails with InvalidTransition
// e.g., from "idle" you can't go to "success" directly
```

The transition fails with an `InvalidTransition` error if the current state doesn't allow it. This is caught at the type level too — TypeScript won't let you call `status.to()` with a state that's never reachable from anywhere.

## Guarded Transitions

Sometimes a transition should only be allowed when a condition is met. Guards are reactive — the `canTransitionTo` Readable updates automatically when the guard's value changes.

```typescript
const isOnline = yield* Signal.make(true);

const status = yield* Transition.make(
  {
    idle: [
      { to: "loading", when: isOnline },  // guarded
      "error",                             // unguarded
    ],
    loading: ["success", "error"],
    success: ["idle"],
    error: ["idle"],
  },
  "idle"
);

// canTransitionTo respects guards — updates reactively
status.canTransitionTo("loading");  // true only when isOnline is true

// Transition fails if guard is false
yield* status.to("loading");  // InvalidTransition if offline
```

You can use this to disable buttons, hide options, or prevent actions based on dynamic conditions.

## Guarded Callbacks

`transition.guard` creates a callback that only runs when the machine is in specific states:

```typescript
const submit = status.guard(
  ["idle"],  // only enabled in these states
  (data: FormData) =>
    Effect.gen(function* () {
      yield* status.to("loading");
      return yield* api.submit(data);
    }),
  { onBlocked: "ignore" }  // or "fail" (default)
);

yield* submit(formData);
```

With `onBlocked: "ignore"`, calling `submit` while loading is a no-op. With `onBlocked: "fail"`, it produces an error. Either way, you don't need to manually check state before calling the function.

## Practical Example: Form Submission

```typescript
const formStatus = yield* Transition.make(
  {
    idle: ["submitting"],
    submitting: ["success", "error"],
    success: ["idle"],
    error: ["idle", "submitting"],
  },
  "idle"
);

const submitForm = formStatus.guard(
  ["idle", "error"],  // can submit from idle or retry from error
  (data: FormData) =>
    Effect.gen(function* () {
      yield* formStatus.to("submitting");
      const result = yield* api.submitForm(data);
      yield* formStatus.to("success");
      return result;
    }).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* formStatus.to("error");
          return yield* Effect.fail(error);
        })
      )
    ),
);

// In the UI
const submitButton = $.button(
  {
    disabled: Readable.map(
      formStatus.canTransitionTo("submitting"),
      (can) => !can,
    ),
    onClick: () => submitForm(formData),
  },
  when(formStatus.is("submitting"), {
    onTrue: () => $.of("Submitting..."),
    onFalse: () => $.of("Submit"),
  }),
);
```
