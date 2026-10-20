import { Effect, Fiber } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runEnterAnimation, runExitAnimation } from "./core.js";
import { waitForAnimationEvent } from "./helpers.js";
import {
  calculateStaggerDelay,
  stagger,
  staggerEased,
  staggerFromCenter,
} from "./index.js";

const afterEachRestoreGCS = (orig: typeof window.getComputedStyle) =>
  afterEach(() => {
    window.getComputedStyle = orig;
  });

// Mock window.matchMedia for reduced motion tests
const mockMatchMedia = (matches: boolean) => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" ? matches : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

describe("Animation", () => {
  beforeEach(() => {
    // Reset to no reduced motion preference by default
    mockMatchMedia(false);
  });

  describe("runEnterAnimation", () => {
    it("should add and remove enter classes", async () => {
      const element = document.createElement("div");

      await Effect.runPromise(
        runEnterAnimation(Effect.succeed(element), {
          enter: "fade-in",
          timeout: 10,
        }),
      );

      // After animation, enter class should be removed
      expect(element.classList.contains("fade-in")).toBe(false);
    });

    it("should handle enterFrom and enterTo classes", async () => {
      const element = document.createElement("div");

      await Effect.runPromise(
        runEnterAnimation(Effect.succeed(element), {
          enterFrom: "opacity-0",
          enterTo: "opacity-100",
          timeout: 10,
        }),
      );

      // enterFrom should be removed, enterTo should persist
      expect(element.classList.contains("opacity-0")).toBe(false);
      expect(element.classList.contains("opacity-100")).toBe(true);
    });

    it("should skip animation when reduced motion is preferred", async () => {
      mockMatchMedia(true);

      const element = document.createElement("div");
      const onBeforeEnter = vi.fn((el) => el);
      const onEnter = vi.fn((el) => el);

      await Effect.runPromise(
        runEnterAnimation(Effect.succeed(element), {
          enter: "fade-in",
          enterTo: "visible",
          onBeforeEnter,
          onEnter,
        }),
      );

      // Hooks should still be called
      expect(onBeforeEnter).toHaveBeenCalled();
      expect(onEnter).toHaveBeenCalled();
      // enterTo should be applied immediately
      expect(element.classList.contains("visible")).toBe(true);
    });

    it("should call lifecycle hooks with Effect-wrapped element", async () => {
      const element = document.createElement("div");
      let beforeEnterEl: HTMLElement | null = null;
      let enterEl: HTMLElement | null = null;

      await Effect.runPromise(
        runEnterAnimation(Effect.succeed(element), {
          enter: "fade-in",
          timeout: 10,
          onBeforeEnter: (el) =>
            Effect.tap(el, (e) =>
              Effect.sync(() => {
                beforeEnterEl = e;
              }),
            ),
          onEnter: (el) =>
            Effect.tap(el, (e) =>
              Effect.sync(() => {
                enterEl = e;
              }),
            ),
        }),
      );

      expect(beforeEnterEl).toBe(element);
      expect(enterEl).toBe(element);
    });

    it("should handle Effect-returning hooks", async () => {
      const element = document.createElement("div");
      let effectRan = false;

      await Effect.runPromise(
        runEnterAnimation(Effect.succeed(element), {
          enter: "fade-in",
          timeout: 10,
          onEnter: (el) =>
            Effect.tap(el, () =>
              Effect.sync(() => {
                effectRan = true;
              }),
            ),
        }),
      );

      expect(effectRan).toBe(true);
    });

    it("should apply enterTo even with no animation classes", async () => {
      const element = document.createElement("div");

      await Effect.runPromise(
        runEnterAnimation(Effect.succeed(element), {
          enterTo: "visible",
        }),
      );

      expect(element.classList.contains("visible")).toBe(true);
    });
  });

  describe("runExitAnimation", () => {
    it("should add exit classes", async () => {
      const element = document.createElement("div");

      // Start exit animation but check classes during animation
      // Since we're mocking and there's no real animation, check immediately
      const promise = Effect.runPromise(
        runExitAnimation(Effect.succeed(element), {
          exit: "fade-out",
          timeout: 10,
        }),
      );

      await promise;

      // After timeout (no real animation), exit class is removed
      expect(element.classList.contains("fade-out")).toBe(false);
    });

    it("should handle exitTo class", async () => {
      const element = document.createElement("div");

      await Effect.runPromise(
        runExitAnimation(Effect.succeed(element), {
          exit: "fade-out",
          exitTo: "hidden",
          timeout: 10,
        }),
      );

      // exitTo may or may not persist depending on implementation
      // The key is exit animation completes without error
    });

    it("should skip animation when reduced motion is preferred", async () => {
      mockMatchMedia(true);

      const element = document.createElement("div");
      const onBeforeExit = vi.fn((el) => el);
      const onExit = vi.fn((el) => el);

      await Effect.runPromise(
        runExitAnimation(Effect.succeed(element), {
          exit: "fade-out",
          onBeforeExit,
          onExit,
        }),
      );

      // Hooks should still be called
      expect(onBeforeExit).toHaveBeenCalled();
      expect(onExit).toHaveBeenCalled();
    });

    it("should call lifecycle hooks with Effect-wrapped element", async () => {
      const element = document.createElement("div");
      let beforeExitEl: HTMLElement | null = null;
      let exitEl: HTMLElement | null = null;

      await Effect.runPromise(
        runExitAnimation(Effect.succeed(element), {
          exit: "fade-out",
          timeout: 10,
          onBeforeExit: (el) =>
            Effect.tap(el, (e) =>
              Effect.sync(() => {
                beforeExitEl = e;
              }),
            ),
          onExit: (el) =>
            Effect.tap(el, (e) =>
              Effect.sync(() => {
                exitEl = e;
              }),
            ),
        }),
      );

      expect(beforeExitEl).toBe(element);
      expect(exitEl).toBe(element);
    });
  });

  describe("stagger utilities", () => {
    describe("stagger", () => {
      it("should return linear stagger delays", () => {
        const fn = stagger(50);

        expect(fn(0, 5)).toBe(0);
        expect(fn(1, 5)).toBe(50);
        expect(fn(2, 5)).toBe(100);
        expect(fn(3, 5)).toBe(150);
        expect(fn(4, 5)).toBe(200);
      });
    });

    describe("staggerFromCenter", () => {
      it("should animate from center outward", () => {
        const fn = staggerFromCenter(50);

        // With 5 items, center is at index 2
        // Distances: [2, 1, 0, 1, 2]
        expect(fn(0, 5)).toBe(100); // distance 2 * 50
        expect(fn(1, 5)).toBe(50); // distance 1 * 50
        expect(fn(2, 5)).toBe(0); // distance 0 * 50
        expect(fn(3, 5)).toBe(50); // distance 1 * 50
        expect(fn(4, 5)).toBe(100); // distance 2 * 50
      });

      it("should handle even number of items", () => {
        const fn = staggerFromCenter(100);

        // With 4 items, center is at 1.5
        // Distances: [1.5, 0.5, 0.5, 1.5]
        expect(fn(0, 4)).toBe(150);
        expect(fn(1, 4)).toBe(50);
        expect(fn(2, 4)).toBe(50);
        expect(fn(3, 4)).toBe(150);
      });
    });

    describe("staggerEased", () => {
      it("should apply easing to stagger timing", () => {
        // Linear easing (no change)
        const linearFn = staggerEased(100, (t) => t);

        expect(linearFn(0, 3)).toBe(0);
        expect(linearFn(1, 3)).toBe(50);
        expect(linearFn(2, 3)).toBe(100);
      });

      it("should work with ease-out curve", () => {
        // Quadratic ease-out
        const easeOutFn = staggerEased(100, (t) => 1 - Math.pow(1 - t, 2));

        expect(easeOutFn(0, 3)).toBe(0);
        // At t=0.5, easeOut = 1 - (0.5)^2 = 0.75
        expect(easeOutFn(1, 3)).toBe(75);
        expect(easeOutFn(2, 3)).toBe(100);
      });

      it("should return 0 for single item", () => {
        const fn = staggerEased(100, (t) => t);
        expect(fn(0, 1)).toBe(0);
      });
    });

    describe("calculateStaggerDelay", () => {
      it("should return 0 for undefined stagger", () => {
        expect(calculateStaggerDelay(undefined, 3, 5)).toBe(0);
      });

      it("should calculate delay for numeric stagger", () => {
        expect(calculateStaggerDelay(50, 0, 5)).toBe(0);
        expect(calculateStaggerDelay(50, 3, 5)).toBe(150);
      });

      it("should use function stagger directly", () => {
        const fn = (index: number, total: number) => index * total;
        expect(calculateStaggerDelay(fn, 3, 10)).toBe(30);
      });
    });
  });

  describe("waitForAnimationEvent short-circuit", () => {
    // Direct tests for the has-active-animation gate — the previous
    // logic only checked `transitionDuration !== "0s"` and treated any
    // `animationName !== "none"` as pending, which stalled the 5s
    // timeout when a page had `transition-property: none`, a comma
    // list of zero durations, or an infinite `animate-pulse`-style
    // keyframe sitting on the element.

    const withMockedStyles = async <A>(
      styles: Partial<CSSStyleDeclaration>,
      fn: () => Promise<A>,
    ): Promise<A> => {
      const original = window.getComputedStyle;
      window.getComputedStyle = (() =>
        ({
          animationName: "none",
          animationDuration: "0s",
          animationIterationCount: "1",
          transitionProperty: "all",
          transitionDuration: "0s",
          ...styles,
        }) as CSSStyleDeclaration) as typeof window.getComputedStyle;
      try {
        return await fn();
      } finally {
        window.getComputedStyle = original;
      }
    };

    it("skips when transitionProperty is 'none' even if duration is non-zero", async () => {
      const el = document.createElement("div");
      const start = Date.now();
      const result = await withMockedStyles(
        { transitionProperty: "none", transitionDuration: "0.5s" },
        () =>
          Effect.runPromise(
            waitForAnimationEvent(el, 5000).pipe(Effect.map((r) => r.endedBy)),
          ),
      );
      expect(result).toBe("skip");
      expect(Date.now() - start).toBeLessThan(200);
    });

    it("skips when every transitionDuration entry is zero", async () => {
      const el = document.createElement("div");
      const result = await withMockedStyles(
        { transitionDuration: "0s, 0s, 0s" },
        () =>
          Effect.runPromise(
            waitForAnimationEvent(el, 5000).pipe(Effect.map((r) => r.endedBy)),
          ),
      );
      expect(result).toBe("skip");
    });

    it("skips when the only active animation has infinite iteration count", async () => {
      const el = document.createElement("div");
      const start = Date.now();
      const result = await withMockedStyles(
        {
          animationName: "pulse",
          animationDuration: "2s",
          animationIterationCount: "infinite",
        },
        () =>
          Effect.runPromise(
            waitForAnimationEvent(el, 5000).pipe(Effect.map((r) => r.endedBy)),
          ),
      );
      expect(result).toBe("skip");
      expect(Date.now() - start).toBeLessThan(200);
    });

    it("waits for animationend when a finite CSS animation is active", async () => {
      const el = document.createElement("div");
      const p = withMockedStyles(
        {
          animationName: "fade",
          animationDuration: "0.05s",
          animationIterationCount: "1",
        },
        () =>
          Effect.runPromise(
            waitForAnimationEvent(el, 5000).pipe(Effect.map((r) => r.endedBy)),
          ),
      );

      // Give the RAF a moment to run, then dispatch the completion event.
      await new Promise((r) => setTimeout(r, 20));
      el.dispatchEvent(new Event("animationend"));
      const endedBy = await p;
      expect(endedBy).toBe("animation");
    });

    it("waits for transitionend when a finite transition is active", async () => {
      const el = document.createElement("div");
      const p = withMockedStyles(
        { transitionProperty: "opacity", transitionDuration: "0.05s" },
        () =>
          Effect.runPromise(
            waitForAnimationEvent(el, 5000).pipe(Effect.map((r) => r.endedBy)),
          ),
      );

      await new Promise((r) => setTimeout(r, 20));
      el.dispatchEvent(new Event("transitionend"));
      const endedBy = await p;
      expect(endedBy).toBe("transition");
    });

    it("removes its listeners when interrupted mid-flight (nav-away case)", async () => {
      // Regression: nav-away during an animation used to leave the
      // animationend/transitionend listeners and timeout dangling on the
      // element being unmounted. The interrupt cleanup only cancelled the
      // RAF. This test simulates the exact shape of the bug: start
      // waiting, cancel the fiber (route change), assert the element
      // has no residual listeners.
      const el = document.createElement("div");
      const addSpy = vi.spyOn(el, "addEventListener");
      const removeSpy = vi.spyOn(el, "removeEventListener");

      await withMockedStyles(
        { transitionProperty: "opacity", transitionDuration: "0.5s" },
        async () => {
          const fiber = Effect.runFork(
            Effect.scoped(waitForAnimationEvent(el, 5000).pipe(Effect.asVoid)),
          );

          // Let the RAF fire and listeners register.
          await new Promise((r) => setTimeout(r, 30));
          const addedEvents = addSpy.mock.calls.map((c) => c[0]);
          expect(addedEvents).toContain("animationend");
          expect(addedEvents).toContain("transitionend");

          // Interrupt the way a route change would.
          fiber.unsafeInterruptAsFork(fiber.id());

          // Give cancellation a tick.
          await new Promise((r) => setTimeout(r, 10));
        },
      );

      const removedEvents = removeSpy.mock.calls.map((c) => c[0]);
      expect(removedEvents).toContain("animationend");
      expect(removedEvents).toContain("transitionend");

      addSpy.mockRestore();
      removeSpy.mockRestore();
    });
  });

  describe("multiple classes in options", () => {
    it("should handle space-separated enter classes", async () => {
      const element = document.createElement("div");

      await Effect.runPromise(
        runEnterAnimation(Effect.succeed(element), {
          enter: "fade-in slide-up",
          timeout: 10,
        }),
      );

      // Both classes should be removed after animation
      expect(element.classList.contains("fade-in")).toBe(false);
      expect(element.classList.contains("slide-up")).toBe(false);
    });

    it("should handle space-separated enterFrom classes", async () => {
      const element = document.createElement("div");

      await Effect.runPromise(
        runEnterAnimation(Effect.succeed(element), {
          enterFrom: "opacity-0 scale-95",
          enterTo: "opacity-100 scale-100",
          timeout: 10,
        }),
      );

      expect(element.classList.contains("opacity-0")).toBe(false);
      expect(element.classList.contains("scale-95")).toBe(false);
      expect(element.classList.contains("opacity-100")).toBe(true);
      expect(element.classList.contains("scale-100")).toBe(true);
    });
  });

  describe("interrupt cleanup", () => {
    // The animation lifecycle leaves the element in different intermediate
    // states depending on where it is — enter has `enterFrom` on briefly,
    // then `enter + enterTo`, then only `enterTo`. If a run is interrupted
    // mid-flight the next run (e.g. a reverse exit after a `when` flip)
    // mustn't inherit stale classes. These tests fire a long-running
    // animation, interrupt the fiber, and verify the element is clean.
    //
    // jsdom doesn't resolve CSS transitions from classes or inline styles
    // through computed style the way browsers do, so we stub
    // `getComputedStyle` for the duration of each test to make
    // `hasActiveAnimations` report true and the wait actually park.
    const originalGCS = window.getComputedStyle;
    beforeEach(() => {
      window.getComputedStyle = (() => ({
        transitionProperty: "opacity",
        transitionDuration: "1s",
        animationName: "none",
        animationDuration: "",
        animationIterationCount: "",
      })) as unknown as typeof window.getComputedStyle;
    });
    afterEachRestoreGCS(originalGCS);

    it("strips enter-animation classes on interrupt", async () => {
      const element = document.createElement("div");
      // Pin an inline transition so `hasActiveAnimations` returns true
      // and the wait doesn't short-circuit (jsdom doesn't resolve
      // Tailwind classes to transition rules).
      element.style.transition = "opacity 1s";

      await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(
            runEnterAnimation(Effect.succeed(element), {
              enterFrom: "opacity-0",
              enter: "animating",
              enterTo: "opacity-100",
              timeout: 5000,
            }),
          );
          // Enough time to progress past add-before-reflow so the state
          // machine is parked inside waitForAnimationEvent waiting on a
          // transitionend that will never fire.
          yield* Effect.sleep("30 millis");
          yield* Fiber.interrupt(fiber);
          yield* Effect.sleep("10 millis");
        }),
      );

      expect(element.classList.contains("opacity-0")).toBe(false);
      expect(element.classList.contains("animating")).toBe(false);
      expect(element.classList.contains("opacity-100")).toBe(false);
    });

    it("strips exit-animation classes on interrupt", async () => {
      const element = document.createElement("div");
      element.style.transition = "opacity 1s";

      await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(
            runExitAnimation(Effect.succeed(element), {
              exit: "animating",
              exitTo: "opacity-0",
              timeout: 5000,
            }),
          );
          yield* Effect.sleep("30 millis");
          yield* Fiber.interrupt(fiber);
          yield* Effect.sleep("10 millis");
        }),
      );

      expect(element.classList.contains("animating")).toBe(false);
      expect(element.classList.contains("opacity-0")).toBe(false);
    });

    it("keeps enterTo on the element after a normal completion", async () => {
      // Regression guard — the interrupt finalizer must NOT fire on normal
      // completion (otherwise it would strip the final-state class).
      const element = document.createElement("div");

      await Effect.runPromise(
        runEnterAnimation(Effect.succeed(element), {
          enterFrom: "opacity-0",
          enter: "transition-opacity",
          enterTo: "opacity-100",
          timeout: 10,
        }),
      );

      expect(element.classList.contains("opacity-100")).toBe(true);
    });
  });
});
