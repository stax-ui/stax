import { Effect, Layer } from "effect";

import {
  Readable,
  RendererContext,
  type Renderer,
  type Slot,
} from "@stax-ui/core";

import { toKebabCase } from "../helpers/index.js";
import { warnIfInvalidNesting } from "./validateNesting.js";

const tagNameOf = (node: Node): string | undefined =>
  node.nodeType === 1 ? (node as Element).tagName.toLowerCase() : undefined;

/**
 * DOM implementation of the Renderer interface.
 * Uses browser DOM APIs to create and manipulate elements.
 */
export const DOMRenderer: Renderer<Node> = {
  environment: "dom",
  createNode: (type: string, namespace?: string) =>
    Effect.sync(() =>
      namespace
        ? document.createElementNS(namespace, type)
        : document.createElement(type),
    ),

  createTextNode: (text: string) =>
    Effect.sync(() => document.createTextNode(text)),

  createComment: (content: string) =>
    Effect.sync(() => document.createComment(content)),

  createFragment: () => Effect.sync(() => document.createDocumentFragment()),

  appendChild: (parent: Node, child: Node) =>
    Effect.gen(function* () {
      yield* warnIfInvalidNesting(tagNameOf(parent), tagNameOf(child));
      parent.appendChild(child);
    }),

  removeChild: (parent: Node, child: Node) =>
    Effect.sync(() => {
      parent.removeChild(child);
    }),

  replaceChild: (parent: Node, newChild: Node, oldChild: Node) =>
    Effect.sync(() => {
      parent.replaceChild(newChild, oldChild);
    }),

  insertBefore: (parent: Node, child: Node, reference: Node | null) =>
    Effect.sync(() => {
      parent.insertBefore(child, reference);
    }),

  setAttribute: (node: Node, key: string, value: unknown) =>
    Effect.sync(() => {
      const element = node as HTMLElement;
      if (value === null || value === undefined) {
        element.removeAttribute(key);
      } else if (typeof value === "boolean") {
        if (value) {
          element.setAttribute(key, "");
        } else {
          element.removeAttribute(key);
        }
      } else {
        element.setAttribute(key, String(value));
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
      (node as HTMLElement).style.setProperty(toKebabCase(property), value);
    }),

  removeStyleProperty: (node: Node, property: string) =>
    Effect.sync(() => {
      (node as HTMLElement).style.removeProperty(toKebabCase(property));
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
      const element = node as HTMLInputElement;
      // Only update if different to prevent cursor position reset
      if (element.value !== value) {
        element.value = value;
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

  hydrationPhase: Readable.of(false),

  completeHydration: Effect.void,

  finalizeNode: () => Effect.void,

  pushHydrationParent: () => Effect.void,

  enterPreresolvedNode: () => Effect.void,

  createSlot: () =>
    Effect.sync((): Slot<Node> => {
      // Use a fragment to hold marker and initial content before DOM insertion
      const fragment = document.createDocumentFragment();
      const marker = document.createComment("stax-slot");
      fragment.appendChild(marker);
      let currentContent: Node | null = null;
      console.log("create slot, marker created:", marker);

      return {
        // Return fragment so both marker and content get inserted together
        marker: fragment,
        setContent: (content: Node) =>
          Effect.sync(() => {
            console.log("Setting slot content:", content);
            if (currentContent) {
              // Replace existing content
              const parent = currentContent.parentNode;
              if (parent) {
                parent.replaceChild(content, currentContent);
              }
            } else {
              // Initial content - marker is either in fragment or real DOM
              const parent = marker.parentNode;
              if (parent) {
                parent.insertBefore(content, marker.nextSibling);
              }
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

/**
 * Layer that provides the DOMRenderer to the application.
 */
export const DOMRendererLive = Layer.succeed(
  RendererContext,
  DOMRenderer as Renderer<unknown>,
);
