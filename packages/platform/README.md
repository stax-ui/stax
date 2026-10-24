# @stax-ui/platform

Server-side rendering, static site generation, and hydration utilities for Stax applications. Supports two output modes:

- **SSR** — Convert an Stax Router into `@effect/platform` HTTP handlers; renders pages per-request, handles data requests and mutations.
- **SSG** — Pre-render all routes at build time into static HTML files for deployment to any static host.

## Installation

```bash
pnpm add @stax-ui/platform @effect/platform effect
```

`@stax-ui/dom` and `@stax-ui/router` are peer dependencies — install them separately:

```bash
pnpm add @stax-ui/dom @stax-ui/router
```

> `@stax-ui/dom` re-exports `@stax-ui/core`, so you don't need to install core separately.

## Overview

`@stax-ui/platform` is a server-side package that bridges Stax's UI layer with `@effect/platform`'s HTTP server (for SSR) and a build-time static-site generator (for SSG). It does not re-export dom or router — import those directly:

```ts
import { $, collect, Readable } from "@stax-ui/dom";          // UI primitives
import { Route, Router, Outlet, Link } from "@stax-ui/router"; // Routing
import { Platform, RedirectError } from "@stax-ui/platform";   // SSR + SSG utilities
```

## SSR vs. SSG — which to use

| | SSR | SSG |
|---|---|---|
| **Rendering happens** | Per request, on a long-running server | Once, at build time |
| **Route definition** | `Route.get(loader, render)` | `Route.static({ paths, load, render })` |
| **Deployment target** | Node host (Fly.io, Railway, VPS) | Any static host (Cloudflare Pages, Netlify, S3) |
| **Per-request data** | ✅ | ❌ (data fixed at build) |
| **Mutation handlers (`Route.post/put/delete`)** | ✅ | ❌ (no server at runtime) |
| **Operational cost** | Server uptime + compute | Free static hosting |
| **Hydration / interactivity** | ✅ identical to SSG | ✅ identical to SSR |

Both modes produce fully hydratable output — the same client bundle picks up the SSR-rendered or pre-built HTML and brings the same interactive components to life. Choose based on whether you need per-request server logic, not based on whether you need interactivity.

## SSR Quick Start

### Define Routes

```ts
// routes.ts
import { Effect, Schema } from "effect";
import { Route, Router } from "@stax-ui/router";
import { RedirectError } from "@stax-ui/platform";

import { UserPage } from "./pages/User.js";
import { FeedPage } from "./pages/Feed.js";

const FeedRoute = Route.make("/").pipe(
  Route.get(
    () =>
      Effect.gen(function* () {
        const svc = yield* PostService;
        return yield* svc.getPosts();
      }),
    (posts) => FeedPage({ posts }),
  ),
  Route.post("create", (body) =>
    Effect.gen(function* () {
      const { content } = body as { content: string };
      const svc = yield* PostService;
      return yield* svc.createPost(content);
    }),
  ),
);

const UserRoute = Route.make("/users/:id").pipe(
  Route.params(Schema.Struct({ id: Schema.String })),
  Route.get(
    ({ params: { id } }) =>
      Effect.gen(function* () {
        const svc = yield* PostService;
        return yield* svc.getUser(id);
      }),
    (user) => UserPage({ user }),
  ),
);

export const router = Router.empty.pipe(
  Router.concat(FeedRoute),
  Router.concat(UserRoute),
  Router.fallback(() => NotFoundPage()),
);
```

### Server Entry

```ts
// server.ts
import { createServer } from "node:http";
import { HttpRouter, HttpServer, HttpServerResponse } from "@effect/platform";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Layer } from "effect";
import { Platform } from "@stax-ui/platform";

import { App } from "./App.js";
import { router } from "./routes.js";

const staxRoutes = Platform.toHttpRoutes(router, {
  app: App,
  document: {
    title: "My App",
    scripts: ["/src/client.ts"],
    styles: ["/styles.css"],
  },
});

const httpApp = HttpRouter.empty.pipe(
  HttpRouter.get("/api/health", HttpServerResponse.json({ ok: true })),
  HttpRouter.concat(staxRoutes),
);

const ServerLive = httpApp.pipe(
  HttpServer.serve(),
  Layer.provide(NodeHttpServer.layer(createServer, { port: 3000 })),
);

NodeRuntime.runMain(Layer.launch(ServerLive));
```

### Client Entry

```ts
// client.ts
import type { Element } from "@stax-ui/dom";
import { hydrate } from "@stax-ui/dom/hydrate";
import { Platform } from "@stax-ui/platform";

import { App } from "./App.js";
import { router } from "./routes.js";

hydrate(
  App() as unknown as Element.Element<HTMLElement>,
  document.getElementById("root")!,
  { layers: Platform.makeClientLayer(router) },
);
```

### App Component

The app component is shared between server and client. It should contain an `Outlet` that renders matched routes:

```ts
// App.ts
import { $ } from "@stax-ui/dom";
import { Link, Outlet } from "@stax-ui/router";
import { router } from "./routes.js";

export const App = () =>
  $.div(
    { class: "app" },
    $.nav({}, Link({ href: "/" }, "Home")),
    $.main({}, Outlet({ router })),
  );
```

## SSG Quick Start

### Define Static Routes

Routes opt into static generation via `Route.static({ paths, load, render })`. The `paths` function returns all parameter sets to build; the `load` function runs at build time per parameter set:

```ts
// routes.ts
import { Effect, Schema } from "effect";
import { Route, Router } from "@stax-ui/router";

import { HomePage } from "./pages/Home.js";
import { PostPage } from "./pages/Post.js";
import { NotFoundPage } from "./pages/NotFound.js";

const HomeRoute = Route.make("/").pipe(
  Route.static({
    paths: () => Effect.succeed([{}]), // one path, no params
    load: () => Effect.succeed({ heading: "Welcome" }),
    render: (data) => HomePage({ data }),
  }),
);

const PostRoute = Route.make("/posts/:slug").pipe(
  Route.params(Schema.Struct({ slug: Schema.String })),
  Route.static({
    paths: () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const slugs = yield* fs.listPostSlugs();
        return slugs.map((slug) => ({ slug }));
      }),
    load: ({ params }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        return yield* fs.readPost(params.slug);
      }),
    render: (post) => PostPage({ post }),
  }),
);

export const router = Router.empty.pipe(
  Router.concat(HomeRoute),
  Router.concat(PostRoute),
  Router.fallback(() => NotFoundPage()),
);
```

### SSG Build Entry

```ts
// entry.ts — consumed by @stax-ui/vite-plugin in ssg mode
import { Layer } from "effect";

import { App } from "./App.js";
import { router } from "./routes.js";
import { FileSystemLive } from "./services/FileSystem.js";

export { router };
export const app = App;
export const document = {
  title: "My Site",
  scripts: ["/src/client.ts"],
};
export const layers = FileSystemLive; // services needed by load() functions
```

### Vite Config

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { staxPlatform } from "@stax-ui/vite-plugin";

export default defineConfig({
  plugins: [staxPlatform({ mode: "ssg", entry: "src/entry.ts" })],
});
```

### Build

```bash
pnpm build
```

The plugin runs `vite build` (client bundle) followed by `vite build --ssr src/entry.ts` (build-time SSR module), then invokes `Platform.buildStaticSite` to render every `Route.static` route to HTML in `dist/`.

### Output Structure

```
dist/
├── index.html                # Home route
├── posts/
│   ├── hello-world/
│   │   └── index.html
│   └── another-post/
│       └── index.html
├── 404.html                  # From router.fallback
└── assets/
    └── client-[hash].js      # Client bundle for hydration
```

### Hydration

Same client entry as SSR. The static HTML embeds loader data in a `<script type="application/json" id="__stax_data">` block, which the client picks up via `Platform.makeClientLayer`:

```ts
// client.ts
import { hydrate } from "@stax-ui/dom/hydrate";
import { Platform } from "@stax-ui/platform";

import { App } from "./App.js";
import { router } from "./routes.js";

hydrate(App(), document.getElementById("root")!, {
  layers: Platform.makeClientLayer(router),
});
```

After hydration, the site behaves identically to an SSR-rendered page — Signal subscriptions are wired, event handlers attached, animations run.

## Server API

### `Platform.toHttpRoutes(router, options?)`

Converts an Stax Router into an `@effect/platform` HttpRouter. For each route:

- **GET** — Runs the loader, SSR renders the component, returns full HTML document. If `?_data=1` is present, returns loader data as JSON (used for client-side navigation).
- **POST / PUT / DELETE** — Dispatches to the handler matching `?_action=key`, executes it with the parsed request body, returns JSON. No component rendering.

```ts
const staxRoutes = Platform.toHttpRoutes(router, {
  app: App,                        // Root component (should contain Outlet)
  document: {
    title: "My App",
    scripts: ["/client.js"],       // <script type="module"> tags
    styles: ["/styles.css"],       // <link rel="stylesheet"> tags
    head: '<meta name="..." ...>', // Additional head HTML
  },
});
```

The returned HttpRouter composes with any `@effect/platform` router via `HttpRouter.concat`.

### `RedirectError`

Throw from loaders or mutation handlers to trigger a redirect:

```ts
import { RedirectError } from "@stax-ui/platform";

Route.make("/users/me").pipe(
  Route.get(
    () => Effect.fail(new RedirectError({ url: "/users/alice", status: 302 })),
    () => $.div(), // never reached
  ),
);
```

- On full page loads: returns an HTTP 3xx redirect
- On data requests (`?_data=1`): returns `{ _redirect: url }` so the client navigates without a full reload

### `generateDocument(html, loaderData, options?)`

Wraps rendered HTML in a full HTML5 document with hydration data:

```ts
const doc = generateDocument("<div>Hello</div>", { data: { name: "World" } }, {
  title: "My Page",
  scripts: ["/client.js"],
});
```

Produces:
```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>My Page</title>
  </head>
  <body>
    <div id="root"><div>Hello</div></div>
    <script type="application/json" id="__stax_data">{...}</script>
    <script type="module" src="/client.js"></script>
  </body>
</html>
```

### `serializeForHtml(data)`

Safely serializes JSON for embedding in HTML `<script>` tags. Escapes `<`, `>`, and `&` to prevent XSS.

### `generateLoaderDataScript(loaderData)`

Generates a `<script type="application/json" id="__stax_data">` data block holding the loader data as JSON. Returns empty string if no data. The block is CSP-friendly out of the box — browsers don't execute non-JS script types, so `script-src 'self'` governs no nonce/hash obligations on it.

## Client API

### `Platform.makeClientLayer(router)`

Creates an Effect Layer providing `NavigationContext` and `RouteDataProvider` for the client.

- **First render (hydration):** Reads data from the embedded `<script type="application/json" id="__stax_data">` block
- **Subsequent navigations:** Fetches data from the server via `?_data=1`

```ts
import { hydrate } from "@stax-ui/dom/hydrate";
import { Platform } from "@stax-ui/platform";

hydrate(App() as unknown as Element.Element<HTMLElement>, root, {
  layers: Platform.makeClientLayer(router),
});
```

## Data Flow

### Initial Page Load

```
GET /users/123
  -> Route matching
  -> Run loader: getUser("123")
  -> Build RouteDataService: { data, loaderPath, actions }
  -> SSR render component tree
  -> Embed data in <script type="application/json" id="__stax_data">
  -> Return full HTML document
```

### Client Hydration

```
Browser loads HTML
  -> hydrate() attaches to existing DOM
  -> makeClientLayer reads the embedded __stax_data JSON block
  -> Component tree hydrates with server data
```

### Client-Side Navigation

```
User clicks Link
  -> Outlet detects route change
  -> RouteDataProvider fetches /users/456?_data=1
  -> Server runs loader, returns JSON
  -> Component re-renders with new data
```

### Mutation

```
Form submit -> POST /users/123?_action=update
  -> Server finds handler with key "update"
  -> Parses body (JSON or URL-encoded)
  -> Executes handler, returns JSON result
  -> Client receives result
  -> AsyncCache invalidation triggers UI update
```

## Composing with Effect HttpApi

Since `toHttpRoutes` returns a standard `@effect/platform` HttpRouter, it composes naturally with API endpoints:

```ts
const apiRoutes = HttpRouter.empty.pipe(
  HttpRouter.get("/api/users", usersHandler),
  HttpRouter.post("/api/users", createUserHandler),
);

const app = HttpRouter.empty.pipe(
  HttpRouter.concat(apiRoutes),           // API routes first
  HttpRouter.concat(staxRoutes),          // Stax pages catch the rest
);
```

## Vite Plugin

The `@stax-ui/vite-plugin` package provides dev server integration and client build optimization:

```ts
// vite.config.ts
import { staxPlatform } from "@stax-ui/vite-plugin";

export default defineConfig({
  plugins: [
    staxPlatform({ entry: "src/vite-entry.ts" }),
  ],
});
```

**Dev mode:** Intercepts requests to the Vite dev server and delegates to your SSR or SSG entry, with HMR support.

**Client builds:** Strips server-only code from the client bundle — loader function bodies are removed from `Route.get()` calls, mutation handlers in `Route.post/put/delete()` are replaced with stubs, and `Route.static({...})` config (build-time `paths`/`load`) is reduced to its render function.

**SSG mode:** After the SSR build completes, the plugin invokes `Platform.buildStaticSite` to enumerate `Route.static` routes, run their loaders, render to HTML, and write the output to `dist/`.

## API Reference

### Platform Namespace

| Function | Description |
|---|---|
| `Platform.toHttpRoutes(router, options?)` | Convert Stax Router to `@effect/platform` HttpRouter (SSR) |
| `Platform.buildStaticSite(options)` | Pre-render all `Route.static` routes to static HTML files (SSG) |
| `Platform.makeClientLayer(router)` | Create client-side Layer for hydration and navigation |
| `Platform.generateDocument(html, data, options?)` | Wrap HTML in full document with hydration data |
| `Platform.generateLoaderDataScript(data)` | Generate `<script>` tag for hydration data |
| `Platform.serializeForHtml(data)` | Safely serialize JSON for HTML embedding |

### Named Exports

| Export | Description |
|---|---|
| `RedirectError` | Tagged error class for server-side redirects |
| `toHttpRoutes` | Same as `Platform.toHttpRoutes` |
| `buildStaticSite` | Same as `Platform.buildStaticSite` |
| `makeClientLayer` | Same as `Platform.makeClientLayer` |
| `generateDocument` | Same as `Platform.generateDocument` |
| `generateLoaderDataScript` | Same as `Platform.generateLoaderDataScript` |
| `serializeForHtml` | Same as `Platform.serializeForHtml` |

### DocumentOptions

```ts
interface DocumentOptions {
  title?: string;              // Page <title>
  scripts?: readonly string[]; // Module script URLs
  styles?: readonly string[];  // Stylesheet URLs
  head?: string;               // Additional head HTML
}
```

### ToHttpRoutesOptions

```ts
interface ToHttpRoutesOptions {
  document?: DocumentOptions;
  app?: () => Element.Element<HTMLElement | SVGElement>;  // Root app component
}
```

### BuildStaticSiteOptions

```ts
interface BuildStaticSiteOptions {
  router: Router<any, any, any, any, any>; // router with Route.static entries
  app?: () => Element.Element<HTMLElement | SVGElement>;  // Optional root app
  document?: DocumentOptions;
  outDir: string;                          // Output directory (e.g. "dist")
  layers?: Layer.Layer<any, never, never>; // Services for loaders/render
}
```
