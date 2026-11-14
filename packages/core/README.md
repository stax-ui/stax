# @stax-ui/core

Reactive primitives for Stax applications. This package provides the foundational reactivity system: Signals, Readables, async state management, reactive collections, state machines, and control flow primitives.

> **Note:** `@stax-ui/dom` re-exports everything from this package. If you're using `@stax-ui/dom`, you don't need to install this separately.

## Installation

```bash
pnpm add @stax-ui/core effect
```

## Signals

Signals are reactive values that can be read and updated:

```ts
import { Effect } from "effect";
import { Signal } from "@stax-ui/core";

const count = yield* Signal.make(0);

// Read the current value
const current = yield* count.get;

// Update the value
yield* count.set(5);
yield* count.update((n) => n + 1);
```

### Custom Equality

By default, Signal uses strict equality (`===`) to determine if a value has changed. Use `Signal.equals` for custom equality:

```ts
interface User {
  id: number;
  name: string;
  lastSeen: Date;
}

// Only trigger updates when the user ID changes
const currentUser = yield* Signal.make<User>(
  { id: 1, name: "Alice", lastSeen: new Date() }
).pipe(Signal.equals((a, b) => a.id === b.id));
```

This is useful for:
- **Objects with irrelevant fields** (timestamps, metadata)
- **Expensive computations** that shouldn't re-run on semantically equal inputs
- **Normalized data** where you want to compare by ID rather than reference

## Readable

Readables are the foundation of Stax's reactivity. They represent values that can be observed for changes. Signals are Readables, but you can also create derived Readables using combinators.

### Derived Values

Use `Readable.map` to create derived values that automatically update:

```ts
import { Readable, Signal } from "@stax-ui/core";

const firstName = yield* Signal.make("John");
const lastName = yield* Signal.make("Doe");

// Simple derivation with map
const upperFirst = Readable.map(firstName, (s) => s.toUpperCase());

// Combine multiple readables
const fullName = Readable.zipWith(
  firstName,
  lastName,
  (first, last) => `${first} ${last}`
);

// Or use zipAll for tuples
const both = Readable.zipAll([firstName, lastName]);
// both: Readable<[string, string]>
```

### Constants and Streams

```ts
// Constant (never changes)
const label = Readable.of("Hello");

// From an initial value + stream of updates
const time = Readable.fromStream(Date.now(), clockStream);
```

### Normalizing Props

Many functions accept props that can be either static values or reactive `Readable` values. Use `Readable.normalize()` to handle both cases:

```ts
// Reactive<T> means: T | Readable<T>
interface ButtonProps {
  disabled?: Readable.Reactive<boolean>;
  class?: Readable.Reactive<string>;
}

const Button = <E, R>(props: ButtonProps, child: Child<E, R>) => {
  // Normalize props - works whether they're static or reactive
  const disabled = Readable.normalize(props.disabled ?? false);
  const className = Readable.normalize(props.class ?? "");

  // Use .pipe(Readable.map()) for derived attributes
  const ariaDisabled = disabled.pipe(
    Readable.map((d) => (d ? "true" : undefined))
  );

  return $.button(
    { class: className, disabled, "aria-disabled": ariaDisabled },
    child
  );
};
```

### Lifting Functions

When using utility libraries like [class-variance-authority (CVA)](https://cva.style/docs) or [clsx](https://github.com/lukeed/clsx), use `Readable.lift` to make them reactive-aware:

```ts
import { cva } from "class-variance-authority";
import { Signal, Readable } from "@stax-ui/core";

const buttonStyles = cva("btn font-medium rounded", {
  variants: {
    variant: { primary: "bg-blue-500", secondary: "bg-gray-200" },
    size: { sm: "px-2 py-1", md: "px-4 py-2", lg: "px-6 py-3" },
  },
});

// Lift it to accept Readables
const reactiveButtonStyles = Readable.lift(buttonStyles);

const variant = yield* Signal.make<"primary" | "secondary">("primary");

// className is Readable<string> - updates when variant changes
const className = reactiveButtonStyles({ variant, size: "md" });
```

## Ref

Mutable references with deferred resolution, similar to React's `useRef` but with Effect integration:

```ts
import { Ref } from "@stax-ui/core";

// Create a ref for a DOM element
const inputRef = yield* Ref.make<HTMLInputElement>();

// inputRef.current is null until set
// inputRef.value is an Effect that resolves when the ref is populated

// Later, focus the input (waits until the ref is set)
yield* inputRef.value.pipe(
  Effect.tap((el) => Effect.sync(() => el.focus()))
);
```

## AsyncReadable

For async operations like data fetching, use `AsyncReadable`. It provides reactive state for loading, value, and error:

```ts
import { AsyncReadable } from "@stax-ui/core";

const userData = yield* AsyncReadable.make(() =>
  Effect.gen(function* () {
    const response = yield* fetchUser(userId);
    return response.data;
  })
);

// Reactive state properties
userData.isLoading;  // Readable<boolean>
userData.value;      // Readable<Option<User>>
userData.error;      // Readable<Option<Error>>

// Manually trigger refetch
yield* userData.refetch();

// Reset to initial state
yield* userData.reset();
```

### From Promises

```ts
// Simple promise
const data = yield* AsyncReadable.promise(() => fetch("/api/data").then(r => r.json()));

// With error handling
const data = yield* AsyncReadable.tryPromise(
  () => fetch("/api/data").then(r => r.json()),
  (error) => new ApiError({ cause: error })
);
```

### Reactive Dependencies

Recompute when a source Readable changes:

```ts
const userId = yield* Signal.make("alice");

const profile = yield* AsyncReadable.fromReadable(
  (id) => Effect.tryPromise(() => fetchProfile(id))
)(userId);
// Refetches automatically when userId changes
```

Use with control flow primitives:

```ts
import { when, matchOption } from "@stax-ui/core";

// Show loading spinner
when(userData.isLoading, {
  onTrue: () => Spinner(),
  onFalse: () => $.span(),
});

// Handle the value (matchOption unwraps Option for you)
matchOption(userData.value, {
  onSome: (user) => UserCard({ user }),  // user is Readable<User>
  onNone: () => $.span($.of("No data")),
});
```

## AsyncCache

A caching layer for async operations. Entries are keyed by hierarchical paths and can be invalidated by prefix. Ideal for data fetching in apps with loaders and mutations.

```ts
import { AsyncCache } from "@stax-ui/core";

const cache = yield* AsyncCache;

// Get or create a cached async readable
const posts = yield* cache.get(
  ["posts"],
  () => Effect.tryPromise(() => fetch("/api/posts").then(r => r.json())),
);

// Seed with initial data (e.g., from a server-side loader)
const posts = yield* cache.get(
  ["posts"],
  () => Effect.tryPromise(() => fetch("/api/posts").then(r => r.json())),
  { initialData: loaderData.posts },
);
```

### Cache Keys

Keys are arrays of primitives, enabling hierarchical invalidation:

```ts
// Key examples
["posts"]                    // all posts
["posts", "feed"]            // feed posts specifically
["posts", userId]            // posts by user
["users", 42, true]          // compound keys
```

### Invalidation

```ts
// Invalidate all entries starting with ["posts"] — triggers refetch
yield* cache.invalidate(["posts"]);

// Invalidate a specific user's data
yield* cache.invalidate(["users", userId]);

// Remove entries entirely (no refetch)
yield* cache.remove(["posts"]);

// Clear the whole cache
yield* cache.clear();
```

### Typical Usage with Loaders

```ts
const FeedPage = (data: { posts: Post[] }) =>
  Effect.gen(function* () {
    const cache = yield* AsyncCache;

    // Seed cache with server-loaded data, fetch from client on invalidation
    const feedQuery = yield* cache.get(
      ["feed"],
      () => Effect.tryPromise(() =>
        fetch("/?_data=1").then(r => r.json()).then(r => r.data)
      ),
      { initialData: data },
    );

    const posts = Readable.map(feedQuery.value, (fetched) =>
      Option.match(fetched, {
        onSome: (f) => f.posts,
        onNone: () => data.posts,
      }),
    );

    // After a mutation, invalidate to refetch:
    yield* cache.invalidate(["feed"]);
  });
```

## Mutation

For explicit async operations (like form submissions, API calls), use `Mutation`. Unlike AsyncReadable, mutations are triggered manually:

```ts
import { Mutation } from "@stax-ui/core";

const createUser = yield* Mutation.make((input: CreateUserInput) =>
  Effect.gen(function* () {
    const response = yield* api.createUser(input);
    return response.user;
  })
);

// Reactive state
createUser.isLoading;  // Readable<boolean>
createUser.data;       // Readable<Option<User>>
createUser.error;      // Readable<Option<Error>>

// Execute the mutation
const user = yield* createUser.run({ name: "Alice", email: "alice@example.com" });

// Reset state
yield* createUser.reset();
```

### From Promises

```ts
const createUser = yield* Mutation.promise((input: CreateUserInput) =>
  fetch("/api/users", { method: "POST", body: JSON.stringify(input) }).then(r => r.json())
);

// With error handling
const createUser = yield* Mutation.tryPromise(
  (input: CreateUserInput) =>
    fetch("/api/users", { method: "POST", body: JSON.stringify(input) }).then(r => r.json()),
  (error) => new ApiError({ cause: error })
);
```

## Reactive Collections

Stax provides reactive versions of Array, Map, Set, and Struct. Unlike in React where you must clone collections on every mutation, these allow in-place mutations that automatically trigger reactive updates.

### Signal.Array

A reactive array with in-place mutation methods:

```ts
const todos = yield* Signal.Array.make<Todo>([]);

// In-place mutations (no cloning needed!)
yield* todos.push({ id: 1, text: "Learn Stax", done: false });
yield* todos.unshift(firstItem);
yield* todos.pop();
yield* todos.shift();
yield* todos.splice(1, 2, replacement);
yield* todos.insertAt(0, item);
yield* todos.removeAt(index);
yield* todos.remove(specificItem);  // By reference
yield* todos.move(fromIndex, toIndex);  // Great for drag-and-drop
yield* todos.swap(indexA, indexB);
yield* todos.sort((a, b) => a.id - b.id);
yield* todos.reverse();
yield* todos.clear();

// Transform entire array
yield* todos.update(arr => arr.filter(t => !t.done));
yield* todos.set(newTodos);

// Reactive length
todos.length;  // Readable<number>

// Use with each
each(todos, {
  key: todo => todo.id,
  render: todo => TodoItem(todo),
});
```

### Signal.Map

A reactive Map for key-value stores:

```ts
const users = yield* Signal.Map.make<string, User>();

// Mutations
yield* users.set("u1", { name: "Alice", role: "admin" });
yield* users.delete("u1");
yield* users.clear();
yield* users.replace(newMap);
yield* users.update(m => new Map([...m, ["u2", bob]]));

// Reactive reads (for UI binding)
users.at("u1");              // Readable<Option<User>>
users.atOrElse("u1", guest); // Readable<User>
users.has("u1");              // Readable<boolean>

// One-time reads (for imperative code)
const user = yield* users.atEffect("u1");   // Effect<Option<User>>
const exists = yield* users.hasEffect("u1"); // Effect<boolean>

// Reactive derived values
users.size;         // Readable<number>
users.entries;      // Readable<readonly [string, User][]>
users.keys;         // Readable<readonly string[]>
users.valuesArray;  // Readable<readonly User[]>
```

### Signal.Set

A reactive Set for unique collections:

```ts
const tags = yield* Signal.Set.make<string>(["draft"]);

// Mutations
yield* tags.add("important");
yield* tags.delete("draft");
yield* tags.toggle("featured");  // Add if missing, remove if present
yield* tags.clear();
yield* tags.replace(newSet);
yield* tags.update(s => new Set([...s, "extra"]));

// Reactive reads
tags.has("important");  // Readable<boolean>

// One-time read
const exists = yield* tags.hasEffect("important");  // Effect<boolean>

// Reactive derived values
tags.size;         // Readable<number>
tags.valuesArray;  // Readable<readonly string[]>
```

**Why This Matters**: In React, mutating a Map/Set doesn't trigger re-renders because the reference is unchanged. You're forced to clone on every mutation:

```tsx
// React (painful)
setMap(new Map(map).set(key, value));
setSet(new Set(set).add(item));
```

With Stax's reactive collections, mutations are O(1) and automatically trigger updates.

### Signal.Struct

A reactive object where each field is an individual Signal. This allows granular updates to specific fields without affecting the rest:

```ts
const address = yield* Signal.Struct.make({
  street: "123 Main St",
  city: "Austin",
  zip: "78701",
});

// Each field is a Signal — granular reads and writes
yield* address.street.set("456 Oak Ave");
yield* address.city.update((c) => c.toUpperCase());

// Read the whole struct as a single Readable
const value = yield* address.get;
// { street: "456 Oak Ave", city: "AUSTIN", zip: "78701" }

// Batch update multiple fields
yield* address.update({ street: "789 Pine Rd", city: "Houston" });

// Replace the entire struct
yield* address.replace({ street: "100 New St", city: "San Antonio", zip: "78201" });

// List of field keys
address.keys;  // readonly ["street", "city", "zip"]
```

## Transition (State Machines)

`Transition` provides declarative state machines with type-safe transitions and reactive guards:

```ts
import { Transition } from "@stax-ui/core";

const status = yield* Transition.make(
  {
    idle: ["loading"],
    loading: ["success", "error"],
    success: ["idle"],
    error: ["idle", "loading"],
  },
  "idle"
);

// Current state (read-only Readable)
status.current;  // Readable<"idle" | "loading" | "success" | "error">

// Transition to a new state (fails if not allowed)
yield* status.to("loading");  // Effect<void, InvalidTransition>

// Check current state (reactive)
status.is("idle");  // Readable<boolean>

// Check if transition is allowed (reactive)
status.canTransitionTo("success");  // Readable<boolean>
```

### Guarded Transitions

Add reactive guards to transitions that must be satisfied:

```ts
const isOnline = yield* Signal.make(true);

const status = yield* Transition.make(
  {
    idle: [{ to: "loading", when: isOnline }, "error"],  // guarded + unguarded
    loading: ["success", "error"],
    success: ["idle"],
    error: ["idle"],
  },
  "idle"
);

// canTransitionTo respects guards - updates reactively
status.canTransitionTo("loading");  // true only when isOnline is true

// Transition fails if guard is false
yield* status.to("loading");  // InvalidTransition if offline
```

### Guarded Callbacks

Create callbacks that only run when in specific states:

```ts
const submit = status.guard(
  ["idle"],  // only enabled in these states
  (data: FormData) => Effect.gen(function* () {
    yield* status.to("loading");
    return yield* api.submit(data);
  }),
  { onBlocked: "ignore" }  // or "fail" (default)
);

yield* submit(formData);
```

## Control Flow

Reactive control flow primitives for conditional and list rendering. These work with any `Readable` value and automatically update the UI when the source changes.

### when

Conditional rendering based on a boolean Readable:

```ts
import { when } from "@stax-ui/core";

when(isLoggedIn, {
  onTrue: () => Dashboard(),
  onFalse: () => LoginForm(),
});
```

### match

Pattern matching on a Readable value:

```ts
import { match } from "@stax-ui/core";

match(status.current, {
  cases: [
    { pattern: "idle", render: () => IdleView() },
    { pattern: "loading", render: () => LoadingSpinner() },
    { pattern: "error", render: () => ErrorView() },
  ],
  fallback: () => $.div($.of("Unknown state")),
});
```

### matchOption / matchEither

Handle `Option` and `Either` values reactively:

```ts
import { matchOption, matchEither } from "@stax-ui/core";

matchOption(userData.value, {
  onSome: (user) => UserCard({ user }),  // user is Readable<User>
  onNone: () => $.span($.of("No data")),
});

matchEither(result, {
  onRight: (value) => SuccessView({ value }),
  onLeft: (error) => ErrorView({ error }),
});
```

### each

Keyed list rendering with efficient reconciliation:

```ts
import { each } from "@stax-ui/core";

each(todos, {
  key: (todo) => todo.id,
  render: (todo, index) => TodoItem({ todo, index }),
  container: () => $.ul({ class: "todo-list" }),
});
```

### redraw

Complete redraw on every change (useful when the whole subtree depends on the value):

```ts
import { redraw } from "@stax-ui/core";

redraw(theme, {
  render: (currentTheme) => ThemedApp({ theme: currentTheme }),
});
```

## API Reference

### Signal

| Method | Signature | Description |
|--------|-----------|-------------|
| `Signal.make` | `(initial: T) => Effect<Signal<T>, never, Scope>` | Create a signal |
| `Signal.equals` | `(fn: (a, b) => boolean) => (signal) => signal` | Custom equality (pipeable) |
| `Signal.fromNullable` | `(existing?, default) => Effect<Signal<T>>` | Use existing or create new |
| `Signal.fromReactive` | `(value, default) => Effect<Signal<T>>` | Convert any reactive value to Signal |
| `signal.get` | `Effect<T>` | Read current value |
| `signal.set` | `(value: T) => Effect<void>` | Set value |
| `signal.update` | `(fn: (T) => T) => Effect<void>` | Update with function |

### Readable

| Method | Signature | Description |
|--------|-----------|-------------|
| `Readable.of` | `(value: T) => Readable<T>` | Constant readable |
| `Readable.normalize` | `(value: T \| Readable<T>) => Readable<T>` | Normalize static or reactive |
| `Readable.fromStream` | `(initial, stream) => Readable<T>` | From initial + stream |
| `Readable.map` | `(readable, fn) => Readable<B>` | Transform value |
| `Readable.flatMap` | `(readable, fn) => Readable<B>` | Chain readables |
| `Readable.zip` | `(a, b) => Readable<[A, B]>` | Combine into tuple |
| `Readable.zipWith` | `(a, b, fn) => Readable<C>` | Combine with function |
| `Readable.zipAll` | `(readables) => Readable<[...]>` | Combine multiple into tuple |
| `Readable.filter` | `(readable, predicate) => Readable<T>` | Filter values |
| `Readable.dedupe` | `(readable) => Readable<T>` | Remove consecutive duplicates |
| `Readable.dedupeWith` | `(readable, equals) => Readable<T>` | Dedupe with custom equality |
| `Readable.lift` | `(fn) => reactiveFn` | Lift function to accept Readables |
| `Readable.tap` | `(readable, fn) => Readable<T>` | Side effect on each value |
| `readable.get` | `Effect<T>` | Read current value |
| `readable.changes` | `Stream<T>` | Stream of changes |
| `readable.values` | `Stream<T>` | Stream of all values (current + changes) |

### Ref

| Method | Signature | Description |
|--------|-----------|-------------|
| `Ref.make` | `() => Effect<Ref<T>, never, Scope>` | Create empty ref |
| `ref.current` | `T \| null` | Mutable current value |
| `ref.value` | `Effect<T>` | Resolves when ref is set |
| `ref.set` | `(value: T) => void` | Set value and complete deferred |

### AsyncReadable

| Method | Signature | Description |
|--------|-----------|-------------|
| `AsyncReadable.make` | `(fn) => Effect<AsyncReadable<A, E>>` | From effect (fetches immediately) |
| `AsyncReadable.promise` | `(fn) => Effect<AsyncReadable<A, unknown>>` | From promise |
| `AsyncReadable.tryPromise` | `(fn, onError) => Effect<AsyncReadable<A, E>>` | From promise with error mapping |
| `AsyncReadable.fromReadable` | `(fn) => (source) => Effect<AsyncReadable>` | Recompute on source change |
| `AsyncReadable.map` | `(ar, fn) => AsyncReadable<B, E>` | Transform successful value |
| `ar.isLoading` | `Readable<boolean>` | Loading state |
| `ar.value` | `Readable<Option<A>>` | Successful value |
| `ar.error` | `Readable<Option<E>>` | Error state |
| `ar.refetch` | `() => Effect<void>` | Manually refetch |
| `ar.reset` | `() => Effect<void>` | Reset to initial state |

### AsyncCache

| Method | Signature | Description |
|--------|-----------|-------------|
| `AsyncCache` | `Context.Tag` | Service tag (use `yield* AsyncCache`) |
| `makeAsyncCache` | `() => IAsyncCache` | Create instance |
| `cache.get` | `(key, fetcher, options?) => Effect<AsyncReadable>` | Get or create cached entry |
| `cache.invalidate` | `(keyPrefix) => Effect<void>` | Invalidate + refetch matching entries |
| `cache.remove` | `(keyPrefix) => Effect<void>` | Remove matching entries |
| `cache.clear` | `() => Effect<void>` | Clear entire cache |

### Mutation

| Method | Signature | Description |
|--------|-----------|-------------|
| `Mutation.make` | `(fn) => Effect<Mutation<I, O, E>>` | From effect |
| `Mutation.promise` | `(fn) => Effect<Mutation<I, O, unknown>>` | From promise |
| `Mutation.tryPromise` | `(fn, onError) => Effect<Mutation<I, O, E>>` | From promise with error mapping |
| `Mutation.map` | `(mutation, fn) => Mutation<I, O2, E>` | Transform result |
| `Mutation.flatMap` | `(mutation, fn) => Mutation<I, O2, E\|E2>` | Chain mutations |
| `mutation.isLoading` | `Readable<boolean>` | Loading state |
| `mutation.data` | `Readable<Option<O>>` | Successful result |
| `mutation.error` | `Readable<Option<E>>` | Error state |
| `mutation.run` | `(input: I) => Effect<O, E>` | Execute mutation |
| `mutation.reset` | `() => Effect<void>` | Reset to initial state |

### Reactive Collections

| Constructor | Description |
|-------------|-------------|
| `Signal.Array.make<T>(initial?)` | Reactive array |
| `Signal.Map.make<K, V>(initial?)` | Reactive map |
| `Signal.Set.make<T>(initial?)` | Reactive set |
| `Signal.Struct.make<T>(initial)` | Reactive struct with per-field Signals |

### Transition

| Method | Signature | Description |
|--------|-----------|-------------|
| `Transition.make` | `(config, initial) => Effect<Transition<S>>` | Create state machine |
| `transition.current` | `Readable<S>` | Current state |
| `transition.to` | `(state) => Effect<void, InvalidTransition>` | Transition |
| `transition.is` | `(state) => Readable<boolean>` | Check state |
| `transition.canTransitionTo` | `(state) => Readable<boolean>` | Check if allowed |
| `transition.guard` | `(states, callback, options?) => guardedFn` | Create guarded callback |

### Control Flow

| Function | Description |
|----------|-------------|
| `when(condition, { onTrue, onFalse })` | Conditional rendering |
| `match(value, { cases, fallback })` | Pattern matching |
| `matchOption(option, { onSome, onNone })` | Option matching |
| `matchEither(either, { onRight, onLeft })` | Either matching |
| `each(items, { key, render, container })` | Keyed list rendering |
| `redraw(readable, { render, container })` | Full redraw on change |
