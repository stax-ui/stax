import { $, Element } from "@stax-ui/dom";

import type { DocSection } from "../content.js";
import { Sidebar } from "./Sidebar.js";

/**
 * Docs shell — mirrors HomePage's top-level layout: a Sidebar column
 * on the left (stacked on top on mobile), and a `<main>` flex column
 * on the right that scrolls with the page content.
 *
 * `E` / `R` default to `never` so plain-child calls don't widen the
 * inferred Effect requirements to `unknown` — see the NavLink note.
 */
export const SidebarLayout = <E = never, R = never>(
  props: { readonly sections: readonly DocSection[] },
  child: Element.Child<E, R>,
) =>
  $.div(
    { class: "flex flex-col lg:flex-row" },
    $.div({ class: "lg:border-r" }, Sidebar({ sections: props.sections })),
    $.main(
      // `min-w-0` lets this flex child shrink below its intrinsic
      // content width, so an overly-wide code block scrolls inside
      // its own `overflow-x-auto` container instead of pushing the
      // whole page wider than the viewport on mobile.
      { class: "flex-1 min-w-0 flex flex-col text-base-content" },
      $.div({ class: "pt-22 lg:pt-0 px-8 pb-8" }, child),
    ),
  );
