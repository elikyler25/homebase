/*
 * Balance harness. Run: node games/hustle-lite/tests/balance.mjs
 *
 * Not a pass/fail suite — a readout. It answers the two questions that decide whether
 * the game is worth playing:
 *   1. Can any single button, mashed forever, beat a thinking opponent?
 *   2. When two thinking opponents play, does the whole moveset actually get used?
 * A dominant strategy or a dead move shows up here long before it shows up in play.
 */
import {
  MOVES, NEUTRAL_SET, newMatch, resolveTurn, availableMoves, chooseAiMove, rng,
} from '../src/engine.js';

const MATCHES = 40;
const TURN_CAP = 250;   // above RULES.TURN_LIMIT, so the engine ends its own rounds

function play(pick0, pick1, seed) {
  const rand = rng(seed);
  let s = newMatch();
  let turns = 0;
  const hist = [[], []];
  const used = [{}, {}];
  while (s.over === null && turns < TURN_CAP) {
    const a = pick0(s, 0, hist[1], rand);
    const b = pick1(s, 1, hist[0], rand);
    if (a === null || b === null) break;
    used[0][a] = (used[0][a] || 0) + 1;
    used[1][b] = (used[1][b] || 0) + 1;
    hist[0].push(a); hist[1].push(b);
    s = resolveTurn(s, [a, b]).state;
    turns++;
  }
  return { winner: s.over ? s.over.winner : 'timeout', turns, used, hp: s.fighters.map((f) => f.hp) };
}

/** Mash one move forever; fall back to whatever is legal when stunned or downed. */
const spam = (id) => (s, i) => {
  const opts = availableMoves(s, i);
  return (opts.find((m) => m.id === id) || opts[0]).id;
};
const ai = (level) => (s, i, oppHistory, rand) => chooseAiMove(s, i, level, oppHistory, rand);

console.log('One-button players vs the Oracle AI');
console.log('─'.repeat(64));
const rows = [];
for (const id of NEUTRAL_SET) {
  let wins = 0, draws = 0, timeouts = 0, totalTurns = 0;
  for (let m = 0; m < MATCHES; m++) {
    const r = play(spam(id), ai('oracle'), 1000 + m * 37);
    if (r.winner === 0) wins++;
    else if (r.winner === null) draws++;
    else if (r.winner === 'timeout') timeouts++;
    totalTurns += r.turns;
  }
  rows.push({ id, wins, draws, timeouts, avg: totalTurns / MATCHES });
}
rows.sort((a, b) => b.wins - a.wins);
for (const r of rows) {
  const rate = (r.wins / MATCHES * 100).toFixed(0).padStart(3);
  const bar = '█'.repeat(Math.round(r.wins / MATCHES * 24)).padEnd(24, '·');
  console.log(`  ${MOVES[r.id].name.padEnd(12)} ${rate}% ${bar} ${String(r.draws).padStart(2)} draws  ${r.avg.toFixed(0).padStart(3)} turns`);
}
const worst = rows[0];
console.log(`\n  Best single button: ${MOVES[worst.id].name} at ${(worst.wins / MATCHES * 100).toFixed(0)}% ` +
  `— ${worst.wins / MATCHES > 0.5 ? 'DOMINANT, needs a nerf' : 'no dominant strategy'}`);

console.log('\n\nOracle vs Oracle — which moves actually get played?');
console.log('─'.repeat(64));
const tally = {};
let plays = 0, totalTurns = 0, decisive = 0;
for (let m = 0; m < MATCHES; m++) {
  const r = play(ai('oracle'), ai('oracle'), 500 + m * 13);
  totalTurns += r.turns;
  if (r.winner === 0 || r.winner === 1) decisive++;
  for (const side of r.used) {
    for (const [id, n] of Object.entries(side)) { tally[id] = (tally[id] || 0) + n; plays += n; }
  }
}
const seen = Object.entries(tally).sort((a, b) => b[1] - a[1]);
for (const [id, n] of seen) {
  const pct = n / plays * 100;
  console.log(`  ${(MOVES[id]?.name || id).padEnd(12)} ${pct.toFixed(1).padStart(5)}% ${'▏'.repeat(Math.round(pct))}`);
}
const dead = NEUTRAL_SET.filter((id) => !tally[id]);
console.log(`\n  Average match: ${(totalTurns / MATCHES).toFixed(0)} turns, ${(decisive / MATCHES * 100).toFixed(0)}% decisive`);
console.log(`  Unused neutral moves: ${dead.length ? dead.map((d) => MOVES[d].name).join(', ') : 'none — every option earns its slot'}`);
