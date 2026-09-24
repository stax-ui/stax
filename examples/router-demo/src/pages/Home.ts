import { Effect } from "effect";

import { $ } from "@stax-ui/dom";
import { Link, Route } from "@stax-ui/router";

export const HomeRoute = Route.make("/").pipe(Route.render(() => HomePage()));

const HomePage = () =>
  Effect.gen(function* () {
    return yield* $.div(
      { class: "space-y-4" },
      $.h1({ class: "text-3xl font-bold" }, "Welcome to Router Demo"),
      $.p(
        { class: "text-gray-600" },
        "This demo shows off the @stax-ui/router package.",
      ),
      $.div(
        { class: "flex gap-4" },
        Link(
          { href: "/about", class: "text-blue-600 hover:underline" },
          "About",
        ),
        Link(
          { href: "/users", class: "text-blue-600 hover:underline" },
          "View Users",
        ),
      ),
    );
  });
