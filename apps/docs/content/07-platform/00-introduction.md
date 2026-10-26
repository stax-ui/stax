---
title: "Platform Overview"
description: "How @stax-ui/platform integrates with @effect/platform instead of reinventing the wheel."
order: 0
---

# Platform Overview

## Not a Meta-Framework

Most frontend libraries ship their own server runtime. Next.js has its Node server. Nuxt has Nitro. SvelteKit has its adapter system. Each one reinvents routing, request handling, middleware, and deployment — on top of what the framework already provides.

Stax doesn't do this.

`@stax-ui/platform` is a thin integration layer between Stax's router and [Effect's HTTP platform](https://effect-ts.github.io/effect/platform/HttpRouter.ts.html). It doesn't have its own server, its own request pipeline, or its own deployment story. Instead, it gives you a function — `Platform.toHttpRoutes` — that converts your Stax Router into an `@effect/platform` HttpRouter. From there, you use Effect's existing HTTP infrastructure to serve requests however you want.

## Why This Matters

Effect already has a production-grade HTTP stack:

- **HttpRouter** for declarative route registration
- **HttpServerRequest / HttpServerResponse** for typed request/response handling
- **HttpServer** with adapters for Node, Bun, and more
- **Middleware**, **error handling**, and **observability** built in
- Full **Layer-based dependency injection**

Rebuilding any of this would be a waste. Instead, `toHttpRoutes` produces an HttpRouter that plugs into whatever Effect HTTP setup you already have:

```typescript
import { HttpRouter } from "@effect/platform";
import { Platform } from "@stax-ui/platform";

// Your Stax routes become Effect HTTP routes
const staxRoutes = Platform.toHttpRoutes(router, {
  app: App,
  document: { title: "My App", scripts: ["/client.js"] },
});

// Compose with your own API routes, middleware, etc.
const httpApp = HttpRouter.empty.pipe(
  HttpRouter.concat(apiRoutes),
  HttpRouter.concat(staxRoutes),
);
```

This means you can:

- **Add API routes** alongside your Stax pages using the same HttpRouter
- **Use Effect middleware** for auth, logging, rate limiting — things that already exist in the ecosystem
- **Deploy anywhere** Effect's HTTP platform runs — Node, Bun, Cloudflare Workers, or any custom adapter
- **Share services** between your API and your page loaders via Effect's Layer system

## What @stax-ui/platform Actually Does

The package provides three utilities:

### `Platform.toHttpRoutes(router, options)`

Converts your Stax Router into an HttpRouter. For each route:

- **GET** → runs the loader, SSR renders the page (or returns JSON for `?_data=1` client navigations)
- **POST/PUT/DELETE** → dispatches to mutation handlers by `?_action=key`

### `Platform.makeClientLayer(router)`

Creates a client-side Layer for hydration. On first load, reads embedded data from the server. On subsequent navigations, fetches data via `?_data=1`.

### `Platform.buildStaticSite(options)`

Pre-renders all `Route.static` routes to HTML files at build time. Used by the Vite plugin for SSG.

## The Vite Plugin

`@stax-ui/vite-plugin` handles the dev-time and build-time integration:

- **Dev mode** — SSR dev server with HMR
- **Client builds** — strips server-only code (loaders, handlers) from the browser bundle
- **SSG builds** — runs `buildStaticSite` after the SSR build

The plugin is the only piece with opinions about tooling. Everything else is just Effect.

## When You Don't Need Platform

If you're building a pure SPA — no server rendering, no server-side data loading — you don't need `@stax-ui/platform` at all. Use `Navigation.makeLayer(router)` directly and run loaders client-side:

```typescript
import { mount } from "@stax-ui/dom";
import { Navigation } from "@stax-ui/router";

mount(App(), document.getElementById("root")!, {
  layers: Navigation.makeLayer(router),
});
```

Platform is for when you want the server involved — SSR, SSG, or server-side data loading.
