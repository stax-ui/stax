---
title: "Quick Start"
description: "Set up a new Stax project as an SPA, SSR app, or static site in under a minute."
order: 1
---

# Quick Start

The fastest way to start an Stax project is with `create-stax-ui`. It scaffolds a working app with routing, reactive state, and all the tooling configured.

```bash
pnpm create stax-ui my-app
```

You can also use npm, yarn, or bun:

```bash
npx create-stax-ui my-app
yarn create stax-ui my-app
bunx create-stax-ui my-app
```

The CLI will ask you to pick a template:

- **SPA** — Client-side only, no server required
- **SSR** — Server-side rendering with client hydration
- **SSG** — Static site generation, pre-rendered at build time

Once it's done, start the dev server:

```bash
cd my-app
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) and you're running.

The rest of this guide walks through what each template gives you and when to pick one over another.

---

## SPA (Single Page Application)

```bash
pnpm create stax-ui my-app --spa
```

The simplest setup. Everything runs in the browser — no server, no build-time rendering. Good for dashboards, internal tools, or anything that doesn't need SEO.

### What you get

```
my-app/
├── src/
│   ├── main.ts        # Mounts the app
│   ├── App.ts         # Root component with nav + Outlet
│   └── routes.ts      # Route definitions
├── public/
│   └── styles.css     # Base styles
├── index.html
├── vite.config.ts
└── tsconfig.json
```

### Entry point

`src/main.ts` mounts the app and provides the router's Navigation layer:

```typescript
import { mount } from "@stax-ui/dom";
import { Navigation } from "@stax-ui/router";

import { App } from "./App.js";
import { router } from "./routes.js";

const root = document.getElementById("root")!;

mount(App(), root, { layers: Navigation.layer(router) });
```

### Defining routes

Routes are plain functions that return Effects:

```typescript
import { Route, Router } from "@stax-ui/router";
import { $, Signal } from "@stax-ui/dom";

const Home = Route.make("/").pipe(
  Route.render(() =>
    Effect.gen(function* () {
      const count = yield* Signal.make(0);
      return yield* $.div(
        {},
        $.h1({}, "Welcome to Stax"),
        $.button(
          { onClick: () => count.update((n) => n + 1) },
          count,
        ),
      );
    }),
  ),
);

export const router = Router.empty.pipe(
  Router.concat(Home),
);
```

### Scripts

| Command | What it does |
|---------|-------------|
| `pnpm dev` | Start Vite dev server |
| `pnpm build` | Production build |
| `pnpm preview` | Preview the production build |

---

## SSR (Server-Side Rendering)

```bash
pnpm create stax-ui my-app --ssr
```

Full-stack rendering. The server renders HTML on each request using Effect's HTTP platform, then the client hydrates it. Use this when you need SEO, fast initial page loads, or server-side data loading.

### What you get

```
my-app/
├── src/
│   ├── app.ts           # Root component
│   ├── routes.ts        # Route definitions
│   ├── server.ts        # Production Node.js server
│   ├── client.ts        # Client hydration entry
│   └── vite-entry.ts    # Dev server SSR entry
├── public/
│   └── styles.css
├── vite.config.ts
└── tsconfig.json
```

### Server entry

`src/server.ts` is a Node.js server built on `@effect/platform`. It serves static assets and delegates everything else to Stax's SSR:

```typescript
import { Effect } from "effect";
import { HttpRouter, HttpServer } from "@effect/platform";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
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

// Compose with other routes if needed
const httpApp = HttpRouter.empty.pipe(
  HttpRouter.concat(staxRoutes),
);
```

### Client hydration

`src/client.ts` hydrates the server-rendered HTML:

```typescript
import { hydrate } from "@stax-ui/dom";
import { Platform } from "@stax-ui/platform";

import { App } from "./app.js";
import { router } from "./routes.js";

hydrate(App(), document.getElementById("root")!, {
  layers: Platform.makeClientLayer(router),
});
```

After hydration, navigation is client-side. Data for new pages is fetched as JSON (via `?_data=1` requests) without full page reloads.

### Vite plugin

The SSR template uses `@stax-ui/vite-plugin` to handle dev-time SSR:

```typescript
import { defineConfig } from "vite";
import { staxPlatform } from "@stax-ui/vite-plugin";

export default defineConfig({
  plugins: [
    staxPlatform({ entry: "src/vite-entry.ts" }),
  ],
});
```

### Scripts

| Command | What it does |
|---------|-------------|
| `pnpm dev` | Vite dev server with SSR |
| `pnpm build` | Build client and server bundles |
| `pnpm start` | Run the production server |

---

## SSG (Static Site Generation)

```bash
pnpm create stax-ui my-app --ssg
```

Pages are pre-rendered to HTML at build time. No server at runtime — just static files you can deploy anywhere. Use this for docs sites, blogs, marketing pages, or anything where the content is known ahead of time.

### What you get

```
my-app/
├── src/
│   ├── App.ts         # Root component
│   ├── routes.ts      # Route definitions with static paths
│   ├── entry.ts       # Build-time entry point
│   └── client.ts      # Client hydration entry
├── public/
│   └── styles.css
├── vite.config.ts
└── tsconfig.json
```

### Static routes

SSG routes use `Route.static()` to declare which paths to generate and how to load data for each:

```typescript
import { Effect } from "effect";
import { Route, Router } from "@stax-ui/router";
import { $ } from "@stax-ui/dom";

const DocsRoute = Route.make("/docs/:slug").pipe(
  Route.static({
    // Which paths to generate
    paths: () =>
      Effect.succeed([
        { slug: "getting-started" },
        { slug: "routing" },
      ]),

    // Load data for each path (runs at build time)
    load: ({ params }) =>
      Effect.succeed({
        title: params.slug,
        content: `Content for ${params.slug}`,
      }),

    // Render with loaded data
    render: (data) =>
      $.article(
        {},
        data.content,
      ),
  }),
);
```

### Build-time entry

`src/entry.ts` exports everything the SSG builder needs:

```typescript
import { App } from "./App.js";
import { router } from "./routes.js";

export { router, App };

export const document = {
  title: "My Site",
  scripts: ["/client.js"],
  styles: ["/styles.css"],
};
```

### Client hydration

Like SSR, the client hydrates after the static HTML loads. SSG still needs `Platform.makeClientLayer` — it provides `NavigationContext` (for `Outlet`/`Link`) and reads the SSG-embedded `<script type="application/json" id="__stax_data">` block on first load. On subsequent client-side navigations it fetches the matching HTML shell and pulls the embedded data out (the Vite plugin strips loaders from the client bundle, so this is how loader data reaches routes after hydration):

```typescript
import { hydrate } from "@stax-ui/dom/hydrate";
import { Platform } from "@stax-ui/platform";
import { App } from "./App.js";
import { router } from "./routes.js";

hydrate(App(), document.getElementById("root")!, {
  layers: Platform.makeClientLayer(router),
});
```

### Scripts

| Command | What it does |
|---------|-------------|
| `pnpm dev` | Vite dev server with SSR rendering |
| `pnpm build` | Generate static HTML + client bundle |
| `pnpm preview` | Preview the static site |

---

## Which template should I use?

| | SPA | SSR | SSG |
|---|---|---|---|
| **SEO** | No | Yes | Yes |
| **Initial load speed** | Slower (JS must execute) | Fast (HTML from server) | Fastest (pre-built HTML) |
| **Dynamic data** | Client-side fetching | Server loaders | Build-time only |
| **Hosting** | Any static host | Node.js server | Any static host |
| **Best for** | Dashboards, internal tools | Apps with auth, real-time data | Docs, blogs, marketing |

You can always change later — the component model is the same across all three. The main difference is the entry point and how data gets loaded.
