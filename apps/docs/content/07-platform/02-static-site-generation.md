---
title: "Static Site Generation"
description: "Pre-render pages at build time with Route.static and Platform.buildStaticSite."
order: 2
---

# Static Site Generation

SSG pre-renders pages to HTML at build time. No server at runtime — just static files you can deploy anywhere. Use it for docs sites, blogs, marketing pages, or anything where the content is known ahead of time.

## Defining Static Routes

Use `Route.static` to declare which paths to generate and how to load data for each:

```typescript
import { Effect } from "effect";
import { Schema } from "effect";
import { Route } from "@stax-ui/router";

const BlogRoute = Route.make("/blog/:slug").pipe(
  Route.params(Schema.Struct({ slug: Schema.String })),
  Route.static({
    // Enumerate all pages to generate
    paths: () =>
      Effect.succeed([
        { slug: "hello-world" },
        { slug: "getting-started" },
        { slug: "advanced-patterns" },
      ]),

    // Load data for each page (runs at build time)
    load: ({ params }) =>
      Effect.gen(function* () {
        const content = yield* readMarkdown(`blog/${params.slug}.md`);
        return { title: content.title, html: content.html };
      }),

    // Render with loaded data
    render: (data) => BlogPost(data),
  }),
);
```

`paths` returns an array of param objects — one per page to generate. `load` fetches data for each page. `render` produces the component. All three run at build time.

On the client, the Vite plugin strips `paths` and `load` from the bundle — only `render` ships to the browser.

## Building the Site

`Platform.buildStaticSite` runs the SSG build programmatically:

```typescript
import { Platform } from "@stax-ui/platform";

await Platform.buildStaticSite({
  router,
  app: App,
  document: {
    title: "My Blog",
    scripts: ["/assets/client.js"],
    styles: ["/assets/styles.css"],
  },
  outDir: "dist",
});
```

This:
1. Finds all routes with `Route.static` config
2. Calls `paths()` to enumerate param sets
3. Calls `load()` for each set to fetch data
4. Renders each page to HTML through the `app` component (or just the route if `app` is omitted)
5. Writes the HTML files to `outDir`

### Output Structure

Each page becomes an `index.html` at its URL path:

```
dist/
├── index.html              ← /
├── blog/
│   ├── hello-world/
│   │   └── index.html      ← /blog/hello-world
│   ├── getting-started/
│   │   └── index.html      ← /blog/getting-started
│   └── advanced-patterns/
│       └── index.html       ← /blog/advanced-patterns
└── 404.html                 ← from Router.fallback
```

If your router has a `Router.fallback`, a `404.html` is generated automatically.

### Providing Services

If your loaders depend on Effect services (filesystem, markdown parser, database, etc.), pass them via `layers`:

```typescript
import { Layer } from "effect";

await Platform.buildStaticSite({
  router,
  outDir: "dist",
  layers: Layer.mergeAll(
    FileSystemLive,
    MarkdownServiceLive,
  ),
});
```

## Vite Integration

In practice, you don't call `buildStaticSite` directly. The Vite plugin handles it as part of the build.

### Entry Point

Create an SSG entry that exports the router, app component, and document options:

```typescript
// src/entry.ts
import { App } from "./app.js";
import { router } from "./routes.js";

export { router };
export const app = App;
export const document = {
  title: "My Blog",
  scripts: ["/assets/client.js"],
  styles: ["/assets/styles.css"],
};
```

### Vite Config

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import { staxPlatform } from "@stax-ui/vite-plugin";

export default defineConfig({
  plugins: [
    staxPlatform({ mode: "ssg", entry: "src/entry.ts" }),
  ],
});
```

### Build Command

```bash
vite build && vite build --ssr src/entry.ts
```

The first command builds the client bundle. The second builds the SSR entry, and the Vite plugin's `closeBundle` hook runs `buildStaticSite` automatically using the compiled entry.

## Client Hydration

Static pages are hydrated on the client just like SSR pages. Pass the client layer via `options.layers` so `hydrate` builds it in its long-lived scope — baking it in via `Effect.provide(App(), layer)` would tear the layer down as soon as the element function returns, killing the popstate listener and reactive subscriptions:

```typescript
// src/client.ts
import { hydrate } from "@stax-ui/dom/hydrate";
import { Platform } from "@stax-ui/platform";

import { App } from "./app.js";
import { router } from "./routes.js";

hydrate(App(), document.getElementById("root")!, {
  layers: Platform.makeClientLayer(router),
});
```

`Platform.makeClientLayer` provides both `NavigationContext` and `RouteDataProvider` — the latter reads the SSG-embedded `<script type="application/json" id="__stax_data">` block on first load, then fetches `<path>?_data=1` for subsequent navigations (the Vite plugin strips loaders from the client bundle, so this fetch is how loader data reaches the client after hydration).

After hydration, clicking a Link triggers client-side navigation — the browser doesn't reload the page.
