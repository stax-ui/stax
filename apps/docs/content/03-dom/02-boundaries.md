---
title: "Boundaries"
description: "Handle async loading states and errors with suspense and error boundaries."
order: 2
---

# Boundaries

Components that fetch data or do async work need loading and error states. Stax provides two boundary types: **suspense** for async rendering and **error** for catching failures.

## Suspense

Wrap async components in a suspense boundary to show a fallback while they load:

```typescript
import { Boundary } from "@stax-ui/dom";

Boundary.suspense({
  render: () =>
    Effect.gen(function* () {
      const user = yield* fetchUser(id);
      return yield* UserProfile({ user });
    }),
  fallback: () => $.div("Loading..."),
  catch: (error) => $.div(`Error: ${error.message}`),
  delay: "200 millis",  // Avoid loading flash for fast responses
});
```

The `delay` option prevents the fallback from showing if the async work completes quickly. If `fetchUser` resolves within 200ms, the user sees the content directly — no loading flicker.

### How It Works

1. Stax starts rendering the `render` function
2. If it encounters an async Effect that isn't resolved yet, it shows the `fallback`
3. When the async work completes, the fallback is replaced with the real content
4. If the async work fails, the `catch` handler renders instead

## Error Boundary

Catch errors from a component subtree without crashing the whole app:

```typescript
Boundary.error(
  () => RiskyComponent(),
  (error) => $.div(`Failed: ${error.message}`),
);
```

The error handler receives the error and returns an Element to render in place of the failed subtree. The rest of the application continues running.

## Combining Boundaries

Boundaries compose naturally. You can nest suspense inside error boundaries, or vice versa:

```typescript
Boundary.error(
  () =>
    Boundary.suspense({
      render: () => DataDashboard(),
      fallback: () => DashboardSkeleton(),
    }),
  (error) => $.div("Dashboard unavailable"),
);
```

This catches both sync errors (thrown during render) and async failures (rejected Effects).
