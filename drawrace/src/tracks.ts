// Hand-laid circuits. Coordinates are metres; every layout is sized to fit a
// phone screen whole, because the drawing gesture needs the entire lap visible.
// Lap lengths land around 500-580 m, which puts a two-lap race near 40 s.
//
// These are roughly square rather than portrait, which leaves headroom above and
// below on a phone. That is deliberate: a pass at squashing them into portrait
// (narrower, taller, same lap length) tightened the left and right sections past
// what the cars can hold, and no retuning of the planner recovered the AI
// ordering. Screen real estate is not worth a circuit that does not drive.

import { TrackDef } from "./track";

export const TRACKS: TrackDef[] = [
  {
    id: "harbour",
    name: "Harbour Sweep",
    surface: "asphalt",
    width: 16,
    laps: 2,
    classes: ["gt", "rally"],
    medals: { gold: 1.025, silver: 1.075, bronze: 1.16 },
    // The east side is a hairpin, deliberately. Without at least one corner
    // tight enough to force a real lift, a flat-out stroke is competitive with
    // a properly modulated one and the whole game evaporates.
    points: [
      [0, -78],
      [42, -70],
      [70, -46],
      [76, -14],
      [50, -2],
      [44, 16],
      [68, 32],
      [58, 56],
      [28, 70],
      [-8, 76],
      [-40, 68],
      [-64, 48],
      [-78, 16],
      [-74, -24],
      [-52, -56],
      [-26, -74],
    ],
  },
  {
    id: "gravelpit",
    name: "Gravel Pit",
    surface: "gravel",
    width: 18,
    laps: 2,
    classes: ["rally"],
    medals: { gold: 1.03, silver: 1.085, bronze: 1.18 },
    points: [
      [0, -70],
      [38, -62],
      [60, -40],
      [52, -14],
      [20, -6],
      [14, 18],
      [44, 30],
      [58, 54],
      [30, 72],
      [-10, 70],
      [-40, 58],
      [-62, 32],
      [-70, -2],
      [-58, -38],
      [-32, -62],
    ],
  },
  {
    id: "frostring",
    name: "Frost Ring",
    surface: "ice",
    width: 18,
    laps: 2,
    classes: ["rally", "gt"],
    medals: { gold: 1.035, silver: 1.09, bronze: 1.2 },
    points: [
      [0, -80],
      [50, -68],
      [78, -32],
      [82, 12],
      [60, 48],
      [22, 74],
      [-22, 76],
      [-58, 54],
      [-80, 18],
      [-80, -24],
      [-56, -58],
      [-28, -76],
    ],
  },
  {
    id: "vantaa",
    name: "Vantaa GP",
    surface: "asphalt",
    width: 17,
    laps: 2,
    classes: ["formula", "gt"],
    medals: { gold: 1.02, silver: 1.07, bronze: 1.15 },
    points: [
      [0, -72],
      [36, -68],
      [64, -52],
      [76, -22],
      [60, -8],
      [34, -14],
      [18, 4],
      [36, 24],
      [62, 30],
      [70, 58],
      [40, 76],
      [0, 78],
      [-36, 70],
      [-64, 50],
      [-76, 20],
      [-72, -16],
      [-52, -48],
      [-28, -66],
    ],
  },
];

export const trackById = (id: string): TrackDef =>
  TRACKS.find((t) => t.id === id) ?? TRACKS[0];
