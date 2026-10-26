---
title: "Server-Side Rendering"
description: "Convert an Stax Router into an Effect HttpRouter with SSR, data loading, and mutation handling."
order: 1
---

# Server-Side Rendering

`@stax-ui/platform` bridges Stax's router to Effect's HTTP platform. The core function, `Platform.toHttpRoutes`, converts your Stax Router into an `@effect/platform` HttpRouter that handles SSR rendering, data loading, and mutation execution.

## Setup

```typescript
import { Effect } from "effect";
import { HttpRouter, HttpServer } from "@effect/platform";
import { Platform } from "@stax-ui/platform";

import { App } from "./app.js";
import { router } from "./routes.js";

const staxRoutes = Platform.toHttpRoutes(router, {
  app: App,
  document: {
    title: "My App",
    scripts: ["/client.js"],
    styles: ["/styles.css"],
  },
});

const httpApp = HttpRouter.empty.pipe(
  HttpRouter.concat(staxRoutes),
);
```

`toHttpRoutes` registers handlers for every route in your router. You can compose the result with other `@effect/platform` routes — adding API endpoints, static file serving, or anything else.

## How Requests Are Handled

### GET Requests

For each route, the GET handler:

1. Extracts and validates URL params and search params against the route's schemas
2. Runs the route's loader (`Route.get`) if one exists
3. If the request has `?_data=1`, returns the loader data as JSON (for client-side navigation)
4. Otherwise, SSR renders the component tree and returns a full HTML document

The HTML document includes the rendered content, embedded loader data for hydration, and script/style tags from the document options.

### POST / PUT / DELETE Requests

Mutation handlers execute directly — no component rendering:

1. Reads `?_action=key` from the URL to find the matching handler
2. Parses the request body (JSON or URL-encoded)
3. Runs the handler and returns the result as JSON

This means `Route.post("updateProfile", handler)` creates a POST endpoint at the route's path that dispatches by action key.

## Mutation Handlers

Routes can define handlers for POST, PUT, and DELETE requests using `Route.post`, `Route.put`, and `Route.delete`. These are server-only — the platform executes them directly without rendering any components:

```typescript
const UserRoute = Route.make("/users/:id").pipe(
  Route.params(Schema.Struct({ id: Schema.NumberFromString })),
  Route.post("updateProfile", (body) =>
    Effect.gen(function* () {
      const data = yield* Schema.decodeUnknown(ProfileSchema)(body);
      const db = yield* DatabaseService;
      return yield* db.updateProfile(data);
    }),
  ),
  Route.put("updateSettings", (body) =>
    Effect.gen(function* () {
      const settings = yield* Schema.decodeUnknown(SettingsSchema)(body);
      const db = yield* DatabaseService;
      return yield* db.updateSettings(settings);
    }),
  ),
  Route.delete("deleteUser", (_body) =>
    Effect.gen(function* () {
      const db = yield* DatabaseService;
      return yield* db.deleteUser();
    }),
  ),
  Route.get(loader, (user) => UserPage({ user })),
);
```

Each handler has a unique key (like `"updateProfile"`). The platform generates action URLs from these keys and makes them available to your components via `RouteDataContext`:

```typescript
const UserPage = (props: { user: User }) =>
  Effect.gen(function* () {
    const { actions } = yield* RouteDataContext;
    // actions.updateProfile → "/users/123?_action=updateProfile"

    return yield* $.form(
      { action: actions.updateProfile, method: "POST" },
      $.input({ name: "name", value: props.user.name }),
      $.button({ type: "submit" }, "Save"),
    );
  });
```

In client builds, the Vite plugin strips the handler bodies so server-only dependencies don't end up in the browser bundle. The keys are preserved so the Outlet can still compute action URLs.

### Redirects

Throw a `RedirectError` from any loader or handler to trigger an HTTP redirect:

```typescript
import { Platform } from "@stax-ui/platform";

Route.get(
  ({ params }) =>
    Effect.gen(function* () {
      const user = yield* db.getUser(params.id);
      if (!user) {
        return yield* Effect.fail(
          new Platform.RedirectError({ url: "/not-found", status: 302 }),
        );
      }
      return user;
    }),
  (user) => UserPage({ user }),
);
```

For data requests (`?_data=1`), redirects are returned as JSON signals (`{ _redirect: url }`) so the client can handle them as SPA navigations instead of full page reloads.

## Document Options

The `document` option controls the HTML shell:

```typescript
Platform.toHttpRoutes(router, {
  document: {
    title: "My App",
    scripts: ["/assets/client.js"],
    styles: ["/assets/styles.css"],
    head: '<meta name="description" content="My Stax app">',
    htmlAttrs: { lang: "en", "data-theme": "dark" },
  },
});
```

| Option | Description |
|--------|-------------|
| `title` | Content of the `<title>` tag |
| `scripts` | Script URLs added as `<script type="module">` tags |
| `styles` | Stylesheet URLs added as `<link rel="stylesheet">` tags |
| `head` | Raw HTML injected into `<head>` |
| `htmlAttrs` | Attributes added to the `<html>` element |

## App Component

The `app` option specifies your root component — the same tree the client hydrates. It should contain an `Outlet` that renders the matched route:

```typescript
const App = () =>
  $.div(
    { class: "app" },
    Header(),
    $.main({}, Outlet({ router })),
    Footer(),
  );

Platform.toHttpRoutes(router, { app: App });
```

If `app` is omitted, the platform renders just the matched route with its layouts applied. Using `app` ensures the server-rendered HTML matches what the client hydrates.

## Client Hydration

On the client, use `Platform.makeClientLayer` to set up navigation and data fetching:

```typescript
import { hydrate } from "@stax-ui/dom/hydrate";
import { Platform } from "@stax-ui/platform";

import { App } from "./app.js";
import { router } from "./routes.js";

hydrate(App(), document.getElementById("root")!, {
  layers: Platform.makeClientLayer(router),
});
```

`makeClientLayer` provides two things:

1. **NavigationContext** — browser history management and route matching
2. **RouteDataProvider** — on the first load (hydration), reads data from the embedded `<script type="application/json" id="__stax_data">` block. On subsequent navigations, fetches from the server via `?_data=1`

After hydration, all navigation is client-side. Only data is fetched from the server — no full page reloads.
