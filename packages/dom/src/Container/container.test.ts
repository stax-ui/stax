import { Context, Effect, Layer } from "effect";
import { beforeEach, describe, expect, it } from "vitest";

import { ClientControlCtx } from "../Control/ClientControlCtx.js";
import { $ } from "../Element/index.js";
import { DOMRendererLive } from "../Render/DOMRenderer.js";
import { ClientSuspenseBoundaryCtx } from "../SuspenseBoundaryCtx/index.js";
import { container } from "./container.js";

const TestLayer = Layer.provideMerge(
  Layer.mergeAll(ClientSuspenseBoundaryCtx, ClientControlCtx),
  DOMRendererLive,
);

const runTest = <A, R>(effect: Effect.Effect<A, unknown, R>) =>
  Effect.runPromise(
    Effect.scoped(effect).pipe(Effect.provide(TestLayer)) as Effect.Effect<
      A,
      never,
      never
    >,
  );

beforeEach(() => {
  document.body.innerHTML = "";
});

// -----------------------------------------------------------------------------
// Fixtures shared across suites.
// -----------------------------------------------------------------------------

class ThemeCtx extends Context.Tag("ThemeCtx")<
  ThemeCtx,
  { readonly color: string }
>() {}

class SizeCtx extends Context.Tag("SizeCtx")<
  SizeCtx,
  { readonly scale: number }
>() {}

// -----------------------------------------------------------------------------

describe("container", () => {
  describe("pure path", () => {
    it("builds a factory that renders with no props and no children", async () => {
      const Leaf = container((_props: { label?: string }, children) =>
        $.span({ class: "leaf" }, children),
      );
      const el = await runTest(Leaf());
      expect(el.tagName).toBe("SPAN");
      expect(el.className).toBe("leaf");
    });

    it("accepts a children-only call when every prop is optional", async () => {
      const Leaf = container((_props: { label?: string }, children) =>
        $.span({}, children),
      );
      const el = await runTest(Leaf("hello"));
      expect(el.textContent).toBe("hello");
    });

    it("accepts props-plus-variadic children", async () => {
      const Wrap = container((props: { tone: string }, children) =>
        $.div({ "data-tone": props.tone }, children),
      );
      const el = await runTest(Wrap({ tone: "muted" }, "a", "b"));
      expect(el.getAttribute("data-tone")).toBe("muted");
      expect(el.textContent).toBe("ab");
    });

    it("accepts props-plus-forwarded-array children", async () => {
      const Wrap = container((props: { tone: string }, children) =>
        $.div({ "data-tone": props.tone }, children),
      );
      const el = await runTest(Wrap({ tone: "loud" }, ["x", "y", "z"]));
      expect(el.textContent).toBe("xyz");
    });

    it("preserves impl's yield* context requirement on the output", async () => {
      const Panel = container((_props: { keepMounted?: boolean }, children) =>
        Effect.gen(function* () {
          const { color } = yield* ThemeCtx;
          return yield* $.div({ "data-color": color }, children);
        }),
      );
      const el = await runTest(
        Panel({}, "content").pipe(
          Effect.provideService(ThemeCtx, { color: "amber" }),
        ),
      );
      expect(el.getAttribute("data-color")).toBe("amber");
      expect(el.textContent).toBe("content");
    });
  });

  describe("provides — single tag", () => {
    it("provides the service to effectful children", async () => {
      const Panel = container((_props: object, children) =>
        Effect.gen(function* () {
          const { color } = yield* ThemeCtx;
          return yield* $.span({ "data-color": color }, children);
        }),
      );

      const Root = container.provides(ThemeCtx)((_props: object, provide) =>
        $.div({ class: "root" }, provide({ color: "teal" })),
      );

      const el = await runTest(Root({}, Panel({}, "hi")));
      const inner = el.querySelector("span");
      expect(inner?.getAttribute("data-color")).toBe("teal");
      expect(inner?.textContent).toBe("hi");
    });

    it("leaves non-effectful children alone", async () => {
      const Root = container.provides(ThemeCtx)((_props: object, provide) =>
        $.div({}, provide({ color: "red" })),
      );
      const el = await runTest(Root({}, "plain text"));
      expect(el.textContent).toBe("plain text");
    });

    it("passes props through to impl", async () => {
      const Root = container.provides(ThemeCtx)(
        (props: { seed: string }, provide) =>
          $.div({ "data-seed": props.seed }, provide({ color: "indigo" })),
      );
      const el = await runTest(Root({ seed: "abc" }, "child"));
      expect(el.getAttribute("data-seed")).toBe("abc");
    });
  });

  describe("provides — record form", () => {
    it("provides every service in the record", async () => {
      const Panel = container((_props: object, children) =>
        Effect.gen(function* () {
          const { color } = yield* ThemeCtx;
          const { scale } = yield* SizeCtx;
          return yield* $.span(
            { "data-color": color, "data-scale": String(scale) },
            children,
          );
        }),
      );

      const MultiRoot = container.provides({
        theme: ThemeCtx,
        size: SizeCtx,
      })((_props: object, provide) =>
        $.div(
          {},
          provide({
            theme: { color: "cyan" },
            size: { scale: 2 },
          }),
        ),
      );

      const el = await runTest(MultiRoot({}, Panel({}, "ok")));
      const inner = el.querySelector("span");
      expect(inner?.getAttribute("data-color")).toBe("cyan");
      expect(inner?.getAttribute("data-scale")).toBe("2");
    });
  });

  describe("provides — escape-hatch children override", () => {
    it("scopes only the explicit subset when provide(service, override) is used", async () => {
      // Child reads ThemeCtx; without the service, this fails at runtime.
      const Reader = container((_props: object, children) =>
        Effect.gen(function* () {
          const { color } = yield* ThemeCtx;
          return yield* $.span({ "data-color": color }, children);
        }),
      );

      // Root receives two children. It routes only the SECOND through
      // provide(); the FIRST is passed raw and must be a non-reader.
      const SplitRoot = container.provides(ThemeCtx)(
        (_props: object, provide, children = []) =>
          $.div(
            {},
            children.slice(0, 1),
            provide({ color: "lime" }, children.slice(1)),
          ),
      );

      const el = await runTest(
        SplitRoot({}, $.span({ class: "raw" }, "head"), Reader({}, "body")),
      );

      // Raw child survived; provided child read the service.
      expect(el.querySelector(".raw")?.textContent).toBe("head");
      const provided = el.querySelector("[data-color]");
      expect(provided?.getAttribute("data-color")).toBe("lime");
      expect(provided?.textContent).toBe("body");
    });
  });
});
