import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it } from "vitest";

import { Signal } from "@stax-ui/core";

import { Boundary } from "./Boundary.js";
import { ClientControlCtx } from "./Control/ClientControlCtx.js";
import { when } from "./Control/index.js";
import { $ } from "./Element/index.js";
import { DOMRendererLive } from "./Render/DOMRenderer.js";
import { ClientSuspenseBoundaryCtx } from "./SuspenseBoundaryCtx/index.js";

// Boundary.error's reactive swap uses `matchOption` internally, so it
// requires ControlCtx. ClientSuspenseBoundaryCtx + DOMRendererLive
// cover the rest; ClientControlCtx completes the stack.
const TestLayer = Layer.provideMerge(
  Layer.mergeAll(ClientSuspenseBoundaryCtx, ClientControlCtx),
  DOMRendererLive,
);

const runTest = <A, R>(effect: Effect.Effect<A, never, R>) =>
  Effect.runPromise(
    Effect.scoped(effect).pipe(Effect.provide(TestLayer)) as Effect.Effect<
      A,
      never,
      never
    >,
  );

describe("Boundary", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  describe("error", () => {
    it("should render content when no error", async () => {
      const el = await runTest(
        Boundary.error(
          () => $.div({}, $.of("Success")),
          () => $.div({}, $.of("Error occurred")),
        ),
      );

      expect(el.textContent).toBe("Success");
    });

    it("should render fallback on error", async () => {
      interface TestError {
        readonly _tag: "TestError";
        readonly message: string;
      }

      const makeTestError = (message: string): TestError => ({
        _tag: "TestError",
        message,
      });

      const el = await runTest(
        Boundary.error(
          () =>
            Effect.gen(function* () {
              yield* Effect.fail(makeTestError("oops"));
              return yield* $.div({}, $.of("Never reached"));
            }),
          (error) => $.div({}, $.of(`Caught: ${error.message}`)),
        ),
      );

      expect(el.textContent).toBe("Caught: oops");
    });

    it("swaps to fallback on subscription-path failure and swaps back on recovery", async () => {
      // Reactive boundary semantics: a `when` whose onTrue render
      // throws triggers the fallback the moment the condition flips
      // to true. Flipping back to false (which successfully renders
      // onFalse) auto-swaps back to the child since reconcile's
      // safeSync clears the signal on success.
      await runTest(
        Effect.gen(function* () {
          const broken = yield* Signal.make(false);
          const el = yield* Boundary.error(
            () =>
              $.div(
                {},
                when(broken, {
                  onTrue: () => Effect.die(new Error("subscription boom")),
                  onFalse: () => $.div({ class: "ok" }, "ok"),
                }),
              ),
            () => $.div({ class: "boom" }, "fallback"),
            { catchDefects: true },
          );
          document.body.appendChild(el);

          yield* Effect.sleep("10 millis");
          expect(document.querySelector(".ok")?.textContent).toBe("ok");

          // Flip → subscription re-syncs → onTrue renders → defect
          // reported → boundary swaps to fallback.
          yield* broken.set(true);
          yield* Effect.sleep("20 millis");
          expect(document.querySelector(".boom")?.textContent).toBe("fallback");

          // Flip back → onFalse renders → safeSync's `clear` fires →
          // boundary auto-swaps back to the child.
          yield* broken.set(false);
          yield* Effect.sleep("20 millis");
          expect(document.querySelector(".ok")?.textContent).toBe("ok");
          expect(document.querySelector(".boom")).toBeNull();
        }),
      );
    });
  });

  describe("suspense", () => {
    it("should show fallback then content", async () => {
      const el = await runTest(
        Effect.gen(function* () {
          // Create a parent container to hold the slot
          const parent = yield* $.div({});
          document.body.appendChild(parent);

          const marker = yield* Boundary.suspense({
            render: () =>
              Effect.gen(function* () {
                yield* Effect.sleep(20);
                return yield* $.div({}, $.of("Loaded!"));
              }),
            fallback: () => $.div({}, $.of("Loading...")),
          });

          // Append the marker to the parent
          parent.appendChild(marker);

          // Should show fallback initially (content is after the marker)
          expect(parent.textContent).toBe("Loading...");

          // Wait for async content
          yield* Effect.sleep(50);

          // Should now show loaded content
          expect(parent.textContent).toBe("Loaded!");

          return marker;
        }),
      );

      expect(el).toBeTruthy();
    });

    it("should handle nested suspense boundaries correctly", async () => {
      await runTest(
        Effect.gen(function* () {
          // Create a parent container to hold the slots
          const parent = yield* $.div({});
          document.body.appendChild(parent);

          const outerMarker = yield* Boundary.suspense({
            render: () =>
              Effect.gen(function* () {
                yield* Effect.sleep(30);

                // Nested suspense inside the outer render
                const innerMarker = yield* Boundary.suspense({
                  render: () =>
                    Effect.gen(function* () {
                      yield* Effect.sleep(100); // Longer delay for inner
                      return yield* $.span({}, $.of("Inner Content"));
                    }),
                  fallback: () => $.span({}, $.of("Inner Loading...")),
                });

                // Return a div containing the inner suspense
                const container = yield* $.div({}, $.of("Outer: "));
                container.appendChild(innerMarker);
                return container;
              }),
            fallback: () => $.div({}, $.of("Outer Loading...")),
          });

          parent.appendChild(outerMarker);

          // Initially should show outer fallback
          expect(parent.textContent).toBe("Outer Loading...");

          // Wait for outer to resolve (inner starts loading)
          yield* Effect.sleep(50);

          // Outer resolved, inner should show its fallback
          expect(parent.textContent).toBe("Outer: Inner Loading...");

          // Wait for inner to resolve
          yield* Effect.sleep(150);

          // Both should be resolved now
          expect(parent.textContent).toBe("Outer: Inner Content");
        }),
      );
    });

    it("should handle sibling suspense boundaries independently", async () => {
      await runTest(
        Effect.gen(function* () {
          const parent = yield* $.div({});
          document.body.appendChild(parent);

          // Create two sibling suspense boundaries with different timings
          const marker1 = yield* Boundary.suspense({
            render: () =>
              Effect.gen(function* () {
                yield* Effect.sleep(30);
                return yield* $.span({}, $.of("[First]"));
              }),
            fallback: () => $.span({}, $.of("[Loading1]")),
          });

          const marker2 = yield* Boundary.suspense({
            render: () =>
              Effect.gen(function* () {
                yield* Effect.sleep(60);
                return yield* $.span({}, $.of("[Second]"));
              }),
            fallback: () => $.span({}, $.of("[Loading2]")),
          });

          parent.appendChild(marker1);
          parent.appendChild(marker2);

          // Both should show fallbacks initially
          expect(parent.textContent).toBe("[Loading1][Loading2]");

          // Wait for first to resolve
          yield* Effect.sleep(50);
          expect(parent.textContent).toBe("[First][Loading2]");

          // Wait for second to resolve
          yield* Effect.sleep(50);
          expect(parent.textContent).toBe("[First][Second]");
        }),
      );
    });
  });
});
