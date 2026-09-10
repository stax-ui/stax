import { Effect } from "effect";

import { Route, Router } from "@stax-ui/router";

import { getAdjacentPages, getSections } from "./content.js";
import {
  discoverPages,
  extractToc,
  loadComponentFiles,
  loadPage,
  renderCode,
} from "./content.server.js";
import { ContactPage } from "./pages/ContactPage.js";
import { DocPage } from "./pages/DocPage.js";
import { DocsIndexPage } from "./pages/DocsIndexPage.js";
import {
  effectExample,
  errorsExample,
  familiarExample,
  fullstackExample,
  HomePage,
  reactiveExample,
} from "./pages/HomePage.js";
import { NotFoundPage } from "./pages/NotFoundPage.js";

// ─── Home page ───────────────────────────────────────────────────────────────

const HomeRoute = Route.make("/").pipe(
  Route.static({
    load: () =>
      Effect.gen(function* () {
        const [
          errorsHtml,
          fullstackHtml,
          effectHtml,
          reactiveHtml,
          familiarHtml,
          todoFiles,
        ] = yield* Effect.all([
          renderCode(errorsExample, "typescript"),
          renderCode(fullstackExample, "typescript"),
          renderCode(effectExample, "typescript"),
          renderCode(reactiveExample, "typescript"),
          renderCode(familiarExample, "typescript"),
          loadComponentFiles("TodoApp", [
            "TodoApp.ts",
            "TodoItem.ts",
            "Storage.ts",
          ]),
        ]);

        return {
          codeExamples: {
            errorsHtml,
            fullstackHtml,
            effectHtml,
            reactiveHtml,
            familiarHtml,
            todoFiles,
          },
        };
      }),
    render: (data) => HomePage(data),
  }),
  Route.meta({
    title: "Stax | Reactive UI Built on Effect.ts",
    description: "A reactive UI library ecosystem built on top of Effect.ts.",
  }),
);

// ─── Docs index ──────────────────────────────────────────────────────────────

const DocsIndexRoute = Route.make("/docs").pipe(
  Route.static({
    load: () =>
      Effect.gen(function* () {
        const allPages = yield* discoverPages();
        return { sections: getSections(allPages) };
      }),
    render: (data) => DocsIndexPage({ sections: data.sections }),
  }),
  Route.meta({
    title: "Docs | Stax",
    description: "Everything you need to build with Stax.",
  }),
);

// ─── Doc pages ───────────────────────────────────────────────────────────────

const DocRoute = Route.make("/docs/*").pipe(
  Route.static({
    paths: () =>
      Effect.gen(function* () {
        const pages = yield* discoverPages();
        return pages.map((p) => ({ "*": p.slug }) as Record<string, string>);
      }),
    load: ({ params }) =>
      Effect.gen(function* () {
        const slug = params["*"];
        const parts = slug.split("/");
        const section = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
        const filename = parts[parts.length - 1] + ".md";
        const page = yield* loadPage(section, filename);

        const allPages = yield* discoverPages();
        const sections = getSections(allPages);

        const { prev, next } = getAdjacentPages(slug, sections);
        const toc = extractToc(page.html);

        return { page, sections, prev, next, toc };
      }),
    render: (data) =>
      DocPage({
        page: data.page,
        sections: data.sections,
        prev: data.prev,
        next: data.next,
        toc: data.toc,
      }),
  }),
  Route.meta(({ data }) => ({
    title: `${data.page.title} | Stax Docs`,
    description: data.page.description,
  })),
);

// ─── Contact page ────────────────────────────────────────────────────────────

const ContactRoute = Route.make("/contact").pipe(
  Route.static({
    load: () => Effect.succeed({}),
    render: () => ContactPage(),
  }),
  Route.meta({
    title: "Contact | Stax",
    description: "Get in touch about Stax.",
  }),
);

// ─── Router ──────────────────────────────────────────────────────────────────

export const router = Router.empty.pipe(
  Router.concat(HomeRoute),
  Router.concat(DocsIndexRoute),
  Router.concat(DocRoute),
  Router.concat(ContactRoute),
  Router.fallback(() => NotFoundPage()),
);
