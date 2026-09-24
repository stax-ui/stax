import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { Readable, Signal } from "@stax-ui/core";

import { Boundary } from "../../Boundary.js";
import { animated, each, match, when } from "../../Control/index.js";
import { $ } from "../../Element/index.js";
import { renderToString } from "./index.js";

describe("SSR", () => {
  describe("renderToString", () => {
    it("should render a simple element to HTML", async () => {
      const html = await Effect.runPromise(
        renderToString($.div({ class: "container" }, "Hello World")),
      );

      expect(html).toContain("<div");
      expect(html).toContain('class="container"');
      expect(html).toContain("Hello World");
      expect(html).toContain("</div>");
    });

    it("should render nested elements", async () => {
      const html = await Effect.runPromise(
        renderToString(
          $.div(
            { class: "parent" },
            $.span({ class: "child" }, "First"),
            $.span({ class: "child" }, "Second"),
          ),
        ),
      );

      expect(html).toContain('<div class="parent">');
      expect(html).toContain('<span class="child">First</span>');
      expect(html).toContain('<span class="child">Second</span>');
    });

    it("should escape HTML in text content", async () => {
      const html = await Effect.runPromise(
        renderToString($.div({}, "<script>alert('xss')</script>")),
      );

      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });

    it("should escape HTML in attributes", async () => {
      const html = await Effect.runPromise(
        renderToString($.div({ class: 'foo" onclick="alert(1)' })),
      );

      expect(html).toContain("&quot;");
      expect(html).not.toContain('onclick="alert(1)"');
    });
  });

  describe("when with hydration markers", () => {
    it("should add hydration markers to when container", async () => {
      const html = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const condition = yield* Signal.make(true);
            return yield* renderToString(
              when(condition, {
                onTrue: () => $.div({}, "Visible"),
                onFalse: () => $.div({}, "Hidden"),
              }),
            );
          }),
        ),
      );

      expect(html).toContain("data-stax-id=");
      expect(html).toContain('data-stax-key="true"');
      expect(html).toContain("Visible");
      expect(html).not.toContain("Hidden");
    });

    it("should render false condition", async () => {
      const html = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const condition = yield* Signal.make(false);
            return yield* renderToString(
              when(condition, {
                onTrue: () => $.div({}, "Visible"),
                onFalse: () => $.div({}, "Hidden"),
              }),
            );
          }),
        ),
      );

      expect(html).toContain('data-stax-key="false"');
      expect(html).toContain("Hidden");
      expect(html).not.toContain("Visible");
    });
  });

  describe("match with hydration markers", () => {
    it("should add hydration markers to match container", async () => {
      const html = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const status = yield* Signal.make<"loading" | "success" | "error">(
              "loading",
            );
            return yield* renderToString(
              match(status, {
                cases: [
                  {
                    pattern: "loading",
                    render: () => $.div({}, "Loading..."),
                  },
                  {
                    pattern: "success",
                    render: () => $.div({}, "Done!"),
                  },
                  { pattern: "error", render: () => $.div({}, "Failed") },
                ],
              }),
            );
          }),
        ),
      );

      expect(html).toContain("data-stax-id=");
      expect(html).toContain('data-stax-key="loading"');
      expect(html).toContain("Loading...");
    });

    it("should render fallback when no pattern matches", async () => {
      const html = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const value = yield* Signal.make(999);
            return yield* renderToString(
              match(value, {
                cases: [
                  { pattern: 1, render: () => $.div({}, "One") },
                  { pattern: 2, render: () => $.div({}, "Two") },
                ],
                fallback: () => $.div({}, "Unknown"),
              }),
            );
          }),
        ),
      );

      expect(html).toContain("Unknown");
    });
  });

  describe("each with hydration markers", () => {
    it("should add hydration markers to each container and items", async () => {
      const html = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const items = yield* Signal.make([
              { id: "1", name: "Alice" },
              { id: "2", name: "Bob" },
            ]);
            return yield* renderToString(
              each(items, {
                container: () => $.ul({ class: "list" }),
                key: (item) => item.id,
                render: (item) =>
                  $.li(
                    {},
                    Readable.map(item, (i) => i.name),
                  ),
              }),
            );
          }),
        ),
      );

      expect(html).toContain("data-stax-id=");
      expect(html).toContain('data-stax-key="1"');
      expect(html).toContain('data-stax-key="2"');
      expect(html).toContain("<ul");
      expect(html).toContain("<li");
      expect(html).toContain("Alice");
      expect(html).toContain("Bob");
    });

    it("should render empty list", async () => {
      const html = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const items = yield* Signal.make<{ id: string; name: string }[]>(
              [],
            );
            return yield* renderToString(
              each(items, {
                key: (item) => item.id,
                render: (item) =>
                  $.li(
                    {},
                    Readable.map(item, (i) => i.name),
                  ),
              }),
            );
          }),
        ),
      );

      expect(html).toContain("data-stax-id=");
      expect(html).not.toContain("<li");
    });
  });

  describe("reactive values in SSR", () => {
    it("should render initial value of Signal in text", async () => {
      const html = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const count = yield* Signal.make(42);
            return yield* renderToString($.div({}, "Count: ", count));
          }),
        ),
      );

      expect(html).toContain("Count: ");
      expect(html).toContain("42");
    });

    it("should render initial value of Signal in attribute", async () => {
      const html = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const isActive = yield* Signal.make(true);
            return yield* renderToString(
              $.div({
                class: Readable.map(isActive, (a) =>
                  a ? "active" : "inactive",
                ),
              }),
            );
          }),
        ),
      );

      expect(html).toContain('class="active"');
    });
  });

  describe("suspense boundaries in SSR", () => {
    it("should render fallback with hydration markers", async () => {
      const html = await Effect.runPromise(
        renderToString(
          Boundary.suspense({
            render: () =>
              Effect.gen(function* () {
                yield* Effect.sleep(100);
                return yield* $.div({}, "Loaded content");
              }),
            fallback: () => $.div({}, "Loading..."),
          }),
        ),
      );

      expect(html).toContain("data-stax-id=");
      expect(html).toContain('data-stax-type="suspense"');
      expect(html).toContain('data-stax-suspense-state="loading"');
      expect(html).toContain("Loading...");
      // Should NOT contain the async content during SSR
      expect(html).not.toContain("Loaded content");
    });

    it("should render fallback with catch handler", async () => {
      const html = await Effect.runPromise(
        renderToString(
          Boundary.suspense({
            render: () =>
              Effect.gen(function* () {
                yield* Effect.sleep(100);
                return yield* $.div({}, "Success");
              }),
            fallback: () => $.div({}, "Loading..."),
            catch: () => $.div({}, "Error occurred"),
          }),
        ),
      );

      expect(html).toContain('data-stax-type="suspense"');
      expect(html).toContain("Loading...");
    });
  });

  describe("intro FOUC prevention", () => {
    it("emits enterFrom classes on each's SSR items when intro is set", async () => {
      const App = () =>
        Effect.gen(function* () {
          const items = yield* Signal.make(["a", "b"]);
          return yield* each(items, {
            key: (item) => item,
            render: (item) => $.li({}, item),
            animate: {
              enterFrom: "opacity-0 translate-y-2",
              enter: "opacity-100 translate-y-0",
            },
            intro: true,
          });
        });

      const html = await Effect.runPromise(renderToString(App()));

      // Both items should carry the enterFrom classes so the browser paints
      // them hidden until hydration animates them in.
      const opacityMatches = html.match(/opacity-0/g) ?? [];
      const translateMatches = html.match(/translate-y-2/g) ?? [];
      expect(opacityMatches).toHaveLength(2);
      expect(translateMatches).toHaveLength(2);
    });

    it("does not emit enterFrom classes when intro is omitted", async () => {
      const App = () =>
        Effect.gen(function* () {
          const items = yield* Signal.make(["a", "b"]);
          return yield* each(items, {
            key: (item) => item,
            render: (item) => $.li({}, item),
            animate: {
              enterFrom: "opacity-0",
              enter: "opacity-100",
            },
          });
        });

      const html = await Effect.runPromise(renderToString(App()));

      expect(html).not.toContain("opacity-0");
    });

    it("emits enterFrom on when's SSR branch when intro is set", async () => {
      const App = () =>
        Effect.gen(function* () {
          const visible = yield* Signal.make(true);
          return yield* when(visible, {
            onTrue: () => $.div({ class: "hero" }, "Hi"),
            onFalse: () => $.div({}, ""),
            animate: {
              enterFrom: "opacity-0",
              enter: "opacity-100",
            },
            intro: true,
          });
        });

      const html = await Effect.runPromise(renderToString(App()));

      expect(html).toContain("opacity-0");
    });

    it("emits enterFrom on animated's SSR child when intro is set", async () => {
      const html = await Effect.runPromise(
        renderToString(
          animated(
            {
              animate: {
                enterFrom: "opacity-0 translate-y-2",
                enter: "opacity-100 translate-y-0",
              },
              intro: true,
            },
            () => $.h1({}, "Hero"),
          ),
        ),
      );

      expect(html).toContain("opacity-0");
      expect(html).toContain("translate-y-2");
      expect(html).toContain("Hero");
    });

    it("does not emit enterFrom on animated when intro is omitted", async () => {
      const html = await Effect.runPromise(
        renderToString(
          animated(
            {
              animate: {
                enterFrom: "opacity-0",
                enter: "opacity-100",
              },
            },
            () => $.h1({}, "Hero"),
          ),
        ),
      );

      expect(html).not.toContain("opacity-0");
    });
  });
});
