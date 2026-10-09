/**
 * Tests for FocusTrap — specifically the modal-grade additions from #174:
 * - sibling `inert` marking so screen-reader virtual cursors can't reach
 *   content outside the trap
 * - sentinel focus guards that catch Tab-out before focus actually
 *   leaves the container
 *
 * Pre-existing Tab-wrap and focus-restore behavior is also covered to
 * guard against regressions.
 *
 * jsdom quirks worked around here:
 * - `.inert` reads `undefined` on elements where the setter has never
 *   run (instead of `false` as the spec says), and setting `.inert =
 *   true` reflects on the property but not on the `inert` attribute.
 *   So assertions use `!!el.inert` for the "set" case and `!el.inert`
 *   for the "unset" case, not `hasAttribute("inert")`.
 * - `HTMLElement.offsetParent` is always `undefined` under jsdom (no
 *   layout engine), so `getFocusableElements`'s `offsetParent !== null`
 *   filter rejects every button in the test DOM. Tests that need
 *   focusables to be detected stub `offsetParent` with a getter that
 *   returns the body (what a real browser would report for an attached
 *   button with no positioned ancestor).
 */

import { Effect, Exit, Scope } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { FocusTrap } from "./FocusTrap.js";

const activate = async (
  container: HTMLElement,
  options?: Omit<Parameters<typeof FocusTrap.make>[0], "container">,
): Promise<() => Promise<void>> => {
  const scope = Effect.runSync(Scope.make());
  await Effect.runPromise(
    FocusTrap.make({ container, ...options }).pipe(
      Effect.provideService(Scope.Scope, scope),
    ),
  );
  return () => Effect.runPromise(Scope.close(scope, Exit.void));
};

/** Make an element pass the trap's offsetParent-based visibility check. */
const makeVisible = (el: HTMLElement): void => {
  Object.defineProperty(el, "offsetParent", {
    configurable: true,
    get: () => document.body,
  });
};

const GUARD_SELECTOR = "[data-stax-focus-guard]";

describe("FocusTrap", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  describe("inert on siblings", () => {
    it("marks every sibling of the container's ancestor chain as inert", async () => {
      // body > outerSibling + wrapper
      // wrapper > innerSibling + container
      const outerSibling = document.createElement("div");
      outerSibling.id = "outer-sibling";
      const wrapper = document.createElement("div");
      wrapper.id = "wrapper";
      const innerSibling = document.createElement("div");
      innerSibling.id = "inner-sibling";
      const container = document.createElement("div");
      container.innerHTML = `<button id="btn">btn</button>`;

      wrapper.append(innerSibling, container);
      document.body.append(outerSibling, wrapper);

      const close = await activate(container);

      expect(!!innerSibling.inert).toBe(true);
      expect(!!outerSibling.inert).toBe(true);
      // The container's own ancestor chain is never inert.
      expect(!!wrapper.inert).toBe(false);
      expect(!!container.inert).toBe(false);
      expect(!!document.body.inert).toBe(false);

      await close();
    });

    it("un-inerts the siblings it marked when the trap closes", async () => {
      const sibling = document.createElement("div");
      const container = document.createElement("div");
      container.innerHTML = `<button>btn</button>`;
      document.body.append(sibling, container);

      const close = await activate(container);
      expect(!!sibling.inert).toBe(true);

      await close();
      expect(!!sibling.inert).toBe(false);
    });

    it("leaves user-set inert siblings inert on cleanup", async () => {
      // Caller already marked a sibling inert for their own reasons.
      // We shouldn't un-set it just because the trap closed.
      const sibling = document.createElement("div");
      sibling.inert = true;
      const container = document.createElement("div");
      container.innerHTML = `<button>btn</button>`;
      document.body.append(sibling, container);

      const close = await activate(container);
      expect(!!sibling.inert).toBe(true);

      await close();
      // Still inert after cleanup — because WE didn't set it.
      expect(!!sibling.inert).toBe(true);
    });
  });

  describe("focus guards", () => {
    it("inserts sentinel guards as the container's siblings", async () => {
      const container = document.createElement("div");
      container.innerHTML = `<button>btn</button>`;
      document.body.appendChild(container);

      const close = await activate(container);

      const guards = document.querySelectorAll(GUARD_SELECTOR);
      expect(guards.length).toBe(2);
      expect(container.previousElementSibling).toBe(guards[0]);
      expect(container.nextElementSibling).toBe(guards[1]);

      await close();
    });

    it("removes the sentinel guards on cleanup", async () => {
      const container = document.createElement("div");
      container.innerHTML = `<button>btn</button>`;
      document.body.appendChild(container);

      const close = await activate(container);
      expect(document.querySelectorAll(GUARD_SELECTOR).length).toBe(2);

      await close();
      expect(document.querySelectorAll(GUARD_SELECTOR).length).toBe(0);
    });

    it("marks guards aria-hidden so AT doesn't announce them", async () => {
      const container = document.createElement("div");
      container.innerHTML = `<button>btn</button>`;
      document.body.appendChild(container);

      const close = await activate(container);
      for (const guard of document.querySelectorAll(GUARD_SELECTOR)) {
        expect(guard.getAttribute("aria-hidden")).toBe("true");
      }
      await close();
    });

    it("excludes guards from the trap's focusable list", async () => {
      // The guard sentinels are tabIndex=0 and would be selected by the
      // [tabindex]:not([tabindex='-1']) rule if we didn't filter them.
      // With only one real focusable, Shift+Tab must wrap to that same
      // button, not to a guard.
      const container = document.createElement("div");
      const btn = document.createElement("button");
      btn.textContent = "only";
      container.appendChild(btn);
      document.body.appendChild(container);
      makeVisible(btn);

      const close = await activate(container);

      btn.focus();
      expect(document.activeElement).toBe(btn);

      container.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      // Still on btn — the trap's focusable list sees exactly one
      // element (not three), so first === last === btn, and wrapping
      // Shift+Tab on first lands back on last.
      expect(document.activeElement).toBe(btn);

      await close();
    });

    it("beforeGuard focus wraps to the last focusable in the container", async () => {
      const container = document.createElement("div");
      const first = document.createElement("button");
      first.id = "first";
      const last = document.createElement("button");
      last.id = "last";
      container.append(first, last);
      document.body.appendChild(container);
      makeVisible(first);
      makeVisible(last);

      const close = await activate(container);
      const beforeGuard = container.previousElementSibling as HTMLElement;
      expect(beforeGuard?.hasAttribute("data-stax-focus-guard")).toBe(true);

      // Simulate the browser moving focus to the before-guard (what
      // Shift+Tab from the first focusable, or Tab from a preceding
      // sibling in the browser's focus chain, would do).
      beforeGuard.dispatchEvent(new Event("focus"));
      expect(document.activeElement?.id).toBe("last");

      await close();
    });

    it("afterGuard focus wraps to the first focusable in the container", async () => {
      const container = document.createElement("div");
      const first = document.createElement("button");
      first.id = "first";
      const last = document.createElement("button");
      last.id = "last";
      container.append(first, last);
      document.body.appendChild(container);
      makeVisible(first);
      makeVisible(last);

      const close = await activate(container);
      const afterGuard = container.nextElementSibling as HTMLElement;
      expect(afterGuard?.hasAttribute("data-stax-focus-guard")).toBe(true);

      afterGuard.dispatchEvent(new Event("focus"));
      expect(document.activeElement?.id).toBe("first");

      await close();
    });
  });

  describe("existing behavior preserved", () => {
    it("focuses the first focusable element by default", async () => {
      const container = document.createElement("div");
      container.innerHTML = `
        <button id="first">first</button>
        <button id="second">second</button>
      `;
      document.body.appendChild(container);
      makeVisible(container.querySelector<HTMLButtonElement>("#first")!);
      makeVisible(container.querySelector<HTMLButtonElement>("#second")!);

      const close = await activate(container);

      expect(document.activeElement?.id).toBe("first");
      await close();
    });

    it("focuses initialFocus when provided", async () => {
      const container = document.createElement("div");
      container.innerHTML = `
        <button id="a">a</button>
        <button id="b">b</button>
      `;
      document.body.appendChild(container);
      makeVisible(container.querySelector<HTMLButtonElement>("#a")!);
      makeVisible(container.querySelector<HTMLButtonElement>("#b")!);

      const second = container.querySelector<HTMLButtonElement>("#b")!;
      const close = await activate(container, { initialFocus: second });

      expect(document.activeElement?.id).toBe("b");
      await close();
    });

    it("restores focus to the previously-focused element on cleanup", async () => {
      const trigger = document.createElement("button");
      trigger.id = "trigger";
      document.body.appendChild(trigger);
      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      const container = document.createElement("div");
      container.innerHTML = `<button id="inside">inside</button>`;
      document.body.appendChild(container);
      makeVisible(container.querySelector<HTMLButtonElement>("#inside")!);

      const close = await activate(container);
      expect(document.activeElement?.id).toBe("inside");

      await close();
      expect(document.activeElement).toBe(trigger);
    });
  });
});
