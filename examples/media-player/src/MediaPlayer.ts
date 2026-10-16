/**
 * The media player's state machine.
 *
 * The machine owns the playback lifecycle so the UI never has to
 * reason about "which buttons are enabled right now" or "is it safe
 * to call .play()" — those are projections of the current state,
 * read reactively via the Readable adapter.
 *
 * ## State diagram
 *
 * ```
 *                ┌───────── LOAD ─────────┐
 *                │                        ▼
 *   ┌────┐     ┌──────┐  transitionAwait  ┌───────┐
 *   │idle│◀───▶│loading│──── 800ms ──────▶│playing│
 *   └────┘     └──────┘                   └───────┘
 *     ▲                                   │   ▲
 *     │ STOP                           PAUSE   │ PLAY
 *     │                                   ▼   │
 *     │                                 ┌──────┐
 *     ├─────────── STOP ────────────────│paused│
 *     │                                 └──────┘
 *     │                                   │
 *     │                                 TICK  (position ≥ duration)
 *     │                                   ▼
 *     │                                 ┌─────┐
 *     └─────────── STOP ────────────────│ended│
 *                                       └─────┘
 * ```
 *
 * ## Features demonstrated
 *
 * - **States + transitions** — five states, per-state handler maps
 *   for in-state events.
 * - **Context + output projection** — mutable `trackId` / `title` /
 *   `position` / `duration`; the output is a direct spread, bound
 *   reactively in the UI.
 * - **`self.transitionAwait`** — `loading` suspends on a setTimeout
 *   and resumes into `playing`. The register's cleanup fires if the
 *   user picks a different track mid-load (global `LOAD` interrupts).
 * - **`Effect.forkScoped` + `self.dispatch`** — `playing` forks a
 *   repeating effect that enqueues a `TICK` every 100ms. The fork
 *   is tied to the state scope, so transitioning out cancels it —
 *   no setInterval leaks.
 * - **Global `on:` handlers** — `LOAD` and `STOP` fire from any
 *   state. "Load another track from the sidebar while playing"
 *   just works without each state fn re-declaring the transition.
 * - **`canDispatch` / `availableEvents`** — the UI binds button
 *   disabled-state to `canDispatch("PLAY")`, `canDispatch("PAUSE")`,
 *   etc., so the transport reflects whatever's handleable right now.
 */

import { Effect, Schedule } from "effect";

import { Machine } from "@stax-ui/machine";

import { findTrack } from "./tracks.js";

// =============================================================================
// Types
// =============================================================================

// `undefined` is the "no payload" spelling. `{}` works too but
// `@typescript-eslint/no-empty-object-type` flags it as "any
// non-nullish value," which isn't the intent here.
export interface PlayerStates {
  idle: undefined;
  loading: { trackId: string };
  playing: undefined;
  paused: undefined;
  ended: undefined;
}

export interface PlayerEvents {
  /** Load a track by id. Fires from any state via the global `on:`. */
  LOAD: { trackId: string };
  /** Resume playback. Only handled in `paused`. */
  PLAY: undefined;
  /** Pause playback. Only handled in `playing`. */
  PAUSE: undefined;
  /** Stop and clear the loaded track. Fires from any state. */
  STOP: undefined;
  /** Internal — enqueued by the forked ticker while `playing`. */
  TICK: undefined;
}

export interface PlayerContext {
  trackId: string | null;
  title: string;
  artist: string;
  duration: number;
  position: number;
}

export interface PlayerOutput {
  trackId: string | null;
  title: string;
  artist: string;
  duration: number;
  position: number;
}

// =============================================================================
// Service class
// =============================================================================

// No `UserE` declared — handlers yield only ordinary transitions,
// so the dispatch error channel is `never`. Click handlers can
// just `player.dispatch(...)` without wrapping. Runtime bugs
// (`MalformedSpec`) die as defects and never reach the typed
// channel.
export class MediaPlayer extends Machine.Service<
  MediaPlayer,
  PlayerStates,
  PlayerEvents,
  PlayerContext,
  PlayerOutput
>()("MediaPlayer") {}

// =============================================================================
// Spec + Live layer
// =============================================================================

/** How often the forked ticker enqueues a TICK event while playing. */
const TICK_MS = 100;

/** Reset context — used when transitioning to `idle` via STOP. */
const emptyContext: PlayerContext = {
  trackId: null,
  title: "",
  artist: "",
  duration: 0,
  position: 0,
};

export const MediaPlayerLive = Machine.serviceLayer(
  MediaPlayer,
  Effect.succeed({
    initial: "idle" as const,
    context: emptyContext,
    output: (ctx) => ({ ...ctx }),

    // Global fallbacks — fire regardless of current state. The
    // precedence rule is per-state wins, so if a state ever grew its
    // own LOAD handler it would shadow this one for that state.
    on: {
      LOAD: (self, { trackId }) => self.transition("loading", { trackId }),
      STOP: (self) =>
        Effect.gen(function* () {
          yield* self.assign(emptyContext);
          return yield* self.transition("idle");
        }),
    },

    states: {
      // Nothing selected. Returning `undefined` keeps the state
      // "active with no local handlers" — the global `on:` map is
      // still consulted, so LOAD / STOP still work.
      idle: () => Effect.succeed(undefined),

      // Fake buffer window — 800ms before we hand off to `playing`.
      // The register's unsubscribe clears the setTimeout, which runs
      // whether we transition naturally (go fires), via a sibling
      // path (global LOAD swaps tracks mid-load), or on parent-scope
      // teardown.
      loading: (self, { trackId }) =>
        Effect.gen(function* () {
          const track = findTrack(trackId);
          if (!track) {
            return yield* self.transition("idle");
          }
          yield* self.assign({
            trackId,
            title: track.title,
            artist: track.artist,
            duration: track.duration,
            position: 0,
          });
          return yield* self.transitionAwait((go) => {
            const timer = setTimeout(go, 800);
            return () => clearTimeout(timer);
          }, "playing");
        }),

      // The ticker is a repeating Effect forked into the state's
      // scope. Transitioning out closes the scope, which cancels
      // the fiber — no cleanup to write by hand.
      playing: (self) =>
        Effect.gen(function* () {
          yield* Effect.forkScoped(
            self
              .dispatch("TICK")
              .pipe(Effect.repeat(Schedule.spaced(`${TICK_MS} millis`))),
          );
          return {
            PAUSE: () => self.transition("paused"),
            TICK: () => {
              const next = self.context.position + TICK_MS;
              if (next >= self.context.duration) {
                return Effect.gen(function* () {
                  yield* self.assign({ position: self.context.duration });
                  return yield* self.transition("ended");
                });
              }
              return self.assign({ position: next });
            },
          };
        }),

      paused: (self) =>
        Effect.succeed({
          PLAY: () => self.transition("playing"),
        }),

      // Reached end of track. Globals (LOAD / STOP) handle the exit.
      ended: () => Effect.succeed(undefined),
    },
  }),
);
