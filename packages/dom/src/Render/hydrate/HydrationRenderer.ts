/**
 * Hydration renderer that attaches to existing DOM using tree walking.
 */

import { Effect, Stream } from "effect";

import { Readable, type Renderer, type Slot } from "@stax-ui/core";

import type { HydrateOptions } from "./index.js";

/**
 * Context for tracking current hydration state.
 * Used by control flow components to find their containers.
 */
export interface HydrationState {
  readonly root: HTMLElement | SVGElement;
  readonly onMismatch: (message: string, node: Node | null) => void;
}

/**
 * Create a hydration renderer that attaches to existing DOM.
 *
 * Unlike DOMRenderer which creates new elements, HydrationRenderer
 * finds existing elements via tree walking and attaches handlers.
 *
 * The renderer uses a stack-based approach to track the current parent
 * and child index, properly handling nested element structures.
 */
export const createHydrationRenderer = (
  container: HTMLElement | SVGElement,
  options: HydrateOptions = {},
): Renderer<Node> => {
  const onMismatch =
    options.onMismatch ??
    ((message, _node) => {
      if (typeof console !== "undefined") {
        console.warn(`[Stax Hydration] ${message}`);
      }
    });

  // Stack to track parent context during hydration
  // Each entry is [parent, childIndex]
  const parentStack: Array<{ parent: Node; childIndex: number }> = [
    { parent: container, childIndex: 0 },
  ];

  const getCurrentContext = () => parentStack[parentStack.length - 1];

  // Reactive hydration phase. Browser-only reactive values (Screen.match,
  // etc.) observe this to serve their SSR-safe fallback during the initial
  // walk and switch to the live value once `completeHydration` fires.
  //
  // A tiny hand-rolled pubsub — using SubscriptionRef would need a Scope
  // during renderer construction, and the renderer factory is a plain sync
  // function.
  let hydrating = true;
  const phaseSubscribers = new Set<(v: boolean) => void>();
  const hydrationPhase = Readable.make(
    Effect.sync(() => hydrating),
    () =>
      Stream.async<boolean>((emit) => {
        const cb = (v: boolean) => emit.single(v);
        phaseSubscribers.add(cb);
        return Effect.sync(() => {
          phaseSubscribers.delete(cb);
        });
      }),
  );

  const renderer: Renderer<Node> = {
    environment: "dom-hydration",
    createNode: (type: string, namespace?: string) =>
      Effect.sync(() => {
        const ctx = getCurrentContext();
        const children = ctx.parent.childNodes;
        let node: Node | null = null;

        // Find the next element node of the expected type
        while (ctx.childIndex < children.length) {
          const child = children[ctx.childIndex];
          if (
            child.nodeType === Node.ELEMENT_NODE &&
            (child as Element).tagName.toLowerCase() === type
          ) {
            node = child;
            ctx.childIndex++;
            break;
          } else if (child.nodeType === Node.TEXT_NODE) {
            // Skip whitespace text nodes
            if (child.textContent?.trim() === "") {
              ctx.childIndex++;
              continue;
            }
          }
          ctx.childIndex++;
        }

        if (!node) {
          onMismatch(
            `Expected <${type}> but not found in ${(ctx.parent as Element).tagName || "root"}`,
            ctx.parent,
          );
          // Fallback: create the element (hydration failure recovery)
          return namespace
            ? document.createElementNS(namespace, type)
            : document.createElement(type);
        }

        // Push a new context for this element's children
        parentStack.push({ parent: node, childIndex: 0 });

        return node;
      }),

    createComment: (content: string) =>
      Effect.sync(() => document.createComment(content)),

    createFragment: () => Effect.sync(() => document.createDocumentFragment()),

    createTextNode: (text: string) =>
      Effect.sync(() => {
        const ctx = getCurrentContext();
        const children = ctx.parent.childNodes;
        let node: Node | null = null;

        // Find the next text node
        while (ctx.childIndex < children.length) {
          const child = children[ctx.childIndex];
          if (child.nodeType === Node.TEXT_NODE) {
            node = child;
            ctx.childIndex++;
            break;
          } else if (
            child.nodeType === Node.ELEMENT_NODE &&
            (child as Element).tagName.toLowerCase() === "span" &&
            (child as Element).hasAttribute("data-stax-text")
          ) {
            // Reactive text is wrapped in a span
            node = child.firstChild ?? document.createTextNode(text);
            ctx.childIndex++;
            break;
          }
          ctx.childIndex++;
        }

        if (!node) {
          // Fallback: create the text node
          return document.createTextNode(text);
        }

        // Verify content matches
        if (node.textContent !== text) {
          onMismatch(
            `Text mismatch: expected "${text}", got "${node.textContent}"`,
            node,
          );
          node.textContent = text;
        }

        return node;
      }),

    appendChild: (_parent: Node, _child: Node) =>
      Effect.sync(() => {
        // During hydration, children are already in place — no-op.
        // Stack management is handled by createNode (push) and finalizeNode (pop).
      }),

    removeChild: (parent: Node, child: Node) =>
      Effect.sync(() => {
        if (parent.contains(child)) {
          parent.removeChild(child);
        }
      }),

    replaceChild: (parent: Node, newChild: Node, oldChild: Node) =>
      Effect.sync(() => {
        if (parent.contains(oldChild)) {
          parent.replaceChild(newChild, oldChild);
        }
      }),

    insertBefore: (parent: Node, child: Node, reference: Node | null) =>
      Effect.sync(() => {
        if (!parent.contains(child)) {
          parent.insertBefore(child, reference);
        }
      }),

    setAttribute: (node: Node, key: string, value: unknown) =>
      Effect.sync(() => {
        const el = node as HTMLElement;

        // Class attribute during hydration: merge the developer's classes
        // with whatever is already on the element. SSR may have added
        // classes on top of what the developer requested — most notably
        // `enterFrom` classes for `intro: true` controls (see
        // SSRControlCtx.addSlot). Overwriting the class here strips those
        // extras before the enter animation fiber gets a chance to run
        // its lifecycle, so the transition has no start state to move
        // away from — enterTo sets a value the property already has, no
        // transitionend fires, and every intro animation stalls until
        // the timeout.
        //
        // Merging is safe: SSR and hydration render the same tree so the
        // developer's `value` should be a subset of what's already there.
        // Any developer classes not in the DOM get added; SSR extras stay.
        if (key === "class" && typeof value === "string") {
          const requested = value.split(/\s+/).filter(Boolean);
          for (const cls of requested) el.classList.add(cls);
          return;
        }

        if (value === null || value === undefined) {
          el.removeAttribute(key);
        } else if (typeof value === "boolean") {
          if (value) {
            el.setAttribute(key, "");
          } else {
            el.removeAttribute(key);
          }
        } else {
          el.setAttribute(key, String(value));
        }
      }),

    removeAttribute: (node: Node, key: string) =>
      Effect.sync(() => {
        (node as HTMLElement).removeAttribute(key);
      }),

    setClassName: (node: Node, className: string) =>
      Effect.sync(() => {
        (node as HTMLElement).className = className;
      }),

    setStyleProperty: (node: Node, property: string, value: string) =>
      Effect.sync(() => {
        // Convert camelCase to kebab-case for CSS (setProperty requires kebab-case)
        const cssProperty = property.replace(
          /[A-Z]/g,
          (m) => `-${m.toLowerCase()}`,
        );
        (node as HTMLElement).style.setProperty(cssProperty, value);
      }),

    removeStyleProperty: (node: Node, property: string) =>
      Effect.sync(() => {
        const cssProperty = property.replace(
          /[A-Z]/g,
          (m) => `-${m.toLowerCase()}`,
        );
        (node as HTMLElement).style.removeProperty(cssProperty);
      }),

    toggleClass: (node: Node, className: string, force?: boolean) =>
      Effect.sync(() => {
        (node as HTMLElement).classList.toggle(className, force);
      }),

    setTextContent: (node: Node, text: string) =>
      Effect.sync(() => {
        node.textContent = text;
      }),

    setInnerHTML: (node: Node, html: string) =>
      Effect.sync(() => {
        (node as HTMLElement).innerHTML = html;
      }),

    setInputValue: (node: Node, value: string) =>
      Effect.sync(() => {
        const el = node as HTMLInputElement;
        if (el.value !== value) {
          el.value = value;
        }
      }),

    addEventListener: (
      node: Node,
      event: string,
      handler: (event: unknown) => void,
      options?: AddEventListenerOptions,
    ) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          (node as HTMLElement).addEventListener(event, handler, options);
        }),
        () =>
          Effect.sync(() => {
            (node as HTMLElement).removeEventListener(event, handler, options);
          }),
      ),

    getChildren: (node: Node) => Effect.sync(() => Array.from(node.childNodes)),

    hydrationPhase,

    completeHydration: Effect.sync(() => {
      if (!hydrating) return;
      hydrating = false;
      for (const cb of phaseSubscribers) cb(false);
    }),

    finalizeNode: (node: Node) =>
      Effect.sync(() => {
        // Pop the context that was pushed by createNode for this element.
        // This must be called after the element's children have been processed,
        // so sibling elements are searched in the correct parent context.
        if (
          parentStack.length > 1 &&
          parentStack[parentStack.length - 1].parent === node
        ) {
          parentStack.pop();
        }
      }),

    pushHydrationParent: (node: Node) =>
      Effect.sync(() => {
        // Resume hydration inside `node`. Used by reconcile after a forked
        // ControlCtx has walked to its containerElement — the container's
        // own createElement already pushed and popped its stack frame
        // (via createNode+finalizeNode), so the walker is one level too
        // shallow when addSlot begins looking for slot nodes inside the
        // container. Push a fresh frame at childIndex 0 so the next
        // createNode call finds children in the right parent.
        parentStack.push({ parent: node, childIndex: 0 });
      }),

    enterPreresolvedNode: (node: Node) =>
      Effect.sync(() => {
        // Fast path for ID-based container lookup: given a node resolved
        // via the hydration pre-index, do two things atomically:
        //   1. Advance the current parent's cursor past `node` so sibling
        //      lookups resume after it.
        //   2. Push `node` as a new parent frame so subsequent child
        //      lookups walk inside it.
        //
        // Replaces the `createNode(type) + pushHydrationParent(container)`
        // pair that the slow (positional-walk) path uses. The caller
        // already knows which node to use, so there's no sibling scan.
        const ctx = getCurrentContext();
        const children = ctx.parent.childNodes;
        // Scan forward from the cursor to locate `node`. In well-formed
        // SSR, `node` is at or just past the current index — but there
        // may be whitespace or comment siblings between the cursor and
        // the target node that we need to step over. If we reach the
        // end without finding `node`, treat it as a mismatch: leave the
        // cursor alone (callers can fall back) but still push the node
        // so children can hydrate against it.
        for (let i = ctx.childIndex; i < children.length; i++) {
          if (children[i] === node) {
            ctx.childIndex = i + 1;
            break;
          }
        }
        parentStack.push({ parent: node, childIndex: 0 });
      }),

    createSlot: () =>
      Effect.sync((): Slot<Node> => {
        const ctx = getCurrentContext();
        const children = ctx.parent.childNodes;
        let marker: Comment | null = null;

        // Find an existing comment marker
        while (ctx.childIndex < children.length) {
          const child = children[ctx.childIndex];
          if (
            child.nodeType === Node.COMMENT_NODE &&
            (child as Comment).textContent === "stax-slot"
          ) {
            marker = child as Comment;
            ctx.childIndex++;
            break;
          }
          ctx.childIndex++;
        }

        // Fallback: create a new marker if not found
        if (!marker) {
          marker = document.createComment("stax-slot");
        }

        let currentContent: Node | null = null;

        return {
          marker,
          setContent: (content: Node) =>
            Effect.sync(() => {
              const parent = marker!.parentNode;
              if (!parent) return;

              if (currentContent) {
                parent.replaceChild(content, currentContent);
              } else {
                parent.insertBefore(content, marker!.nextSibling);
              }
              currentContent = content;
            }),
          clear: () =>
            Effect.sync(() => {
              if (currentContent && currentContent.parentNode) {
                currentContent.parentNode.removeChild(currentContent);
                currentContent = null;
              }
            }),
        };
      }),
  };

  return renderer;
};

/**
 * Type alias for the hydration renderer.
 */
export type HydrationRenderer = Renderer<Node>;
