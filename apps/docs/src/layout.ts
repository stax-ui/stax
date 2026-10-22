import { $, Boundary } from "@stax-ui/dom";
import { Outlet } from "@stax-ui/router";

import "@fontsource-variable/inter/wght.css";

import { router } from "./routes.js";

/**
 * App shell. `Boundary.error` wraps the outlet so a route's meta
 * function throwing on wrong-shape data (e.g. SSG client-side nav
 * briefly loading the wrong page's blob) swaps the whole route for
 * a user-friendly fallback instead of blanking the UI. The reactive
 * boundary auto-swaps back when the next successful nav lands.
 */
export const DocLayout = () =>
  $.div(
    { class: "min-h-screen bg-base-100 text-base-content" },
    Boundary.error(
      () => Outlet({ router }),
      (err) =>
        $.div(
          {
            class:
              "max-w-2xl mx-auto px-6 py-32 text-center flex flex-col gap-4",
          },
          $.h1(
            { class: "text-3xl font-bold" },
            "Something went wrong on this page",
          ),
          $.p(
            { class: "text-base-content/70" },
            `Route \`${err.route}\` couldn't finish rendering. Navigate elsewhere to try again.`,
          ),
        ),
    ),
  );
