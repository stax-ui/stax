/**
 * State badge — binds to `MachineReadable.state` and maps the
 * raw state name into a human label + a DaisyUI badge color.
 */

import { Effect } from "effect";

import { $, Readable } from "@stax-ui/dom";
import { MachineReadable } from "@stax-ui/machine/stax";

import { MediaPlayer, type PlayerStates } from "../MediaPlayer.js";

const label: Record<keyof PlayerStates, string> = {
  idle: "Ready",
  loading: "Loading",
  playing: "Playing",
  paused: "Paused",
  ended: "Done",
};

const badgeClass: Record<keyof PlayerStates, string> = {
  idle: "badge badge-ghost",
  loading: "badge badge-info",
  playing: "badge badge-success",
  paused: "badge badge-warning",
  ended: "badge badge-neutral",
};

export const Status = () =>
  Effect.gen(function* () {
    const player = yield* MediaPlayer;
    const state = MachineReadable.state(player);

    return yield* $.span(
      {
        class: Readable.map(state, (s) => badgeClass[s] + " badge-lg"),
      },
      Readable.map(state, (s) => label[s]),
    );
  });
