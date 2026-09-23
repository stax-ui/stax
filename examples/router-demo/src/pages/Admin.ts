import { Effect } from "effect";

import { $ } from "@stax-ui/dom";
import { Link, Route } from "@stax-ui/router";

import { isAuthenticated } from "../auth";

// Route with guard - redirects to /login if not authenticated
export const AdminRoute = Route.make("/admin").pipe(
  Route.render(() => AdminPage()),
  Route.withGuard(isAuthenticated, { redirect: "/login" }),
);

const AdminPage = () =>
  Effect.gen(function* () {
    return yield* $.div(
      { class: "space-y-4" },
      $.h1({ class: "text-3xl font-bold" }, "Admin Dashboard"),
      $.p(
        { class: "text-gray-600" },
        "Welcome to the admin area. You are authenticated!",
      ),
      $.div(
        { class: "p-4 bg-yellow-100 rounded" },
        "This page is protected by a route guard.",
      ),
      Link(
        { href: "/", class: "text-blue-600 hover:underline" },
        "Back to Home",
      ),
    );
  });
