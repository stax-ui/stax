<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./stax-logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./stax-logo-light.svg">
  <img src="./stax-logo-dark.svg" alt="Stax" width="200">
</picture>

A reactive UI framework built on [Effect](https://effect.website/). Stax provides a declarative way to build web interfaces with fine-grained reactivity, automatic cleanup, and full type safety.

## Why Stax?

Stax brings the power of [Effect](https://effect.website/) to frontend development. If you're building with Effect, this is a UI framework that speaks the same language.

### Typed Error Handling

Every element has type `Element<E, R>` where `E` is the error channel. Errors propagate through the component tree, and you **must** handle them before mounting:

```ts
// This won't compile — UserProfile might fail with ApiError
mount(UserProfile(), document.body); // Type error!

// Handle the error first
mount(
  Boundary.error(
    () => UserProfile(),
    (error) => $.div(`Failed to load: ${error.message}`),
  ),
  document.body,
); // Compiles
```

TypeScript tells you at build time which components can fail and forces you to handle it.

### Fine-Grained Reactivity

Stax uses signals for reactive state. When a signal updates, only the DOM nodes that depend on it update. No virtual DOM, no diffing, no wasted work:

```ts
const Counter = () =>
  Effect.gen(function* () {
    const count = yield* Signal.make(0);
    console.log("setup"); // Logs once, on mount
    return yield* $.div(count); // count changes update only this text node
  });
```

### Automatic Resource Cleanup

Stax uses Effect's scope system. Subscriptions, timers, and other resources are automatically cleaned up when components unmount:

```ts
yield* eventSource.pipe(
  Stream.runForEach(handler),
  Effect.forkIn(scope), // Cleaned up when scope closes
);
```

### The Effect Ecosystem

Stax gives you access to Effect's entire ecosystem:

- **Schema** — Runtime validation with static types
- **Streams** — Reactive data flows
- **Services** — Dependency injection via Effect's context system
- **Retry/timeout** — Built-in resilience patterns
- **Structured concurrency** — Fork, join, and race without footguns

## Rendering Modes

Stax supports three rendering modes. Pick based on what your app needs at runtime:

| Mode | When to use | Output | Hosting |
|------|-------------|--------|---------|
| **SPA** | App needs no server logic; all data fetched client-side. Internal tools, dashboards. | Client bundle + `index.html` | Any static host |
| **SSR** | Per-request server logic (auth, dynamic data, mutations). Web apps with database access. | Long-running Node HTTP server + client bundle | Fly.io, Railway, VPS, Cloud Run |
| **SSG** | Content is known at build time. Portfolios, marketing sites, docs, blogs. | Pre-rendered HTML pages + client bundle for hydration | Any static host (Cloudflare Pages, Netlify, GitHub Pages) |

All three produce interactive, hydrated pages — SSG output behaves identically to SSR output once the client bundle loads. The difference is purely *where rendering happens* (build time vs. request time vs. browser).

## Quick Start

```bash
# Create a new project — prompts you to pick SPA, SSR, or SSG
pnpm create stax-ui my-app
cd my-app
pnpm install
pnpm dev
```

Skip the prompt with a template flag:

```bash
pnpm create stax-ui my-app --spa   # SPA
pnpm create stax-ui my-app --ssr   # SSR
pnpm create stax-ui my-app --ssg   # SSG
```

Or install packages individually:

```bash
# SPA (client-side only)
pnpm add @stax-ui/dom @stax-ui/router effect

# Full-stack SSR / SSG
pnpm add @stax-ui/dom @stax-ui/router @stax-ui/platform @effect/platform effect
```

> `@stax-ui/dom` re-exports everything from `@stax-ui/core`, so you don't need to install core separately.

### Hello World

```ts
import { Effect } from "effect";
import { $, Signal, mount } from "@stax-ui/dom";

const Counter = () =>
  Effect.gen(function* () {
    const count = yield* Signal.make(0);

    return yield* $.div(
      $.button({ onClick: () => count.update((n) => n - 1) }, "-"),
      $.span(count),
      $.button({ onClick: () => count.update((n) => n + 1) }, "+"),
    );
  });

mount(Counter(), document.getElementById("root")!);
```

## Reactive Primitives

Stax's reactivity layer lives in `@stax-ui/core` (re-exported by `@stax-ui/dom`):

```ts
import { Effect } from "effect";
import { Signal, Readable, Ref } from "@stax-ui/dom";

// Mutable reactive state
const count = yield* Signal.make(0);
yield* count.set(5);
yield* count.update((n) => n + 1);

// Derived values (read-only, auto-tracked)
const doubled = Readable.map(count, (n) => n * 2);
const label = Readable.map(count, (n) => `Count: ${n}`);

// Reactive collections
const todos = yield* Signal.Array.make([{ text: "Learn Stax", done: false }]);
yield* todos.push({ text: "Build something", done: false });

const users = yield* Signal.Map.make(new Map([["alice", { name: "Alice" }]]));
yield* users.set("bob", { name: "Bob" });

// Reactive structs (each field is independently reactive)
const form = yield* Signal.Struct.make({ name: "", email: "" });
yield* form.name.set("Alice"); // Only updates subscribers of `name`

// Lightweight mutable refs (not reactive, no subscriptions)
const cache = yield* Ref.make(new Map());
```

## DOM & Control Flow

The `@stax-ui/dom` package provides element constructors and reactive control flow:

```ts
import { $, each, when, matchOption, Readable } from "@stax-ui/dom";

// Elements accept reactive attributes
$.input({
  class: Readable.map(hasError, (err) => err ? "input error" : "input"),
  value: name,
  onInput: (e) => name.set((e.target as HTMLInputElement).value),
});

// Conditional rendering
when(isLoggedIn, {
  onTrue: () => Dashboard(),
  onFalse: () => LoginPage(),
});

// List rendering with keyed reconciliation
each(todos, {
  key: (todo) => todo.id,
  render: (todo) => TodoItem({ todo }),
});

// Option matching
matchOption(maybeUser, {
  onSome: (user) => UserCard({ user }),
  onNone: () => $.span("No user"),
});
```

## Routing

`@stax-ui/router` provides type-safe routing with the builder pattern:

```ts
import { Route, Router, Outlet, Link } from "@stax-ui/router";
import { Schema } from "effect";

// Define routes
const HomeRoute = Route.make("/").pipe(
  Route.render(() => HomePage()),
);

const UserRoute = Route.make("/users/:id").pipe(
  Route.params(Schema.Struct({ id: Schema.String })),
  Route.render((data) => UserPage(data)),
);

// Compose into a router
const router = Router.empty.pipe(
  Router.concat(HomeRoute),
  Router.concat(UserRoute),
  Router.fallback(() => NotFoundPage()),
);

// Render the matched route
$.main(Outlet({ router }));

// Navigate with type-safe links
Link({ href: "/users/alice" }, "Alice's Profile");
```

### Loaders & Mutation Handlers

Routes can define server-side data loading and mutations when used with `@stax-ui/platform`:

```ts
import { Route } from "@stax-ui/router";
import { RedirectError } from "@stax-ui/platform";

const PostRoute = Route.make("/posts/:id").pipe(
  Route.params(Schema.Struct({ id: Schema.String })),

  // Loader: runs server-side with platform, client-side in SPA mode
  Route.get(
    ({ params }) =>
      Effect.gen(function* () {
        const svc = yield* PostService;
        return yield* svc.getPost(params.id);
      }),
    (post) => PostPage({ post }),
  ),

  // Mutation handlers: server-side only (via platform)
  Route.post("update", (body) =>
    Effect.gen(function* () {
      const svc = yield* PostService;
      return yield* svc.updatePost(body);
    }),
  ),
);
```

Route components access loader data and action endpoints via `RouteDataContext`:

```ts
const { data, loaderPath, actions } = yield* RouteDataContext;
```

## Forms

`@stax-ui/form` provides schema-validated forms with reactive field state:

```ts
import { Field, Form } from "@stax-ui/form";
import { Schema } from "effect";

// Define the form at module level
const LoginForm = Form.make({
  email: Field.make(Schema.String.pipe(Schema.nonEmptyString()), { validateOn: "blur" }),
  password: Field.make(Schema.String.pipe(Schema.minLength(8)), { validateOn: "blur" }),
});

// Use in a component
LoginForm.provide(
  {
    defaults: { email: "", password: "" },
    onSubmit: (ctx) => Effect.tryPromise(() => login(ctx.decoded)),
  },
  $.form(
    { class: "login" },
    Effect.gen(function* () {
      const email = yield* LoginForm.fields.email;
      return yield* $.input({
        value: email.value,
        onInput: (e) => email.set((e.target as HTMLInputElement).value),
        onBlur: () => email.blur(),
      });
    }),
    // ... more fields
  ),
);
```

Supports leaf fields, nested structs, arrays, and maps — all with Effect Schema validation.

## Server-Side Rendering (SSR)

`@stax-ui/platform` bridges Stax with `@effect/platform`'s HTTP server for server-side rendering:

```ts
// server.ts
import { Platform } from "@stax-ui/platform";

const staxRoutes = Platform.toHttpRoutes(router, {
  app: App,
  document: { title: "My App", scripts: ["/client.js"] },
});

// Compose with any @effect/platform HttpRouter
const httpApp = HttpRouter.empty.pipe(
  HttpRouter.get("/api/health", HttpServerResponse.json({ ok: true })),
  HttpRouter.concat(staxRoutes),
);
```

```ts
// client.ts
import { hydrate } from "@stax-ui/dom/hydrate";
import { Platform } from "@stax-ui/platform";

hydrate(App(), document.getElementById("root")!, {
  layers: Platform.makeClientLayer(router),
});
```

Key features:
- **SSR + Hydration** — Server renders HTML, client picks up seamlessly
- **Loaders** — Fetch data server-side, serialized to client for hydration
- **Mutation handlers** — `Route.post/put/delete` execute server-side, return JSON
- **Data requests** — Client navigations fetch data via `?_data=1` without full page loads
- **Redirects** — Throw `RedirectError` from loaders for server-side redirects
- **HttpApi composition** — Mount Effect's HttpApi alongside Stax pages on a single server

## Static Site Generation (SSG)

The same `@stax-ui/platform` package also supports building fully static sites. Routes opt in via `Route.static`, which declares the paths to generate and a build-time loader:

```ts
// routes.ts
import { Route, Router } from "@stax-ui/router";

const PostRoute = Route.make("/posts/:slug").pipe(
  Route.params(Schema.Struct({ slug: Schema.String })),
  Route.static({
    paths: () => Effect.succeed([{ slug: "hello" }, { slug: "world" }]),
    load: ({ params }) => loadPostFromDisk(params.slug),
    render: (post) => PostPage({ post }),
  }),
);
```

Build to a `dist/` directory of static HTML at build time:

```ts
// vite.config.ts
import { staxPlatform } from "@stax-ui/vite-plugin";

export default defineConfig({
  plugins: [staxPlatform({ mode: "ssg", entry: "src/entry.ts" })],
});
```

Output is fully hydratable — the generated HTML embeds loader data via `window.__STAX_DATA__`, and the client bundle picks up where the server left off. Animations, interactive components, signal-driven UI all work post-hydration. Deploy to any static host (Cloudflare Pages, Netlify, GitHub Pages, S3 + CloudFront).

See [`@stax-ui/platform`](./packages/platform) for the full `buildStaticSite` API.

## Packages

| Package | Description |
|---------|-------------|
| [`@stax-ui/core`](./packages/core) | Reactive primitives: Signal, Readable, Ref, Signal.Array/Map/Struct, AsyncCache |
| [`@stax-ui/dom`](./packages/dom) | DOM rendering, elements, control flow, animation, mount/hydrate |
| [`@stax-ui/router`](./packages/router) | Type-safe routing with loaders, mutation handlers, and Outlet |
| [`@stax-ui/form`](./packages/form) | Schema-validated forms with reactive field state |
| [`@stax-ui/platform`](./packages/platform) | Server-side rendering, hydration, and data loading |
| [`@stax-ui/vite-plugin`](./packages/vite-plugin) | Vite plugin: SSR dev server + server-code stripping |
| [`create-stax-ui`](./packages/create-stax-ui) | CLI to scaffold new projects (SPA, SSR, or SSG) |

**Import conventions:**
- `@stax-ui/dom` re-exports everything from `@stax-ui/core` — no need to install core separately
- `@stax-ui/platform` does **not** re-export dom or router — import them directly

## Examples

| Example | Description |
|---------|-------------|
| [`twitter`](./examples/twitter) | Full-stack SSR app with loaders, mutations, and caching |
| [`kanban`](./examples/kanban) | Kanban board with drag-and-drop and forms |
| [`todo-app`](./examples/todo-app) | Classic todo app |
| [`router-demo`](./examples/router-demo) | Router features showcase |

## Why No JSX?

Stax uses function calls instead of JSX:

```ts
// Stax
$.div(
  { class: "container" },
  $.h1("Hello"),
  $.p(count),
)
```

**Why:**

1. **Error type preservation** — Elements have type `Element<E, R>`. JSX would erase this to `JSX.Element`, losing type-safe error propagation.
2. **No build configuration** — Works with any TypeScript setup. No JSX runtime, tsconfig tweaks, or bundler plugins.
3. **Explicit Effects** — Every element is an Effect that must be yielded. JSX would obscure this.
4. **Consistent syntax** — Components and elements use the same call pattern.

## Coming from Another Framework?

Migration guides with concept mapping and side-by-side examples:

- [Coming from React](./REACT-MIGRATION.md)
- [Coming from Vue](./VUE-MIGRATION.md)
- [Coming from Svelte](./SVELTE-MIGRATION.md)

## Acknowledgments

- **[Effect](https://effect.website/)** — The foundation. Effect's typed errors, resource management, and structured concurrency inspired this entire project.
- **[Solid](https://www.solidjs.com/)** — Fine-grained reactivity draws direct inspiration from Solid's reactive primitives.
- **[TanStack](https://tanstack.com/)** — The router API is inspired by TanStack Router.
- **[effect-form](https://github.com/lucas-barake/effect-form)** — The form package's schema-first, context-based architecture was inspired by this library.

## License

[Mozilla Public License 2.0](./LICENSE)

Stax is copyleft at the file level: modifications to Stax's own source files must be released under MPL 2.0, so the framework itself stays open forever. Code that *uses* Stax as a dependency can be licensed however you like — proprietary, commercial, or another open-source license. Build whatever you want on top; keep the framework itself open when you patch it.

Package versions published as `0.1.x` were released under MIT and remain MIT forever. Versions `0.2.0` onward ship under MPL 2.0.
