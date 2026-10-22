/**
 * Virtual node types for SSR representation.
 * These are used by StringRenderer to build a tree that can be serialized to HTML.
 */

export type VNode = VElement | VText | VComment | VFragment;

export interface VElement {
  readonly _tag: "VElement";
  readonly type: string;
  attributes: Record<string, string>;
  children: VNode[];
  /** Raw innerHTML content (bypasses escaping) */
  _innerHTML?: string;
}

export interface VText {
  readonly _tag: "VText";
  content: string;
}

export interface VComment {
  readonly _tag: "VComment";
  content: string;
}

/**
 * Virtual DocumentFragment. Mirrors DOM semantics: appending a VFragment to a
 * parent flattens its children into the parent and leaves the fragment empty.
 * This lets a control-flow function return a sentinel-anchored group of
 * sibling nodes (`[VComment("$stax-N"), ...slots, VComment("/stax-N")]`) that
 * the parent's `appendChild` inlines without needing a wrapper element.
 */
export interface VFragment {
  readonly _tag: "VFragment";
  children: VNode[];
}

export const vElement = (type: string): VElement => ({
  _tag: "VElement",
  type,
  attributes: {},
  children: [],
});

export const vText = (content: string): VText => ({
  _tag: "VText",
  content,
});

export const vComment = (content: string): VComment => ({
  _tag: "VComment",
  content,
});

export const vFragment = (): VFragment => ({
  _tag: "VFragment",
  children: [],
});
