import { Effect } from "effect";

import { $ } from "@stax-ui/dom";
import { Link } from "@stax-ui/router";

export const NotFoundPage = () =>
  Effect.gen(function* () {
    return yield* $.div(
      { class: "space-y-4 text-center" },
      $.h1({ class: "text-6xl font-bold text-gray-300" }, "404"),
      $.h2({ class: "text-2xl font-bold" }, "Page Not Found"),
      $.p(
        { class: "text-gray-600" },
        "The page you're looking for doesn't exist.",
      ),
      Link({ href: "/", class: "text-blue-600 hover:underline" }, "Go Home"),
    );
  });
