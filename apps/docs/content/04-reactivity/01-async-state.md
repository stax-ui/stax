---
title: "Async State"
description: "Manage loading, error, and success states for async operations with AsyncReadable, Mutation, and AsyncCache."
order: 1
---

# Async State

Real applications need to fetch data, submit forms, and handle loading and error states. Stax provides three primitives for this: **AsyncReadable** for data that loads automatically, **Mutation** for operations you trigger manually, and **AsyncCache** for coordinating data across your app.

## AsyncReadable

An AsyncReadable wraps an async operation and exposes reactive state for loading, value, and error:

```typescript
import { AsyncReadable } from "@stax-ui/dom";

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

The operation runs immediately when the AsyncReadable is created. The `isLoading`, `value`, and `error` Readables update as the operation progresses.

### From Promises

If you're working with promise-based APIs:

```typescript
// Simple promise
const data = yield* AsyncReadable.promise(
  () => fetch("/api/data").then((r) => r.json())
);

// With typed error handling
const data = yield* AsyncReadable.tryPromise(
  () => fetch("/api/data").then((r) => r.json()),
  (error) => new ApiError({ cause: error }),
);
```

### Reactive Dependencies

The most powerful pattern: recompute when a source Readable changes.

```typescript
const userId = yield* Signal.make("alice");

const profile = yield* AsyncReadable.fromReadable(
  (id) => Effect.tryPromise(() => fetchProfile(id))
)(userId);
// Refetches automatically when userId changes
```

When `userId` changes from `"alice"` to `"bob"`, the profile refetches automatically. The `isLoading` state reflects the new fetch, and the previous value remains available until the new one arrives.

### Rendering Async State

Async state works naturally with Stax's control flow primitives:

```typescript
import { when, matchOption } from "@stax-ui/dom";

// Show loading spinner
when(userData.isLoading, {
  onTrue: () => Spinner(),
  onFalse: () => $.span(),
});

// Handle the value
matchOption(userData.value, {
  onSome: (user) => UserCard({ user }),  // user is Readable<User>
  onNone: () => $.span("No data"),
});
```

## Mutation

Unlike AsyncReadable, a Mutation doesn't run until you tell it to. Use it for form submissions, API calls, or any operation triggered by user action:

```typescript
import { Mutation } from "@stax-ui/dom";

const createUser = yield* Mutation.make((input: CreateUserInput) =>
  Effect.gen(function* () {
    const response = yield* api.createUser(input);
    return response.user;
  })
);

// Same reactive state as AsyncReadable
createUser.isLoading;  // Readable<boolean>
createUser.data;       // Readable<Option<User>>
createUser.error;      // Readable<Option<Error>>

// Execute the mutation
const user = yield* createUser.run({
  name: "Alice",
  email: "alice@example.com",
});

// Reset state
yield* createUser.reset();
```

### From Promises

```typescript
const createUser = yield* Mutation.promise(
  (input: CreateUserInput) =>
    fetch("/api/users", {
      method: "POST",
      body: JSON.stringify(input),
    }).then((r) => r.json())
);

// With error handling
const createUser = yield* Mutation.tryPromise(
  (input: CreateUserInput) =>
    fetch("/api/users", {
      method: "POST",
      body: JSON.stringify(input),
    }).then((r) => r.json()),
  (error) => new ApiError({ cause: error }),
);
```

### Transforming Results

```typescript
// Transform the output
const createUserName = Mutation.map(createUser, (user) => user.name);

// Chain mutations
const createAndVerify = Mutation.flatMap(createUser, (user) =>
  Mutation.make(() => api.sendVerificationEmail(user.email))
);
```

## AsyncCache

AsyncCache coordinates async data across your application. It deduplicates requests, caches results, and supports hierarchical invalidation.

```typescript
import { AsyncCache } from "@stax-ui/dom";

const cache = yield* AsyncCache;

// Get or create a cached async readable
const posts = yield* cache.get(
  ["posts"],
  () => Effect.tryPromise(() =>
    fetch("/api/posts").then((r) => r.json())
  ),
);
```

If two components request the same cache key, they share the same AsyncReadable — no duplicate fetches.

### Seeding with Loader Data

In SSR or SSG apps, you often have data from a server-side loader. Seed the cache so the client doesn't refetch on hydration:

```typescript
const posts = yield* cache.get(
  ["posts"],
  () => Effect.tryPromise(() =>
    fetch("/api/posts").then((r) => r.json())
  ),
  { initialData: loaderData.posts },
);
```

### Hierarchical Keys

Cache keys are arrays, which enables prefix-based invalidation:

```typescript
// Key examples
["posts"]                    // all posts
["posts", "feed"]            // feed posts specifically
["posts", userId]            // posts by user
["users", 42, true]          // compound keys
```

### Invalidation

After a mutation, invalidate related cache entries to trigger a refetch:

```typescript
// Invalidate all entries starting with ["posts"] — triggers refetch
yield* cache.invalidate(["posts"]);

// Invalidate a specific user's data
yield* cache.invalidate(["users", userId]);

// Remove entries entirely (no refetch)
yield* cache.remove(["posts"]);

// Clear the whole cache
yield* cache.clear();
```

### Typical Pattern: Loader + Cache + Mutation

```typescript
const FeedPage = (data: { posts: Post[] }) =>
  Effect.gen(function* () {
    const cache = yield* AsyncCache;

    // Seed cache with server-loaded data
    const feedQuery = yield* cache.get(
      ["feed"],
      () => Effect.tryPromise(() =>
        fetch("/?_data=1").then((r) => r.json()).then((r) => r.data)
      ),
      { initialData: data },
    );

    const posts = Readable.map(feedQuery.value, (fetched) =>
      Option.match(fetched, {
        onSome: (f) => f.posts,
        onNone: () => data.posts,
      }),
    );

    // After a mutation, invalidate to refetch
    yield* cache.invalidate(["feed"]);
  });
```

This pattern gives you server-loaded data on first render, client-side refetching after mutations, and deduplication if multiple components read the same data.
