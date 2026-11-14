---
title: "Effect in 2 Minutes"
description: "A quick mental model for Effect.ts—think Promises with superpowers"
order: 2
---

# Effect in 2 Minutes

You don't need to be an Effect expert to use Stax. This page gives you just enough to be productive.

## The Mental Model
### Promises with Superpowers

If you know Promises, you already understand 80% of Effect.

| Promise | Effect |
|---------|--------|
| `Promise<A>` | `Effect<A, E, R>` |
| Value that will resolve | Value that will resolve |
| Might reject (untyped) | Might fail with `E` (typed!) |
| — | Might need `R` (dependencies) |

The key difference: Effect tracks **errors** and **requirements** in the type system.

## Pipeline Style
### .then → .pipe

You can chain Promises with `.then()`. Effect uses `.pipe()` with operators:

```typescript
// Promise pipeline
fetchUser(id)
  .then(user => user.profile)
  .then(profile => profile.name)
  .catch(err => "Unknown");

// Effect pipeline
fetchUser(id).pipe(
  Effect.map(user => user.profile),
  Effect.map(profile => profile.name),
  Effect.catchAll(() => Effect.succeed("Unknown"))
);
```

| Promise | Effect |
|---------|--------|
| `.then(a => b)` | `Effect.map(a => b)` |
| `.then(a => promiseB)` | `Effect.flatMap(a => effectB)` |
| `.catch(handler)` | `Effect.catchAll(handler)` |

The difference? With Effect, **errors are typed**. The compiler knows exactly what can fail.

## Generator Style
### async/await → Effect.gen/yield*

Just like `async/await` made Promise chains readable, `Effect.gen` does the same:

```typescript
// async/await
async function fetchUser(id: string): Promise<User> {
  const response = await fetch(`/users/${id}`);  // errors? who knows!
  const user = await response.json();
  return user;
}

// Effect.gen
const fetchUser = (id: string): Effect<User, HttpError, never> =>
  Effect.gen(function* () {
    const response = yield* httpGet(`/users/${id}`);  // HttpError in type!
    const user = yield* parseJson(response);
    return user;
  });
```

- `function*` makes it a generator (required for `yield*`)
- `yield*` unwraps the Effect, like `await` unwraps a Promise
- **The error type is visible**—no surprise runtime crashes

## Why Not Just Use Promises?

This isn't arbitrary. Effects solve real problems:

**1. Errors disappear with Promises**
```typescript
// Promise: errors vanish into the void
async function getUser(): Promise<User> {
  return fetch("/user").then(r => r.json());  // Can throw! But type says Promise<User>
}

// Effect: errors are tracked
const getUser: Effect<User, HttpError | JsonError, never> = ...  // Compiler enforces handling
```

**2. Effects are lazy, Promises are eager**
```typescript
// Promise: starts immediately when created
const promise = fetch("/api");  // Network request fires NOW

// Effect: describes what to do, runs when you say so
const effect = httpGet("/api");  // Nothing happens yet
Effect.runPromise(effect);       // NOW it runs
```

This laziness lets Stax render the same component on server or client, cancel unnecessary work, and batch operations.

**3. Dependencies are explicit**
```typescript
// Promise: where does logger come from? Global? Import? Magic?
async function saveUser(user: User) {
  logger.info("Saving user");  // ???
  await db.save(user);         // ???
}

// Effect: dependencies declared in the type
const saveUser = (user: User): Effect<void, DbError, Logger | Database> => ...
//                                                     ↑ must be provided!
```

## Error Handling

Effect makes error handling explicit and type-safe:

```typescript
// Define error types
class NotFoundError { readonly _tag = "NotFoundError"; }
class NetworkError { readonly _tag = "NetworkError"; }

// Function that can fail
const fetchUser = (id: string): Effect<User, NotFoundError | NetworkError, never> => ...

// Handle specific errors
fetchUser("123").pipe(
  Effect.catchTag("NotFoundError", () => Effect.succeed(defaultUser)),
  Effect.catchTag("NetworkError", (err) => Effect.fail(new RetryableError(err))),
);

// Or handle all errors
fetchUser("123").pipe(
  Effect.catchAll((err) => {
    console.error("Failed:", err);
    return Effect.succeed(fallbackUser);
  }),
);
```

The compiler ensures you handle (or propagate) every possible error.

## Dependency Injection

The `R` type parameter tracks what services your code needs:

```typescript
// Define a service
class Database extends Context.Tag("Database")<Database, {
  query: (sql: string) => Effect<Row[], DbError, never>;
}>() {}

// Use it—Database appears in R
const getUsers: Effect<User[], DbError, Database> = Effect.gen(function* () {
  const db = yield* Database;
  const rows = yield* db.query("SELECT * FROM users");
  return rows.map(toUser);
});

// Provide it when running
Effect.runPromise(
  getUsers.pipe(Effect.provide(DatabaseLive))  // Satisfy the Database requirement
);
```

This makes testing trivial—swap `DatabaseLive` for `DatabaseTest` with no code changes.

## Effect.gen
### Where You'll See This Most

In Stax, you'll mostly use `Effect.gen`:

```typescript
const Counter = () =>
  Effect.gen(function* () {
    const count = yield* Signal.make(0);

    return yield* $.div(
      $.button({ onClick: () => count.update(n => n - 1) }, "-"),
      $.span(count),
      $.button({ onClick: () => count.update(n => n + 1) }, "+"),
    );
  });
```

Every `yield*` unwraps an Effect:
- `Signal.make(0)` returns an Effect that creates a Signal
- `$.div(...)` returns an Effect that creates a DOM element

## The Three Type Parameters

```typescript
Effect<A, E, R>
```

- **`A`** (Success): What you get when it succeeds
- **`E`** (Error): What errors can occur (`never` = infallible)
- **`R`** (Requirements): What services it needs (`never` = none)

In Stax:
- Elements are `Effect<HTMLElement, E, R>`
- Signals are created with `Effect<Signal<T>, never, Scope>`
- Components return `Effect<HTMLElement, E, R>`

## You Don't Need to Know More (Yet)

This covers what you need for building Stax apps. Stax handles most Effect complexity for you—you'll rarely need to think about `Scope`, `Layer`, or advanced error handling.

As you grow, explore:
- [Effect Documentation](https://effect.website/docs/introduction)
- [Why Effect?](https://effect.website/docs/why-effect)
