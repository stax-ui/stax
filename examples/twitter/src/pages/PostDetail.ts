import { $ } from "@stax-ui/dom";
import { Link } from "@stax-ui/router";

import type { Post, User } from "../services/PostService.js";

export const PostDetailPage = (data: { post: Post; author: User }) =>
  $.div(
    {},
    Link({ href: "/", class: "btn btn-ghost btn-sm mb-4" }, "← Back to feed"),
    $.div(
      { class: "card bg-base-100 shadow-sm" },
      $.div(
        { class: "card-body" },
        // Author
        $.div(
          { class: "flex items-center gap-3 mb-4" },
          $.div(
            { class: "avatar placeholder" },
            $.div(
              {
                class: "bg-primary text-primary-content w-12 rounded-full",
              },
              $.span(
                { class: "text-lg" },
                data.author.name.charAt(0).toUpperCase(),
              ),
            ),
          ),
          $.div(
            {},
            Link(
              {
                href: `/users/${data.author.id}`,
                class: "font-bold link link-hover",
              },
              $.strong({}, data.author.name),
            ),
            $.span(
              { class: "text-base-content/60 ml-2 text-sm" },
              data.author.handle,
            ),
          ),
        ),
        // Content
        $.p({ class: "text-lg mb-4" }, data.post.content),
        // Timestamp
        $.div(
          { class: "text-base-content/50 text-sm" },
          new Date(data.post.createdAt).toLocaleString(),
        ),
      ),
    ),
  );
