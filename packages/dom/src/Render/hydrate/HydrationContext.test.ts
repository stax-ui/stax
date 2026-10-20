import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  buildHydrationIndex,
  HydrationContext,
  makeHydrationContext,
} from "./HydrationContext.js";

describe("HydrationContext", () => {
  describe("buildHydrationIndex", () => {
    it("indexes every `[data-stax-id]` under the root", () => {
      const root = document.createElement("div");
      root.innerHTML = `
        <section>
          <div data-stax-id="stax-1" class="a"></div>
          <div data-stax-id="stax-2" class="b">
            <span data-stax-id="stax-3" class="nested"></span>
          </div>
        </section>
      `;

      const index = buildHydrationIndex(root);

      expect(index.elements.size).toBe(3);
      expect(index.sentinels.size).toBe(0);
      expect(index.elements.get("stax-1")?.classList.contains("a")).toBe(true);
      expect(index.elements.get("stax-2")?.classList.contains("b")).toBe(true);
      expect(index.elements.get("stax-3")?.classList.contains("nested")).toBe(
        true,
      );
    });

    it("includes the root itself when it carries data-stax-id", () => {
      const root = document.createElement("div");
      root.setAttribute("data-stax-id", "stax-root");
      root.innerHTML = `<div data-stax-id="stax-1"></div>`;

      const index = buildHydrationIndex(root);

      expect(index.elements.size).toBe(2);
      expect(index.elements.get("stax-root")).toBe(root);
    });

    it("returns empty maps when there are no hydration markers", () => {
      const root = document.createElement("div");
      root.innerHTML = `<p>static</p><ul><li></li></ul>`;

      const index = buildHydrationIndex(root);

      expect(index.elements.size).toBe(0);
      expect(index.sentinels.size).toBe(0);
    });

    it("indexes `<!--$stax-N-->` sentinel comments under the root", () => {
      // Approximates SSR output for two default-container controls: a
      // sibling pair of sentinel ranges nested inside a <ul>.
      const root = document.createElement("div");
      const ul = document.createElement("ul");
      root.appendChild(ul);
      ul.appendChild(document.createComment("$stax-1"));
      ul.appendChild(document.createElement("li"));
      ul.appendChild(document.createComment("/stax-1"));
      ul.appendChild(document.createComment("$stax-2"));
      ul.appendChild(document.createElement("li"));
      ul.appendChild(document.createComment("/stax-2"));

      const index = buildHydrationIndex(root);

      expect(index.sentinels.size).toBe(2);
      expect(index.sentinels.get("stax-1")?.data).toBe("$stax-1");
      expect(index.sentinels.get("stax-2")?.data).toBe("$stax-2");
      // End sentinels and non-stax `$` comments are not indexed.
      ul.appendChild(document.createComment("$other"));
      ul.appendChild(document.createComment("/stax-3"));
      const index2 = buildHydrationIndex(root);
      expect(index2.sentinels.size).toBe(2);
    });
  });

  describe("findById", () => {
    it("resolves pre-indexed IDs without touching the DOM", async () => {
      const root = document.createElement("div");
      root.innerHTML = `<div data-stax-id="stax-1" class="target"></div>`;

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const layer = yield* makeHydrationContext(root);
          return yield* Effect.provide(
            Effect.gen(function* () {
              const hc = yield* HydrationContext;
              return yield* hc.findById("stax-1");
            }),
            layer,
          );
        }),
      );

      expect(result).not.toBeNull();
      expect((result as HTMLElement).classList.contains("target")).toBe(true);
    });

    it("falls back to querySelector for IDs added after the pre-index", async () => {
      // Defensive case: user code might inject hydration markers between
      // hydrate() entry and the first findById call. The map doesn't
      // know about them, but the fallback query does.
      const root = document.createElement("div");
      root.innerHTML = `<div data-stax-id="stax-1"></div>`;

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const layer = yield* makeHydrationContext(root);
          return yield* Effect.provide(
            Effect.gen(function* () {
              const injected = document.createElement("div");
              injected.setAttribute("data-stax-id", "stax-late");
              root.appendChild(injected);

              const hc = yield* HydrationContext;
              return yield* hc.findById("stax-late");
            }),
            layer,
          );
        }),
      );

      expect(result).not.toBeNull();
      expect((result as HTMLElement).getAttribute("data-stax-id")).toBe(
        "stax-late",
      );
    });

    it("returns null for IDs that don't exist anywhere", async () => {
      const root = document.createElement("div");
      root.innerHTML = `<div data-stax-id="stax-1"></div>`;

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const layer = yield* makeHydrationContext(root);
          return yield* Effect.provide(
            Effect.gen(function* () {
              const hc = yield* HydrationContext;
              return yield* hc.findById("stax-missing");
            }),
            layer,
          );
        }),
      );

      expect(result).toBeNull();
    });
  });

  describe("nextControlId", () => {
    it("issues `stax-N` IDs starting at 1 in sequence", async () => {
      const root = document.createElement("div");

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const layer = yield* makeHydrationContext(root);
          return yield* Effect.provide(
            Effect.gen(function* () {
              const hc = yield* HydrationContext;
              const a = yield* hc.nextControlId;
              const b = yield* hc.nextControlId;
              const c = yield* hc.nextControlId;
              return [a, b, c];
            }),
            layer,
          );
        }),
      );

      expect(result).toEqual(["stax-1", "stax-2", "stax-3"]);
    });

    it("isolates counters across separate hydration contexts", async () => {
      const root = document.createElement("div");

      const run = () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const layer = yield* makeHydrationContext(root);
            return yield* Effect.provide(
              Effect.gen(function* () {
                const hc = yield* HydrationContext;
                return yield* hc.nextControlId;
              }),
              layer,
            );
          }),
        );

      expect(await run()).toBe("stax-1");
      expect(await run()).toBe("stax-1");
    });
  });
});
