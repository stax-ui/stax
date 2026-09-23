import { Context, Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Readable, Signal } from "@stax-ui/core";

import { Animation } from "../../Animation/index.js";
import { Boundary } from "../../Boundary.js";
import { animated, each, match, when } from "../../Control/index.js";
import { $ } from "../../Element/index.js";
import { renderToString } from "../server/index.js";
import { hydrate } from "./index.js";

describe("Hydration", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe("basic hydration", () => {
    it("should hydrate a simple element", async () => {
      // SSR
      const html = await Effect.runPromise(
        renderToString($.div({ class: "test" }, $.of("Hello"))),
      );
      container.innerHTML = html;

      // Hydrate
      await hydrate($.div({ class: "test" }, $.of("Hello")), container);

      expect(container.querySelector(".test")).toBeTruthy();
      expect(container.textContent).toContain("Hello");
    });

    it("should attach event handlers during hydration", async () => {
      const onClick = vi.fn();

      // SSR - note: events don't render to HTML
      const html = await Effect.runPromise(
        renderToString($.div({ class: "clickable" }, $.of("Click me"))),
      );
      container.innerHTML = html;

      // Hydrate with event handler
      await hydrate(
        $.div({ class: "clickable", onClick }, $.of("Click me")),
        container,
      );

      // Wait a tick for the forked fiber to complete hydration
      await new Promise((r) => setTimeout(r, 0));

      // Simulate click
      const element = container.querySelector(".clickable") as HTMLElement;
      element?.click();

      expect(onClick).toHaveBeenCalled();
    });
  });

  describe("control flow hydration", () => {
    it("should hydrate when component and set up subscriptions", async () => {
      // Create signal outside for testing
      let conditionSignal: Signal.Signal<boolean>;

      const App = () =>
        Effect.gen(function* () {
          conditionSignal = yield* Signal.make(true);
          return yield* when(conditionSignal, {
            onTrue: () => $.div({ class: "visible" }, $.of("Visible")),
            onFalse: () => $.div({ class: "hidden" }, $.of("Hidden")),
          });
        });

      // SSR
      const html = await Effect.runPromise(renderToString(App()));
      container.innerHTML = html;

      expect(container.innerHTML).toContain("Visible");
      expect(container.innerHTML).not.toContain("Hidden");

      // Hydrate
      await hydrate(App(), container);

      // Initial state preserved
      expect(container.textContent).toContain("Visible");
    });

    it("should hydrate match component", async () => {
      let statusSignal: Signal.Signal<"loading" | "success" | "error">;

      const App = () =>
        Effect.gen(function* () {
          statusSignal = yield* Signal.make<"loading" | "success" | "error">(
            "loading",
          );
          return yield* match(statusSignal, {
            cases: [
              {
                pattern: "loading",
                render: () => $.div({}, $.of("Loading...")),
              },
              { pattern: "success", render: () => $.div({}, $.of("Success!")) },
              { pattern: "error", render: () => $.div({}, $.of("Error!")) },
            ],
          });
        });

      // SSR
      const html = await Effect.runPromise(renderToString(App()));
      container.innerHTML = html;

      expect(container.innerHTML).toContain("Loading...");

      // Hydrate
      await hydrate(App(), container);

      expect(container.textContent).toContain("Loading...");
    });
  });

  describe("suspense hydration", () => {
    it("should find suspense container and trigger async load", async () => {
      let resolved = false;

      const App = () =>
        Boundary.suspense({
          render: () =>
            Effect.gen(function* () {
              yield* Effect.sleep(10);
              resolved = true;
              return yield* $.div({ class: "loaded" }, $.of("Loaded content"));
            }),
          fallback: () => $.div({ class: "loading" }, $.of("Loading...")),
        });

      // SSR - renders fallback
      const html = await Effect.runPromise(renderToString(App()));
      container.innerHTML = html;

      expect(container.innerHTML).toContain("Loading...");
      expect(container.innerHTML).toContain(
        'data-stax-suspense-state="loading"',
      );
      expect(resolved).toBe(false);

      // Hydrate - should trigger async load
      await hydrate(App(), container);

      // Wait for async content to load
      await new Promise((r) => setTimeout(r, 50));

      expect(resolved).toBe(true);
      expect(container.innerHTML).toContain("Loaded content");
      expect(container.innerHTML).toContain(
        'data-stax-suspense-state="loaded"',
      );
    });

    it("should handle suspense error with catch handler", async () => {
      const App = () =>
        Boundary.suspense({
          render: () =>
            Effect.gen(function* () {
              yield* Effect.sleep(10);
              return yield* Effect.fail("Something went wrong");
            }),
          fallback: () => $.div({ class: "loading" }, $.of("Loading...")),
          catch: (error) => $.div({ class: "error" }, $.of(`Error: ${error}`)),
        });

      // SSR - renders fallback
      const html = await Effect.runPromise(renderToString(App()));
      container.innerHTML = html;

      expect(container.innerHTML).toContain("Loading...");

      // Hydrate - should trigger async load and catch error
      await hydrate(App(), container);

      // Wait for async content
      await new Promise((r) => setTimeout(r, 50));

      expect(container.innerHTML).toContain("Error: Something went wrong");
      expect(container.innerHTML).toContain('data-stax-suspense-state="error"');
    });

    it("should handle nested when inside suspense", async () => {
      let conditionSignal: Signal.Signal<boolean>;

      const App = () =>
        Effect.gen(function* () {
          conditionSignal = yield* Signal.make(true);

          return yield* Boundary.suspense({
            render: () =>
              Effect.gen(function* () {
                yield* Effect.sleep(10);
                return yield* when(conditionSignal, {
                  onTrue: () => $.div({ class: "true-branch" }, $.of("True")),
                  onFalse: () =>
                    $.div({ class: "false-branch" }, $.of("False")),
                });
              }),
            fallback: () => $.div({ class: "loading" }, $.of("Loading...")),
          });
        });

      // SSR - renders fallback
      const html = await Effect.runPromise(renderToString(App()));
      container.innerHTML = html;

      expect(container.innerHTML).toContain("Loading...");

      // Hydrate
      await hydrate(App(), container);

      // Wait for async content
      await new Promise((r) => setTimeout(r, 50));

      expect(container.innerHTML).toContain("True");
    });
  });

  describe("hydration ID synchronization", () => {
    it("should generate matching IDs for SSR and hydration", async () => {
      // This tests that when we have multiple control flow elements,
      // the hydration ID counter stays in sync

      const App = () =>
        Effect.gen(function* () {
          const show1 = yield* Signal.make(true);
          const show2 = yield* Signal.make(false);

          return yield* $.div(
            {},
            when(show1, {
              onTrue: () => $.span({}, "First visible"),
              onFalse: () => $.span({}, "First hidden"),
            }),
            Boundary.suspense({
              render: () =>
                Effect.gen(function* () {
                  yield* Effect.sleep(10);
                  return yield* $.div({}, "Async content");
                }),
              fallback: () => $.div({}, "Loading..."),
            }),
            when(show2, {
              onTrue: () => $.span({}, "Second visible"),
              onFalse: () => $.span({}, "Second hidden"),
            }),
          );
        });

      // SSR
      const html = await Effect.runPromise(renderToString(App()));
      container.innerHTML = html;

      // Should have stax-id markers for control flow containers
      expect(container.innerHTML).toContain("data-stax-id=");
      // Should have keys for the rendered slots
      expect(container.innerHTML).toContain('data-stax-key="true"');
      expect(container.innerHTML).toContain('data-stax-key="false"');

      // Hydrate
      await hydrate(App(), container);

      // Wait for suspense
      await new Promise((r) => setTimeout(r, 50));

      // Suspense should have loaded
      expect(container.innerHTML).toContain("Async content");
      expect(container.innerHTML).toContain("First visible");
      expect(container.innerHTML).toContain("Second hidden");
    });
  });

  describe("each intro flag", () => {
    const letters = () => [
      { id: "l1", char: "H" },
      { id: "l2", char: "i" },
    ];

    it("does not re-animate SSR items by default", async () => {
      const onBeforeEnter = vi.fn(() => Effect.void);

      const App = () =>
        Effect.gen(function* () {
          const items = yield* Signal.make(letters());
          return yield* each(items, {
            key: (l: { id: string; char: string }) => l.id,
            render: (l: Readable.Readable<{ id: string; char: string }>) =>
              $.span({}, $.of(Readable.map(l, (v) => v.char))),
            animate: {
              enterFrom: "opacity-0",
              enter: "opacity-100",
              onBeforeEnter,
            },
          });
        });

      container.innerHTML = await Effect.runPromise(renderToString(App()));
      await hydrate(App(), container);
      // Wait long enough that if the fork DID try to run the animation,
      // we'd see it — protects the "no re-animate" assertion against
      // late-firing regressions.
      await new Promise((r) => setTimeout(r, 100));

      expect(onBeforeEnter).not.toHaveBeenCalled();
    });

    it("re-animates SSR items when intro: true", async () => {
      const onBeforeEnter = vi.fn(() => Effect.void);

      const App = () =>
        Effect.gen(function* () {
          const items = yield* Signal.make(letters());
          return yield* each(items, {
            key: (l: { id: string; char: string }) => l.id,
            render: (l: Readable.Readable<{ id: string; char: string }>) =>
              $.span({}, $.of(Readable.map(l, (v) => v.char))),
            animate: {
              enterFrom: "opacity-0",
              enter: "opacity-100",
              onBeforeEnter,
              timeout: 50,
            },
            intro: true,
          });
        });

      container.innerHTML = await Effect.runPromise(renderToString(App()));
      await hydrate(App(), container);
      // Give forked enter animations time to invoke the hook. Hydration
      // animations now wait one requestAnimationFrame before starting
      // (see `forkSlotEnter` — needed to give stylesheets a chance to
      // apply before forceReflow snapshots the pre-transition state),
      // which in jsdom is ~16ms + queue drain. 20ms was too tight on
      // slow CI runners.
      await new Promise((r) => setTimeout(r, 100));

      expect(onBeforeEnter).toHaveBeenCalledTimes(letters().length);
    });

    it("re-animates a `when` branch when intro: true", async () => {
      const onBeforeEnter = vi.fn(() => Effect.void);

      const App = () =>
        Effect.gen(function* () {
          const visible = yield* Signal.make(true);
          return yield* when(visible, {
            onTrue: () => $.div({ class: "hero" }, $.of("Hi")),
            onFalse: () => $.div({}, $.of("")),
            animate: {
              enterFrom: "opacity-0",
              enter: "opacity-100",
              onBeforeEnter,
              timeout: 50,
            },
            intro: true,
          });
        });

      container.innerHTML = await Effect.runPromise(renderToString(App()));
      await hydrate(App(), container);
      await new Promise((r) => setTimeout(r, 100));

      expect(onBeforeEnter).toHaveBeenCalledTimes(1);
    });
  });

  describe("each removal after hydration", () => {
    it("removes a hydrated slot's SSR DOM node when its key drops out", async () => {
      let itemsSignal: Signal.Signal<Array<{ id: string; text: string }>>;
      const initial = [
        { id: "a", text: "Alpha" },
        { id: "b", text: "Bravo" },
        { id: "c", text: "Charlie" },
      ];

      const App = () =>
        Effect.gen(function* () {
          itemsSignal = yield* Signal.make(initial);
          return yield* each(itemsSignal, {
            key: (item: { id: string; text: string }) => item.id,
            render: (item: Readable.Readable<{ id: string; text: string }>) =>
              $.li({}, $.of(Readable.map(item, (v) => v.text))),
            container: () => $.ul({ class: "letters" }),
          });
        });

      container.innerHTML = await Effect.runPromise(renderToString(App()));

      // Sanity: SSR emits three <li> nodes.
      const ssrLis = container.querySelectorAll("li");
      expect(ssrLis.length).toBe(3);
      expect(Array.from(ssrLis).map((li) => li.textContent)).toEqual([
        "Alpha",
        "Bravo",
        "Charlie",
      ]);

      await hydrate(App(), container);
      // hydrate() returns Promise.resolve() immediately and completes the
      // App() render inside a forked fiber — wait a tick so the signal has
      // been created and subscriptions wired before we drive it.
      await new Promise((r) => setTimeout(r, 20));

      // Drop "Bravo" — its <li> should be removed from the DOM.
      await Effect.runPromise(
        itemsSignal!.set([
          { id: "a", text: "Alpha" },
          { id: "c", text: "Charlie" },
        ]),
      );
      // Let the forked removal fiber run.
      await new Promise((r) => setTimeout(r, 40));

      const afterLis = container.querySelectorAll("li");
      expect(afterLis.length).toBe(2);
      expect(Array.from(afterLis).map((li) => li.textContent)).toEqual([
        "Alpha",
        "Charlie",
      ]);
    });

    it("removes the correct node when the each is nested inside a wrapper", async () => {
      // Regression cover: the forked ControlCtx that reconcile creates has
      // to re-push its container onto the hydration walker after `create()`
      // pops it; otherwise slot renders find the wrong parent, entry.element
      // is a detached fresh node, and the SSR node stays orphaned in the DOM.
      let itemsSignal: Signal.Signal<Array<{ id: string; text: string }>>;

      const App = () =>
        Effect.gen(function* () {
          itemsSignal = yield* Signal.make([
            { id: "a", text: "Alpha" },
            { id: "b", text: "Bravo" },
          ]);
          return yield* $.section(
            { class: "wrap" },
            each(itemsSignal, {
              key: (item: { id: string; text: string }) => item.id,
              render: (item: Readable.Readable<{ id: string; text: string }>) =>
                $.p({}, $.of(Readable.map(item, (v) => v.text))),
            }),
          );
        });

      container.innerHTML = await Effect.runPromise(renderToString(App()));
      await hydrate(App(), container);
      await new Promise((r) => setTimeout(r, 20));

      await Effect.runPromise(itemsSignal!.set([{ id: "a", text: "Alpha" }]));
      await new Promise((r) => setTimeout(r, 40));

      const remaining = container.querySelectorAll("section p");
      expect(remaining.length).toBe(1);
      expect(remaining[0].textContent).toBe("Alpha");
    });
  });

  describe("animated wrapper under hydration", () => {
    it("hydrates content wrapped in `animated` alongside other siblings", async () => {
      // Regression cover: `animated` uses the same forked-ControlCtx +
      // getContainer path as `each`, but it hits the DEFAULT container
      // (no `config.container` factory). If getContainer's fix pushes on
      // top of a container that createNode already pushed but never
      // popped, the walker ends up with a residual frame after
      // finalizeContainer — siblings rendered after the `animated` block
      // then look in the wrong parent and mismatch.
      const App = () =>
        $.div(
          { class: "root" },
          animated(
            {
              animate: {
                enterFrom: "opacity-0",
                enter: "opacity-100",
              },
            },
            () => $.h1({}, "Animated title"),
          ),
          $.p({ class: "sibling" }, "A sibling"),
        );

      const html = await Effect.runPromise(renderToString(App()));
      container.innerHTML = html;

      const mismatches: string[] = [];
      await hydrate(App(), container, {
        onMismatch: (message) => mismatches.push(message),
      });
      await new Promise((r) => setTimeout(r, 20));

      // The sibling must hydrate against the actual <p>, not fall through
      // to onMismatch because the walker was in the wrong parent.
      expect(mismatches).toEqual([]);
      expect(container.querySelector(".sibling")?.textContent).toBe(
        "A sibling",
      );
      expect(container.querySelector("h1")?.textContent).toBe("Animated title");
    });

    it("applies enterFrom on remount after hydration (route re-navigation)", async () => {
      // The reported bug: hydrate a page, toggle away, toggle back,
      // and the client-mode addSlot on the RE-mount should apply
      // enterFrom to the fresh element before the animation fiber
      // runs. Without this, the transition has no start state to
      // move away from — `enterTo` sets the property to a value it
      // already has, no transitionend fires, and every animation
      // stalls to the timeout. The `when` here stands in for the
      // Outlet reconcile on a route change.
      let visibleSignal: Signal.Signal<boolean>;
      const snapshots: string[] = [];

      const App = () =>
        Effect.gen(function* () {
          visibleSignal = yield* Signal.make(true);
          return yield* when(visibleSignal, {
            onTrue: () =>
              animated(
                {
                  animate: {
                    enterFrom: "opacity-0",
                    enterTo: "opacity-100",
                    onBeforeEnter: (el) =>
                      Effect.tap(el, (e) =>
                        Effect.sync(() => {
                          snapshots.push(e.className);
                        }),
                      ),
                    timeout: 20,
                  },
                  intro: true,
                },
                () => $.span({ class: "target" }, $.of("Hi")),
              ),
            onFalse: () => $.div({ class: "gone" }, $.of("gone")),
          });
        });

      container.innerHTML = await Effect.runPromise(renderToString(App()));
      await hydrate(App(), container);
      // Hydration path with intro: true re-runs enter — first snapshot.
      await new Promise((r) => setTimeout(r, 30));
      expect(snapshots.length).toBe(1);
      expect(snapshots[0]).toContain("opacity-0");

      // Toggle away (unmount) and back (re-mount via client path).
      await Effect.runPromise(visibleSignal!.set(false));
      await new Promise((r) => setTimeout(r, 10));
      await Effect.runPromise(visibleSignal!.set(true));
      await new Promise((r) => setTimeout(r, 30));

      // Second snapshot must also see enterFrom applied.
      expect(snapshots.length).toBe(2);
      expect(snapshots[1]).toContain("opacity-0");
    });

    it("matches the reported portfolio shape: no-attrs wrapper div with image child + group", async () => {
      // Faithful mirror of jonlaing-portfolio/src/components/Headline.ts's
      // first `animated` block: the render returns `$.div($.img(...))`
      // with no attrs on the wrapper. Verifies that enterFrom lands on
      // the outer wrapper div on both the initial hydration mount AND
      // the client re-mount that follows a route change.
      let visibleSignal: Signal.Signal<boolean>;
      const snapshots: string[] = [];

      const App = () =>
        Effect.gen(function* () {
          visibleSignal = yield* Signal.make(true);
          const [g0] = yield* Animation.sequence(1);
          return yield* when(visibleSignal, {
            onTrue: () =>
              animated(
                {
                  animate: {
                    enterFrom: "opacity-0 -rotate-45 -translate-y-[100px]",
                    enterTo:
                      "translate-y-0 -rotate-5 transition-all duration-500",
                    group: g0,
                    onBeforeEnter: (el) =>
                      Effect.tap(el, (e) =>
                        Effect.sync(() => {
                          snapshots.push(e.className);
                        }),
                      ),
                    timeout: 20,
                  },
                  intro: true,
                },
                () =>
                  $.div(
                    $.img({
                      src: "/portrait.jpg",
                      alt: "portrait",
                      class: "portrait-base",
                    }),
                  ),
              ),
            onFalse: () => $.div({ class: "gone" }, $.of("gone")),
          });
        });

      container.innerHTML = await Effect.runPromise(renderToString(App()));
      await hydrate(App(), container);
      // 100ms rather than 30ms (the shape used by the sibling tests):
      // this test's animation is group-coordinated (`group: g0` +
      // Animation.sequence(1)), which schedules onBeforeEnter through
      // extra fiber steps. 30ms was passing locally but not under CI
      // load; 100ms leaves ~3x headroom over what onBeforeEnter has
      // needed in observed runs.
      await new Promise((r) => setTimeout(r, 100));
      expect(snapshots.length).toBe(1);
      expect(snapshots[0]).toContain("opacity-0");
      expect(snapshots[0]).toContain("-rotate-45");
      expect(snapshots[0]).toContain("-translate-y-[100px]");

      // Toggle away and back — the route-navigation shape.
      await Effect.runPromise(visibleSignal!.set(false));
      await new Promise((r) => setTimeout(r, 20));
      await Effect.runPromise(visibleSignal!.set(true));
      await new Promise((r) => setTimeout(r, 100));

      expect(snapshots.length).toBe(2);
      expect(snapshots[1]).toContain("opacity-0");
      expect(snapshots[1]).toContain("-rotate-45");
      expect(snapshots[1]).toContain("-translate-y-[100px]");
    });
  });

  describe("options.layers lifetime", () => {
    // Regression: `Effect.provide(element, scopedLayer)` internally does
    // `scopedWith(scope => ...)`, which scopes the layer to the effect's
    // lifetime — since element functions return synchronously after
    // building the DOM, the layer's finalizers used to fire immediately
    // after hydrate. That tore down Navigation's popstate listener, the
    // SubscriptionRef PubSub, and any other scoped resource before the
    // user could interact. Hydrate must build options.layers in its OUTER
    // program scope (kept alive by Effect.never) so finalizers only run
    // on page unload.
    it("does not run scoped-layer finalizers on the initial render", async () => {
      class Marker extends Context.Tag("test/Marker")<
        Marker,
        { readonly value: string }
      >() {}

      const finalizer = vi.fn();
      const markerLayer = Layer.scoped(
        Marker,
        Effect.gen(function* () {
          yield* Effect.addFinalizer(() => Effect.sync(() => finalizer()));
          return { value: "alive" };
        }),
      );

      // Element that reads the service — proves hydration actually built
      // the layer (rather than the scoped layer just being unused).
      const element = Effect.gen(function* () {
        const marker = yield* Marker;
        return yield* $.div({ class: "marker" }, $.of(marker.value));
      });

      // Pre-populate matching SSR HTML so hydration doesn't warn.
      container.innerHTML = `<div class="marker">alive</div>`;

      await hydrate(element, container, { layers: markerLayer });
      await new Promise((r) => setTimeout(r, 10));

      expect(container.querySelector(".marker")?.textContent).toBe("alive");
      // The scope is kept alive by Effect.never inside hydrate — the
      // finalizer must NOT have fired yet. Before the fix it fired
      // synchronously right after the element function returned.
      expect(finalizer).not.toHaveBeenCalled();
    });
  });
});
