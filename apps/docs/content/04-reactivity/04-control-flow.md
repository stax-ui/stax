---
title: "Control Flow"
description: "Reactive conditionals, pattern matching, and list rendering with when, match, each, and more."
order: 4
---

# Control Flow

Stax doesn't use JSX or templates. Instead, it provides reactive control flow primitives — functions that take Readables and produce elements that update automatically when the source values change.

## when

Conditional rendering based on a boolean Readable:

```typescript
import { when } from "@stax-ui/dom";

when(isLoggedIn, {
  onTrue: () => Dashboard(),
  onFalse: () => LoginForm(),
});
```

When `isLoggedIn` changes, the previous branch is unmounted and the new one is rendered. This is a full swap — each branch gets its own lifecycle.

## match

Pattern matching on a Readable value. Like a reactive `switch`:

```typescript
import { match } from "@stax-ui/dom";

match(status.current, {
  cases: [
    { pattern: "idle", render: () => IdleView() },
    { pattern: "loading", render: () => LoadingSpinner() },
    { pattern: "success", render: () => SuccessView() },
    { pattern: "error", render: () => ErrorView() },
  ],
  fallback: () => $.div("Unknown state"),
});
```

Only one case renders at a time. When the value changes, the active case is swapped. The `fallback` is optional — if omitted and no case matches, nothing renders.

## matchOption

Unwrap an `Option<T>` reactively:

```typescript
import { matchOption } from "@stax-ui/dom";

matchOption(userData.value, {
  onSome: (user) => UserCard({ user }),  // user is Readable<User>
  onNone: () => $.span("No data"),
});
```

The key detail: inside `onSome`, the value is a `Readable<User>`, not a `User`. This means when the Option's inner value changes (say, from one user to another), the `UserCard` component updates in place rather than being unmounted and remounted. The branch only swaps when the Option goes from `Some` to `None` or vice versa.

## matchEither

Same idea, for `Either<L, R>`:

```typescript
import { matchEither } from "@stax-ui/dom";

matchEither(result, {
  onRight: (value) => SuccessView({ value }),  // value is Readable<A>
  onLeft: (error) => ErrorView({ error }),      // error is Readable<E>
});
```

## each

Keyed list rendering with efficient reconciliation:

```typescript
import { each } from "@stax-ui/dom";

each(todos, {
  key: (todo) => todo.id,
  render: (todo, index) => TodoItem({ todo, index }),
  container: () => $.ul({ class: "todo-list" }),
});
```

The `key` function is required. It tells Stax how to track items across updates. When the list changes:

- **New items** are created and inserted at the correct position
- **Removed items** are unmounted and their DOM nodes removed
- **Moved items** are repositioned without re-rendering
- **Unchanged items** are left completely untouched

The `todo` parameter inside `render` is a `Readable<Todo>` — if an item's data changes without the key changing, the existing component updates in place.

The `container` is optional. If provided, it wraps the list items. If omitted, items are rendered as siblings.

### With Signal.Array

`each` works directly with reactive arrays:

```typescript
const items = yield* Signal.Array.make<Item>([]);

// Push, remove, move — each updates the DOM minimally
yield* items.push(newItem);
yield* items.removeAt(2);
yield* items.move(0, 3);

each(items, {
  key: (item) => item.id,
  render: (item) => ItemCard({ item }),
});
```

## redraw

For cases where the entire subtree depends on the value and should be rebuilt from scratch on every change:

```typescript
import { redraw } from "@stax-ui/dom";

redraw(theme, {
  render: (currentTheme) => ThemedApp({ theme: currentTheme }),
});
```

Unlike `match` or `when`, `redraw` unmounts and remounts on every change, not just branch switches. Use this sparingly — it's a full teardown and rebuild.

## Nesting Control Flow

These primitives compose naturally:

```typescript
when(isLoggedIn, {
  onTrue: () =>
    match(currentPage, {
      cases: [
        {
          pattern: "dashboard",
          render: () =>
            matchOption(userData.value, {
              onSome: (user) =>
                each(user.pipe(Readable.map((u) => u.notifications)), {
                  key: (n) => n.id,
                  render: (notification) => NotificationCard({ notification }),
                }),
              onNone: () => LoadingSpinner(),
            }),
        },
        { pattern: "settings", render: () => SettingsPage() },
      ],
    }),
  onFalse: () => LoginPage(),
});
```

Each level reacts independently to its own source Readable. Changing `currentPage` doesn't affect the `isLoggedIn` branch, and vice versa.
