/*
 * Balance harness. Run: node games/hustle-lite/tests/balance.mjs
 *
 * Not a pass/fail suite — a readout. It answers the three questions that decide whether
 * the game is worth playing:
 *   1. Can any single button, mashed forever, beat a thinking opponent?
 *   2. When two thinking opponents play, does the whole moveset actually get used?
 *   3. Is any character simply better than the others?
 * A dominant strategy, a dead move, or a lopsided matchup shows up here long before it
 * shows up in play.
 */
import {
  CHARS, CHAR_IDS, neutralSet, moveOf, newMatch, nextRound, resolveTurn,
  availableMoves, chooseAiMove, rng,
} from '../src/engine.js';

const MATCHES = 30;
const TURN_CAP = 600;   // generous: a best-of-three runs several rounds

function play(pick0, pick1, seed, c0 = 'duelist', c1 = 'duelist') {
  const rand = rng(seed);
  let s = newMatch(c0, c1);
  let turns = 0;
  const hist = [[], []];
  const used = [{}, {}];
  while (s.over === null && turns < TURN_CAP) {
    const a = pick0(s, 0, hist[1], rand);
    const b = pick1(s, 1, hist[0], rand);
    if (a == null || b == null) break;
    used[0][a] = (used[0][a] || 0) + 1;
    used[1][b] = (used[1][b] || 0) + 1;
    hist[0].push(a); hist[1].push(b);
    s = resolveTurn(s, [a, b]).state;
    if (s.roundOver && !s.over) s = nextRound(s);
    turns++;
  }
  return { winner: s.over ? s.over.winner : 'timeout', turns, used, wins: s.wins };
}

/** Mash one move forever; fall back to whatever is legal when stunned or downed. */
const spam = (id) => (s, i) => {
  const opts = availableMoves(s, i);
  return (opts.find((m) => m.id === id) || opts[0]).id;
};
const ai = (level) => (s, i, oppHistory, rand) => chooseAiMove(s, i, level, oppHistory, rand);
const bar = (frac, width = 22) => '█'.repeat(Math.round(frac * width)).padEnd(width, '·');

/* ------------------------------------------------- 1. one-button players */

console.log('One-button players vs the Oracle AI  (win rate over a best-of-three)');
console.log('─'.repeat(70));
let worstOverall = { rate: 0 };
for (const c of CHAR_IDS) {
  const rows = [];
  for (const id of neutralSet(c)) {
    let wins = 0, total = 0;
    for (let m = 0; m < MATCHES; m++) {
      const r = play(spam(id), ai('oracle'), 1000 + m * 37, c, 'duelist');
      if (r.winner === 0) wins++;
      total++;
    }
    rows.push({ id, rate: wins / total });
  }
  rows.sort((a, b) => b.rate - a.rate);
  const top = rows[0];
  if (top.rate > worstOverall.rate) worstOverall = { rate: top.rate, char: c, id: top.id };
  const offenders = rows.filter((r) => r.rate > 0).slice(0, 3);
  console.log(`  ${CHARS[c].name.padEnd(9)} best single button: ${moveOf(c, top.id).name.padEnd(12)} ` +
    `${(top.rate * 100).toFixed(0).padStart(3)}%  ${bar(top.rate)}`);
  if (offenders.length > 1) {
    console.log(`             others above zero: ${offenders.slice(1).map((r) => `${moveOf(c, r.id).name} ${(r.rate * 100).toFixed(0)}%`).join(', ')}`);
  }
}
console.log(`\n  Verdict: ${worstOverall.rate > 0.4
  ? `DOMINANT — ${CHARS[worstOverall.char].name}'s ${moveOf(worstOverall.char, worstOverall.id).name} wins ${(worstOverall.rate * 100).toFixed(0)}% on its own`
  : 'no dominant strategy on any character'}`);

/* ------------------------------------------------------- 2. move usage */

console.log('\n\nOracle mirrors — which moves actually get played?');
console.log('─'.repeat(70));
for (const c of CHAR_IDS) {
  const tally = {};
  let plays = 0, totalTurns = 0, decisive = 0;
  for (let m = 0; m < MATCHES; m++) {
    const r = play(ai('oracle'), ai('oracle'), 500 + m * 13, c, c);
    totalTurns += r.turns;
    if (r.winner === 0 || r.winner === 1) decisive++;
    for (const side of r.used) {
      for (const [id, n] of Object.entries(side)) { tally[id] = (tally[id] || 0) + n; plays += n; }
    }
  }
  const neutral = neutralSet(c);
  const shares = neutral.map((id) => ({ id, pct: (tally[id] || 0) / plays * 100 }))
    .sort((a, b) => b.pct - a.pct);
  console.log(`\n  ${CHARS[c].name}  —  ${(totalTurns / MATCHES).toFixed(0)} turns/match, ${(decisive / MATCHES * 100).toFixed(0)}% decisive`);
  for (const s of shares) {
    const flag = s.pct < 1 ? ' ← barely used' : '';
    console.log(`    ${moveOf(c, s.id).name.padEnd(13)} ${s.pct.toFixed(1).padStart(5)}% ${'▏'.repeat(Math.round(s.pct))}${flag}`);
  }
  const dead = shares.filter((s) => s.pct < 1);
  if (dead.length) console.log(`    (${dead.length} option${dead.length > 1 ? 's' : ''} under 1%)`);
}

/* -------------------------------------------------- 3. matchup matrix */

console.log('\n\nCharacter matchup matrix  (row wins vs column, Yomi AI both sides)');
console.log('─'.repeat(70));
const pad = 10;
console.log('  '.padEnd(pad + 2) + CHAR_IDS.map((c) => CHARS[c].name.padStart(9)).join(''));
const spread = [];
for (const a of CHAR_IDS) {
  const cells = [];
  for (const b of CHAR_IDS) {
    let wins = 0;
    for (let m = 0; m < MATCHES; m++) {
      const r = play(ai('yomi'), ai('yomi'), 7000 + m * 91, a, b);
      if (r.winner === 0) wins++;
    }
    const rate = wins / MATCHES;
    if (a !== b) spread.push({ a, b, rate });
    cells.push(`${(rate * 100).toFixed(0)}%`.padStart(9));
  }
  console.log(`  ${CHARS[a].name.padEnd(pad)}${cells.join('')}`);
}
// A cycle (A beats B beats C beats A) is a healthy structure for a roster — it means
// picking a character is itself a read. A character that simply beats everyone is not.
const beats = (a, b) => (spread.find((s) => s.a === a && s.b === b)?.rate ?? 0) > 0.5;
const cyclic = CHAR_IDS.every((c) => CHAR_IDS.some((d) => c !== d && beats(c, d)))
  && CHAR_IDS.every((c) => CHAR_IDS.some((d) => c !== d && beats(d, c)));
const worst = spread.reduce((m, s) => (Math.abs(s.rate - 0.5) > Math.abs(m.rate - 0.5) ? s : m), spread[0]);
console.log(`\n  Structure: ${cyclic
  ? 'a cycle — every character beats someone and loses to someone'
  : 'NOT cyclic — at least one character has no bad matchup'}`);
console.log(`  Steepest edge: ${CHARS[worst.a].name} vs ${CHARS[worst.b].name} at ${(worst.rate * 100).toFixed(0)}%` +
  `${Math.abs(worst.rate - 0.5) > 0.3 ? '  ← steep, counterpick matters a lot here' : ''}`);
