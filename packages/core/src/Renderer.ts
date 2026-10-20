import { Context, Effect, Scope } from "effect";

import { Readable } from "./Readable.js";

/**
 * A slot is a swappable content placeholder.
 * Used by Boundary.suspense to swap fallback content with actual content
 * without needing a container element.
 *
 * @template Node - The node type for this renderer
 */
export interface Slot<Node> {
  /**
   * The marker node that represents this slot in the tree.
   * This is typically a Comment node in DOM, or a VComment in SSR.
   */
  readonly marker: Node;

  /**
   * Set the content of this slot.
   * Replaces any existing content with the new node.
   */
  readonly setContent: (content: Node) => Effect.Effect<void>;

  /**
   * Clear the content of this slot.
   * Removes the current content, leaving only the marker.
   */
  readonly clear: () => Effect.Effect<void>;
}

/**
 * Abstract renderer interface for creating and manipulating a node tree.
 * Implementations can target DOM, strings (SSR), terminal, native, etc.
 *
 * @template Node - The node type for this renderer (e.g., HTMLElement, VNode, string)
 */
export interface Renderer<Node> {
  /**
   * A string identifying the rendering environment (e.g., "dom", "ssr", "terminal").
   * Useful for conditional logic in components that need to behave differently
   * in different environments.
   */
  readonly environment: string;
  /**
   * Create an element node of the given type.
   * @param type - The element tag name
   * @param namespace - Optional namespace URI (e.g., "http://www.w3.org/2000/svg" for SVG)
   */
  readonly createNode: (
    type: string,
    namespace?: string,
  ) => Effect.Effect<Node>;

  /**
   * Create a text node with the given content.
   */
  readonly createTextNode: (text: string) => Effect.Effect<Node>;

  /**
   * Create a comment node with the given content. Used by sentinel-anchored
   * control-flow containers to delimit the group of slot nodes they manage.
   * Non-DOM renderers (SSR) produce a comment vnode that serializes to
   * `<!--content-->`.
   */
  readonly createComment: (content: string) => Effect.Effect<Node>;

  /**
   * Create an empty fragment node. Appending a fragment to a parent flattens
   * its children into the parent (DOM semantics); SSR mirrors this via
   * `VFragment`. Used by control-flow containers to return a sentinel-wrapped
   * slot group without introducing a wrapper element in the output.
   */
  readonly createFragment: () => Effect.Effect<Node>;

  /**
   * Append a child node to a parent node.
   */
  readonly appendChild: (parent: Node, child: Node) => Effect.Effect<void>;

  /**
   * Remove a child node from a parent node.
   */
  readonly removeChild: (parent: Node, child: Node) => Effect.Effect<void>;

  /**
   * Replace an old child node with a new one.
   */
  readonly replaceChild: (
    parent: Node,
    newChild: Node,
    oldChild: Node,
  ) => Effect.Effect<void>;

  /**
   * Insert a child before a reference node.
   */
  readonly insertBefore: (
    parent: Node,
    child: Node,
    reference: Node | null,
  ) => Effect.Effect<void>;

  /**
   * Set an attribute on a node.
   * If value is null/undefined, the attribute should be removed.
   * If value is a boolean, true sets empty string, false removes.
   */
  readonly setAttribute: (
    node: Node,
    key: string,
    value: unknown,
  ) => Effect.Effect<void>;

  /**
   * Remove an attribute from a node.
   */
  readonly removeAttribute: (node: Node, key: string) => Effect.Effect<void>;

  /**
   * Set the className of a node.
   */
  readonly setClassName: (node: Node, className: string) => Effect.Effect<void>;

  /**
   * Set a CSS style property on a node.
   */
  readonly setStyleProperty: (
    node: Node,
    property: string,
    value: string,
  ) => Effect.Effect<void>;

  /**
   * Remove a CSS style property from a node.
   */
  readonly removeStyleProperty: (
    node: Node,
    property: string,
  ) => Effect.Effect<void>;

  /**
   * Toggle a CSS class on a node.
   * @param force - If true, adds the class; if false, removes it; if undefined, toggles
   */
  readonly toggleClass: (
    node: Node,
    className: string,
    force?: boolean,
  ) => Effect.Effect<void>;

  /**
   * Set the text content of a node.
   */
  readonly setTextContent: (node: Node, text: string) => Effect.Effect<void>;

  /**
   * Set the innerHTML of a node.
   * Note: This may not be supported by all renderers.
   */
  readonly setInnerHTML: (node: Node, html: string) => Effect.Effect<void>;

  /**
   * Set the value property of an input-like node.
   */
  readonly setInputValue: (node: Node, value: string) => Effect.Effect<void>;

  /**
   * Add an event listener to a node. Scoped — the listener is removed
   * when the enclosing `Scope` closes. Callers don't need to register
   * their own finalizer.
   *
   * `options` is passed through to the underlying `addEventListener`
   * (matters for `once`, `capture`, `passive`); the same values are
   * passed to `removeEventListener` in the finalizer so the listener
   * is correctly identified for removal.
   *
   * Non-interactive renderers (SSR) treat this as a no-op.
   */
  readonly addEventListener: (
    node: Node,
    event: string,
    handler: (event: unknown) => void,
    options?: AddEventListenerOptions,
  ) => Effect.Effect<void, never, Scope.Scope>;

  /**
   * Get children of a node (for traversal during hydration).
   */
  readonly getChildren: (node: Node) => Effect.Effect<readonly Node[]>;

  /**
   * Reactive hydration phase — `true` while the initial hydration walk is
   * in progress, `false` afterwards (or from the outset for non-hydration
   * renderers). Observed by browser-only reactive values (e.g.
   * `Screen.match`) that need to serve their SSR-safe fallback during
   * hydration and switch to the live value once hydration completes, so
   * the first client render matches the SSR HTML.
   */
  readonly hydrationPhase: Readable.Readable<boolean>;

  /**
   * Mark the initial hydration walk as complete — flips `hydrationPhase`
   * from `true` to `false` and emits the transition to subscribers.
   * Called by `hydrate()` after the initial `Effect.provide(element, …)`
   * returns; no-op for non-hydration renderers.
   */
  readonly completeHydration: Effect.Effect<void>;

  /**
   * Signal that an element created with createNode has been fully built
   * (attributes set, children appended). Used by the hydration renderer
   * to pop its traversal context. No-op for other renderers.
   */
  readonly finalizeNode: (node: Node) => Effect.Effect<void>;

  /**
   * Resume a hydration walk inside a node whose subtree hasn't been fully
   * consumed yet. Used by reconcile after a forked ControlCtx builds its
   * `containerElement` via `create()` — `create()`'s inner `finalizeNode`
   * pops the container off the stack, and subsequent `addSlot` renders
   * need it back on top so they find the SSR slot nodes inside.
   *
   * The complementary pop is `finalizeNode(node)`, which is invoked
   * indirectly by `finalizeContainer` at the end of reconcile.
   *
   * No-op for renderers that don't maintain a traversal stack.
   */
  readonly pushHydrationParent: (node: Node) => Effect.Effect<void>;

  /**
   * Hydration fast path: given a pre-resolved node (e.g. looked up in
   * `O(1)` from the hydration-id pre-index), advance the walker as if
   * `createNode` had just found it, then push it as a new parent frame
   * for subsequent child walking.
   *
   * Combines two operations atomically: scan forward in the current
   * parent's children until we hit the given node (so sibling lookups
   * resume after it), then push it onto the parent stack. Replaces the
   * `createNode(type) + pushHydrationParent(container)` pair used by the
   * slow (positional-walking) path.
   *
   * No-op on renderers that don't maintain a traversal stack. If the
   * node is not found at or after the current parent cursor, the walker
   * is unchanged — callers should treat that as a hydration mismatch
   * and fall back to the slow path.
   *
   * Pair with `finalizeNode(node)` to pop, same as `createNode`.
   */
  readonly enterPreresolvedNode: (node: Node) => Effect.Effect<void>;

  /**
   * Hydration fast path for sentinel-anchored control containers.
   * Advance the current parent cursor past `start` (a `<!--$stax-N-->`
   * comment resolved via the pre-index) without pushing a new parent
   * frame — the slots of a sentinel-anchored control are *siblings*
   * of the sentinel pair, not children, so slot renders should keep
   * walking in the same parent context.
   *
   * Pair with `exitSentinelAnchor(end)` at the end of the control's
   * initial sync to skip the walker cursor past the end sentinel so
   * surrounding siblings resume walking from the right position.
   *
   * No-op on renderers that don't maintain a traversal stack.
   */
  readonly enterSentinelAnchor: (start: Node) => Effect.Effect<void>;

  /**
   * Hydration fast path for sentinel-anchored control containers.
   * Advance the current parent cursor past `end` (a `<!--/stax-N-->`
   * comment) so sibling walking resumes after the control's slot
   * group. Pair with a preceding `enterSentinelAnchor(start)`.
   *
   * No-op on renderers that don't maintain a traversal stack.
   */
  readonly exitSentinelAnchor: (end: Node) => Effect.Effect<void>;

  /**
   * Create a slot for swappable content.
   * Used by Boundary.suspense to swap fallback with actual content.
   * Returns a Slot with a marker node and methods to set/clear content.
   */
  readonly createSlot: () => Effect.Effect<Slot<Node>>;
}

/**
 * Context tag for the Renderer service.
 * Components access the renderer through this context.
 */
export class RendererContext extends Context.Tag("@stax-ui/Renderer")<
  RendererContext,
  Renderer<unknown>
>() {}

/**
 * Renderer namespace containing the interface and context.
 */
export const Renderer = {
  Context: RendererContext,
};
