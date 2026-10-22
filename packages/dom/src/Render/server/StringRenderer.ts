import { Effect } from "effect";

import { Readable, type Renderer, type Slot } from "@stax-ui/core";

import { warnIfInvalidNesting } from "../validateNesting.js";
import {
  vComment,
  vElement,
  vFragment,
  vText,
  type VElement,
  type VFragment,
  type VNode,
  type VText,
} from "./VNode.js";

/** A VNode that can hold children — the only parents our mutation ops accept. */
type VContainer = VElement | VFragment;

const isContainer = (node: VNode): node is VContainer =>
  node._tag === "VElement" || node._tag === "VFragment";

/**
 * Attach `child` into `parent.children` at `index` (or push if negative).
 * If `child` is a VFragment, flatten its children in-place at that insertion
 * point — DOM `appendChild(fragment)` semantics.
 */
const spliceChild = (
  parent: VContainer,
  child: VNode,
  index: number,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (child._tag === "VFragment") {
      const kids = child.children.slice();
      child.children.length = 0;
      let cursor = index < 0 ? parent.children.length : index;
      for (const grandChild of kids) {
        yield* spliceChild(parent, grandChild, cursor);
        cursor++;
      }
      return;
    }

    if (parent._tag === "VElement" && child._tag === "VElement") {
      yield* warnIfInvalidNesting(parent.type, child.type);
    }

    if (index < 0) {
      parent.children.push(child);
    } else {
      parent.children.splice(index, 0, child);
    }

    // Track parent reference for slot markers (used by SSR `createSlot`).
    if (child._tag === "VComment") {
      (child as unknown as { _parent?: VContainer })._parent = parent;
    }
  });

export const StringRenderer: Renderer<VNode> = {
  environment: "ssr",
  createNode: (type: string, _namespace?: string) =>
    Effect.sync(() => vElement(type)),

  createTextNode: (text: string) => Effect.sync(() => vText(text)),

  createComment: (content: string) => Effect.sync(() => vComment(content)),

  createFragment: () => Effect.sync(() => vFragment()),

  appendChild: (parent: VNode, child: VNode) =>
    isContainer(parent) ? spliceChild(parent, child, -1) : Effect.void,

  removeChild: (parent: VNode, child: VNode) =>
    Effect.sync(() => {
      if (!isContainer(parent)) return;
      const index = parent.children.indexOf(child);
      if (index > -1) parent.children.splice(index, 1);
    }),

  replaceChild: (parent: VNode, newChild: VNode, oldChild: VNode) =>
    Effect.sync(() => {
      if (!isContainer(parent)) return;
      const index = parent.children.indexOf(oldChild);
      if (index > -1) parent.children[index] = newChild;
    }),

  insertBefore: (parent: VNode, child: VNode, reference: VNode | null) =>
    Effect.gen(function* () {
      if (!isContainer(parent)) return;
      const index =
        reference === null ? -1 : parent.children.indexOf(reference);
      yield* spliceChild(parent, child, index);
    }),

  setAttribute: (node: VNode, key: string, value: unknown) =>
    Effect.sync(() => {
      if (node._tag === "VElement") {
        if (value === null || value === undefined) {
          delete node.attributes[key];
        } else if (typeof value === "boolean") {
          if (value) {
            node.attributes[key] = "";
          } else {
            delete node.attributes[key];
          }
        } else {
          node.attributes[key] = String(value);
        }
      }
    }),

  removeAttribute: (node: VNode, key: string) =>
    Effect.sync(() => {
      if (node._tag === "VElement") {
        delete node.attributes[key];
      }
    }),

  setClassName: (node: VNode, className: string) =>
    Effect.sync(() => {
      if (node._tag === "VElement") {
        if (className) {
          node.attributes.class = className;
        } else {
          delete node.attributes.class;
        }
      }
    }),

  setStyleProperty: (node: VNode, property: string, value: string) =>
    Effect.sync(() => {
      if (node._tag === "VElement") {
        const existing = node.attributes.style ?? "";
        // Convert camelCase to kebab-case for CSS
        const cssProperty = property.replace(
          /[A-Z]/g,
          (m) => `-${m.toLowerCase()}`,
        );
        if (existing) {
          node.attributes.style = `${existing}; ${cssProperty}: ${value}`;
        } else {
          node.attributes.style = `${cssProperty}: ${value}`;
        }
      }
    }),

  removeStyleProperty: (node: VNode, property: string) =>
    Effect.sync(() => {
      if (node._tag === "VElement" && node.attributes.style) {
        // Convert camelCase to kebab-case for CSS
        const cssProperty = property.replace(
          /[A-Z]/g,
          (m) => `-${m.toLowerCase()}`,
        );
        // Simple implementation: remove the property from the style string
        const styles = node.attributes.style
          .split(";")
          .map((s) => s.trim())
          .filter((s) => !s.startsWith(`${cssProperty}:`));
        if (styles.length === 0) {
          delete node.attributes.style;
        } else {
          node.attributes.style = styles.join("; ");
        }
      }
    }),

  toggleClass: (node: VNode, className: string, force?: boolean) =>
    Effect.sync(() => {
      if (node._tag === "VElement") {
        const current = node.attributes.class ?? "";
        const classes = current.split(/\s+/).filter(Boolean);
        const hasClass = classes.includes(className);

        const shouldAdd = force !== undefined ? force : !hasClass;

        if (shouldAdd && !hasClass) {
          classes.push(className);
        } else if (!shouldAdd && hasClass) {
          const index = classes.indexOf(className);
          classes.splice(index, 1);
        }

        if (classes.length === 0) {
          delete node.attributes.class;
        } else {
          node.attributes.class = classes.join(" ");
        }
      }
    }),

  setTextContent: (node: VNode, text: string) =>
    Effect.sync(() => {
      if (node._tag === "VElement") {
        node.children = [vText(text)];
      } else if (node._tag === "VText") {
        (node as VText).content = text;
      }
    }),

  setInnerHTML: (node: VNode, html: string) =>
    Effect.sync(() => {
      if (node._tag === "VElement") {
        (node as VElement)._innerHTML = html;
        node.children = [];
      }
    }),

  setInputValue: (node: VNode, value: string) =>
    Effect.sync(() => {
      if (node._tag === "VElement") {
        node.attributes.value = value;
      }
    }),

  addEventListener: (_node: VNode, _event: string, _handler: unknown) =>
    // No-op for SSR - events don't run on server
    Effect.void,

  getChildren: (node: VNode) =>
    Effect.sync(() => (isContainer(node) ? node.children : [])),

  hydrationPhase: Readable.of(false),

  completeHydration: Effect.void,

  finalizeNode: () => Effect.void,

  pushHydrationParent: () => Effect.void,

  enterPreresolvedNode: () => Effect.void,

  enterSentinelAnchor: () => Effect.void,

  exitSentinelAnchor: () => Effect.void,

  createSlot: () =>
    Effect.sync((): Slot<VNode> => {
      const marker = vComment("stax-slot");
      let currentContent: VNode | null = null;

      // Helper to find parent and index of marker
      const findMarkerContext = (): {
        parent: VElement;
        index: number;
      } | null => {
        // For SSR, we need a way to track the parent.
        // We'll use a simple approach: store parent reference on marker
        const parent = (marker as unknown as { _parent?: VElement })._parent;
        if (!parent) return null;
        const index = parent.children.indexOf(marker);
        if (index === -1) return null;
        return { parent, index };
      };

      return {
        marker,
        setContent: (content: VNode) =>
          Effect.sync(() => {
            const ctx = findMarkerContext();
            if (!ctx) return;

            const { parent, index } = ctx;
            const contentIndex = index + 1;

            if (currentContent) {
              // Replace existing content
              const existingIndex = parent.children.indexOf(currentContent);
              if (existingIndex !== -1) {
                parent.children[existingIndex] = content;
              }
            } else {
              // Insert content after marker
              parent.children.splice(contentIndex, 0, content);
            }
            currentContent = content;
          }),
        clear: () =>
          Effect.sync(() => {
            const ctx = findMarkerContext();
            if (!ctx || !currentContent) return;

            const { parent } = ctx;
            const contentIndex = parent.children.indexOf(currentContent);
            if (contentIndex !== -1) {
              parent.children.splice(contentIndex, 1);
            }
            currentContent = null;
          }),
      };
    }),
};
