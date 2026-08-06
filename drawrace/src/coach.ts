// Coaching: turning the physics the game already computes into something a
// player can read before they have crashed.
//
// The friction circle is the whole game, and until now the only way to discover
// you had asked for more grip than exists was to watch the car plough into the
// grass twenty seconds later. Both functions here close that loop — one before
// the race, one after — using exactly the same numbers the vehicle uses. No
// separate model, so the advice cannot disagree with what then happens.

import { RacingLine } from "./line";

/** A stretch of drawn line asking for more lateral grip than the tyres own. */
export interface OverLimitSpan {
  fromIndex: number;
  toIndex: number;
  /** Worst demand across the span, as a multiple of the budget. */
  peak: number;
}

/**
 * Where the drawn line is over the grip budget.
 *
 * A corner taken at speed v on a line of curvature k demands v²k of lateral
 * acceleration. That is the same expression the vehicle evaluates every tick;
 * here it is evaluated on the whole stroke at once, before the lights go out.
 *
 * The margin is deliberately slightly generous. Flagging everything at exactly
 * 100% would light up half of a well-drawn lap, because a good line does run
 * close to the limit — the point is to catch the corners that are hopeless, not
 * to tell a competent player they are cornering hard.
 */
export function overLimitSpans(
  line: RacingLine,
  gripBudget: number,
  margin = 1.06,
): OverLimitSpan[] {
  const out: OverLimitSpan[] = [];
  if (gripBudget <= 0) return out;
  let start = -1;
  let peak = 0;
  for (let i = 0; i < line.nodes.length; i++) {
    const n = line.nodes[i];
    const demand = (n.speed * n.speed * Math.abs(n.curv)) / gripBudget;
    if (demand > margin) {
      if (start < 0) {
        start = i;
        peak = 0;
      }
      peak = Math.max(peak, demand);
    } else if (start >= 0) {
      // Ignore single-node blips: a drawn line carries finger noise, and one
      // noisy node is not a corner anybody took too fast.
      if (i - start >= 3) out.push({ fromIndex: start, toIndex: i, peak });
      start = -1;
    }
  }
  if (start >= 0 && line.nodes.length - start >= 3) {
    out.push({ fromIndex: start, toIndex: line.nodes.length - 1, peak });
  }
  return out;
}

/** How many separate corners are over the limit, for the draw-screen readout. */
export const overLimitCount = (spans: OverLimitSpan[]): number => spans.length;

/**
 * Where the lap was actually lost, measured during the race rather than
 * predicted from the line.
 *
 * Twelve buckets around the circuit, each accumulating the time the car spent
 * past its grip budget. That is the same bucketing `npm run where` uses to
 * diagnose a circuit — pointed at the player instead of at the layout.
 */
export const SECTORS = 12;

export function worstSector(slidePerSector: number[]): { index: number; seconds: number } {
  let index = 0;
  let seconds = 0;
  for (let i = 0; i < slidePerSector.length; i++) {
    if (slidePerSector[i] > seconds) {
      seconds = slidePerSector[i];
      index = i;
    }
  }
  return { index, seconds };
}
