import { Effect, Scope } from "effect";

/**
 * Selector for focusable elements within a container.
 */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

/**
 * Options for creating a focus trap.
 */
export interface FocusTrapOptions {
  /** Element to trap focus within */
  readonly container: HTMLElement;
  /** Initial element to focus (default: first focusable element) */
  readonly initialFocus?: HTMLElement | null;
  /** Element to return focus to when deactivated (default: previously focused element) */
  readonly returnFocus?: HTMLElement | null;
}

/**
 * Marker attribute set on sentinel guard elements so the focusin fallback
 * knows to ignore focus landing on them — the guards' own focus handlers
 * do the right thing, and we don't want the fallback to race them.
 */
const GUARD_ATTR = "data-stax-focus-guard";

/**
 * Get all focusable elements within a container.
 */
const getFocusableElements = (container: HTMLElement): HTMLElement[] => {
  const elements = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  return Array.from(elements).filter(
    (el) =>
      !el.hasAttribute("disabled") &&
      el.getAttribute("aria-hidden") !== "true" &&
      !el.hasAttribute(GUARD_ATTR) &&
      el.offsetParent !== null, // Element is visible
  );
};

/**
 * Create an invisible, focusable sentinel. Browser Tab navigation lands
 * on it before any focus actually leaves the container, so we can redirect
 * cleanly instead of catching the escape after the fact.
 */
const makeGuard = (): HTMLDivElement => {
  const guard = document.createElement("div");
  guard.tabIndex = 0;
  guard.setAttribute(GUARD_ATTR, "");
  guard.setAttribute("aria-hidden", "true");
  // position:fixed keeps it out of flow; width/height 1px + opacity 0 keeps
  // it non-visible but still focusable (display:none / visibility:hidden
  // would strip it from the focus chain entirely).
  guard.style.cssText =
    "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;";
  return guard;
};

/**
 * Mark every sibling of the container's ancestor chain (up to and
 * including `document.body`'s children) as `inert`, so screen-reader
 * virtual cursors and pointer input can't reach anything outside the
 * trap. Returns the list of elements we actually set so the finalizer
 * can un-set only those — elements the caller or another layer had
 * already marked inert stay inert on cleanup.
 */
const markSiblingsInert = (container: HTMLElement): HTMLElement[] => {
  const inerted: HTMLElement[] = [];
  let node: Element | null = container;
  while (node && node.parentElement) {
    for (const sibling of Array.from(node.parentElement.children)) {
      if (sibling === node) continue;
      if (!(sibling instanceof HTMLElement)) continue;
      if (sibling.inert) continue;
      sibling.inert = true;
      inerted.push(sibling);
    }
    if (node.parentElement === document.body) break;
    node = node.parentElement;
  }
  return inerted;
};

/**
 * Create a focus trap that keeps focus within a container element.
 *
 * The focus trap:
 * - Focuses the first focusable element (or initialFocus) when activated
 * - Cycles focus with Tab/Shift+Tab at boundaries
 * - Marks every sibling of the container's ancestor chain as `inert`,
 *   so screen-reader virtual cursors and pointer input can't reach
 *   content outside the trap
 * - Inserts invisible focus-guard sentinels before and after the
 *   container so Tab from browser chrome / programmatic focus moves
 *   get redirected back in cleanly
 * - Restores focus to the previously focused element when deactivated
 * - Automatically cleans up when the scope closes
 *
 * @example
 * ```ts
 * // In a dialog component
 * const element = yield* contentRef.get;
 * yield* FocusTrap.make({
 *   container: element,
 *   returnFocus: triggerElement,
 * });
 * // Focus is now trapped within the dialog
 * // When scope closes, focus returns to triggerElement
 * ```
 */
export const FocusTrap = {
  make: (options: FocusTrapOptions): Effect.Effect<void, never, Scope.Scope> =>
    Effect.gen(function* () {
      // SSR safety - focus trapping only makes sense in browser
      if (typeof document === "undefined") return;

      const { container, initialFocus, returnFocus } = options;
      const previouslyFocused =
        returnFocus ?? (document.activeElement as HTMLElement | null);

      // 1. Inert the rest of the page. Do this BEFORE inserting the
      //    guards, otherwise the guards would land in the sibling scan
      //    and get marked inert themselves — which would make them
      //    unfocusable and defeat the whole point.
      const inerted = markSiblingsInert(container);

      // 2. Insert sentinel guards as the container's immediate siblings.
      //    Focus landing on the before-guard means Shift+Tab out of
      //    first focusable → wrap to last; after-guard means Tab out
      //    of last → wrap to first.
      const parent = container.parentElement;
      const beforeGuard = makeGuard();
      const afterGuard = makeGuard();
      if (parent) {
        parent.insertBefore(beforeGuard, container);
        parent.insertBefore(afterGuard, container.nextSibling);
      }

      const handleBeforeGuardFocus = () => {
        const focusables = getFocusableElements(container);
        focusables[focusables.length - 1]?.focus({ preventScroll: true });
      };
      const handleAfterGuardFocus = () => {
        const focusables = getFocusableElements(container);
        focusables[0]?.focus({ preventScroll: true });
      };
      beforeGuard.addEventListener("focus", handleBeforeGuardFocus);
      afterGuard.addEventListener("focus", handleAfterGuardFocus);

      // 3. Keydown handler for in-container Tab wrapping. The guards
      //    handle Tab-out, but a user tabbing *between* focusables
      //    inside the container should wrap at the boundaries without
      //    bouncing through a guard.
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Tab") return;

        const focusableElements = getFocusableElements(container);
        if (focusableElements.length === 0) {
          event.preventDefault();
          return;
        }

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (event.shiftKey) {
          // Shift+Tab: if on first element, wrap to last
          if (document.activeElement === firstElement) {
            event.preventDefault();
            lastElement.focus({ preventScroll: true });
          }
        } else {
          // Tab: if on last element, wrap to first
          if (document.activeElement === lastElement) {
            event.preventDefault();
            firstElement.focus({ preventScroll: true });
          }
        }
      };

      // 4. Document-level focusin fallback. Catches programmatic focus
      //    moves that bypass Tab navigation entirely (e.g. a click
      //    handler calling .focus() on something outside the container).
      //    Must skip our own guard elements — their dedicated handlers
      //    do the right thing, and we don't want to race them.
      const handleFocusIn = (event: FocusEvent) => {
        const target = event.target as Element | null;
        if (!target) return;
        if (target === beforeGuard || target === afterGuard) return;
        if (!container.contains(target as Node)) {
          event.stopPropagation();
          const focusableElements = getFocusableElements(container);
          if (focusableElements.length > 0) {
            focusableElements[0].focus({ preventScroll: true });
          }
        }
      };

      container.addEventListener("keydown", handleKeyDown);
      document.addEventListener("focusin", handleFocusIn);

      // 5. Focus the initial element.
      const focusableElements = getFocusableElements(container);
      if (initialFocus && container.contains(initialFocus)) {
        initialFocus.focus({ preventScroll: true });
      } else if (focusableElements.length > 0) {
        focusableElements[0].focus({ preventScroll: true });
      } else {
        // If no focusable elements, focus the container itself
        container.setAttribute("tabindex", "-1");
        container.focus({ preventScroll: true });
      }

      // Cleanup when scope closes
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          container.removeEventListener("keydown", handleKeyDown);
          document.removeEventListener("focusin", handleFocusIn);

          // Un-inert only the elements we marked. Anything the caller
          // or another layer had set stays set.
          for (const el of inerted) {
            el.inert = false;
          }

          // Remove sentinels + their listeners (removing the node
          // disconnects the listeners too, but being explicit keeps
          // the intent clear).
          beforeGuard.removeEventListener("focus", handleBeforeGuardFocus);
          afterGuard.removeEventListener("focus", handleAfterGuardFocus);
          beforeGuard.remove();
          afterGuard.remove();

          // Restore focus to previously focused element
          if (
            previouslyFocused &&
            previouslyFocused !== document.body &&
            document.body.contains(previouslyFocused)
          ) {
            previouslyFocused.focus({ preventScroll: true });
          }
        }),
      );
    }),
};
