// Export Element as a namespace — values come from `export * as`,
// types are added via declaration merging below to work around

import type { Effect, Scope } from "effect";

import type { Readable, RendererContext } from "@stax-ui/core";

import * as ElementCore from "./Element/index.js";

export namespace Element {
  export type Child<E = never, R = never> = Effect.Effect<
    ChildNode | ChildNode[],
    E,
    R
  >;
  export type ChildNode =
    | string
    | number
    | Readable.Readable<string | number>
    | HTMLElement
    | SVGElement;
  export type Element<
    A extends HTMLElement | SVGElement = HTMLElement | SVGElement,
    E = never,
    R = never,
  > = Effect.Effect<A, E, Scope.Scope | RendererContext | R>;
}

export const Element = {
  ...ElementCore,
};

// Re-export everything from core so users can import from @stax-ui/dom
export * from "@stax-ui/core";

// DOM Renderer
export { DOMRenderer, DOMRendererLive } from "./Render/DOMRenderer.js";

// Re-export commonly used items from Element for convenience
export { $, bindElementToRef, ref } from "./Element/index.js";
export type {
  ChildInput,
  ChildInputE,
  ChildInputR,
  ChildLeaf,
  Children,
  ClassItem,
  ClassValue,
  EventHandler,
  PermissiveChildren,
} from "./Element/index.js";

// Control flow
export {
  when,
  match,
  each,
  matchOption,
  matchEither,
  redraw,
  animated,
  AnimationConfigCtx,
  ClientControlCtx,
  HydrationMismatchError,
} from "./Control/index.js";
export type {
  WhenConfig,
  MatchConfig,
  MatchCase,
  EachConfig,
  MatchOptionConfig,
  MatchEitherConfig,
  RedrawConfig,
  AnimatedConfig,
} from "./Control/index.js";

// Boundary (async and error handling)
export { Boundary, suspense, error } from "./Boundary.js";
export type { SuspenseOptions, BoundarySuspenseOptions } from "./Boundary.js";

// Context provision
export { provide } from "./Provide.js";

export { collect } from "./Collect.js";

// Animation
export type {
  AnimationEndResult,
  AnimationGroup,
  AnimationHook,
  AnimationOptions,
  EnterOnlyAnimationOptions,
  ListAnimationOptions,
  StaggerFunction,
} from "./Animation/index.js";
export {
  Animation,
  runEnterAnimation,
  runExitAnimation,
  prefersReducedMotion,
  waitForAnimationEvent,
  waitForAnimationEnd,
  forceReflow,
  stagger,
  staggerFromCenter,
  staggerEased,
  delay,
  sequence,
  parallel,
  calculateStaggerDelay,
} from "./Animation/index.js";

// Screen (viewport, media queries, display metrics)
export * as Screen from "./Screen/index.js";
export type {
  MatchOptions as ScreenMatchOptions,
  OrientationSnapshot,
} from "./Screen/index.js";

// Mounting
export { mount } from "./Render/client/index.js";

// Template helpers
export { t } from "./Template.js";

// Portal
export type { PortalOptions } from "./Portal.js";
export { Portal } from "./Portal.js";

// Virtual List
export type {
  VirtualEachOptions,
  VirtualListRefType,
  VirtualListControl,
  VisibleRange,
} from "./VirtualList/index.js";
export { virtualEach, VirtualListRef } from "./VirtualList/index.js";

// Unique ID generation
export { IdGenerator, makeIdGeneratorLayer, UniqueId } from "./UniqueId.js";

// Focus Trap
export type { FocusTrapOptions } from "./FocusTrap/index.js";
export { FocusTrap } from "./FocusTrap/index.js";

// Keyboard
export type {
  KeyboardHandler,
  KeyboardOptions,
  PreventDefaultRule,
} from "./Keyboard/index.js";
export { Keyboard, KeyboardBindingError } from "./Keyboard/index.js";

// Scroll Lock
export { ScrollLock } from "./ScrollLock/index.js";
