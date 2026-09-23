import { $ } from "@stax-ui/dom";
import { Link } from "@stax-ui/router";

export const NotFoundPage = () =>
  $.div(
    { class: "hero min-h-[60vh]" },
    $.div(
      { class: "hero-content text-center" },
      $.div(
        { class: "max-w-md" },
        $.h1({ class: "text-5xl font-bold" }, "404"),
        $.p(
          { class: "py-6 text-base-content/70" },
          "The page you're looking for doesn't exist.",
        ),
        Link({ href: "/", class: "btn btn-primary" }, "Go home"),
      ),
    ),
  );
