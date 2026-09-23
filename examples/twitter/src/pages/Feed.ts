import { Effect, Option, Schema } from "effect";

import { $, AsyncCache, each, matchOption, Readable } from "@stax-ui/dom";
import { Field, Form } from "@stax-ui/form";
import { RouteDataContext } from "@stax-ui/router";

import { PostCard } from "../components/PostCard.js";
import type { Post, User } from "../services/PostService.js";

// Form definition — validates content is non-empty
const ContentSchema: Schema.Schema<string, string> = Schema.String.pipe(
  Schema.minLength(1),
);
const NewPostForm = Form.make({
  content: Field.make(ContentSchema),
});

const PostList = ({
  posts,
  users,
}: {
  posts: Readable.Readable<readonly Post[]>;
  users: Readable.Readable<readonly User[]>;
}) =>
  each(posts, {
    container: () => $.div({ class: "flex flex-col gap-3" }),
    key: (post) => post.id,
    render: (post) =>
      Effect.gen(function* () {
        const p = yield* post.get;
        const author = Readable.map(users, (u) =>
          Option.fromNullable(u.find((user) => user.id === p.authorId)),
        );

        return yield* matchOption(author, {
          onNone: () => $.div({}, "Unknown author"),
          onSome: (author) => PostCard({ post, author }),
        });
      }),
  });

export const FeedPage = (data: {
  posts: readonly Post[];
  users: readonly User[];
}) =>
  Effect.gen(function* () {
    const { loaderPath, actions } = yield* RouteDataContext;
    const cache = yield* AsyncCache;

    const feedQuery = yield* cache.get(
      ["feed"],
      () =>
        Effect.tryPromise(() =>
          fetch(loaderPath).then(
            (r) =>
              r.json() as Promise<{
                data: { posts: Post[]; users: User[] };
              }>,
          ),
        ).pipe(Effect.map((res) => res.data)),
      { initialData: data },
    );

    const posts = Readable.map(feedQuery.value, (fetched) =>
      Option.match(fetched, {
        onSome: (f) => f.posts,
        onNone: () => data.posts,
      }),
    );

    const users = Readable.map(feedQuery.value, (fetched) =>
      Option.match(fetched, {
        onSome: (f) => f.users,
        onNone: () => data.users,
      }),
    );

    return yield* $.div(
      {},
      $.h1({ class: "text-3xl font-bold mb-6" }, "Feed"),
      // New post form
      NewPostForm.provide(
        {
          defaults: { content: "" },
          action: actions.create,
          onSubmit: (ctx) =>
            Effect.gen(function* () {
              yield* Effect.tryPromise(() =>
                fetch(actions.create, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(ctx.encoded),
                }),
              );
              // Invalidate feed cache — triggers refetch, UI updates reactively
              yield* cache.invalidate(["feed"]);
              yield* cache.invalidate(["posts"]);
            }),
        },
        Effect.gen(function* () {
          const content = yield* NewPostForm.fields.content;

          return yield* $.form(
            { class: "card bg-base-100 shadow-sm mb-6" },
            $.div(
              { class: "card-body p-4" },
              $.textarea({
                class: "textarea textarea-bordered w-full mb-3",
                name: "content",
                placeholder: "What's happening?",
                rows: 3,
                value: content.value,
                onInput: (e: Event) =>
                  content.set((e.target as HTMLTextAreaElement).value),
              }),
              $.button(
                { type: "submit", class: "btn btn-primary btn-sm" },
                "Post",
              ),
            ),
          );
        }),
      ),
      // Post list — reactive on client (via cache), static on server
      PostList({ posts, users }),
    );
  });
