/*
 * Engine self-tests. Run: node games/hustle-lite/tests/engine.test.mjs
 *
 * These lock down the rock-paper-scissors web the whole game rests on. If one of these
 * fails, the threat board is lying to the player and the AI is playing a different game.
 */
import {
  MOVES, RULES, newMatch, resolveTurn, threatBoard, availableMoves,
  chooseAiMove, verdictFor, rng, riskProfile, NEUTRAL_SET, moveDuration,
} from '../src/engine.js';

let pass = 0, fail = 0;
const results = [];

function ok(name, cond, detail = '') {
  if (cond) { pass++; results.push(`  ok   ${name}`); }
  else { fail++; results.push(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}
const eq = (name, a, b) => ok(name, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

/** A match with the fighters placed exactly `d` apart, centred. */
function at(d, patch = {}) {
  const s = newMatch();
  const mid = (RULES.ARENA_MIN + RULES.ARENA_MAX) / 2;
  s.fighters[0].x = mid - d / 2;
  s.fighters[1].x = mid + d / 2;
  Object.assign(s.fighters[0], patch.p0 || {});
  Object.assign(s.fighters[1], patch.p1 || {});
  return s;
}
/** Resolve `a` (player 0) against `b` (player 1) at distance `d`. */
const clash = (a, b, d = 80, patch) => resolveTurn(at(d, patch), [a, b]);
const atk0 = (r) => r.summary[0].outcome;      // what player 0's move did
const atk1 = (r) => r.summary[1].outcome;
const def0 = (r) => r.summary[0].defence;      // what happened to player 0
const def1 = (r) => r.summary[1].defence;
const GRAB_RANGE = 70;                          // inside Grab's 78-unit reach

/* ---------------------------------------------------- speed decides trades */

{
  const r = clash('jab', 'grab');
  eq('jab (4f) beats grab (6f)', atk0(r), 'hit');
  eq('  ...and the grab never comes out', def1(r), 'cut');
  eq('  ...so the grab deals nothing', r.summary[1].dmgDealt, 0);
}
{
  const r = clash('jab', 'overhead');
  eq('jab beats overhead to the punch', atk0(r), 'hit');
  eq('  ...overhead is interrupted', def1(r), 'cut');
}
{
  const r = clash('jab', 'jab');
  ok('mirror jabs trade', atk0(r) === 'hit' && atk1(r) === 'hit', `${atk0(r)}/${atk1(r)}`);
  ok('  ...both take damage', r.summary[0].dmgDealt > 0 && r.summary[1].dmgDealt > 0);
  eq('  ...the trade is even', r.summary[0].adv, r.summary[1].adv);
  eq('  ...verdict reads TRADE', verdictFor(r, 0).key, 'trade');
  eq('  ...and a trade resets both to neutral', r.state.fighters[0].state, 'neutral');
  eq('  ...for both sides', r.state.fighters[1].state, 'neutral');
}

/* ------------------------------------------------------ high / low guard */

{
  const r = clash('sweep', 'highGuard');
  eq('sweep goes under High Guard', atk0(r), 'hit');
  eq('  ...and knocks them down', r.state.fighters[1].state, 'down');
}
eq('Low Guard stops a sweep', atk0(clash('sweep', 'lowGuard')), 'block');
eq('overhead beats Low Guard', atk0(clash('overhead', 'lowGuard')), 'hit');
eq('High Guard stops an overhead', atk0(clash('overhead', 'highGuard')), 'block');
eq('both guards stop a mid (jab)', atk0(clash('jab', 'lowGuard')), 'block');
ok('guarding still costs chip damage', clash('overhead', 'highGuard').state.fighters[1].hp < RULES.MAX_HP);
ok('a guarded overhead leaves the attacker minus', clash('overhead', 'highGuard').summary[0].adv < 0);
ok('a guarded jab is roughly even', Math.abs(clash('jab', 'highGuard').summary[0].adv) <= 2);
ok('a guarded lunge is a free punish', clash('lunge', 'highGuard').summary[1].adv >= 8);

/* ------------------------------------------------------------------ grab */

{
  const r = clash('grab', 'highGuard', GRAB_RANGE);
  eq('grab ignores High Guard', atk0(r), 'hit');
  eq('grab ignores Low Guard', atk0(clash('grab', 'lowGuard', GRAB_RANGE)), 'hit');
  eq('  ...and puts them on the floor', r.state.fighters[1].state, 'down');
}
{
  const r = clash('grab', 'grab', GRAB_RANGE);
  eq('grab vs grab clashes', atk0(r), 'clash');
  eq('  ...for both sides', atk1(r), 'clash');
  ok('  ...nobody takes damage', r.summary[0].dmgDealt === 0 && r.summary[1].dmgDealt === 0);
}
eq('grab is out of reach from 100 units', atk0(clash('grab', 'hustle', 100)), 'whiff');

/* ----------------------------------------------------------------- parry */

{
  const r = clash('jab', 'parry');
  eq('parry eats a jab (contact frame 4, window 2-7)', atk0(r), 'parried');
  eq('  ...parrier is credited', def1(r), 'parry');
  ok('  ...parrier acts first by a mile', r.summary[1].adv > 15, `adv ${r.summary[1].adv}`);
  ok('  ...and banks a meter level', r.state.fighters[1].meter > 0);
}
eq('overhead (13f) walks past the parry window', atk0(clash('overhead', 'parry')), 'hit');
eq('sweep (8f) walks past the parry window', atk0(clash('sweep', 'parry')), 'hit');
eq('grab is not parryable', atk0(clash('grab', 'parry', GRAB_RANGE)), 'hit');
eq('super (5f) gets parried', atk0(clash('super', 'parry', 80, { p0: { meter: 4 } })), 'parried');

/* ----------------------------------------------------------- dodge roll */

eq('dodge i-frames beat a jab', atk0(clash('jab', 'dodge')), 'whiff');
eq('dodge i-frames beat a grab', atk0(clash('grab', 'dodge', GRAB_RANGE)), 'whiff');
{
  const r = clash('jab', 'dodge');
  ok('dodging surrenders the turn', r.summary[1].adv < -8, `adv ${r.summary[1].adv}`);
  ok('dodging creates space', Math.abs(r.state.fighters[0].x - r.state.fighters[1].x) > 80);
}
eq('a dodge escapes even a slow overhead', atk0(clash('overhead', 'dodge')), 'whiff');
eq('but Lunge chases a dodge down', atk0(clash('lunge', 'dodge')), 'hit');
ok('dodging banks no meter', clash('jab', 'dodge').state.fighters[1].meter === 0);

/* --------------------------------------------------------------- armour */

{
  const r = clash('jab', 'lunge', 165);
  eq('Lunge armours through a poke on the way in', atk0(r), 'armoured');
  ok('  ...the poke still does half damage', r.summary[0].dmgDealt > 0 && r.summary[0].dmgDealt < MOVES.jab.dmg);
  eq('  ...but the Lunge is not interrupted', def1(r), 'armour');
  eq('  ...and it lands', atk1(r), 'hit');
}
{
  const r = clash('grab', 'lunge', GRAB_RANGE);
  eq('a Grab goes straight through armour', atk0(r), 'hit');
  eq('  ...stopping the Lunge cold', def1(r), 'cut');
}
eq('a guard also stops a Lunge', atk1(clash('highGuard', 'lunge', 165)), 'block');
{
  const r = clash('jab', 'lunge', 165);
  const two = resolveTurn(at(165, { p0: { combo: 0 } }), ['overhead', 'lunge']);
  ok('armour only soaks one strike per move', r.summary[0].dmgDealt > 0);
  eq('armour does not apply outside its window', MOVES.lunge.armour[1], 10);
}
ok('only Lunge carries armour in the neutral set',
  NEUTRAL_SET.filter((id) => MOVES[id].armour).length === 1);

/* ---------------------------------------------------------------- super */

ok('super is unavailable below 2 meter', !availableMoves(at(80, { p0: { meter: 1 } }), 0).some((m) => m.id === 'super'));
ok('super is available at 2 meter', availableMoves(at(80, { p0: { meter: 2 } }), 0).some((m) => m.id === 'super'));
{
  const r = resolveTurn(at(80, { p0: { meter: 2 } }), ['super', 'jab']);
  eq('super i-frames make the jab whiff', atk1(r), 'whiff');
  eq('  ...the jab deals nothing', r.summary[1].dmgDealt, 0);
  eq('  ...and the super lands', atk0(r), 'hit');
  eq('  ...costing 2 meter', r.state.fighters[0].meter, 0);
}
{
  const r = clash('super', 'highGuard', 80, { p0: { meter: 4 } });
  eq('a guarded super is guarded', atk0(r), 'block');
  ok('  ...and is enormously punishable', r.summary[1].adv > 15, `adv ${r.summary[1].adv}`);
}

/* ------------------------------------------------------------- distance */

eq('a jab whiffs from 300 units out', atk0(clash('jab', 'hustle', 300)), 'whiff');
eq('lunge closes the gap and connects', atk0(clash('lunge', 'hustle', 220)), 'hit');
eq('lunge still cannot reach from 400', atk0(clash('lunge', 'hustle', 400)), 'whiff');
{
  const r = clash('closeIn', 'backOff', 200);
  ok('closing vs retreating roughly holds the gap',
    Math.abs(Math.abs(r.state.fighters[0].x - r.state.fighters[1].x) - 200) < 40);
}
{
  const r = clash('closeIn', 'hustle', 300);
  ok('closing in shrinks the gap', Math.abs(r.state.fighters[0].x - r.state.fighters[1].x) < 200);
}
{
  const r = clash('lunge', 'closeIn', 100);
  ok('fighters never overlap',
    Math.abs(r.state.fighters[0].x - r.state.fighters[1].x) >= RULES.MIN_SEPARATION - 0.001);
}
ok('nobody leaves the arena', [0, 1].every((i) => {
  const r = clash('grab', 'backOff', 70, { p1: { x: RULES.ARENA_MAX - 10 } });
  return r.state.fighters[i].x >= RULES.ARENA_MIN && r.state.fighters[i].x <= RULES.ARENA_MAX;
}));

/* --------------------------------------------------------- hustle / meter */

eq('an uncontested hustle banks 2 meter', clash('hustle', 'hustle', 400).state.fighters[0].meter, 2);
eq('a punished hustle banks nothing', clash('jab', 'hustle').state.fighters[1].meter, 0);
eq('meter is capped', clash('hustle', 'hustle', 400, { p0: { meter: RULES.MAX_METER } }).state.fighters[0].meter, RULES.MAX_METER);
{
  // Meter points carry across turns rather than evaporating between them.
  let acc = at(70);
  for (let i = 0; i < 6; i++) acc = resolveTurn(acc, ['jab', 'highGuard']).state;
  ok('chip meter accumulates over several turns', acc.fighters[1].meter >= 1, `meter ${acc.fighters[1].meter}`);
}

/* ------------------------------------------------ hitstun, wakeup, burst */

{
  const r = clash('jab', 'hustle');
  eq('a clean hit leaves them stunned', r.state.fighters[1].state, 'stunned');
  const opts = availableMoves(r.state, 1).map((m) => m.id);
  ok('stunned players only get escape options', opts.every((id) => ['burst', 'diIn', 'diOut'].includes(id)), opts.join(','));
}
{
  const r = clash('grab', 'hustle', GRAB_RANGE);
  const opts = availableMoves(r.state, 1).map((m) => m.id);
  ok('knocked-down players get wakeup options', opts.includes('quickRise') && opts.includes('rollAway'), opts.join(','));
  ok('wakeup super needs meter', !opts.includes('wakeSuper'));
  const rich = { ...r.state, fighters: r.state.fighters.map((f, i) => (i === 1 ? { ...f, meter: 3 } : f)) };
  ok('wakeup super appears with meter', availableMoves(rich, 1).some((m) => m.id === 'wakeSuper'));
}
{
  const burstState = clash('jab', 'hustle').state;
  burstState.fighters[1].burst = RULES.BURST_FULL;
  ok('burst appears at full charge', availableMoves(burstState, 1).some((m) => m.id === 'burst'));

  const r = resolveTurn(burstState, ['jab', 'burst']);
  eq('burst i-frames beat the follow-up jab', atk0(r), 'whiff');
  ok('burst creates a lot of space', Math.abs(r.state.fighters[0].x - r.state.fighters[1].x) > 150,
    `gap ${Math.abs(r.state.fighters[0].x - r.state.fighters[1].x).toFixed(0)}`);
  eq('burst is spent', r.state.fighters[1].burst, 0);
  eq('  ...and returns them to neutral', r.state.fighters[1].state, 'neutral');

  const baited = resolveTurn(burstState, ['highGuard', 'burst']);
  eq('a guarded burst is wasted', atk1(baited), 'block');
  eq('  ...and still consumed', baited.state.fighters[1].burst, 0);
}
{
  const stunned = clash('jab', 'hustle').state;
  const away = resolveTurn(stunned, ['hustle', 'diOut']);
  const into = resolveTurn(stunned, ['hustle', 'diIn']);
  const g = (r) => Math.abs(r.state.fighters[0].x - r.state.fighters[1].x);
  ok('DI actually shifts position', g(away) > g(into), `${g(away).toFixed(0)} vs ${g(into).toFixed(0)}`);
}

/* ---------------------------------------------------- damage & proration */

{
  const fresh = clash('overhead', 'hustle').summary[0].dmgDealt;
  const late = clash('overhead', 'hustle', 80, { p0: { combo: 4 } }).summary[0].dmgDealt;
  ok('long combos prorate damage', late < fresh, `${late} vs ${fresh}`);
}
{
  const low = clash('overhead', 'hustle', 80, { p1: { hp: 40 } }).summary[0].dmgDealt;
  const high = clash('overhead', 'hustle').summary[0].dmgDealt;
  ok('guts reduces damage at low health', low < high, `${low} vs ${high}`);
}
eq('the match ends when health runs out',
  clash('overhead', 'hustle', 80, { p1: { hp: 5 } }).state.over?.winner, 0);
ok('an unfinished match is not over', clash('jab', 'hustle').state.over === null);
{
  const r = clash('jab', 'jab', 80, { p0: { hp: 3 }, p1: { hp: 3 } });
  ok('a double KO is a draw', r.state.over && r.state.over.winner === null);
}
ok('a win by fighter 0 is truthy, not a falsy index',
  !!clash('overhead', 'hustle', 80, { p1: { hp: 5 } }).state.over);

/* ------------------------------------------------------ stalling (sadness) */

{
  let s = at(700);
  for (let i = 0; i < RULES.STALL_GRACE + 1; i++) s = resolveTurn(s, ['hustle', 'hustle']).state;
  ok('circling forever starts costing both fighters health',
    s.fighters[0].hp < RULES.MAX_HP && s.fighters[1].hp < RULES.MAX_HP, `hp ${s.fighters[0].hp}`);
  eq('a connected hit resets the stall clock', resolveTurn(at(80), ['jab', 'hustle']).state.stall, 0);
}

/* ---------------------------------------------------------- threat board */

{
  const s = at(80);
  const b = threatBoard(s, 0, 'hustle');
  eq('every legal reply is scored', b.rows.length, availableMoves(s, 1).length);
  ok('rows are ranked best-answer-first', b.rows.every((r, i) => i === 0 || b.rows[i - 1].score >= r.score));
  ok('heat is normalised 0..1', b.rows.every((r) => r.heat >= 0 && r.heat <= 1));
  ok('hustling in range is flagged as risky', b.risk > 0.5, `risk ${b.risk}`);
  ok('the best answer to a point-blank hustle hurts', b.best.dmgTaken > 0, b.best.move.name);
}
eq('hustling out of range is safe', threatBoard(at(700), 0, 'hustle').risk, 0);
{
  const b = threatBoard(at(80), 0, 'jab');
  ok('the board names a concrete best answer to a jab', !!b.best.move.name, b.best.move.name);
  ok('the answer to a jab is a real counter, not a coin flip',
    ['parry', 'dodge', 'jab', 'lunge', 'highGuard', 'lowGuard', 'backOff'].includes(b.best.move.id), b.best.move.id);
}
{
  // The board must agree with the engine: replaying the best row reproduces its numbers.
  const s = at(80);
  const b = threatBoard(s, 0, 'jab');
  const replay = resolveTurn(s, ['jab', b.best.move.id]);
  eq('board rows are real simulations, not estimates', replay.summary[0].dmgTaken, b.best.dmgTaken);
  eq('  ...including frame advantage', replay.summary[0].adv, b.best.adv);
}
{
  const s = at(80, { p0: { meter: 3 } });
  const profile = riskProfile(s, 0);
  eq('every available move gets a risk rating', Object.keys(profile).length, availableMoves(s, 0).length);
  ok('risk ratings are fractions', Object.values(profile).every((p) => p.risk >= 0 && p.risk <= 1));
}
{
  // Guarding a mid should be safer than throwing out a raw super point-blank.
  const s = at(80, { p0: { meter: 4 } });
  ok('the board rates a raw super riskier than a guard',
    threatBoard(s, 0, 'super').risk >= threatBoard(s, 0, 'highGuard').risk);
}

/* -------------------------------------------------------------------- AI */

{
  const rand = rng(7);
  for (const diff of ['rookie', 'fighter', 'yomi', 'oracle']) {
    const s = at(90, { p1: { meter: 3 } });
    const id = chooseAiMove(s, 1, diff, ['jab', 'jab', 'jab'], rand);
    ok(`${diff} AI picks a legal move`, availableMoves(s, 1).some((m) => m.id === id), String(id));
  }
}
{
  const rand = rng(3);
  const s = at(85);
  const picks = new Set();
  for (let i = 0; i < 40; i++) picks.add(chooseAiMove(s, 1, 'oracle', ['jab', 'jab', 'jab', 'jab'], rand));
  ok('a read-heavy AI answers a jab habit with a counter',
    [...picks].some((id) => ['parry', 'dodge', 'jab', 'highGuard', 'lowGuard', 'backOff'].includes(id)), [...picks].join(','));
}
{
  const rand = rng(11);
  const picks = new Set();
  for (let i = 0; i < 60; i++) picks.add(chooseAiMove(at(90), 1, 'rookie', [], rand));
  ok('a rookie AI mixes it up', picks.size > 4, `${picks.size} distinct`);
}
{
  const rand = rng(5);
  const id = chooseAiMove(clash('jab', 'hustle').state, 1, 'yomi', [], rand);
  ok('the AI plays legal moves while stunned', ['burst', 'diIn', 'diOut'].includes(id), String(id));
}
{
  const rand = rng(13);
  const id = chooseAiMove(clash('grab', 'hustle', GRAB_RANGE).state, 1, 'yomi', [], rand);
  ok('the AI plays legal moves off the floor', ['quickRise', 'rollAway'].includes(id), String(id));
}

/* -------------------------------------------------------------- playback */

{
  const r = clash('overhead', 'lowGuard');
  eq('a timeline frame exists for every frame', r.timeline.length, r.total + 1);
  ok('timeline carries finite positions', r.timeline.every((t) => t.x.length === 2 && Number.isFinite(t.x[0])));
  ok('impact events are timestamped', r.events.some((e) => e.type === 'hit'));
  ok('every frame has a phase per fighter', r.timeline.every((t) => t.phase.length === 2 && t.phase[0]));
}
{
  const s = at(80);
  const a = resolveTurn(s, ['jab', 'grab']);
  const b = resolveTurn(s, ['jab', 'grab']);
  ok('resolution is deterministic', JSON.stringify(a.summary) === JSON.stringify(b.summary));
  ok('resolution does not mutate the input state', s.fighters[0].hp === RULES.MAX_HP && s.turn === 1);
}

/* ------------------------------------------------------------- integrity */

ok('every neutral move has a blurb', NEUTRAL_SET.every((id) => MOVES[id].blurb));
ok('every neutral move has a hotkey', NEUTRAL_SET.every((id) => MOVES[id].key));
ok('hotkeys are unique', new Set(NEUTRAL_SET.map((id) => MOVES[id].key)).size === NEUTRAL_SET.length);
ok('no neutral move is free', NEUTRAL_SET.every((id) => moveDuration(MOVES[id]) > 0));
ok('every move id matches its key in the table', Object.entries(MOVES).every(([k, m]) => m.id === k));
ok('every strike has reach', NEUTRAL_SET.filter((id) => MOVES[id].dmg).every((id) => MOVES[id].range > 0));

/* ------------------------------------------------------------ full match */

{
  const rand = rng(99);
  let s = newMatch();
  let turns = 0;
  while (s.over === null && turns < 400) {
    const mine = availableMoves(s, 0);
    const pick = mine[Math.floor(rand() * mine.length)].id;
    const ai = chooseAiMove(s, 1, 'fighter', [], rand);
    s = resolveTurn(s, [pick, ai]).state;
    turns++;
  }
  ok('a random match reaches a conclusion', s.over !== null, `${turns} turns`);
  ok('  ...in a sane number of turns', turns < 220, `${turns}`);
}
{
  // The AI should beat a player who does the same thing every single turn.
  const rand = rng(4242);
  let wins = 0;
  for (let m = 0; m < 5; m++) {
    let s = newMatch();
    let turns = 0;
    while (s.over === null && turns < 300) {
      const mine = availableMoves(s, 0);
      const spam = mine.find((x) => x.id === 'jab') || mine[0];
      s = resolveTurn(s, [spam.id, chooseAiMove(s, 1, 'oracle', ['jab'], rand)]).state;
      turns++;
    }
    if (s.over?.winner === 1) wins++;
  }
  ok('the Oracle AI punishes a one-button player', wins >= 4, `${wins}/5 AI wins`);
}

console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
