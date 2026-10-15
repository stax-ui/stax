/**
 * The main transport controls — title, time display, progress bar,
 * and PLAY / PAUSE / STOP buttons whose enabled state binds to
 * `canDispatch` for the matching event.
 */

import { Effect } from "effect";

import { $, Readable, when } from "@stax-ui/dom";
import { MachineReadable } from "@stax-ui/machine/stax";

import { formatTime } from "../format.js";
import { MediaPlayer } from "../MediaPlayer.js";

export const Transport = () =>
  Effect.gen(function* () {
    const player = yield* MediaPlayer;

    // Reactive views of the machine's output + state.
    const title = MachineReadable.field(player, "title");
    const artist = MachineReadable.field(player, "artist");
    const position = MachineReadable.field(player, "position");
    const duration = MachineReadable.field(player, "duration");
    const progress = Readable.zipWith(position, duration, (p, d) =>
      d > 0 ? (p / d) * 100 : 0,
    );
    const hasTrack = Readable.map(title, (t) => t.length > 0);

    // Button-enabled states, straight off the machine's handler
    // surface — "can this event be dispatched right now."
    const canPlay = MachineReadable.canDispatch(player, "PLAY");
    const canPause = MachineReadable.canDispatch(player, "PAUSE");
    const canStop = MachineReadable.canDispatch(player, "STOP");

    // Click handlers run outside the Effect context, so `player` is
    // captured in closure (not re-yielded). No error-channel pipe
    // needed — the machine declares no `UserE`, so dispatch's
    // return type is `Effect<void, never>` by construction.
    const dispatch = (event: "PLAY" | "PAUSE" | "STOP") =>
      player.dispatch(event);

    return yield* $.div(
      { class: "card bg-base-100 shadow-xl" },
      $.div(
        { class: "card-body gap-4" },
        // Title + artist
        when(hasTrack, {
          onTrue: () =>
            $.div(
              { class: "space-y-1" },
              $.h2({ class: "card-title text-2xl" }, title),
              $.p({ class: "opacity-70" }, artist),
            ),
          onFalse: () =>
            $.div(
              { class: "space-y-1" },
              $.h2(
                { class: "card-title text-2xl opacity-50" },
                "No track loaded",
              ),
              $.p(
                { class: "opacity-50 text-sm" },
                "Pick one from the list below.",
              ),
            ),
        }),

        // Progress bar
        $.div(
          { class: "w-full bg-base-200 rounded-full h-2 overflow-hidden" },
          $.div({
            class: "bg-primary h-2 transition-all duration-100",
            style: Readable.map(progress, (p) => ({ width: `${p}%` })),
          }),
        ),

        // Time display
        $.div(
          { class: "flex justify-between font-mono text-sm opacity-70" },
          $.span({}, Readable.map(position, formatTime)),
          $.span({}, Readable.map(duration, formatTime)),
        ),

        // Transport buttons
        $.div(
          { class: "flex gap-2 justify-center" },
          $.button(
            {
              class: "btn btn-primary",
              disabled: Readable.map(canPlay, (v) => !v),
              onClick: () => dispatch("PLAY"),
            },
            "Play",
          ),
          $.button(
            {
              class: "btn btn-secondary",
              disabled: Readable.map(canPause, (v) => !v),
              onClick: () => dispatch("PAUSE"),
            },
            "Pause",
          ),
          $.button(
            {
              class: "btn btn-ghost",
              disabled: Readable.map(canStop, (v) => !v),
              onClick: () => dispatch("STOP"),
            },
            "Stop",
          ),
        ),
      ),
    );
  });
