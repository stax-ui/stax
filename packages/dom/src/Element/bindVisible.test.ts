import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Signal } from "@stax-ui/core";

import { DOMRendererLive } from "../Render/DOMRenderer.js";
import { renderToString } from "../Render/server/index.js";
import { bindVisible } from "./bindVisible.js";
import { $ } from "./DOMElements.js";

// jsdom doesn't resolve CSS transitions through computed style, so stub
// `getComputedStyle` to make `hasActiveAnimations` report active and
// park the animation wait where interrupts and timings can catch it.
const originalGCS = window.getComputedStyle;
const stubComputedStyle = () => {
  window.getComputedStyle = (() => ({
    transitionProperty: "opacity",
    transitionDuration: "1s",
    animationName: "none",
    animationDuration: "",
    animationIterationCount: "",
  })) as unknown as typeof window.getComputedStyle;
};
const restoreComputedStyle = () => {
  window.getComputedStyle = originalGCS;
};

describe("Element.bindVisible", () => {
  describe("initial render", () => {
    it("renders without hidden when initial is true", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const open = yield* Signal.make(true);
            const el = yield* $.div({}, "hello").pipe(bindVisible(open));
            return {
              hidden: el.hasAttribute("hidden"),
              display: el.style.getPropertyValue("display"),
            };
          }).pipe(Effect.provide(DOMRendererLive)),
        ),
      );
      expect(result.hidden).toBe(false);
      expect(result.display).toBe("");
    });

    it("sets hidden and inline display when initial is false", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const open = yield* Signal.make(false);
            const el = yield* $.div({}, "hello").pipe(bindVisible(open));
            return {
              hidden: el.hasAttribute("hidden"),
              hiddenValue: el.getAttribute("hidden"),
              display: el.style.getPropertyValue("display"),
              priority: el.style.getPropertyPriority("display"),
            };
          }).pipe(Effect.provide(DOMRendererLive)),
        ),
      );
      expect(result.hidden).toBe(true);
      expect(result.hiddenValue).toBe("");
      expect(result.display).toBe("none");
      expect(result.priority).toBe("important");
    });

    it("uses hiddenValue 'until-found' when configured", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const open = yield* Signal.make(false);
            const el = yield* $.div({}, "hello").pipe(
              bindVisible(open, { hiddenValue: "until-found" }),
            );
            return el.getAttribute("hidden");
          }).pipe(Effect.provide(DOMRendererLive)),
        ),
      );
      expect(result).toBe("until-found");
    });

    it("skips inline display when manageDisplay is false", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const open = yield* Signal.make(false);
            const el = yield* $.div({}, "hello").pipe(
              bindVisible(open, { manageDisplay: false }),
            );
            return {
              hidden: el.hasAttribute("hidden"),
              display: el.style.getPropertyValue("display"),
            };
          }).pipe(Effect.provide(DOMRendererLive)),
        ),
      );
      expect(result.hidden).toBe(true);
      expect(result.display).toBe("");
    });
  });

  describe("SSR", () => {
    it("renders hidden attribute and inline display when initial is false", async () => {
      const html = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const open = yield* Signal.make(false);
            return yield* renderToString(
              $.div({}, "hello").pipe(bindVisible(open)),
            );
          }),
        ),
      );
      expect(html).toContain("hidden");
      expect(html).toContain("display: none");
    });

    it("renders no hidden attribute when initial is true", async () => {
      const html = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const open = yield* Signal.make(true);
            return yield* renderToString(
              $.div({}, "hello").pipe(bindVisible(open)),
            );
          }),
        ),
      );
      expect(html).not.toContain("hidden");
      expect(html).not.toContain("display: none");
    });

    it("renders until-found as the hidden value", async () => {
      const html = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const open = yield* Signal.make(false);
            return yield* renderToString(
              $.div({}, "hello").pipe(
                bindVisible(open, { hiddenValue: "until-found" }),
              ),
            );
          }),
        ),
      );
      expect(html).toContain('hidden="until-found"');
    });
  });

  describe("reactive toggling", () => {
    beforeEach(stubComputedStyle);
    afterEach(restoreComputedStyle);

    it("toggles hidden on true->false->true round trip", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const open = yield* Signal.make(true);
            const el = yield* $.div({}, "hello").pipe(bindVisible(open));
            document.body.appendChild(el);
            // Let the forked subscription attach before firing the
            // first change.
            yield* Effect.sleep("10 millis");

            yield* open.set(false);
            yield* Effect.sleep("20 millis");
            const afterHide = el.hasAttribute("hidden");

            yield* open.set(true);
            yield* Effect.sleep("20 millis");
            const afterShow = el.hasAttribute("hidden");

            document.body.removeChild(el);
            return { afterHide, afterShow };
          }).pipe(Effect.provide(DOMRendererLive)),
        ),
      );
      expect(result.afterHide).toBe(true);
      expect(result.afterShow).toBe(false);
    });

    it("adds hidden only after the exit animation completes", async () => {
      // With a configured exit, bindVisible must leave the element
      // visible for the duration of the animation and only toggle
      // `hidden` once the exit has settled.
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const open = yield* Signal.make(true);
            const el = yield* $.div({}, "hi").pipe(
              bindVisible(open, {
                animate: {
                  exit: "exiting",
                  exitTo: "opacity-0",
                  timeout: 100,
                },
              }),
            );
            document.body.appendChild(el);
            yield* Effect.sleep("10 millis");

            yield* open.set(false);
            // Mid-exit: the animation is parked waiting for a
            // transitionend that will never fire in jsdom until timeout.
            // `hidden` must NOT be set yet.
            yield* Effect.sleep("30 millis");
            expect(el.hasAttribute("hidden")).toBe(false);

            // After the timeout fires (100ms), the exit finishes and
            // `hidden` lands.
            yield* Effect.sleep("150 millis");
            expect(el.hasAttribute("hidden")).toBe(true);

            document.body.removeChild(el);
          }).pipe(Effect.provide(DOMRendererLive)),
        ),
      );
    });

    it("ignores duplicate emissions via dedupe", async () => {
      // Flipping to the same value shouldn't restart the animation.
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const open = yield* Signal.make(true);
            const el = yield* $.div({}, "hi").pipe(bindVisible(open));
            document.body.appendChild(el);
            yield* Effect.sleep("10 millis");

            yield* open.set(true); // no-op
            yield* open.set(true); // no-op
            yield* Effect.sleep("20 millis");

            const result = el.hasAttribute("hidden");
            document.body.removeChild(el);
            return result;
          }).pipe(Effect.provide(DOMRendererLive)),
        ),
      );
      expect(result).toBe(false);
    });
  });

  describe("hidden='until-found' browser reveal", () => {
    // When the browser's find-in-page matches content inside an
    // `until-found` element it removes `hidden` and fires `beforematch`
    // on the element. The consumer flips `visible` to `true` in that
    // handler; bindVisible then sees `visible: true` with `hidden`
    // already gone and must skip the enter animation (the browser has
    // already revealed and scrolled to the content).
    beforeEach(stubComputedStyle);
    afterEach(restoreComputedStyle);

    it("skips the enter animation when hidden was already removed", async () => {
      let onEnterCalls = 0;
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const open = yield* Signal.make(false);
            const el = yield* $.div({}, "hi").pipe(
              bindVisible(open, {
                hiddenValue: "until-found",
                animate: {
                  enterFrom: "opacity-0",
                  enter: "transition-opacity",
                  enterTo: "opacity-100",
                  onEnter: () =>
                    Effect.sync(() => {
                      onEnterCalls++;
                    }),
                  timeout: 100,
                },
              }),
            );
            document.body.appendChild(el);
            yield* Effect.sleep("10 millis");
            expect(el.getAttribute("hidden")).toBe("until-found");

            // Simulate the browser handling beforematch: remove hidden
            // first, then the consumer flips visible to true.
            el.removeAttribute("hidden");
            yield* open.set(true);
            yield* Effect.sleep("20 millis");

            // No enter-animation class churn (no opacity-100 landed),
            // but onEnter still fired for lifecycle parity.
            expect(el.classList.contains("opacity-100")).toBe(false);
            expect(el.classList.contains("transition-opacity")).toBe(false);
            expect(onEnterCalls).toBe(1);
            // Our inline display:none is also cleared (it was there
            // from the initial hidden state).
            expect(el.style.getPropertyValue("display")).toBe("");

            document.body.removeChild(el);
          }).pipe(Effect.provide(DOMRendererLive)),
        ),
      );
    });
  });
});
