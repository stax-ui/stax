/**
 * Benchmark the three strategies for hydration-time container lookup.
 *
 * The scenario: hydration needs to resolve a reference to every
 * control-flow container (each `each`/`when`/`match`/etc.) under the
 * root. We compare:
 *
 *   1. **Positional walk**: simulates the renderer-stack approach
 *      shipped before this change. One shared cursor advances once
 *      per DOM node; per-lookup cost is amortized O(N/C) where
 *      N = total nodes, C = total controls.
 *
 *   2. **Naive querySelector**: issues a fresh
 *      `document.querySelector('[data-stax-id="X"]')` per lookup. Each
 *      call is O(N) in the worst case; total cost is O(C × N). Serves
 *      as the "baseline you'd get without any strategy."
 *
 *   3. **Eager pre-index + Map.get**: one `querySelectorAll` pass up
 *      front builds `Map<id, Element>`; each lookup is O(1). Total
 *      cost is O(C). Shipped in `HydrationContext.findById`.
 *
 * Reported in `pnpm bench`'s hz / mean-time columns. We expect:
 *   - Pre-index to beat positional walking on static-heavy pages
 *     (lots of N, few C) and tie it on control-dense pages.
 *   - Pre-index to beat naive querySelector by orders of magnitude on
 *     any page with more than a handful of controls.
 */

import { bench, describe } from "vitest";

import { buildHydrationIndex } from "./HydrationContext.js";

// -----------------------------------------------------------------------------
// Page-shape fixtures
// -----------------------------------------------------------------------------

interface PageShape {
  /** Total DOM nodes (approximate — descendants of root). */
  readonly totalNodes: number;
  /** How many control-flow containers (`data-stax-id` elements) sit on the page. */
  readonly controlCount: number;
}

const makeRoot = (shape: PageShape): HTMLElement => {
  const root = document.createElement("div");

  // We synthesize a tree that approximates `totalNodes` elements with
  // `controlCount` of them carrying `data-stax-id`. The structure is
  // flat (one deep section containing all children) to isolate the
  // lookup cost from traversal depth — the lookup strategies care
  // about node count, not shape.

  const section = document.createElement("section");
  root.appendChild(section);

  const controlEveryN = Math.max(
    1,
    Math.floor(shape.totalNodes / shape.controlCount),
  );

  for (let i = 0; i < shape.totalNodes; i++) {
    const el = document.createElement("div");
    el.textContent = `node ${i}`;
    if (i % controlEveryN === 0) {
      // Promote to a control-flow container with a hydration ID.
      const controlIndex = Math.floor(i / controlEveryN) + 1;
      el.setAttribute("data-stax-id", `stax-${controlIndex}`);
    }
    section.appendChild(el);
  }

  return root;
};

// Actual control counts after the integer-division rounding above.
const actualControlCount = (shape: PageShape): number =>
  Math.floor(
    shape.totalNodes /
      Math.max(1, Math.floor(shape.totalNodes / shape.controlCount)),
  ) + 1;

// -----------------------------------------------------------------------------
// Lookup strategies — each resolves every control's container, simulating
// one full hydration pass's worth of container lookups.
// -----------------------------------------------------------------------------

/**
 * Positional walk: iterate the parent's children left-to-right, matching
 * each `[data-stax-id]` element in document order. One shared cursor
 * advances across the whole hydration pass, so the total work is O(N).
 */
const resolveAllPositional = (root: HTMLElement): number => {
  const section = root.firstElementChild;
  if (!section) return 0;

  let count = 0;
  let cursor = 0;
  const children = section.children;
  while (cursor < children.length) {
    const child = children[cursor];
    if (child.hasAttribute("data-stax-id")) {
      count++;
    }
    cursor++;
  }
  return count;
};

/**
 * Naive `querySelector` per control. Each lookup scans from the root.
 */
const resolveAllNaive = (root: HTMLElement, ids: readonly string[]): number => {
  let count = 0;
  for (const id of ids) {
    const el = root.querySelector(`[data-stax-id="${id}"]`);
    if (el) count++;
  }
  return count;
};

/**
 * Pre-index + Map.get. Build the index once, then each lookup is O(1).
 */
const resolveAllPreIndex = (
  root: HTMLElement,
  ids: readonly string[],
): number => {
  const index = buildHydrationIndex(root);
  let count = 0;
  for (const id of ids) {
    if (index.elements.has(id) || index.sentinels.has(id)) count++;
  }
  return count;
};

// -----------------------------------------------------------------------------
// Shapes under test
// -----------------------------------------------------------------------------

interface Benchmark {
  readonly name: string;
  readonly shape: PageShape;
}

// Fixture sizes are modest because `vitest bench` runs on jsdom,
// whose per-element cost is ~10× a real browser's. The ratios
// between strategies are what matters, not the absolute times.
// Scale up when running against a real browser (via `browser.enabled`
// in vitest config) to see the full gap.
const SHAPES: readonly Benchmark[] = [
  {
    name: "small dashboard (500 nodes, ~25 controls)",
    shape: { totalNodes: 500, controlCount: 25 },
  },
  {
    name: "blog post (2k nodes, ~10 controls)",
    shape: { totalNodes: 2_000, controlCount: 10 },
  },
  {
    name: "long feed (5k nodes, ~250 controls)",
    shape: { totalNodes: 5_000, controlCount: 250 },
  },
  {
    name: "list of lists (10k nodes, ~500 controls)",
    shape: { totalNodes: 10_000, controlCount: 500 },
  },
];

// -----------------------------------------------------------------------------
// Benchmarks
// -----------------------------------------------------------------------------

for (const { name, shape } of SHAPES) {
  describe(name, () => {
    // Build fixture once per describe block. Benchmark loops iterate
    // the lookups, not DOM construction.
    const root = makeRoot(shape);
    const idCount = actualControlCount(shape);
    const ids: readonly string[] = Array.from(
      { length: idCount },
      (_, i) => `stax-${i + 1}`,
    );

    bench("positional walk (shared cursor)", () => {
      resolveAllPositional(root);
    });

    bench("naive querySelector per control", () => {
      resolveAllNaive(root, ids);
    });

    bench("pre-index + Map.get", () => {
      resolveAllPreIndex(root, ids);
    });
  });
}
