import { $ } from "@stax-ui/dom";
import { Link, Outlet } from "@stax-ui/router";

import { router } from "./routes.js";

export const App = () =>
  $.div(
    { class: "min-h-screen bg-base-200" },
    // Navigation header
    $.div(
      { class: "navbar bg-base-100 shadow-sm" },
      $.div(
        { class: "flex-1" },
        Link({ href: "/", class: "btn btn-ghost text-xl" }, "Stax Twitter"),
      ),
      $.div(
        { class: "flex-none" },
        $.ul(
          { class: "menu menu-horizontal px-1" },
          $.li({}, Link({ href: "/" }, "Feed")),
          $.li({}, Link({ href: "/users/alice" }, "Alice")),
          $.li({}, Link({ href: "/users/bob" }, "Bob")),
          $.li({}, Link({ href: "/users/carol" }, "Carol")),
          $.li({}, Link({ href: "/users/me" }, "Me")),
          $.li({}, Link({ href: "/posts/999", class: "text-error" }, "404")),
        ),
      ),
    ),
    // Page content
    $.div({ class: "container mx-auto max-w-2xl p-4" }, Outlet({ router })),
  );
