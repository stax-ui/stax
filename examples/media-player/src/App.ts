import { Effect } from "effect";

import { $ } from "@stax-ui/dom";

import { Status, TrackList, Transport } from "./components/index.js";

export const App = () =>
  Effect.gen(function* () {
    return yield* $.div(
      { class: "container mx-auto max-w-3xl p-4 space-y-6" },
      // Header
      $.div(
        { class: "flex items-center justify-between" },
        $.div(
          {},
          $.h1({ class: "text-3xl font-bold text-primary" }, "Media Player"),
          $.p(
            { class: "text-sm opacity-70" },
            "A Stax app driven by @stax-ui/machine.",
          ),
        ),
        Status(),
      ),
      // Main transport
      Transport(),
      // Catalog
      TrackList(),
    );
  });
