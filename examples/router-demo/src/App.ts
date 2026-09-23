import { $, Boundary } from "@stax-ui/dom";
import { Link, Outlet } from "@stax-ui/router";

import { router } from "./routes";

export const App = () =>
  Boundary.error(
    () =>
      $.div(
        { class: "min-h-screen" },
        // Navigation header
        $.nav(
          { class: "bg-white shadow p-4 mb-6" },
          $.div(
            { class: "max-w-4xl mx-auto flex gap-6" },
            Link({ href: "/", class: "font-bold text-lg" }, "Router Demo"),
            Link(
              { href: "/", class: "text-gray-600 hover:text-gray-900" },
              "Home",
            ),
            Link(
              {
                href: "/about",
                class: "text-gray-600 hover:text-gray-900",
              },
              "About",
            ),
            Link(
              {
                href: "/users",
                class: "text-gray-600 hover:text-gray-900",
              },
              "Users",
            ),
            Link(
              {
                href: "/admin",
                class: "text-gray-600 hover:text-gray-900",
              },
              "Admin",
            ),
          ),
        ),
        // Main content - render matched route
        $.main(
          { class: "max-w-4xl mx-auto px-4" },
          Outlet({
            router,
            animate: {
              enterFrom: "opacity-0 transition-opacity duration-150",
              enter: "!opacity-100",
              exit: "transition-opacity duration-150",
              exitTo: "!opacity-0",
            },
          }),
        ),
      ),
    (error) =>
      $.div(
        { class: "p-4 bg-red-100 text-red-800" },
        `An error occurred: ${String(error)}`,
      ),
  );
