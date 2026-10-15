/**
 * Clickable track catalog — dispatches `LOAD` on each click, which
 * is a global `on:` event the machine handles from any state.
 *
 * The "currently selected" highlight binds to
 * `MachineReadable.field(player, "trackId")`, so the list reacts
 * live to transitions driven from anywhere (click a track, load
 * another from the sidebar, hit STOP).
 */

import { Effect } from "effect";

import { $, Readable } from "@stax-ui/dom";
import { MachineReadable } from "@stax-ui/machine/stax";

import { formatTime } from "../format.js";
import { MediaPlayer } from "../MediaPlayer.js";
import { tracks, type Track } from "../tracks.js";

const TrackRow = (track: Track) =>
  Effect.gen(function* () {
    const player = yield* MediaPlayer;
    const currentId = MachineReadable.field(player, "trackId");
    const isCurrent = Readable.map(currentId, (id) => id === track.id);

    return yield* $.button(
      {
        class: Readable.map(isCurrent, (c) =>
          [
            "btn btn-block justify-between normal-case font-normal",
            c ? "btn-primary" : "btn-ghost",
          ].join(" "),
        ),
        onClick: () => player.dispatch("LOAD", { trackId: track.id }),
      },
      $.div(
        { class: "flex flex-col items-start" },
        $.span({ class: "font-medium" }, track.title),
        $.span({ class: "text-xs opacity-70" }, track.artist),
      ),
      $.span({ class: "font-mono text-xs" }, formatTime(track.duration)),
    );
  });

export const TrackList = () =>
  Effect.gen(function* () {
    return yield* $.div(
      { class: "card bg-base-100 shadow" },
      $.div(
        { class: "card-body" },
        $.h3({ class: "card-title text-sm uppercase opacity-70" }, "Catalog"),
        $.div(
          { class: "flex flex-col gap-1 mt-2" },
          ...tracks.map((t) => TrackRow(t)),
        ),
      ),
    );
  });
