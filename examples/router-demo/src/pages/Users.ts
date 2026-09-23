import { Effect, Scope } from "effect";

import { $, ControlCtx, Element, RendererContext } from "@stax-ui/dom";
import { Link, NavigationContext, Route } from "@stax-ui/router";

// Mock users data
const usersMock = [
  { id: 1, name: "Alice Johnson" },
  { id: 2, name: "Bob Smith" },
  { id: 3, name: "Charlie Brown" },
];

export const UsersRoute = Route.make("/users").pipe(
  Route.get(
    ({}) => Effect.succeed(usersMock),
    (users) => UsersPage({ users }),
  ),
);

const UsersPage = (props: {
  users: typeof usersMock;
}): Element.Element<
  HTMLElement,
  never,
  RendererContext | ControlCtx | NavigationContext | Scope.Scope
> =>
  Effect.gen(function* () {
    const { users } = props;

    return yield* $.div(
      { class: "space-y-4" },
      $.h1({ class: "text-3xl font-bold" }, "Users"),
      $.ul(
        { class: "space-y-2" },
        ...users.map((user) =>
          $.li(
            { class: "p-3 bg-white rounded shadow" },
            Link(
              {
                href: `/users/${user.id}`,
                class: "text-blue-600 hover:underline",
              },
              user.name,
            ),
          ),
        ),
      ),
      Link(
        { href: "/", class: "text-blue-600 hover:underline" },
        "Back to Home",
      ),
    );
  });
