import { Effect } from "effect";

import { $ } from "@stax-ui/dom";
import { Link, NavigationContext, Route } from "@stax-ui/router";

import { login } from "../auth";

export const LoginRoute = Route.make("/login").pipe(
  Route.render(() => LoginPage()),
);

const LoginPage = () =>
  Effect.gen(function* () {
    const nav = yield* NavigationContext;

    return yield* $.div(
      { class: "space-y-4" },
      $.h1({ class: "text-3xl font-bold" }, "Login"),
      $.p(
        { class: "text-gray-600" },
        "Click the button below to simulate logging in.",
      ),
      $.button(
        {
          class: "px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700",
          onClick: () =>
            Effect.gen(function* () {
              yield* login();
              yield* nav.pushPath("/admin");
            }),
        },
        "Log In",
      ),
      Link(
        { href: "/", class: "text-blue-600 hover:underline" },
        "Back to Home",
      ),
    );
  });
