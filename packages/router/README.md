# @stax-ui/router

Type-safe routing for Stax applications built on Effect.

## Installation

```bash
pnpm add @stax-ui/router @stax-ui/dom effect
```

## Overview

The router is built around five main concepts:

- **Route** — Define individual routes with paths, loaders, handlers, and render functions using a pipeable builder API
- **Router** — Compose routes together with layouts, guards, fallbacks, and error handling
- **Navigation** — Runtime service for reactive navigation state and programmatic navigation
- **Outlet** — Component that renders the currently matched route
- **Link** — Component for declarative client-side navigation

## Quick Start

```ts
import { $, collect, Signal, mount } from "@stax-ui/dom";
import { Route, Router, Navigation, Link, Outlet } from "@stax-ui/router";

// Define routes
const HomeRoute = Route.make("/").pipe(
  Route.render(() => $.div($.of("Welcome home!"))),
);

const AboutRoute = Route.make("/about").pipe(
  Route.render(() => $.div($.of("About us"))),
);

// Compose router
const router = Router.empty.pipe(
  Router.concat(HomeRoute),
  Router.concat(AboutRoute),
  Router.fallback(() => $.div("Not found")),
);

// App component with navigation
const App = () =>
  $.div(
    $.nav(
      Link({ href: "/" }, "Home"),
      Link({ href: "/about" }, "About"),
    ),
    Outlet({ router }),
  );

// Run the app
mount(App(), document.getElementById("root")!, {
  layers: Navigation.makeLayer(router),
});
```

## Route

Routes are defined using `Route.make(path)` and configured with pipeable combinators.

### Basic Routes

```ts
import { Route } from "@stax-ui/router";

const HomeRoute = Route.make("/").pipe(
  Route.render(() => HomePage()),
);

const AboutRoute = Route.make("/about").pipe(
  Route.render(() => AboutPage()),
);
```

### Routes with Parameters

Use `:param` syntax for dynamic segments:

```ts
import { Schema } from "effect";

const UserRoute = Route.make("/users/:id").pipe(
  Route.params(Schema.Struct({ id: Schema.NumberFromString })),
  Route.render(() =>
    Effect.gen(function* () {
      const { id } = yield* UserRoute.params;  // id is number
      return yield* UserPage({ id });
    }),
  ),
);

const PostRoute = Route.make("/posts/:slug/comments/:commentId").pipe(
  Route.params(Schema.Struct({
    slug: Schema.String,
    commentId: Schema.NumberFromString,
  })),
  Route.render(() =>
    Effect.gen(function* () {
      const { slug, commentId } = yield* PostRoute.params;
      return yield* PostCommentPage({ slug, commentId });
    }),
  ),
);
```

Use `Route.rawParams` to skip schema validation and keep params as raw strings:

```ts
const ProfileRoute = Route.make("/profile/:username").pipe(
  Route.rawParams,
  Route.render(() =>
    Effect.gen(function* () {
      const { username } = yield* ProfileRoute.params;  // string
      return yield* ProfilePage({ username });
    }),
  ),
);
```

### Search Params

Add typed search parameters with schema validation:

```ts
const SearchRoute = Route.make("/search").pipe(
  Route.searchParams(Schema.Struct({
    q: Schema.String,
    page: Schema.optional(Schema.NumberFromString).pipe(
      Schema.withDefault(() => 1),
    ),
  })),
  Route.render(() =>
    Effect.gen(function* () {
      const { q, page } = yield* SearchRoute.searchParams;
      return yield* SearchResults({ query: q, page });
    }),
  ),
);
```

### Loaders (Data Fetching)

Use `Route.get()` to add a loader and render function. In SPA apps, the loader runs client-side. When using `@stax-ui/platform` for SSR, the loader runs server-side and its data is serialized to the client. Either way, the render function receives the loader's return value directly:

```ts
const UsersRoute = Route.make("/users").pipe(
  Route.get(
    ({}) =>
      Effect.gen(function* () {
        const db = yield* DatabaseService;
        return yield* db.getUsers();
      }),
    (users) => UsersPage({ users }),
  ),
);

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

The loader's error and requirement types do not flow into the route's render error channel — in SSR mode they flow to the platform's HTTP handler, and in SPA mode the Outlet runs them directly. Either way, the render function only deals with the data type.

### Mutation Handlers

Add POST/PUT/DELETE handlers for server-side mutations:

```ts
const UserRoute = Route.make("/users/:id").pipe(
  Route.params(Schema.Struct({ id: Schema.NumberFromString })),
  Route.get(
    ({ params: { id } }) => db.getUser(id),
    (user) => UserPage({ user }),
  ),
  Route.post("updateProfile", (body) =>
    Effect.gen(function* () {
      const data = yield* Schema.decodeUnknown(ProfileSchema)(body);
      const db = yield* DatabaseService;
      return yield* db.updateProfile(data);
    }),
  ),
  Route.put("updateAvatar", (body) => db.updateAvatar(body)),
  Route.delete("deleteUser", (body) => db.deleteUser(body)),
);
```

Handler keys (e.g., `"updateProfile"`) become action endpoints accessible via `RouteDataContext.actions` in the component.

> **Note:** Mutation handlers are only executed by `@stax-ui/platform` on the server. In SPA mode, `Route.post`/`put`/`delete` register action URL paths but there is no server to handle them — use mutations or direct API calls instead.

### Route Guards

Protect routes with reactive or effectful conditions:

```ts
const DashboardRoute = Route.make("/dashboard").pipe(
  Route.render(() => DashboardPage()),
  Route.withGuard(isAuthenticated, { redirect: "/login" }),
);

// Or with a fallback component instead of redirect
const AdminRoute = Route.make("/admin").pipe(
  Route.render(() => AdminPanel()),
  Route.withGuard(isAdmin, {
    fallback: () => $.div($.of("Access denied")),
  }),
);
```

Guards can be a `Readable<boolean>` (reactive) or an `Effect<boolean>`.

### Route Animations

```ts
const ModalRoute = Route.make("/modal/:id").pipe(
  Route.render(() => ModalContent()),
  Route.withAnimation({
    enter: "slide-up",
    exit: "slide-down",
    enterFrom: "opacity-0",
    enterTo: "opacity-100",
  }),
);
```

### Error Handling

Catch errors at the route level:

```ts
const UserRoute = Route.make("/users/:id").pipe(
  Route.get(loader, renderFn),
  Route.catchTag("NotFound", () => NotFoundPage()),
  Route.catchTag("Unauthorized", () => LoginPage()),
);

// Or catch by predicate
Route.catchIf(
  (error) => error._tag === "NotFound",
  () => NotFoundPage(),
)

// Or catch all
Route.catchAll((error) => ErrorPage({ error }))
```

### Lazy Loading

Load route modules on demand:

```ts
const AdminRoute = Route.lazy("/admin", () => import("./admin/AdminPage"), {
  fallback: () => $.div($.of("Loading...")),
});
```

## Router

Compose routes using the pipeable Router API.

### Basic Composition

```ts
import { Router } from "@stax-ui/router";

const router = Router.empty.pipe(
  Router.concat(HomeRoute),
  Router.concat(AboutRoute),
  Router.concat(UserRoute),
);
```

`Router.concat` is polymorphic — it accepts both individual routes and other routers:

```ts
const adminRouter = Router.empty.pipe(
  Router.concat(AdminDashboardRoute),
  Router.concat(AdminUsersRoute),
);

const router = Router.empty.pipe(
  Router.concat(HomeRoute),
  Router.concat(adminRouter),  // Merges all routes from adminRouter
);
```

### Prefix Routes

Add a common prefix to a group of routes:

```ts
const adminRouter = Router.empty.pipe(
  Router.concat(DashboardRoute),  // /
  Router.concat(UsersRoute),      // /users
  Router.prefixAll("/admin"),
);
// Routes: /admin, /admin/users
```

### Fallback

Set what renders when no route matches:

```ts
const router = Router.empty.pipe(
  Router.concat(HomeRoute),
  Router.concat(AboutRoute),
  Router.fallback(() => NotFoundPage()),
);
```

### Router Guards

Apply a guard to an entire group of routes:

```ts
const protectedRoutes = Router.empty.pipe(
  Router.concat(DashboardRoute),
  Router.concat(ProfileRoute),
);

const router = Router.empty.pipe(
  Router.concat(HomeRoute),
  Router.concat(LoginRoute),
  Router.guard(isAuthenticated, protectedRoutes, { redirect: "/login" }),
);
```

### Layouts

Wrap routes with a layout component. Layouts are applied inside-out:

```ts
const AppLayout = <A extends HTMLElement | SVGElement, E, R>(
  children: Element.Element<A, E, R>,
) => $.div({ class: "app" }, Navbar(), $.main(children));

const SidebarLayout = <A extends HTMLElement | SVGElement, E, R>(
  children: Element.Element<A, E, R>,
) => $.div({ class: "with-sidebar" }, Sidebar(), children);

const router = Router.empty.pipe(
  Router.concat(DashboardRoute),
  Router.concat(SettingsRoute),
  Router.layout(SidebarLayout),
  Router.layout(AppLayout),
);
// Renders: AppLayout(SidebarLayout(matchedRoute))
```

### Error Handling

Catch errors from all routes in a router:

```ts
const router = Router.empty.pipe(
  Router.concat(HomeRoute),
  Router.concat(UserRoute),
  Router.catchTag("NotFound", () => NotFoundPage()),
  Router.catchTag("Unauthorized", () => LoginPage()),
  Router.catchAll((error) => $.div($.of("Something went wrong"))),
);
```

### Route Matching

```ts
import { Router } from "@stax-ui/router";

const match = Router.findMatch(router, "/users/123");
// Option<{ route: Route, params: { id: "123" } }>
```

## Outlet

The `Outlet` component renders the currently matched route. It handles guard enforcement, layout application, data loading, and route transitions:

```ts
import { Outlet } from "@stax-ui/router";

const App = () =>
  $.div(
    Navbar(),
    $.main(Outlet({ router })),
  );
```

Outlet automatically:
- Matches the current pathname against the router
- Enforces route guards (redirect or fallback)
- Applies layouts inside-out
- Provides `RouteDataContext` with loader data and action endpoints
- Uses key-based reconciliation for efficient route transitions

## Navigation

The Navigation service provides reactive state and programmatic navigation.

### Setup

```ts
import { Navigation } from "@stax-ui/router";

// Create a layer to provide to your app
const navLayer = Navigation.makeLayer(router, {
  initialPath: "/",       // Optional, defaults to window.location
  initialSearch: "",      // Optional
});

// Provide via mount
mount(App(), root, { layers: navLayer });
```

### Reactive State

```ts
import { NavigationContext } from "@stax-ui/router";

Effect.gen(function* () {
  const nav = yield* NavigationContext;

  // All state is reactive (Readable)
  nav.pathname;       // Readable<string>
  nav.searchParams;   // Readable<URLSearchParams>
  nav.currentMatch;   // Readable<Option<CurrentMatch>>
});
```

### Programmatic Navigation

```ts
Effect.gen(function* () {
  const nav = yield* NavigationContext;

  // Path-based
  yield* nav.pushPath("/users/123");
  yield* nav.replacePath("/login");

  // Type-safe route-based
  yield* nav.pushRoute(UserRoute, {
    params: { id: 456 },
    searchParams: { tab: "posts" },
  });

  // Browser history
  yield* nav.back();
  yield* nav.forward();
});
```

### Accessor Effects

Convenience effects that access `NavigationContext` internally:

```ts
import { Navigation } from "@stax-ui/router";

const path = yield* Navigation.pathname;
const params = yield* Navigation.searchParams;
const match = yield* Navigation.currentMatch;

yield* Navigation.pushPath("/about");
yield* Navigation.replacePath("/home");
yield* Navigation.back();
yield* Navigation.forward();
```

### Building Paths

Build path strings from routes with type-safe params:

```ts
const path = Navigation.buildPath(
  UserRoute,
  { id: "123" },
  { tab: "posts" },
);
// "/users/123?tab=posts"
```

## Link

The Link component provides declarative navigation with automatic active state.

### Basic Usage

```ts
import { Link } from "@stax-ui/router";

Link({ href: "/about" }, $.of("About Us"))

Link({ href: "/contact", class: "nav-link" }, $.of("Contact"))
```

### Type-Safe Route Navigation

```ts
Link(
  { to: UserRoute, params: { id: "123" } },
  $.of("View User"),
)

Link(
  { to: SearchRoute, searchParams: { q: "effect", page: "1" } },
  $.of("Search"),
)
```

### Active State

Links automatically receive data attributes based on the current path:

- `data-active-exact="true"` — Path matches exactly
- `data-active-prefix="true"` — Current path starts with link href

Style active links with CSS:

```css
a[data-active-exact] { font-weight: bold; }
a[data-active-prefix] { color: blue; }
```

### Replace Navigation

Replace the current history entry instead of pushing:

```ts
Link({ href: "/login", replace: true }, $.of("Login"))
```

### External Links

External URLs and `target="_blank"` links work normally without SPA interception. Modifier keys (ctrl, cmd, shift, alt) also bypass SPA navigation:

```ts
Link(
  { href: "https://example.com", target: "_blank", rel: "noopener" },
  $.of("External Site"),
)
```

## RouteData

Route data context provides loader results and action endpoints to components.

### RouteDataContext

Access loader data, the loader refetch URL, and mutation action URLs inside a route's render function:

```ts
import { RouteDataContext } from "@stax-ui/router";

const FeedPage = (data: { posts: Post[] }) =>
  Effect.gen(function* () {
    const { loaderPath, actions } = yield* RouteDataContext;

    // loaderPath is the URL to refetch loader data (e.g., "/?_data=1")
    const fresh = yield* Effect.tryPromise(() =>
      fetch(loaderPath).then(r => r.json())
    );

    // actions.create is the URL for the "create" POST handler
    yield* $.form(
      { action: actions.create, method: "post" },
      // ...form fields
    );
  });
```

### RouteDataProvider

In SSR mode, `@stax-ui/platform` provides a `RouteDataProvider` that handles server-side loader execution and client-side data fetching via `?_data=1` requests. In SPA mode (without platform), the Outlet runs loaders directly on the client.

## API Reference

### Route

| Combinator | Description |
|------------|-------------|
| `Route.make(path)` | Create a route — returns pipeable route builder |
| `Route.render(fn)` | Set render function (no loader) |
| `Route.get(loader, renderFn)` | Add GET loader + render (typed data flow) |
| `Route.post(key, handler)` | Add POST mutation handler |
| `Route.put(key, handler)` | Add PUT mutation handler |
| `Route.delete(key, handler)` | Add DELETE mutation handler |
| `Route.params(schema)` | Add typed params schema |
| `Route.searchParams(schema)` | Add typed search params schema |
| `Route.rawParams` | Keep params as raw strings |
| `Route.withGuard(condition, options)` | Add guard (redirect or fallback) |
| `Route.withAnimation(options)` | Add transition animation config |
| `Route.catchIf(predicate, handler)` | Catch errors by predicate |
| `Route.catchTag(tag, handler)` | Catch errors by `_tag` |
| `Route.catchAll(handler)` | Catch all errors |
| `Route.lazy(path, load, options?)` | Create lazy-loaded route |

Route instances also expose:
- `route.Params` — Context tag for typed param access
- `route.params` — Effect that yields typed params
- `route.searchParams` — Effect that yields typed search params

### Router

| Combinator | Description |
|------------|-------------|
| `Router.empty` | Empty router to start composition |
| `Router.concat(routeOrRouter)` | Add route or merge router |
| `Router.prefixAll(prefix)` | Add prefix to all routes |
| `Router.fallback(renderFn)` | Set fallback for unmatched paths |
| `Router.guard(condition, router, options)` | Guard a group of routes |
| `Router.layout(wrapper)` | Add layout wrapper (inside-out) |
| `Router.catchIf(predicate, handler)` | Catch errors from all routes |
| `Router.catchTag(tag, handler)` | Catch tagged errors from all routes |
| `Router.catchAll(handler)` | Catch all errors from all routes |
| `Router.findMatch(router, pathname)` | Find best matching route |
| `Router.parseParams(route, rawParams)` | Validate params with schema |
| `Router.parseSearchParams(route, searchParams)` | Validate search params |

### Navigation

| Export | Description |
|--------|-------------|
| `Navigation.make(router, options?)` | Create Navigation service |
| `Navigation.makeLayer(router, options?)` | Create Navigation layer |
| `Navigation.buildPath(route, params, search?)` | Build path string |
| `NavigationContext` | Context tag for Navigation service |
| `Navigation.pathname` | Effect — current pathname |
| `Navigation.searchParams` | Effect — current search params |
| `Navigation.currentMatch` | Effect — current matched route |
| `Navigation.pushPath(path)` | Effect — navigate to path |
| `Navigation.replacePath(path)` | Effect — replace current path |
| `Navigation.back()` | Effect — go back |
| `Navigation.forward()` | Effect — go forward |

### Components

| Export | Description |
|--------|-------------|
| `Outlet({ router })` | Render matched route with guards and layouts |
| `Link(props, children)` | Navigation link with active state |
| `RouteDataContext` | Context tag for loader data, loader path, and action URLs |
| `RouteDataProvider` | Context tag for platform data fetching |

### LinkProps

| Prop | Type | Description |
|------|------|-------------|
| `href` | `string` | Path to navigate to |
| `to` | `Route` | Route for type-safe navigation |
| `params` | `Record<string, unknown>` | Params for route-based navigation |
| `searchParams` | `Record<string, unknown>` | Search params to append |
| `replace` | `boolean` | Replace history entry instead of push |
| `class` | `string \| Readable<string>` | CSS class |
| `target` | `string` | Link target (`_blank`, etc.) |
| `rel` | `string` | Link rel attribute |
| `id` | `string` | Element ID |
| `title` | `string` | Element title |
| `data-*` | `string \| boolean \| number` | Data attributes |
| `aria-*` | `string \| boolean \| number` | ARIA attributes |
