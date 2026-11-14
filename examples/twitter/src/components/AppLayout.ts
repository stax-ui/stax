import { $, type Element } from "@stax-ui/dom";

export const AppLayout = <A extends HTMLElement | SVGElement, E, R>(
  children: Element.Element<A, E, R>,
) => $.div(children);
