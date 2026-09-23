import { Effect } from "effect";

import { $, Readable } from "@stax-ui/dom";
import { Link } from "@stax-ui/router";

import type { Post, User } from "../services/PostService.js";

export const PostCard = (props: {
  post: Readable.Readable<Post>;
  author: Readable.Readable<User>;
}) =>
  Effect.gen(function* () {
    const authorLink = yield* Readable.map(
      props.author,
      (a) => `/users/${a.id}`,
    ).get;
    const postLink = yield* Readable.map(props.post, (p) => `/posts/${p.id}`)
      .get;

    return yield* $.div(
      { class: "card bg-base-100 shadow-sm" },
      $.div(
        { class: "card-body p-4" },
        // Author info
        $.div(
          { class: "flex items-center gap-2 mb-2" },
          $.div(
            { class: "avatar placeholder" },
            $.div(
              { class: "bg-neutral text-neutral-content w-8 rounded-full" },
              $.span(
                { class: "text-xs" },
                Readable.map(props.author, (a) =>
                  a.name.charAt(0).toUpperCase(),
                ),
              ),
            ),
          ),
          $.div(
            {},
            Link(
              { href: authorLink, class: "font-bold link link-hover" },
              Readable.map(props.author, (a) => a.name),
            ),
            $.span(
              { class: "text-base-content/60 ml-2 text-sm" },
              Readable.map(props.author, (a) => a.handle),
            ),
          ),
        ),
        // Content
        $.p(
          { class: "text-base-content mb-3" },
          Readable.map(props.post, (p) => p.content),
        ),
        // Timestamp
        $.div(
          { class: "text-base-content/50 text-xs" },
          Link(
            { href: postLink, class: "link link-hover" },
            Readable.map(props.post, (p) =>
              new Date(p.createdAt).toLocaleString(),
            ),
          ),
        ),
      ),
    );
  });
