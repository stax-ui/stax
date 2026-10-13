export interface Track {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  /** Duration in milliseconds. */
  readonly duration: number;
}

export const tracks: readonly Track[] = [
  {
    id: "track-1",
    title: "Morning Light",
    artist: "Soft Lanes",
    duration: 185_000,
  },
  {
    id: "track-2",
    title: "Caffeine",
    artist: "Workbench",
    duration: 212_000,
  },
  {
    id: "track-3",
    title: "Afternoon Drift",
    artist: "Soft Lanes",
    duration: 243_000,
  },
  {
    id: "track-4",
    title: "Elevator",
    artist: "The Button",
    duration: 94_000,
  },
  {
    id: "track-5",
    title: "Night Slide",
    artist: "Workbench",
    duration: 338_000,
  },
];

export const findTrack = (id: string): Track | undefined =>
  tracks.find((t) => t.id === id);
