import { Effect } from "effect";

import { $, RendererContext } from "@stax-ui/dom";

import { CodeFile, CodeTabs } from "../components/CodeTabs.js";
import { ContentSection } from "../components/ContentSection.js";
import { Hero } from "../components/Hero.js";
import { Nav } from "../components/Nav.js";
import {
  StorageLive,
  StorageNoOp,
  TodoApp,
} from "../components/TodoApp/index.js";

// ─── Code examples ──────────────────────────────────────────────────────────

export const signalsExample = `// Signals are references, not snapshots.
// No stale closures, no dependency arrays.
const name = yield* Signal.make("world");

// Use a signal directly as element content —
// the text node updates when name changes.
const greeting = yield* $.h1({}, name);

// Derived values update automatically.
const upper = Readable.map(name, (n) => n.toUpperCase());
const shout = yield* $.p({}, upper);`;

export const errorsExample = `// This component can fail — the error type says so.
const UserProfile = 
  (id: string): Element<HTMLDivElement, HttpError, ApiClient> =>
    Effect.gen(function* () {
      const api = yield* ApiClient;
      const user = yield* api.getUser(id);
      return yield* $.div({}, user.name);
    });

// TypeScript won't let you mount this without
// handling HttpError and providing ApiClient.
// Errors are visible in the types, not hidden at runtime.`;

export const effectExample = `const handleUpdate = (delta: number) => () =>
  Effect.gen(function* () {
    const blocked = yield* isBlocked.get;

    if (!blocked) {
      yield* count.update((n) => n + delta);
      yield* isBlocked.set(true);

      // The update is blocked for 2 seconds, then unblocked.
      yield* Effect.sleep("2 seconds").pipe(
        Effect.andThen(() => isBlocked.set(false)),
        Effect.forkDaemon,
      );
    }
  });`;

export const reactiveExample = `import { $, Signal, Readable } from "@stax-ui/dom";

const name = yield* Signal.make("hello");

yield* name.update((n) => n + " world");

// The h1 updates its innerHTML when the signal changes.
yield* $.h1(name); // "hello world"

// Derived values react too, no extra plumbing.
const shout = Readable.map(name, (n) => n.toUpperCase());
yield* $.p( shout); // "HELLO WORLD"`;

export const familiarExample = `import { Effect } from "effect";
import { $, Signal } from "@stax-ui/dom";

// Components are just functions.
// Props are just arguments.
const Greeting = (props: { name: string }) =>
  Effect.gen(function* () {
    const count = yield* Signal.make(0);
    return yield* $.div(
      $.h1({}, \`Hello, \${props.name}!\`),
      $.button(
        { onClick: () => count.update((n) => n + 1) },
        count,
      ),
    );
  });`;

export const fullstackExample = `// Same component, three targets.

// SPA — client-side only
mount(App(), root);

// SSR — server renders, client hydrates
// server:
const routes = Platform.toHttpRoutes(router, opts);
// client:
hydrate(App(), root);

// SSG — pre-render at build time
Route.static({
  paths: () => discoverPages(),
  load: ({ params }) => loadPage(params.slug),
  render: (data) => DocPage(data),
});`;

// ─── Package card ───────────────────────────────────────────────────────────

const packageCard = (name: string, description: string, pkg: string) =>
  $.a(
    {
      href: `https://github.com/stax-ui/stax/tree/main/packages/${pkg}`,
      class:
        "card bg-code shadow-sm hover:bg-base-200 transition-colors rounded-lg",
      target: "_blank",
    },
    $.div(
      { class: "card-body p-5" },
      $.h3(
        { class: "font-mono text-sm text-secondary font-semibold pb-2" },
        name,
      ),
      $.p({ class: "text-base-content/70 text-sm" }, description),
    ),
  );

const ContentLink = (href: string, text: string) =>
  $.a(
    {
      href,
      class: [
        "text-caption text-base-content hover:text-accent font-normal",
        "transition-colors pl-2",
      ],
    },
    text,
  );

// ─── Page ───────────────────────────────────────────────────────────────────

export const HomePage = (props: {
  readonly codeExamples: {
    errorsHtml: string;
    fullstackHtml: string;
    effectHtml: string;
    reactiveHtml: string;
    familiarHtml: string;
    todoFiles: readonly CodeFile[];
  };
}) =>
  Effect.gen(function* () {
    const {
      errorsHtml,
      fullstackHtml,
      effectHtml,
      reactiveHtml,
      familiarHtml,
      todoFiles,
    } = props.codeExamples;

    // TodoApp's source is displayed on this page as a demo, so the
    // Storage wiring lives here (the component itself stays clean).
    // Pick is env-aware — StorageNoOp seeds empty on SSR (no window),
    // StorageLive reads/writes localStorage on client and hydration.
    const renderer = yield* RendererContext;
    const storageLayer =
      renderer.environment === "ssr" ? StorageNoOp : StorageLive;

    return yield* $.div(
      { class: "flex flex-col lg:flex-row" },
      $.div({ class: "lg:border-r" }, Nav()),
      $.main(
        { class: "flex-1 flex flex-col text-base-content" },
        Hero(),
        ContentSection(
          $.div(
            { class: "flex flex-col gap-8" },
            $.h2(
              { class: "text-heading tracking-tight" },
              $.span("Frontend"),
              $.br(),
              $.span({ class: "text-accent" }, "Correctness"),
            ),
            $.h3(
              { class: "text-heading-2 font-thin text-neutral/70 max-w-100" },
              $.span("Robust utilities for building "),
              $.span({ class: "text-accent" }, "serious "),
              $.span("web applications"),
            ),
            $.p(
              { class: "text-paragraph max-w-100 text-neutral/60" },
              "Probably not the quickest way to build a todo app, but the right way to build a production-ready app that solves real-world problems reliably.",
            ),
          ),
          $.div(
            { class: "space-y-4 text-paragraph" },
            $.p(
              "Stax gives you reactive state without the ceremony. Signals are mutable references that track their own subscribers — read one inside an element, and that element updates when the signal changes. No dependency arrays, no memoization hooks, no stale-closure bugs waiting to bite you three renders later.",
            ),
            $.p(
              $.span("Every component has the type "),
              $.code({ class: "prose" }, "Element<E, R>"),
              $.span(
                " — an error channel and a dependency channel. If a component can fail, TypeScript tells you before you ship. If it needs a service, the compiler asks for it. Runtime surprises become compile-time conversations.",
              ),
            ),
            $.p(
              "Write your components once. Run them as an SPA, server-render with hydration, or pre-render to static HTML. The same signals, the same router, the same component model — the entry point is the only thing that changes.",
            ),
          ),
        ),
        ContentSection(
          $.div(
            { class: "flex flex-col gap-6 flex-1" },
            $.h2(
              { class: "text-heading tracking-tight" },
              $.span("Stax in "),
              $.br(),
              $.span({ class: "text-accent" }, "Real Life"),
            ),
            $.p(
              { class: "text-paragraph max-w-200 text-neutral/60" },
              "A small todo app, split across three files. State hydrates through an Effect Context — the component doesn't know whether it's talking to localStorage or an in-memory default; the Layer decides.",
            ),
            $.div(
              { class: "flex-1 flex justify-end" },
              $.div(
                {
                  class: [
                    "w-full flex flex-col gap-6",
                    "items-center justify-center p-8 border rounded-lg",
                  ],
                },
                $.h3({ class: "text-heading-2 text-neutral" }, "Todo App"),
                TodoApp().pipe(Effect.provide(storageLayer)),
              ),
            ),
          ),
          $.div(
            { class: "flex-1 min-w-0" },
            CodeTabs({
              files: todoFiles,
              class: "max-h-[600px]",
            }),
          ),
        ),
        ContentSection(
          $.h2(
            { class: "text-heading tracking-tight" },
            $.span("What is "),
            $.span({ class: "text-accent" }, "Stax"),
            $.span("?"),
          ),
          $.ol(
            {
              class:
                "space-y-3 list-inside text-paragraph font-black text-neutral/30 list-[decimal-leading-zero] tracking-tight",
            },
            $.li(ContentLink("#environment", "Environment Agnostic")),
            $.li(ContentLink("#effect", "Effect Native")),
            $.li(ContentLink("#reactive", "Reactive State")),
            $.li(ContentLink("#familiar", "Familiar Style")),
            $.li(ContentLink("#confidence", "Confident Development")),
            $.li(ContentLink("#suite", "Package Suite")),
          ),
        ),
        ContentSection(
          $.div(
            { class: "flex-1 flex flex-col gap-6" },
            $.h2(
              { class: "text-heading tracking-tight" },
              $.span("Environment"),
              $.br(),
              $.span({ class: "text-accent" }, "Agnostic"),
            ),
            $.dl(
              { class: "text-base-content/70" },
              $.dd({ class: "font-bold" }, "Single Page Apps (SPA)"),
              $.dd(
                { class: "pb-8" },
                "Client-side rendering with Stax is direct. Signals drive the DOM without a virtual tree, Effect handles asynchrony and lifecycle, and the router keeps navigation type-safe. Point Vite at your entry file and you're done — no framework-specific build ceremony.",
              ),
              $.dd({ class: "font-bold" }, "Server-side Rendering"),
              $.dd(
                { class: "pb-8" },
                $.span("Server-side rendering piggybacks on "),
                $.code({ class: "prose" }, "@effect/platform"),
                $.span(
                  ". Rather than shipping our own HTTP server, Stax integrates with the primitives you'd already reach for building any Effect service. Your rendered app and your data layer share one runtime, one context system, one story for errors.",
                ),
              ),
              $.dd({ class: "font-bold" }, "Static Site Generation"),
              $.dd(
                { class: "pb-8" },
                "SSG is a first-class output. Route loaders run at build time, pages render to HTML, and hydration wires the same components back up in the browser. This site — the one you're reading — is built with Stax's SSG pipeline.",
              ),
            ),
          ),
          $.div({ class: "flex-1 flex", innerHTML: fullstackHtml }),
          "environment",
        ),
        ContentSection(
          $.div(
            { class: "flex-1 flex flex-col gap-6" },
            $.h2(
              { class: "text-heading tracking-tight" },
              $.span("Effect "),
              $.span({ class: "text-accent" }, "Native"),
            ),
            $.div(
              { class: "text-paragraph space-y-4" },
              $.p(
                "Every Stax component is an Effect. Typed errors, dependency injection, structured concurrency, resource cleanup — you don't reach for a wrapper library, you just use Effect. If you know how to write a service in Effect, you already know how to write a component in Stax.",
              ),
              $.p(
                $.span("Components can "),
                $.code(
                  {
                    class: "prose",
                  },
                  "yield*",
                ),
                $.span(
                  " services the same way any other Effect can. The same ",
                ),
                $.code(
                  {
                    class: "prose",
                  },
                  "Layer",
                ),
                $.span(
                  " that provides your API client to a server route provides it to a UI component — no adapter, no duplicated wiring.",
                ),
              ),
            ),
          ),
          $.div({ innerHTML: effectHtml }),
          "effect",
        ),
        ContentSection(
          $.div(
            { class: "flex-1 flex flex-col gap-6" },
            $.h2(
              { class: "text-heading tracking-tight" },
              $.span("Reactive "),
              $.span({ class: "text-accent" }, "State"),
            ),
            $.div(
              { class: "text-paragraph space-y-4" },
              $.p(
                $.span(
                  "Signals in Stax are references, not snapshots. Create one with ",
                ),
                $.code({ class: "prose" }, "Signal.make"),
                $.span(", read it with "),
                $.code({ class: "prose" }, ".get"),
                $.span(", update it with "),
                $.code({ class: "prose" }, ".set"),
                $.span(" or "),
                $.code({ class: "prose" }, ".update"),
                $.span(
                  ". Pass a signal directly as an attribute or a child, and Stax subscribes on your behalf — the DOM updates automatically as the value changes.",
                ),
              ),
              $.p(
                $.span("Derived values come from "),
                $.code({ class: "prose" }, "Readable.map"),
                $.span(
                  " and friends. They stay in sync with their inputs without a dependency-tracking runtime and without you thinking about it. If your state model is a tree of signals and readables, your UI is already reactive.",
                ),
              ),
            ),
          ),
          $.div({ class: "flex flex-1", innerHTML: reactiveHtml }),
          "reactive",
        ),
        ContentSection(
          $.div(
            { class: "flex-1 flex flex-col gap-6" },
            $.h2(
              { class: "text-heading tracking-tight" },
              $.span("Familiar "),
              $.span({ class: "text-accent" }, "Style"),
            ),
            $.div(
              { class: "text-paragraph space-y-4" },
              $.p(
                "If you've written React, Solid, or Vue, Stax will feel familiar. Components are functions that return trees of elements, composition works the way you'd expect, and props are just arguments. There's no JSX transform, no virtual DOM, no reconciler — the tree you build is the tree that renders.",
              ),
              $.p(
                $.span("The "),
                $.code({ class: "prose" }, "$"),
                $.span(
                  " factory replaces JSX with plain function calls that read as cleanly. Attributes go in the first argument, children follow. If a React refactor is muscle memory for you, moving to Stax rewires very little.",
                ),
              ),
            ),
          ),

          $.div({ class: "flex flex-1", innerHTML: familiarHtml }),
          "familiar",
        ),
        ContentSection(
          $.div(
            { class: "flex-1 flex flex-col gap-6" },
            $.h2(
              { class: "text-heading tracking-tight" },
              $.span("Confident"),
              $.br(),
              $.span({ class: "text-accent" }, "Development"),
            ),
            $.div(
              { class: "text-paragraph space-y-4" },
              $.p(
                $.span(
                  "Every element in Stax carries its error and dependency types in its signature. ",
                ),
                $.code({ class: "prose" }, "Element<HttpError, ApiClient>"),
                $.span(" says: this component might fail with an "),
                $.code({ class: "prose" }, "HttpError"),
                $.span(", and it needs an "),
                $.code({ class: "prose" }, "ApiClient"),
                $.span(
                  ". TypeScript refuses to mount it until you handle the error and provide the service.",
                ),
              ),
              $.p(
                "Deployment stops being a leap of faith. The compiler tells you when a route is missing context, when a Layer isn't wired up, when an error case slipped past. What ships is what typechecked.",
              ),
            ),
          ),
          $.div({ innerHTML: errorsHtml }),
          "confidence",
        ),
        $.div(
          { class: "px-8 py-12 border-t flex flex-col gap-8" },
          $.a({
            id: "suite",
          }),
          $.h2({ class: "text-heading tracking-tight" }, "Package Suite"),
          $.p(
            { class: "text-paragraph max-w-200 text-neutral" },
            "Stax is a suite of packages that work together to provide a full-stack development experience. Each package is focused on a specific area, and they can be used independently or together.",
          ),
          $.div(
            { class: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" },
            packageCard(
              "@stax-ui/core",
              "Platform-agnostic reactivity primitives: Signal, Readable, reactive collections, control flow, and transitions.",
              "core",
            ),
            packageCard(
              "@stax-ui/dom",
              "DOM renderer: the $ element factory, animations, portals, virtual lists, and hydration.",
              "dom",
            ),
            packageCard(
              "@stax-ui/router",
              "Type-safe routing with schema-validated params, data loaders, and mutation handlers.",
              "router",
            ),
            packageCard(
              "@stax-ui/form",
              "Schema-first forms with per-field reactivity, validation, and nested structures.",
              "form",
            ),
            packageCard(
              "@stax-ui/platform",
              "Full-stack SSR + SSG integration built on @effect/platform — server rendering, data serialization, hydration.",
              "platform",
            ),
            packageCard(
              "@stax-ui/vite-plugin",
              "Vite plugin for the SSR dev server, server-code stripping, and static site generation.",
              "vite-plugin",
            ),
          ),
        ),
      ),
    );
  });
