import { describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { beforeEach, expect } from "vitest";

import { Readable, Signal } from "@stax-ui/core";

import { Animation } from "../Animation/index.js";
import { collect } from "../Collect.js";
import { $ } from "../Element/index.js";
import { DOMRendererLive } from "../Render/DOMRenderer.js";
import { animated, ClientControlCtx, each, match, when } from "./index.js";

const TestLayer = Layer.mergeAll(ClientControlCtx, DOMRendererLive);

describe("Control", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  describe("when", () => {
    it.scopedLive("should render onTrue when condition is true", () =>
      Effect.gen(function* () {
        const isVisible = yield* Signal.make(true);
        const el = yield* when(isVisible, {
          onTrue: () => $.div({}, "Visible"),
          onFalse: () => $.div({}, "Hidden"),
        });

        expect(el.textContent).toBe("Visible");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should render onFalse when condition is false", () =>
      Effect.gen(function* () {
        const isVisible = yield* Signal.make(false);
        const el = yield* when(isVisible, {
          onTrue: () => $.div({}, "Visible"),
          onFalse: () => $.div({}, "Hidden"),
        });

        expect(el.textContent).toBe("Hidden");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should switch rendering when condition changes", () =>
      Effect.gen(function* () {
        const isVisible = yield* Signal.make(true);
        const el = yield* when(isVisible, {
          onTrue: () => $.div({}, "Visible"),
          onFalse: () => $.div({}, "Hidden"),
        });

        expect(el.textContent).toBe("Visible");

        // Wait for forked subscription fiber to start
        yield* Effect.sleep("20 millis");

        yield* isVisible.set(false);
        yield* Effect.sleep("20 millis");

        expect(el.textContent).toBe("Hidden");

        yield* isVisible.set(true);
        yield* Effect.sleep("20 millis");

        expect(el.textContent).toBe("Visible");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should not re-render when condition stays the same", () =>
      Effect.gen(function* () {
        let renderCount = 0;
        const isVisible = yield* Signal.make(true);
        yield* when(isVisible, {
          onTrue: () => {
            renderCount++;
            return $.div({}, "Visible");
          },
          onFalse: () => $.div({}, "Hidden"),
        });

        expect(renderCount).toBe(1);

        yield* Effect.sleep("20 millis");
        yield* isVisible.set(true); // Same value
        yield* Effect.sleep("20 millis");

        // Should not re-render since condition didn't change
        expect(renderCount).toBe(1);
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("match", () => {
    it.scopedLive("should render matching pattern", () =>
      Effect.gen(function* () {
        const status = yield* Signal.make<"loading" | "success" | "error">(
          "loading",
        );
        const el = yield* match(status, {
          cases: [
            {
              pattern: "loading",
              render: () => $.div({}, "Loading..."),
            },
            { pattern: "success", render: () => $.div({}, "Done!") },
            { pattern: "error", render: () => $.div({}, "Failed") },
          ],
        });

        expect(el.textContent).toBe("Loading...");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should switch when pattern changes", () =>
      Effect.gen(function* () {
        const status = yield* Signal.make<"loading" | "success" | "error">(
          "loading",
        );
        const el = yield* match(status, {
          cases: [
            {
              pattern: "loading",
              render: () => $.div({}, "Loading..."),
            },
            { pattern: "success", render: () => $.div({}, "Done!") },
            { pattern: "error", render: () => $.div({}, "Failed") },
          ],
        });

        expect(el.textContent).toBe("Loading...");

        yield* Effect.sleep("20 millis");
        yield* status.set("success");
        yield* Effect.sleep("20 millis");

        expect(el.textContent).toBe("Done!");

        yield* status.set("error");
        yield* Effect.sleep("20 millis");

        expect(el.textContent).toBe("Failed");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should render fallback when no pattern matches", () =>
      Effect.gen(function* () {
        const value = yield* Signal.make(999);
        const el = yield* match(value, {
          cases: [
            { pattern: 1, render: () => $.div({}, "One") },
            { pattern: 2, render: () => $.div({}, "Two") },
          ],
          fallback: () => $.div({}, "Unknown"),
        });

        expect(el.textContent).toBe("Unknown");
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("each", () => {
    it.scopedLive("should render list items", () =>
      Effect.gen(function* () {
        const items = yield* Signal.make([
          { id: "1", name: "Alice" },
          { id: "2", name: "Bob" },
          { id: "3", name: "Charlie" },
        ]);

        const el = yield* each(items, {
          key: (item) => item.id,
          render: (item, _index) =>
            $.li(
              {},
              Readable.map(item, (i) => i.name),
            ),
        });

        expect(el.children.length).toBe(3);
        expect(el.children[0].textContent).toBe("Alice");
        expect(el.children[1].textContent).toBe("Bob");
        expect(el.children[2].textContent).toBe("Charlie");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should add new items", () =>
      Effect.gen(function* () {
        const items = yield* Signal.make([{ id: "1", name: "Alice" }]);

        const el = yield* each(items, {
          key: (item) => item.id,
          render: (item, _index) =>
            $.li(
              {},
              Readable.map(item, (i) => i.name),
            ),
        });

        expect(el.children.length).toBe(1);

        yield* Effect.sleep("20 millis");
        yield* items.update((list) => [...list, { id: "2", name: "Bob" }]);
        yield* Effect.sleep("20 millis");

        expect(el.children.length).toBe(2);
        expect(el.children[1].textContent).toBe("Bob");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should remove items", () =>
      Effect.gen(function* () {
        const items = yield* Signal.make([
          { id: "1", name: "Alice" },
          { id: "2", name: "Bob" },
        ]);

        const el = yield* each(items, {
          key: (item) => item.id,
          render: (item, _index) =>
            $.li(
              {},
              Readable.map(item, (i) => i.name),
            ),
        });

        expect(el.children.length).toBe(2);

        yield* Effect.sleep("20 millis");
        yield* items.update((list) => list.filter((i) => i.id !== "1"));
        yield* Effect.sleep("20 millis");

        expect(el.children.length).toBe(1);
        expect(el.children[0].textContent).toBe("Bob");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should update existing items", () =>
      Effect.gen(function* () {
        const items = yield* Signal.make([{ id: "1", name: "Alice" }]);

        const el = yield* each(items, {
          key: (item) => item.id,
          render: (item, _index) =>
            $.li(
              {},
              Readable.map(item, (i) => i.name),
            ),
        });

        expect(el.children[0].textContent).toBe("Alice");

        yield* Effect.sleep("20 millis");
        yield* items.update((list) =>
          list.map((i) => (i.id === "1" ? { ...i, name: "Alicia" } : i)),
        );
        yield* Effect.sleep("20 millis");

        expect(el.children[0].textContent).toBe("Alicia");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should reorder items", () =>
      Effect.gen(function* () {
        const items = yield* Signal.make([
          { id: "1", name: "Alice" },
          { id: "2", name: "Bob" },
          { id: "3", name: "Charlie" },
        ]);

        const el = yield* each(items, {
          key: (item) => item.id,
          render: (item, _index) =>
            $.li(
              {},
              Readable.map(item, (i) => i.name),
            ),
        });

        expect(el.children[0].textContent).toBe("Alice");
        expect(el.children[2].textContent).toBe("Charlie");

        yield* Effect.sleep("20 millis");
        yield* items.set([
          { id: "3", name: "Charlie" },
          { id: "2", name: "Bob" },
          { id: "1", name: "Alice" },
        ]);
        yield* Effect.sleep("20 millis");

        expect(el.children[0].textContent).toBe("Charlie");
        expect(el.children[2].textContent).toBe("Alice");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should handle empty list", () =>
      Effect.gen(function* () {
        const items = yield* Signal.make<{ id: string; name: string }[]>([]);

        const el = yield* each(items, {
          key: (item) => item.id,
          render: (item, _index) =>
            $.li(
              {},
              Readable.map(item, (i) => i.name),
            ),
        });

        expect(el.children.length).toBe(0);
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  // Key-indexing invariants: what changed when `each` moved its per-slot
  // lookup from `arr.find` (O(n) per slot, O(n²) per sync) to a
  // key→item Map built once per sync via ReconcileConfig.prepare.
  describe("each — key indexing", () => {
    it.scopedLive(
      "duplicate keys resolve to the first occurrence (regression guard)",
      () =>
        Effect.gen(function* () {
          // Two items share a key — `Array.prototype.find` semantics
          // pick the FIRST. Locked in so a future rewrite that reaches
          // for `new Map(arr.map(...))` (which would keep the LAST)
          // doesn't silently drift.
          const items = yield* Signal.make([
            { id: "a", name: "First" },
            { id: "a", name: "Second" },
            { id: "b", name: "Third" },
          ]);

          const el = yield* each(items, {
            key: (item) => item.id,
            render: (item, _index) =>
              $.li(
                {},
                Readable.map(item, (i) => i.name),
              ),
          });

          // Two slots (deduped on key); "a" resolves to "First".
          expect(el.children.length).toBe(2);
          expect(el.children[0].textContent).toBe("First");
          expect(el.children[1].textContent).toBe("Third");
        }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive(
      "config.key invocation count is O(n) per sync, not O(n²)",
      () =>
        Effect.gen(function* () {
          const n = 20;
          const initial = Array.from({ length: n }, (_, i) => ({
            id: String(i),
          }));
          const items = yield* Signal.make(initial);

          let keyCalls = 0;
          const key = (item: { id: string }) => {
            keyCalls++;
            return item.id;
          };

          yield* each(items, {
            key,
            render: () => $.li(),
          });

          // Let the initial sync settle, then reset the counter — we're
          // measuring the update-triggered sync in isolation.
          yield* Effect.sleep("20 millis");
          keyCalls = 0;

          // A full reorder — every slot is "existing", every slot goes
          // through the getItemForKey path.
          yield* items.set([...initial].reverse());
          yield* Effect.sleep("20 millis");

          // Post-fix: getTargetKeys walks the array (n calls), prepare
          // walks it again (n calls). Pre-fix: the same n, plus
          // arr.find scanning ~n(n+1)/2 times ≈ 210 for n=20.
          expect(keyCalls).toBeLessThanOrEqual(2 * n + 5);
        }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive(
      "SignalArray-driven each reflects in-place mutations (identity-cache regression guard)",
      () =>
        Effect.gen(function* () {
          // SignalArray's mutation methods mutate the backing array in
          // place and re-emit the SAME reference. If `each` ever caches
          // its key→item index keyed on array identity, this test
          // renders the wrong item at position 2 (or fails to add
          // position 3 on push).
          const items = yield* Signal.Array.make([
            { id: "1", name: "Alice" },
            { id: "2", name: "Bob" },
            { id: "3", name: "Charlie" },
          ]);

          const el = yield* each(items, {
            key: (item) => item.id,
            render: (item, _index) =>
              $.li(
                {},
                Readable.map(item, (i) => i.name),
              ),
          });

          expect(el.children.length).toBe(3);
          expect(el.children[2].textContent).toBe("Charlie");

          yield* Effect.sleep("20 millis");

          // In-place replaceAt — arr identity unchanged.
          yield* items.replaceAt(2, { id: "3", name: "Chuck" });
          yield* Effect.sleep("20 millis");

          expect(el.children[2].textContent).toBe("Chuck");

          // In-place push — arr identity unchanged, new slot appears.
          yield* items.push({ id: "4", name: "Dave" });
          yield* Effect.sleep("20 millis");

          expect(el.children.length).toBe(4);
          expect(el.children[3].textContent).toBe("Dave");
        }).pipe(Effect.provide(TestLayer)),
    );
  });

  // FLIP reorder animation. jsdom has no layout engine, so we stub
  // `getBoundingClientRect` to report position based on each row's
  // current DOM index — the reorder itself is what makes rects change,
  // which is exactly what FLIP measures. That lets the reconcile path
  // exercise beginSync → mutate → endSync end-to-end.
  describe("each — FLIP reorder", () => {
    const ROW_HEIGHT = 40;

    /**
     * Stub `getBoundingClientRect` on every element via prototype so
     * children of a rendered `each` container get index-based rects
     * without per-element setup. Cleaned up between tests via
     * `beforeEach`'s `innerHTML = ""` — the prototype patch itself
     * survives, but no tests care about real rects.
     */
    const stubIndexedRects = () => {
      HTMLElement.prototype.getBoundingClientRect = function () {
        const parent = this.parentElement;
        const idx = parent ? Array.from(parent.children).indexOf(this) : 0;
        return {
          top: idx * ROW_HEIGHT,
          left: 0,
          bottom: (idx + 1) * ROW_HEIGHT,
          right: 100,
          width: 100,
          height: ROW_HEIGHT,
          x: 0,
          y: idx * ROW_HEIGHT,
          toJSON: () => ({}),
        } as DOMRect;
      };
    };

    beforeEach(() => {
      stubIndexedRects();
    });

    it.scopedLive("invokes move.transform with the layout delta", () =>
      Effect.gen(function* () {
        const deltas: Array<{ x: number; y: number; from: string }> = [];
        const items = yield* Signal.make([
          { id: "1", name: "Alice" },
          { id: "2", name: "Bob" },
          { id: "3", name: "Charlie" },
        ]);

        const el = yield* each(items, {
          key: (item) => item.id,
          render: (item, _index) =>
            $.li(
              { "data-id": Readable.map(item, (i) => i.id) },
              Readable.map(item, (i) => i.name),
            ),
          animate: {
            move: {
              transform: (d) => {
                // Anchor the delta to the row's current data-id so the
                // assertion can name-check who moved.
                const row = document.querySelector(
                  `[style*="translate"]`,
                ) as HTMLElement | null;
                deltas.push({
                  x: d.x,
                  y: d.y,
                  from: row?.dataset.id ?? "?",
                });
                return `translateY(${d.y}px)`;
              },
              transition: "transition-transform",
            },
          },
        });

        // Anchor the container into the document so children's parent
        // walk terminates at the container (rect stub reads parent).
        document.body.appendChild(el);

        yield* Effect.sleep("20 millis");

        // Reverse: [1, 2, 3] → [3, 2, 1]. Row "1" moves down 2 slots
        // (dy = -80), row "3" moves up 2 slots (dy = +80), row "2"
        // stays put.
        yield* items.set([
          { id: "3", name: "Charlie" },
          { id: "2", name: "Bob" },
          { id: "1", name: "Alice" },
        ]);
        yield* Effect.sleep("30 millis");

        // Row "2" was stable → no invert. Rows "1" and "3" each moved
        // by 2 * ROW_HEIGHT (in opposite directions).
        expect(deltas.length).toBe(2);
        const ys = deltas.map((d) => d.y).sort((a, b) => a - b);
        expect(ys).toEqual([-2 * ROW_HEIGHT, 2 * ROW_HEIGHT]);
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("excludes newly-entered items from FLIP", () =>
      Effect.gen(function* () {
        const called: Array<{ x: number; y: number }> = [];
        const items = yield* Signal.make([
          { id: "1", name: "Alice" },
          { id: "2", name: "Bob" },
        ]);

        const el = yield* each(items, {
          key: (item) => item.id,
          render: (item, _index) =>
            $.li(
              {},
              Readable.map(item, (i) => i.name),
            ),
          animate: {
            move: {
              transform: (d) => {
                called.push({ x: d.x, y: d.y });
                return `translateY(${d.y}px)`;
              },
              transition: "transition-transform",
            },
          },
        });
        document.body.appendChild(el);

        yield* Effect.sleep("20 millis");

        // Insert a new row at index 0. Existing rows shift down by
        // ROW_HEIGHT; the new row has no pre-batch rect so it must
        // not be FLIP'd.
        yield* items.set([
          { id: "0", name: "Zed" },
          { id: "1", name: "Alice" },
          { id: "2", name: "Bob" },
        ]);
        yield* Effect.sleep("30 millis");

        // Rows "1" and "2" shifted DOWN by one row; row "0" is new and
        // excluded. Delta = old - new, so a downward shift gives a
        // negative dy — the invert translate then puts them visually
        // back UP at their old spot, and the release transitions them
        // down to their new one.
        expect(called.length).toBe(2);
        expect(called.every((d) => d.y === -ROW_HEIGHT)).toBe(true);
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive(
      "leaves style.transform untouched when no move config is provided",
      () =>
        Effect.gen(function* () {
          const items = yield* Signal.make([
            { id: "1", name: "Alice" },
            { id: "2", name: "Bob" },
          ]);

          const el = yield* each(items, {
            key: (item) => item.id,
            render: (item, _index) =>
              $.li(
                {},
                Readable.map(item, (i) => i.name),
              ),
          });
          document.body.appendChild(el);

          yield* Effect.sleep("20 millis");
          yield* items.set([
            { id: "2", name: "Bob" },
            { id: "1", name: "Alice" },
          ]);
          yield* Effect.sleep("30 millis");

          // Nothing wrote to style.transform on either row.
          for (const child of Array.from(el.children)) {
            expect((child as HTMLElement).style.transform).toBe("");
          }
        }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("does not FLIP when items are unchanged", () =>
      Effect.gen(function* () {
        let calls = 0;
        const items = yield* Signal.make([
          { id: "1", name: "Alice" },
          { id: "2", name: "Bob" },
        ]);

        const el = yield* each(items, {
          key: (item) => item.id,
          render: (item, _index) =>
            $.li(
              {},
              Readable.map(item, (i) => i.name),
            ),
          animate: {
            move: {
              transform: (d) => {
                calls++;
                return `translateY(${d.y}px)`;
              },
              transition: "transition-transform",
            },
          },
        });
        document.body.appendChild(el);

        yield* Effect.sleep("20 millis");

        // Same shape, same order — no-op reconcile.
        yield* items.set([
          { id: "1", name: "Alice" },
          { id: "2", name: "Bob" },
        ]);
        yield* Effect.sleep("30 millis");

        expect(calls).toBe(0);
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive(
      "restores a prior inline `style.transform` after the release",
      () =>
        Effect.gen(function* () {
          const items = yield* Signal.make([
            { id: "1", name: "Alice" },
            { id: "2", name: "Bob" },
          ]);

          const el = yield* each(items, {
            key: (item) => item.id,
            render: (item, _index) =>
              $.li(
                { "data-id": Readable.map(item, (i) => i.id) },
                Readable.map(item, (i) => i.name),
              ),
            animate: {
              move: {
                transform: (d) => `translateY(${d.y}px)`,
                transition: "transition-transform",
              },
            },
          });
          document.body.appendChild(el);

          // Pre-decorate row "1" with an inline transform the user
          // set themselves. FLIP must leave this intact after release.
          const rowOne = el.querySelector(
            '[data-id="1"]',
          ) as HTMLElement | null;
          if (!rowOne) throw new Error("row 1 not found");
          rowOne.style.transform = "rotate(3deg)";

          yield* Effect.sleep("20 millis");
          yield* items.set([
            { id: "2", name: "Bob" },
            { id: "1", name: "Alice" },
          ]);
          // Wait long enough for the double-rAF (jsdom pumps rAF via
          // setTimeout(16), so two ticks are ~32ms), the release, and
          // the microtask-resolved `awaitTransformEnd` cleanup.
          yield* Effect.sleep("100 millis");

          expect(rowOne.style.transform).toBe("rotate(3deg)");
        }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("uses helpers via Animation namespace", () =>
      Effect.gen(function* () {
        const invert = Animation.moveTranslate3d({ x: 5, y: -7 });
        expect(invert).toBe("translate3d(5px, -7px, 0)");
        expect(Animation.moveTranslateY({ x: 5, y: -7 })).toBe(
          "translateY(-7px)",
        );
        expect(Animation.moveTranslate({ x: 5, y: -7 })).toBe(
          "translate(5px, -7px)",
        );
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("nested control functions", () => {
    it.scopedLive("should handle when inside when", () =>
      Effect.gen(function* () {
        const outer = yield* Signal.make(true);
        const inner = yield* Signal.make(true);

        const el = yield* when(outer, {
          onTrue: () =>
            $.div(
              {},
              when(inner, {
                onTrue: () => $.span({}, "Both true"),
                onFalse: () => $.span({}, "Outer true, inner false"),
              }),
            ),
          onFalse: () => $.div({}, "Outer false"),
        });

        expect(el.textContent).toBe("Both true");

        yield* Effect.sleep("20 millis");
        yield* inner.set(false);
        yield* Effect.sleep("20 millis");
        expect(el.textContent).toBe("Outer true, inner false");

        yield* outer.set(false);
        yield* Effect.sleep("20 millis");
        expect(el.textContent).toBe("Outer false");

        yield* outer.set(true);
        yield* Effect.sleep("20 millis");
        expect(el.textContent).toBe("Outer true, inner false");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should handle match inside when", () =>
      Effect.gen(function* () {
        const showDetails = yield* Signal.make(true);
        const status = yield* Signal.make<"loading" | "success" | "error">(
          "loading",
        );

        const el = yield* when(showDetails, {
          onTrue: () =>
            $.div(
              {},
              match(status, {
                cases: [
                  {
                    pattern: "loading",
                    render: () => $.span({}, "Loading..."),
                  },
                  {
                    pattern: "success",
                    render: () => $.span({}, "Done!"),
                  },
                  {
                    pattern: "error",
                    render: () => $.span({}, "Failed"),
                  },
                ],
              }),
            ),
          onFalse: () => $.div({}, "Hidden"),
        });

        expect(el.textContent).toBe("Loading...");

        yield* Effect.sleep("20 millis");
        yield* status.set("success");
        yield* Effect.sleep("20 millis");
        expect(el.textContent).toBe("Done!");

        yield* showDetails.set(false);
        yield* Effect.sleep("20 millis");
        expect(el.textContent).toBe("Hidden");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should handle each inside when", () =>
      Effect.gen(function* () {
        const showList = yield* Signal.make(true);
        const items = yield* Signal.make([
          { id: "1", name: "Alice" },
          { id: "2", name: "Bob" },
        ]);

        const el = yield* when(showList, {
          onTrue: () =>
            $.div(
              {},
              each(items, {
                key: (item) => item.id,
                render: (item) =>
                  $.span(
                    {},
                    Readable.map(item, (i) => i.name),
                  ),
              }),
            ),
          onFalse: () => $.div({}, "List hidden"),
        });

        // el = when's container, el.children[0] = div from onTrue
        // el.children[0].children[0] = each's container
        expect(el.children.length).toBe(1);
        const divWrapper = el.children[0];
        expect(divWrapper.children.length).toBe(1);
        const eachContainer = divWrapper.children[0];
        expect(eachContainer.children.length).toBe(2);
        expect(eachContainer.children[0].textContent).toBe("Alice");

        yield* Effect.sleep("20 millis");
        yield* items.update((list) => [...list, { id: "3", name: "Charlie" }]);
        yield* Effect.sleep("20 millis");
        expect(eachContainer.children.length).toBe(3);

        yield* showList.set(false);
        yield* Effect.sleep("20 millis");
        expect(el.textContent).toBe("List hidden");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should handle when inside each", () =>
      Effect.gen(function* () {
        const items = yield* Signal.make([
          { id: "1", name: "Alice", active: true },
          { id: "2", name: "Bob", active: false },
        ]);

        const el = yield* each(items, {
          key: (item) => item.id,
          render: (item) =>
            $.li(
              {},
              when(
                Readable.map(item, (i) => i.active),
                {
                  onTrue: () =>
                    $.span(
                      {},
                      Readable.map(item, (i) => `${i.name} (active)`),
                    ),
                  onFalse: () =>
                    $.span(
                      {},
                      Readable.map(item, (i) => i.name),
                    ),
                },
              ),
            ),
        });

        expect(el.children[0].textContent).toBe("Alice (active)");
        expect(el.children[1].textContent).toBe("Bob");

        yield* Effect.sleep("20 millis");
        yield* items.set([
          { id: "1", name: "Alice", active: false },
          { id: "2", name: "Bob", active: true },
        ]);
        yield* Effect.sleep("20 millis");

        expect(el.children[0].textContent).toBe("Alice");
        expect(el.children[1].textContent).toBe("Bob (active)");
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("deeply nested control functions", () => {
    it.scopedLive("should handle three levels of nesting", () =>
      Effect.gen(function* () {
        const level1 = yield* Signal.make(true);
        const level2 = yield* Signal.make(true);
        const level3 = yield* Signal.make<"x" | "y">("x");

        const el = yield* when(level1, {
          onTrue: () =>
            $.div(
              { class: "level1" },
              when(level2, {
                onTrue: () =>
                  $.div(
                    { class: "level2" },
                    match(level3, {
                      cases: [
                        {
                          pattern: "x",
                          render: () => $.span({}, "Deep X"),
                        },
                        {
                          pattern: "y",
                          render: () => $.span({}, "Deep Y"),
                        },
                      ],
                    }),
                  ),
                onFalse: () => $.div({}, "Level 2 false"),
              }),
            ),
          onFalse: () => $.div({}, "Level 1 false"),
        });

        // Navigate to the deepest content
        const getDeepText = () => {
          const l1 = el;
          const l2 = l1.querySelector(".level2");
          return l2 ? l2.textContent : l1.textContent;
        };

        expect(getDeepText()).toBe("Deep X");

        yield* Effect.sleep("20 millis");
        yield* level3.set("y");
        yield* Effect.sleep("20 millis");
        expect(getDeepText()).toBe("Deep Y");

        yield* level2.set(false);
        yield* Effect.sleep("20 millis");
        expect(el.textContent).toBe("Level 2 false");

        yield* level1.set(false);
        yield* Effect.sleep("20 millis");
        expect(el.textContent).toBe("Level 1 false");
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("sibling control functions with collect", () => {
    it.scopedLive("should handle multiple when in collect", () =>
      Effect.gen(function* () {
        const show1 = yield* Signal.make(true);
        const show2 = yield* Signal.make(false);

        const el = yield* $.div(
          {},
          collect(
            when(show1, {
              onTrue: () => $.span({}, "First visible"),
              onFalse: () => $.span({}, "First hidden"),
            }),
            when(show2, {
              onTrue: () => $.span({}, "Second visible"),
              onFalse: () => $.span({}, "Second hidden"),
            }),
          ),
        );

        // Each when creates its own container
        expect(el.children.length).toBe(2);
        expect(el.children[0].textContent).toBe("First visible");
        expect(el.children[1].textContent).toBe("Second hidden");

        yield* Effect.sleep("20 millis");
        yield* show1.set(false);
        yield* show2.set(true);
        yield* Effect.sleep("20 millis");

        expect(el.children[0].textContent).toBe("First hidden");
        expect(el.children[1].textContent).toBe("Second visible");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should handle when and match in collect", () =>
      Effect.gen(function* () {
        const isVisible = yield* Signal.make(true);
        const status = yield* Signal.make<"a" | "b">("a");

        const el = yield* $.div(
          {},
          collect(
            when(isVisible, {
              onTrue: () => $.span({}, "Visible"),
              onFalse: () => $.span({}, "Hidden"),
            }),
            match(status, {
              cases: [
                { pattern: "a", render: () => $.span({}, "Status A") },
                { pattern: "b", render: () => $.span({}, "Status B") },
              ],
            }),
          ),
        );

        expect(el.children[0].textContent).toBe("Visible");
        expect(el.children[1].textContent).toBe("Status A");

        yield* Effect.sleep("20 millis");
        yield* isVisible.set(false);
        yield* status.set("b");
        yield* Effect.sleep("20 millis");

        expect(el.children[0].textContent).toBe("Hidden");
        expect(el.children[1].textContent).toBe("Status B");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("should handle when and each in collect", () =>
      Effect.gen(function* () {
        const showHeader = yield* Signal.make(true);
        const items = yield* Signal.make(["a", "b"]);

        const el = yield* $.div(
          {},
          collect(
            when(showHeader, {
              onTrue: () => $.h1({}, "Header"),
              onFalse: () => $.h1({}, "No Header"),
            }),
            each(items, {
              key: (item) => item,
              render: (item) => $.li({}, item),
            }),
          ),
        );

        // when's container and each's container
        expect(el.children.length).toBe(2);
        expect(el.children[0].textContent).toBe("Header");
        expect(el.children[1].children.length).toBe(2);

        yield* Effect.sleep("20 millis");
        yield* showHeader.set(false);
        yield* items.update((list) => [...list, "c"]);
        yield* Effect.sleep("20 millis");

        expect(el.children[0].textContent).toBe("No Header");
        expect(el.children[1].children.length).toBe(3);
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("each animation stagger", () => {
    it.scopedLive(
      "invokes the stagger function with each item's index and total",
      () =>
        // Reconcile is expected to call stagger(index, total) for every new
        // slot in the batch — so we spy on the function itself instead of
        // measuring wall-clock delays (which are unreliable under CI load).
        Effect.gen(function* () {
          const calls: Array<{ index: number; total: number }> = [];
          const spy = (index: number, total: number) => {
            calls.push({ index, total });
            return 0;
          };

          const items = yield* Signal.make(["a", "b", "c"]);
          yield* each(items, {
            key: (item) => item,
            render: (item) => $.li({}, item),
            animate: {
              enterFrom: "opacity-0",
              enter: "opacity-100",
              stagger: spy,
              timeout: 10,
            },
          });

          // Give the forked fibers a moment to reach the stagger call.
          yield* Effect.sleep("20 millis");

          expect(calls).toEqual([
            { index: 0, total: 3 },
            { index: 1, total: 3 },
            { index: 2, total: 3 },
          ]);
        }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("does not invoke stagger when the option is omitted", () =>
      Effect.gen(function* () {
        let callCount = 0;
        const untriggered = (_index: number, _total: number) => {
          callCount++;
          return 0;
        };

        const items = yield* Signal.make(["a", "b"]);
        yield* each(items, {
          key: (item) => item,
          render: (item) => $.li({}, item),
          animate: {
            // Note: stagger is deliberately omitted here. `untriggered` is
            // declared only so the assertion below can reference it and be
            // read as "the spy that would have fired if stagger had been
            // set". Tsc otherwise flags the arrow as unused.
            enterFrom: "opacity-0",
            enter: "opacity-100",
            timeout: 10,
          },
        });

        yield* Effect.sleep("20 millis");
        expect(callCount).toBe(0);
        // Reference `untriggered` to satisfy the linter that it exists as a
        // documentation aid; behaviourally it must never have been called.
        expect(untriggered.length).toBe(2);
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  describe("animated", () => {
    it.scopedLive("mounts its child inside a container", () =>
      Effect.gen(function* () {
        const el = yield* animated({}, () =>
          $.span({ class: "greeting" }, "Hello"),
        );
        // Default container wraps the rendered child.
        expect(el.children.length).toBe(1);
        expect(el.children[0].tagName).toBe("SPAN");
        expect(el.children[0].textContent).toBe("Hello");
      }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive(
      "fires onBeforeEnter on client mount when animate is set",
      () =>
        Effect.gen(function* () {
          let called = 0;
          yield* animated(
            {
              animate: {
                enterFrom: "opacity-0",
                enter: "opacity-100",
                onBeforeEnter: () =>
                  Effect.sync(() => {
                    called += 1;
                  }),
                timeout: 10,
              },
            },
            () => $.span({}, "Hi"),
          );
          // Give the forked enter animation a moment to reach onBeforeEnter.
          yield* Effect.sleep("20 millis");
          expect(called).toBe(1);
        }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive(
      "applies enterFrom to the child before the animation fiber runs",
      () =>
        // The other-agent claim we're testing: on client-mode addSlot
        // (the re-mount path, not hydration), enterFrom lands on the
        // element BEFORE the forked enter animation starts. onBeforeEnter
        // runs at the top of runAnimation, before the addBeforeReflow
        // step — so a snapshot taken there tells us whether
        // applyPreInsertEnterFrom has already fired.
        Effect.gen(function* () {
          let snapshotAtBeforeEnter: string | null = null;
          const container = yield* animated(
            {
              animate: {
                enterFrom: "opacity-0",
                enter: "opacity-100",
                enterTo: "opacity-100",
                onBeforeEnter: (el) =>
                  Effect.tap(el, (e) =>
                    Effect.sync(() => {
                      snapshotAtBeforeEnter = e.className;
                    }),
                  ),
                timeout: 10,
              },
            },
            () => $.span({ class: "target" }, "Hi"),
          );
          // Also snapshot the classList SYNCHRONOUSLY after mount, before
          // the forked enter runs — proves applyPreInsertEnterFrom landed
          // BEFORE insertion, not just when onBeforeEnter fires.
          const child = container.querySelector<HTMLSpanElement>(".target");
          const preAnimationClasses = child?.className ?? "";

          yield* Effect.sleep("20 millis");

          expect(preAnimationClasses).toContain("opacity-0");
          expect(snapshotAtBeforeEnter).toContain("opacity-0");
        }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive(
      "re-applies enterFrom on remount (simulating a router re-render)",
      () =>
        // The heart of the reported bug: when a component is unmounted
        // and re-mounted (route navigation), the second mount should
        // apply enterFrom to the fresh element the same way the first
        // did. This drives a `when` toggle to exercise the reconcile
        // remove/add path — the same path the router hits on nav.
        Effect.gen(function* () {
          const visible = yield* Signal.make(true);
          const snapshots: string[] = [];
          const wrapper = yield* when(visible, {
            onTrue: () =>
              animated(
                {
                  animate: {
                    enterFrom: "opacity-0",
                    enter: "opacity-100",
                    enterTo: "opacity-100",
                    onBeforeEnter: (el) =>
                      Effect.tap(el, (e) =>
                        Effect.sync(() => {
                          snapshots.push(e.className);
                        }),
                      ),
                    timeout: 10,
                  },
                },
                () => $.span({ class: "target" }, "Hi"),
              ),
            onFalse: () => $.div({ class: "gone" }, "gone"),
          });

          // First mount fires.
          yield* Effect.sleep("20 millis");
          expect(snapshots.length).toBe(1);
          expect(snapshots[0]).toContain("opacity-0");

          // Simulate route navigation away and back.
          yield* visible.set(false);
          yield* Effect.sleep("10 millis");
          yield* visible.set(true);
          yield* Effect.sleep("20 millis");

          expect(snapshots.length).toBe(2);
          expect(snapshots[1]).toContain("opacity-0");
          void wrapper;
        }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive(
      "onBeforeEnter fires against an attached element (nested remount)",
      () =>
        // Regression: on a nested-`animated` re-mount, the enter fiber
        // was forked from inside the inner addSlot while the ancestor
        // chain was still being assembled bottom-up in memory. Effect's
        // scheduler could give the fiber control on the next microtask,
        // before the outer flow appended the wrapper into the document.
        // onBeforeEnter then fired against a detached node —
        // getComputedStyle returned empty strings and the transition
        // never fired. Verify the element is `isConnected` at onBeforeEnter.
        Effect.gen(function* () {
          const root = document.createElement("div");
          document.body.appendChild(root);

          const visible = yield* Signal.make(true);
          const connectedFlags: boolean[] = [];

          // Two levels of nesting under the `when` — mirrors the shape
          // of Outlet → HomePage → Headline → animated in the report.
          const view = yield* when(visible, {
            onTrue: () =>
              $.div(
                { class: "outer" },
                $.div(
                  { class: "middle" },
                  animated(
                    {
                      animate: {
                        enterFrom: "opacity-0",
                        enter: "transition-opacity duration-100",
                        enterTo: "opacity-100",
                        onBeforeEnter: (el) =>
                          Effect.tap(el, (e) =>
                            Effect.sync(() => {
                              connectedFlags.push(e.isConnected);
                            }),
                          ),
                        timeout: 20,
                      },
                    },
                    () => $.div({ class: "target" }, "Hi"),
                  ),
                ),
              ),
            onFalse: () => $.div({ class: "gone" }),
          });

          // Attach the top-level result under a real DOM root so
          // `isConnected` propagates all the way down.
          root.appendChild(view as HTMLElement);

          // First mount — everything attached synchronously above.
          yield* Effect.sleep("40 millis");
          expect(connectedFlags.length).toBe(1);
          expect(connectedFlags[0]).toBe(true);

          // Toggle away and back — this is the failure shape from the
          // portfolio report.
          yield* visible.set(false);
          yield* Effect.sleep("10 millis");
          yield* visible.set(true);
          yield* Effect.sleep("40 millis");

          expect(connectedFlags.length).toBe(2);
          expect(connectedFlags[1]).toBe(true);

          document.body.removeChild(root);
        }).pipe(Effect.provide(TestLayer)),
    );

    it.scopedLive("gates on an AnimationGroup", () =>
      Effect.gen(function* () {
        // Two `animated` blocks in sequence — the second must not fire its
        // onBeforeEnter until the first's group completes.
        const [g0, g1] = yield* Animation.sequence(2);
        const log: string[] = [];

        yield* animated(
          {
            animate: {
              enter: "in",
              group: g0,
              onBeforeEnter: () =>
                Effect.sync(() => {
                  log.push("0-start");
                }),
              onEnter: () =>
                Effect.sync(() => {
                  log.push("0-end");
                }),
              timeout: 10,
            },
          },
          () => $.span({}, "First"),
        );

        yield* animated(
          {
            animate: {
              enter: "in",
              group: g1,
              onBeforeEnter: () =>
                Effect.sync(() => {
                  log.push("1-start");
                }),
              timeout: 10,
            },
          },
          () => $.span({}, "Second"),
        );

        // 0 fires immediately (g0 gate open), 1 waits for g0 to complete.
        yield* Effect.sleep("50 millis");
        // 0-start must precede 0-end, and 1-start must be strictly after 0-end.
        const zeroEnd = log.indexOf("0-end");
        const oneStart = log.indexOf("1-start");
        expect(zeroEnd).toBeGreaterThan(-1);
        expect(oneStart).toBeGreaterThan(zeroEnd);
      }).pipe(Effect.provide(TestLayer)),
    );
  });
});
