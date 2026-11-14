---
title: "Defining Routes"
description: "Create routes with typed params, search params, loaders, guards, animations, and error handling."
order: 0
---

# Defining Routes

Routes are the building blocks of an Stax application's URL structure. A route connects a URL pattern to a component, optionally with typed parameters, data loading, and error handling.

## Basic Routes

Create a route with `Route.make` and add a render function with `Route.render`:

```typescript
import { Route } from "@stax-ui/router";
import { $ } from "@stax-ui/dom";

const HomeRoute = Route.make("/").pipe(
  Route.render(() => $.h1("Welcome home")),
);
```

Routes are built with a pipe-based combinator API. `Route.make` creates a bare route (with no render function), and you compose behavior onto it.

## Typed Params

URL parameters like `/users/:id` are strings by default. Use `Route.params` with an Effect Schema to validate and transform them:

```typescript
import { Schema } from "effect";
import { Route } from "@stax-ui/router";

const UserRoute = Route.make("/users/:id").pipe(
  Route.params(Schema.Struct({ id: Schema.NumberFromString })),
  Route.render(() => UserPage()),
);
```

Now `id` is a `number`, not a string. If the URL contains a non-numeric ID, the schema validation fails with a `ParseError`.

### Accessing Params in Components

Each route creates a unique context tag for its params. Access them with `yield*`:

```typescript
const UserPage = () =>
  Effect.gen(function* () {
    const { id } = yield* UserRoute.params;       // number
    return yield* $.div(`User ${id}`);
  });
```

### Search Params

Query string parameters work the same way:

```typescript
const SearchRoute = Route.make("/search").pipe(
  Route.searchParams(
    Schema.Struct({
      q: Schema.String,
      page: Schema.optional(Schema.NumberFromString).pipe(
        Schema.withDefault(() => 1),
      ),
    }),
  ),
  Route.render(() => SearchPage()),
);

// In SearchPage:
const { q, page } = yield* SearchRoute.searchParams;
// q: string, page: number (defaults to 1)
```

### Raw Params

If you don't need schema validation, use `Route.rawParams` to keep the raw string dictionary:

```typescript
const ProfileRoute = Route.make("/profile/:username").pipe(
  Route.rawParams,
  Route.render(() => ProfilePage()),
);

// In ProfilePage:
const { username } = yield* ProfileRoute.params;  // string
```

## Data Loading

`Route.get` adds a server-side loader and a render function that receives the loaded data:

```typescript
const UserRoute = Route.make("/users/:id").pipe(
  Route.params(Schema.Struct({ id: Schema.NumberFromString })),
  Route.get(
    ({ params: { id } }) =>
      Effect.gen(function* () {
        const db = yield* DatabaseService;
        return yield* db.getUser(id);
      }),
    (user) => UserPage({ user }),
  ),
);
```

The first argument is the loader — it receives `{ params, searchParams }` and returns data. The second argument is the render function — it receives the loader's return value directly.

The loader's error and requirement types (`E` and `R`) flow to the platform's HTTP router, not into the route's component types. This keeps client-side code clean of server dependencies.

## Guards

Protect routes with a reactive condition:

```typescript
const DashboardRoute = Route.make("/dashboard").pipe(
  Route.withGuard(isAuthenticated, { redirect: "/login" }),
  Route.render(() => Dashboard()),
);
```

If `isAuthenticated` is a Readable that returns `false`, the user is redirected to `/login`. You can also provide a fallback component instead of a redirect:

```typescript
Route.withGuard(isAuthenticated, {
  fallback: () => $.div("Please log in"),
})
```

## Animations

Add enter/exit animations to route transitions:

```typescript
const ModalRoute = Route.make("/modal/:id").pipe(
  Route.withAnimation({
    enter: "slide-up",
    exit: "slide-down",
  }),
  Route.render(() => ModalContent()),
);
```

These animations are applied by the Outlet when transitioning between routes.

## Lazy Loading

Split routes into separate bundles that load on demand:

```typescript
const AdminRoute = Route.lazy(
  "/admin",
  () => import("./admin/AdminPage.js"),
);
```

The dynamic import runs when the route is first matched. The imported module must have a `default` export that is a Route.

## Error Handling

Catch errors from a route's render function:

```typescript
const UserRoute = Route.make("/users/:id").pipe(
  Route.get(loader, renderUser),
  Route.catchTag("NotFound", () => NotFoundPage()),
  Route.catchTag("Unauthorized", () => UnauthorizedPage()),
);

// Or catch everything
const SafeRoute = Route.make("/risky").pipe(
  Route.render(() => RiskyComponent()),
  Route.catchAll((error) => ErrorPage({ error })),
);
```
