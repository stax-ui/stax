import { Effect, Schema } from "effect";

import { $ } from "@stax-ui/dom";
import { Link, Route } from "@stax-ui/router";

// Mock users data
const users: Record<number, { id: number; name: string; email: string }> = {
  1: { id: 1, name: "Alice Johnson", email: "alice@example.com" },
  2: { id: 2, name: "Bob Smith", email: "bob@example.com" },
  3: { id: 3, name: "Charlie Brown", email: "charlie@example.com" },
};

// Route definition co-located with the component
export const UserDetailRoute = Route.make("/users/:id").pipe(
  Route.params(Schema.Struct({ id: Schema.NumberFromString })),
  Route.get(
    ({ params: { id } }) => Effect.succeed([id, users[id]] as const),
    ([id, user]) => UserDetailPage({ id, user }),
  ),
);

const UserDetailPage = ({
  id,
  user,
}: {
  id: number;
  user: (typeof users)[number];
}) =>
  Effect.gen(function* () {
    if (!user) {
      return yield* $.div(
        { class: "space-y-4" },
        $.h1({ class: "text-3xl font-bold text-red-600" }, "User Not Found"),
        $.p({ class: "text-gray-600" }, `No user with ID ${id} exists.`),
        Link(
          { href: "/users", class: "text-blue-600 hover:underline" },
          "Back to Users",
        ),
      );
    }

    return yield* $.div(
      { class: "space-y-4" },
      $.h1({ class: "text-3xl font-bold" }, user.name),
      $.div(
        { class: "bg-white p-4 rounded shadow" },
        $.p({}, $.span({ class: "font-semibold" }, "ID: "), String(user.id)),
        $.p({}, $.span({ class: "font-semibold" }, "Email: "), user.email),
      ),
      Link(
        { href: "/users", class: "text-blue-600 hover:underline" },
        "Back to Users",
      ),
    );
  });
