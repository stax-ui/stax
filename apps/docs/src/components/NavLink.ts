import { Element, PermissiveChildren } from "@stax-ui/dom";
import { Link, NavigationContext } from "@stax-ui/router";

export interface NavLinkProps {
  readonly href: string;
  /**
   * How to decide "active":
   *   "prefix"  — highlight when the current path starts with `href`
   *               (default; matches on any child page of a section)
   *   "exact"   — highlight only when the current path equals `href`
   */
  readonly active?: "prefix" | "exact";
  readonly class?: string;
}

/**
 * Wrapper around router `Link` that layers on hover + active styling.
 * Active state is driven off the `data-active-{exact,prefix}` attribute
 * that `Link` already stamps on the underlying <a> from the current
 * NavigationContext.pathname — no manual context reads needed.
 *
 * `E` / `R` default to `never` so plain-child calls (e.g. a string
 * label) don't widen the inferred Effect requirements to `unknown` and
 * leak that `unknown` through every parent Sidebar / Layout / mount.
 */
export const NavLink = <E = never, R = never>(
  props: NavLinkProps,
  ...children: PermissiveChildren<E, R>
): Element.Element<HTMLAnchorElement, E, R | NavigationContext> =>
  Link(
    {
      href: props.href,
      class: [
        "text-nav text-base-content/70 transition-colors",
        "hover:text-base-content relative",
        "before:content-['::'] before:absolute before:-left-4 before:-top-0.5 before:font-bold before:opacity-0 before:transition-opacity before:text-accent",
        "hover:before:opacity-100",
        props.active === "exact"
          ? "data-[active-exact=true]:text-base-content data-[active-exact=true]:before:opacity-100 data-[active-exact=true]:before:text-warning data-[active-exact=true]:cursor-default"
          : "data-[active-prefix=true]:text-base-content data-[active-prefix=true]:before:opacity-100 data-[active-prefix=true]:before:text-warning data-[active-prefix=true]:cursor-default",
        props.class ?? "",
      ],
    },
    ...children,
  );
