import { describe, expect, it } from "vitest";

import { stripServerCode } from "./plugin.js";

describe("stripServerCode", () => {
  describe("Route.get loader stripping", () => {
    it("strips inline loader function", () => {
      const input = `
Route.get(
  ({ params }) => Effect.gen(function* () {
    const svc = yield* PostService;
    return yield* svc.getPosts();
  }),
  (data) => FeedPage(data),
)`;
      const result = stripServerCode(input);
      expect(result).toContain("Route.get(null,");
      expect(result).toContain("(data) => FeedPage(data)");
      expect(result).not.toContain("PostService");
    });

    it("strips loader with destructured params", () => {
      const input = `Route.get(({ params: { id } }) => Effect.gen(function* () {
    const svc = yield* PostService;
    return yield* svc.getUser(id);
  }), (data) => UserPage(data))`;
      const result = stripServerCode(input);
      expect(result).toContain("Route.get(null,");
      expect(result).toContain("(data) => UserPage(data)");
      expect(result).not.toContain("PostService");
    });

    it("handles multiple Route.get calls", () => {
      const input = `
const A = Route.make("/a").pipe(
  Route.get(
    () => Effect.succeed("a"),
    (d) => PageA(d),
  ),
);
const B = Route.make("/b").pipe(
  Route.get(
    () => Effect.succeed("b"),
    (d) => PageB(d),
  ),
);`;
      const result = stripServerCode(input);
      expect(result).not.toContain('Effect.succeed("a")');
      expect(result).not.toContain('Effect.succeed("b")');
      expect(result).toContain("(d) => PageA(d)");
      expect(result).toContain("(d) => PageB(d)");
    });

    it("preserves code outside Route.get", () => {
      const input = `
import { Route } from "@stax-ui/router";
const FeedRoute = Route.make("/").pipe(
  Route.get(() => loadData(), (d) => Page(d)),
);
export { FeedRoute };`;
      const result = stripServerCode(input);
      expect(result).toContain('import { Route } from "@stax-ui/router"');
      expect(result).toContain('Route.make("/")');
      expect(result).toContain("export { FeedRoute }");
    });
  });

  describe("Route.post/put/del handler stripping", () => {
    it("strips handler but keeps key", () => {
      const input = `Route.post("create", (body) => Effect.gen(function* () {
    const svc = yield* PostService;
    return yield* svc.createPost(body);
  }))`;
      const result = stripServerCode(input);
      expect(result).toContain('Route.post("create",');
      expect(result).toContain("server only");
      expect(result).not.toContain("PostService");
    });

    it("strips Route.put handler", () => {
      const input = `Route.put("update", (body) => Effect.gen(function* () {
    return yield* db.update(body);
  }))`;
      const result = stripServerCode(input);
      expect(result).toContain('Route.put("update",');
      expect(result).toContain("server only");
      expect(result).not.toContain("db.update");
    });

    it("strips Route.del handler", () => {
      const input = `Route.del("remove", (body) => Effect.gen(function* () {
    return yield* db.delete(body);
  }))`;
      const result = stripServerCode(input);
      expect(result).toContain('Route.del("remove",');
      expect(result).toContain("server only");
      expect(result).not.toContain("db.delete");
    });

    it("handles string key with special characters", () => {
      const input = `Route.post("update-profile", handler)`;
      const result = stripServerCode(input);
      expect(result).toContain('"update-profile"');
      expect(result).toContain("server only");
    });
  });

  describe("combined Route.get + Route.post", () => {
    it("strips both loader and handler in a pipe chain", () => {
      const input = `
export const FeedRoute = Route.make("/").pipe(
  Route.get(
    ({}) => Effect.gen(function* () {
      const svc = yield* PostService;
      const posts = yield* svc.getPosts();
      return { posts };
    }),
    (data) => FeedPage(data),
  ),
  Route.post("create", (body) => Effect.gen(function* () {
    const { content } = body as { content: string };
    const svc = yield* PostService;
    return yield* svc.createPost("alice", content);
  })),
);`;
      const result = stripServerCode(input);
      // Loader stripped
      expect(result).toContain("Route.get(null,");
      expect(result).toContain("(data) => FeedPage(data)");
      // Handler stripped but key kept
      expect(result).toContain('Route.post("create",');
      expect(result).toContain("server only");
      // Server code removed
      expect(result).not.toContain("PostService");
      expect(result).not.toContain("svc.getPosts");
      expect(result).not.toContain("svc.createPost");
    });
  });

  describe("edge cases", () => {
    it("handles nested parentheses in loader", () => {
      const input = `Route.get(({ params }) => Effect.gen(function* () {
    const data = yield* Effect.tryPromise(() =>
      fetch("/api").then((r) => r.json())
    );
    return data;
  }), (d) => Page(d))`;
      const result = stripServerCode(input);
      expect(result).toContain("Route.get(null,");
      expect(result).not.toContain("fetch");
    });

    it("returns unchanged code when no Route calls present", () => {
      const input = `const x = 1;\nconst y = 2;`;
      const result = stripServerCode(input);
      expect(result).toBe(input);
    });

    it("handles loader with template literal strings", () => {
      const input =
        "Route.get(({ params }) => Effect.gen(function* () {\n    const url = `/api/users/${params.id}`;\n    return yield* fetchData(url);\n  }), (d) => Page(d))";
      const result = stripServerCode(input);
      expect(result).toContain("Route.get(null,");
      expect(result).not.toContain("fetchData");
    });

    it("preserves `$` import when `$` is used in the code", () => {
      // Regression: dead-import detection used `\b<name>\b`, and `\b` is a
      // \w↔\W boundary. `$` is a \w character, but the JS `$` at a call
      // site like `$.div(...)` is bordered by whitespace on the left and
      // `.` on the right — so `\b$\b` couldn't match a real usage, and
      // `$`-only imports were misclassified as dead.
      const input = `import { $ } from "@stax-ui/dom";
const App = () => $.div("hi");`;
      const result = stripServerCode(input);
      expect(result).toContain('import { $ } from "@stax-ui/dom"');
    });

    it("preserves `$` when it shares an import line with a used specifier", () => {
      // Regression cover: the bug was hidden while other used specifiers
      // (e.g. `collect`) sat next to `$` on the same import line, because
      // the "all dead" check short-circuits when any one specifier looks
      // used.
      const input = `import { $, when } from "@stax-ui/dom";
const App = () => $.div(when(cond, { onTrue: () => Yes(), onFalse: () => No() }));`;
      const result = stripServerCode(input);
      expect(result).toContain('import { $, when } from "@stax-ui/dom"');
    });

    it("still strips a truly dead `$`-only import", () => {
      const input = `import { $ } from "@stax-ui/dom";
const x = 1;`;
      const result = stripServerCode(input);
      expect(result).not.toContain('import { $ } from "@stax-ui/dom"');
    });
  });

  describe("Route.static stripping", () => {
    it("strips static config with paths, load, and render", () => {
      const input = `Route.static({
  paths: () => Effect.gen(function* () {
    const files = yield* glob("docs/*.md");
    return files.map(f => ({ slug: f }));
  }),
  load: ({ params }) => Effect.gen(function* () {
    return yield* readFile(params.slug);
  }),
  render: (data) => DocPage(data),
})`;
      const result = stripServerCode(input);
      expect(result).toContain("Route.render(");
      expect(result).toContain("DocPage(data)");
      expect(result).not.toContain("Route.static");
      expect(result).not.toContain("glob");
      expect(result).not.toContain("readFile");
    });

    it("strips static config without paths (no dynamic params)", () => {
      const input = `Route.static({
  load: () => Effect.gen(function* () {
    return yield* readFile("about.md");
  }),
  render: (data) => AboutPage(data),
})`;
      const result = stripServerCode(input);
      expect(result).toContain("Route.render(");
      expect(result).toContain("AboutPage(data)");
      expect(result).not.toContain("Route.static");
      expect(result).not.toContain("readFile");
    });

    it("handles Route.static in a pipeline", () => {
      const input = `const DocRoute = Route.make("/docs/:slug").pipe(
  Route.params(Schema.Struct({ slug: Schema.String })),
  Route.static({
    paths: () => Effect.succeed([{ slug: "intro" }]),
    load: ({ params }) => fetchDoc(params.slug),
    render: (data) => DocPage(data),
  }),
);`;
      const result = stripServerCode(input);
      expect(result).toContain("Route.render(");
      expect(result).toContain("DocPage(data)");
      expect(result).not.toContain("Route.static");
      expect(result).not.toContain("fetchDoc");
    });

    it("handles multiple Route.static calls", () => {
      const input = `
const A = Route.make("/a").pipe(
  Route.static({ load: () => Effect.succeed("a"), render: (d) => PageA(d) }),
);
const B = Route.make("/b").pipe(
  Route.static({ load: () => Effect.succeed("b"), render: (d) => PageB(d) }),
);`;
      const result = stripServerCode(input);
      expect(result).not.toContain("Route.static");
      expect(result).toContain("PageA(d)");
      expect(result).toContain("PageB(d)");
    });

    it("does NOT hardcode undefined for the render arg", () => {
      // Regression: an earlier version wrapped the render fn as
      // `Route.render(() => renderFn(undefined))`, which broke the client
      // provider's data-fetch path — the fetched data reached Outlet, but
      // the transform threw it away before calling the user's render.
      const input = `Route.static({
  load: () => Effect.succeed({ title: "About" }),
  render: (data) => $.h1($.of(data.title)),
})`;
      const result = stripServerCode(input);
      expect(result).not.toContain("(undefined)");
      expect(result).not.toMatch(/Route\.render\s*\(\s*\(\s*\)\s*=>/);
      // Should preserve the arg-receiving render fn directly.
      expect(result).toMatch(/Route\.render\(\s*\(data\)/);
    });
  });
});
