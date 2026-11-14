import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Readable, Signal } from "@stax-ui/core";

import { $ } from "../Element/index.js";
import { DOMRendererLive } from "../Render/DOMRenderer.js";
import {
  calculateItemOffset,
  calculateScrollToPosition,
  calculateTotalHeight,
  calculateVisibleRange,
  parseHeight,
  rangesEqual,
} from "./helpers.js";
import { ClientVirtualListCtx, virtualEach, VirtualListRef } from "./index.js";

const runTest = <A, R>(effect: Effect.Effect<A, never, R>) =>
  Effect.runPromise(
    Effect.scoped(effect).pipe(
      Effect.provide(ClientVirtualListCtx),
      Effect.provide(DOMRendererLive),
    ) as Effect.Effect<A, never, never>,
  );

// Mock ResizeObserver for jsdom
class MockResizeObserver {
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe() {
    // Simulate initial observation with a default size
    this.callback(
      [
        {
          contentRect: { height: 300, width: 400 } as DOMRectReadOnly,
          target: document.createElement("div"),
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        },
      ],
      this,
    );
  }
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", MockResizeObserver);

interface TestItem {
  id: string;
  text: string;
}

const makeItems = (count: number): TestItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `item-${i}`,
    text: `Item ${i}`,
  }));

describe("VirtualList", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  describe("helpers", () => {
    describe("calculateVisibleRange", () => {
      it("should calculate correct range for items at top", () => {
        const range = calculateVisibleRange(0, 300, 50, 100, 3);
        expect(range.start).toBe(0);
        expect(range.end).toBe(9); // 300/50 = 6 visible + 3 overscan = 9
      });

      it("should calculate correct range with scroll offset", () => {
        const range = calculateVisibleRange(200, 300, 50, 100, 3);
        // scrollTop=200, so startIndex = 200/50 = 4
        // 300/50 = 6 visible items, so endIndex = 4 + 6 = 10
        // with overscan: start = 4-3 = 1, end = 10+3 = 13
        expect(range.start).toBe(1);
        expect(range.end).toBe(13);
      });

      it("should handle empty list", () => {
        const range = calculateVisibleRange(0, 300, 50, 0, 3);
        expect(range.start).toBe(0);
        expect(range.end).toBe(-1);
      });

      it("should clamp to list bounds", () => {
        const range = calculateVisibleRange(4500, 300, 50, 100, 3);
        // Near end of list
        expect(range.start).toBeGreaterThanOrEqual(0);
        expect(range.end).toBeLessThanOrEqual(99);
      });
    });

    describe("calculateItemOffset", () => {
      it("should calculate correct offset", () => {
        expect(calculateItemOffset(0, 50)).toBe(0);
        expect(calculateItemOffset(5, 50)).toBe(250);
        expect(calculateItemOffset(10, 40)).toBe(400);
      });
    });

    describe("calculateTotalHeight", () => {
      it("should calculate correct total height", () => {
        expect(calculateTotalHeight(100, 50)).toBe(5000);
        expect(calculateTotalHeight(0, 50)).toBe(0);
      });
    });

    describe("calculateScrollToPosition", () => {
      it("should not scroll if item is already visible", () => {
        // Item at index 5 with height 50 is at position 250-300
        // Viewport at scroll 200 with height 300 shows 200-500
        // So item should be visible
        const newPos = calculateScrollToPosition(5, 50, 300, 200);
        expect(newPos).toBe(200); // No change
      });

      it("should scroll down if item is below viewport", () => {
        // Item at index 15 is at position 750-800
        // Viewport at scroll 0 with height 300 shows 0-300
        // Need to scroll so item bottom (800) is at viewport bottom
        const newPos = calculateScrollToPosition(15, 50, 300, 0);
        expect(newPos).toBe(500); // 800 - 300 = 500
      });

      it("should scroll up if item is above viewport", () => {
        // Item at index 2 is at position 100-150
        // Viewport at scroll 500 with height 300 shows 500-800
        // Need to scroll so item top (100) is at viewport top
        const newPos = calculateScrollToPosition(2, 50, 300, 500);
        expect(newPos).toBe(100);
      });
    });

    describe("parseHeight", () => {
      it("should return 100% for undefined", () => {
        expect(parseHeight(undefined)).toBe("100%");
      });

      it("should add px suffix for numbers", () => {
        expect(parseHeight(400)).toBe("400px");
      });

      it("should pass through strings", () => {
        expect(parseHeight("50vh")).toBe("50vh");
        expect(parseHeight("100%")).toBe("100%");
      });
    });

    describe("rangesEqual", () => {
      it("should return true for equal ranges", () => {
        expect(rangesEqual({ start: 0, end: 10 }, { start: 0, end: 10 })).toBe(
          true,
        );
      });

      it("should return false for different ranges", () => {
        expect(rangesEqual({ start: 0, end: 10 }, { start: 1, end: 10 })).toBe(
          false,
        );
        expect(rangesEqual({ start: 0, end: 10 }, { start: 0, end: 11 })).toBe(
          false,
        );
      });
    });
  });

  describe("virtualEach", () => {
    it("should create a scrollable container", async () => {
      await runTest(
        Effect.gen(function* () {
          const items = yield* Signal.make(makeItems(100));
          const el = yield* virtualEach(items, {
            key: (item) => item.id,
            itemHeight: 50,
            height: 300,
            render: (item) => $.div($.of(Readable.map(item, (i) => i.text))),
          });

          expect(el.style.overflow).toBe("auto");
          expect(el.style.height).toBe("300px");
        }),
      );
    });

    it("should render inner container with full height", async () => {
      await runTest(
        Effect.gen(function* () {
          const items = yield* Signal.make(makeItems(100));
          const el = yield* virtualEach(items, {
            key: (item) => item.id,
            itemHeight: 50,
            height: 300,
            render: (item) => $.div($.of(Readable.map(item, (i) => i.text))),
          });

          const inner = el.firstElementChild as HTMLElement;
          expect(inner.style.height).toBe("5000px"); // 100 * 50
        }),
      );
    });

    // Skip: jsdom doesn't have real layout, so this would need a browser test
    it.skip("should only render visible items initially", async () => {
      await runTest(
        Effect.gen(function* () {
          const items = yield* Signal.make(makeItems(1000));
          const el = yield* virtualEach(items, {
            key: (item) => item.id,
            itemHeight: 50,
            height: 300,
            overscan: 3,
            render: (item) => $.div($.of(Readable.map(item, (i) => i.text))),
          });

          // Should only render visible items + overscan
          // 300/50 = 6 visible + 3 overscan at bottom = 9-10 items max
          const inner = el.firstElementChild as HTMLElement;
          expect(inner.children.length).toBeLessThanOrEqual(15);
        }),
      );
    });

    // Skip: jsdom doesn't have real layout so clientHeight is always 0,
    // which means no items get rendered initially. This would work in a real browser.
    it.skip("should position items absolutely", async () => {
      await runTest(
        Effect.gen(function* () {
          const items = yield* Signal.make(makeItems(100));
          const el = yield* virtualEach(items, {
            key: (item) => item.id,
            itemHeight: 50,
            height: 300,
            render: (item) => $.div($.of(Readable.map(item, (i) => i.text))),
          });

          const inner = el.firstElementChild as HTMLElement;
          expect(inner.children.length).toBeGreaterThan(0);
          const firstItem = inner.firstElementChild as HTMLElement;
          expect(firstItem.style.position).toBe("absolute");
          expect(firstItem.style.top).toBe("0px");
        }),
      );
    });

    it("should throw error if no height option provided", async () => {
      const badOptions = {
        key: (item: TestItem) => item.id,
        render: (item: Readable<TestItem>) =>
          $.div($.of(Readable.map(item, (i) => i.text))),
      };

      await expect(
        runTest(
          Effect.gen(function* () {
            const items = yield* Signal.make(makeItems(10));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            yield* virtualEach(items, badOptions as any);
          }),
        ),
      ).rejects.toThrow("itemHeight or estimatedHeight");
    });
  });

  describe("VirtualListRef", () => {
    it("should create a ref that receives control interface", async () => {
      await runTest(
        Effect.gen(function* () {
          const items = yield* Signal.make(makeItems(100));
          const ref = yield* VirtualListRef.make();

          yield* virtualEach(items, {
            key: (item) => item.id,
            itemHeight: 50,
            height: 300,
            ref,
            render: (item) => $.div($.of(Readable.map(item, (i) => i.text))),
          });

          expect(ref.current).not.toBeNull();
          expect(ref.current!.scrollTo).toBeDefined();
          expect(ref.current!.scrollToTop).toBeDefined();
          expect(ref.current!.scrollToBottom).toBeDefined();
          expect(ref.current!.visibleRange).toBeDefined();
        }),
      );
    });

    it("should provide ready effect that resolves to control", async () => {
      await runTest(
        Effect.gen(function* () {
          const items = yield* Signal.make(makeItems(100));
          const ref = yield* VirtualListRef.make();

          yield* virtualEach(items, {
            key: (item) => item.id,
            itemHeight: 50,
            height: 300,
            ref,
            render: (item) => $.div($.of(Readable.map(item, (i) => i.text))),
          });

          const control = yield* ref.ready;
          expect(control).toBe(ref.current);
        }),
      );
    });
  });
});
