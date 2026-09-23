import { Effect } from "effect";

import { $ } from "@stax-ui/dom";
import { Link, Route } from "@stax-ui/router";

export const AboutRoute = Route.make("/about").pipe(
  Route.render(() => AboutPage()),
);

const AboutPage = () =>
  Effect.gen(function* () {
    return yield* $.div(
      { class: "space-y-4" },
      $.h1({ class: "text-3xl font-bold" }, "About"),
      $.p(
        { class: "text-gray-600" },
        "This is a simple demo application to test the Stax router package.",
      ),
      $.p(
        { class: "text-gray-600" },
        "It demonstrates client-side navigation, route params, and layouts.",
      ),
      Link(
        { href: "/", class: "text-blue-600 hover:underline" },
        "Back to Home",
      ),
    );
  });
