/*
 * Engine self-tests. Run: node games/hustle-lite/tests/engine.test.mjs
 *
 * These lock down the rock-paper-scissors web the whole game rests on. If one of these
 * fails, the threat board is lying to the player and the AI is playing a different game.
 */
import {
  CHARS, CHAR_IDS, RULES, newMatch, nextRound, resolveTurn, threatBoard, availableMoves,
  chooseAiMove, verdictFor, rng, riskProfile, neutralSet, moveDuration, moveOf, moveTable,
  yomiChain, postMortem, bestAnswer, previewTurn,
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
  const s = newMatch(patch.c0 || 'duelist', patch.c1 || 'duelist');
  const mid = (RULES.ARENA_MIN + RULES.ARENA_MAX) / 2;
  s.fighters[0].x = mid - d / 2;
  s.fighters[1].x = mid + d / 2;
  Object.assign(s.fighters[0], patch.p0 || {});
  Object.assign(s.fighters[1], patch.p1 || {});
  return s;
}
const clash = (a, b, d = 80, patch) => resolveTurn(at(d, patch), [a, b]);
const atk0 = (r) => r.summary[0].outcome;      // what player 0's move did
const atk1 = (r) => r.summary[1].outcome;
const def1 = (r) => r.summary[1].defence;
const D = (id) => moveOf('duelist', id);
const GRAB_RANGE = 70;                          // inside Grab's 72-unit reach
const MAXHP = CHARS.duelist.hp;

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
ok('guarding still costs chip damage', clash('overhead', 'highGuard').state.fighters[1].hp < MAXHP);
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
  eq('parry eats a jab (contact frame 4, window 2-9)', atk0(r), 'parried');
  eq('  ...parrier is credited', def1(r), 'parry');
  ok('  ...parrier acts first by a mile', r.summary[1].adv > 15, `adv ${r.summary[1].adv}`);
  ok('  ...and banks a meter level', r.state.fighters[1].meter > 0);
}
eq('parry now also catches a 7f sweep', atk0(clash('sweep', 'parry')), 'parried');
eq('overhead (13f) walks past the parry window', atk0(clash('overhead', 'parry')), 'hit');
eq('lunge (10f) walks past the parry window', atk0(clash('lunge', 'parry')), 'hit');
eq('grab is not parryable', atk0(clash('grab', 'parry', GRAB_RANGE)), 'hit');
eq('super (5f) gets parried', atk0(clash('risingFang', 'parry', 80, { p0: { meter: 4 } })), 'parried');

/* ----------------------------------------------------------- dodge roll */

eq('dodge i-frames beat a jab', atk0(clash('jab', 'dodge')), 'whiff');
eq('dodge i-frames beat a grab', atk0(clash('grab', 'dodge', GRAB_RANGE)), 'whiff');
{
  const r = clash('jab', 'dodge');
  ok('dodging still costs the turn', r.summary[1].adv < 0, `adv ${r.summary[1].adv}`);
  ok('  ...but not ruinously any more', r.summary[1].adv > -12, `adv ${r.summary[1].adv}`);
  ok('dodging creates space', Math.abs(r.state.fighters[0].x - r.state.fighters[1].x) > 80);
}
eq('a dodge escapes even a slow overhead', atk0(clash('overhead', 'dodge')), 'whiff');
eq('but Lunge chases a dodge down', atk0(clash('lunge', 'dodge')), 'hit');

/* --------------------------------------------------------------- armour */

{
  const r = clash('jab', 'lunge', 150);
  eq('Lunge armours through a poke on the way in', atk0(r), 'armoured');
  ok('  ...the poke still does reduced damage', r.summary[0].dmgDealt > 0 && r.summary[0].dmgDealt < D('jab').dmg);
  ok('  ...and powering through costs the armoured fighter damage too',
    r.summary[1].dmgDealt < D('lunge').dmg, `${r.summary[1].dmgDealt} vs ${D('lunge').dmg}`);
  eq('  ...but the Lunge is not interrupted', def1(r), 'armour');
  eq('  ...and it lands', atk1(r), 'hit');
}
{
  const r = clash('grab', 'lunge', GRAB_RANGE);
  eq('a Grab goes straight through armour', atk0(r), 'hit');
  eq('  ...stopping the Lunge cold', def1(r), 'cut');
}
eq('a guard also stops a Lunge', atk1(clash('highGuard', 'lunge', 150)), 'block');
ok('no character has more than one armoured move',
  CHAR_IDS.every((c) => neutralSet(c).filter((id) => moveOf(c, id).armour).length <= 1));
ok('Blade trades armour away for reach entirely',
  neutralSet('blade').every((id) => !moveOf('blade', id).armour));
ok('Duelist and Bruiser each get one armoured approach',
  ['duelist', 'bruiser'].every((c) => neutralSet(c).filter((id) => moveOf(c, id).armour).length === 1));

/* ---------------------------------------------------------------- super */

ok('super is unavailable below 2 meter', !availableMoves(at(80, { p0: { meter: 1 } }), 0).some((m) => m.cat === 'super'));
ok('super is available at 2 meter', availableMoves(at(80, { p0: { meter: 2 } }), 0).some((m) => m.cat === 'super'));
{
  const r = resolveTurn(at(80, { p0: { meter: 2 } }), ['risingFang', 'jab']);
  eq('super i-frames make the jab whiff', atk1(r), 'whiff');
  eq('  ...and the super lands', atk0(r), 'hit');
  eq('  ...costing 2 meter', r.state.fighters[0].meter, 0);
}
{
  const r = clash('risingFang', 'highGuard', 80, { p0: { meter: 4 } });
  eq('a guarded super is guarded', atk0(r), 'block');
  ok('  ...and is enormously punishable', r.summary[1].adv > 15, `adv ${r.summary[1].adv}`);
}

/* ------------------------------------------------------------- distance */

eq('a jab whiffs from 300 units out', atk0(clash('jab', 'hustle', 300)), 'whiff');
eq('lunge closes the gap and connects', atk0(clash('lunge', 'hustle', 220)), 'hit');
eq('lunge still cannot reach from 400', atk0(clash('lunge', 'hustle', 400)), 'whiff');
ok('closing vs retreating roughly holds the gap',
  Math.abs(Math.abs(clash('closeIn', 'backOff', 200).state.fighters[0].x
    - clash('closeIn', 'backOff', 200).state.fighters[1].x) - 200) < 40);
ok('closing in shrinks the gap',
  Math.abs(clash('closeIn', 'hustle', 300).state.fighters[0].x
    - clash('closeIn', 'hustle', 300).state.fighters[1].x) < 200);
ok('fighters never overlap',
  Math.abs(clash('lunge', 'closeIn', 100).state.fighters[0].x
    - clash('lunge', 'closeIn', 100).state.fighters[1].x) >= RULES.MIN_SEPARATION - 0.001);
ok('fighters never swap sides, however far a dash overshoots', (() => {
  for (const d of [56, 70, 100, 160]) {
    for (const pair of [['lunge', 'closeIn'], ['closeIn', 'closeIn'], ['lunge', 'lunge'], ['thrust', 'closeIn']]) {
      const s = at(d, { c0: pair[0] === 'thrust' ? 'blade' : 'duelist' });
      const r = resolveTurn(s, pair);
      if (r.state.fighters[0].x > r.state.fighters[1].x) return false;
      if (r.timeline.some((f) => f.x[0] > f.x[1])) return false;
    }
  }
  return true;
})());
ok('nobody leaves the arena', [0, 1].every((i) => {
  const r = clash('grab', 'backOff', 70, { p1: { x: RULES.ARENA_MAX - 10 } });
  return r.state.fighters[i].x >= RULES.ARENA_MIN && r.state.fighters[i].x <= RULES.ARENA_MAX;
}));

/* --------------------------------------------------------- hustle / meter */

eq('an uncontested hustle banks 2 meter', clash('hustle', 'hustle', 400).state.fighters[0].meter, 2);
eq('a punished hustle banks nothing', clash('jab', 'hustle').state.fighters[1].meter, 0);
eq('meter is capped', clash('hustle', 'hustle', 400, { p0: { meter: RULES.MAX_METER } }).state.fighters[0].meter, RULES.MAX_METER);
{
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
  ok('burst creates a lot of space', Math.abs(r.state.fighters[0].x - r.state.fighters[1].x) > 150);
  eq('burst is spent', r.state.fighters[1].burst, 0);
  eq('  ...and returns them to neutral', r.state.fighters[1].state, 'neutral');

  const baited = resolveTurn(burstState, ['highGuard', 'burst']);
  eq('a guarded burst is wasted', atk1(baited), 'block');
  eq('  ...and still consumed', baited.state.fighters[1].burst, 0);
}
{
  const stunned = clash('jab', 'hustle').state;
  const g = (r) => Math.abs(r.state.fighters[0].x - r.state.fighters[1].x);
  ok('DI actually shifts position',
    g(resolveTurn(stunned, ['hustle', 'diOut'])) > g(resolveTurn(stunned, ['hustle', 'diIn'])));
}

/* ---------------------------------------------------- damage & proration */

ok('long combos prorate damage',
  clash('overhead', 'hustle', 80, { p0: { combo: 4 } }).summary[0].dmgDealt < clash('overhead', 'hustle').summary[0].dmgDealt);
ok('guts reduces damage at low health',
  clash('overhead', 'hustle', 80, { p1: { hp: 40 } }).summary[0].dmgDealt < clash('overhead', 'hustle').summary[0].dmgDealt);

/* -------------------------------------------------------- rounds & match */

{
  const r = clash('overhead', 'hustle', 80, { p1: { hp: 5 } });
  eq('a KO ends the round', r.state.roundOver?.winner, 0);
  eq('  ...and banks a round win', r.state.wins[0], 1);
  ok('  ...but not the match', r.state.over === null);
}
{
  const r = clash('jab', 'jab', 80, { p0: { hp: 3 }, p1: { hp: 3 } });
  ok('a double KO is a drawn round', r.state.roundOver && r.state.roundOver.winner === null);
  ok('  ...and banks no wins', r.state.wins[0] === 0 && r.state.wins[1] === 0);
}
{
  const r = clash('overhead', 'hustle', 80, { p1: { hp: 5 }, p0: { hp: 100 } });
  const s2 = nextRound(r.state);
  eq('nextRound advances the round counter', s2.round, 2);
  eq('  ...carries the tally', s2.wins[0], 1);
  eq('  ...and restores full health', s2.fighters[0].hp, CHARS.duelist.hp);
  eq('  ...clearing the round result', s2.roundOver, null);
  eq('  ...and resetting the turn clock', s2.turn, 1);
}
{
  const almost = at(80, { p1: { hp: 5 } });
  almost.wins = [1, 0];
  const r = resolveTurn(almost, ['overhead', 'hustle']);
  eq('the second round win takes the match', r.state.over?.winner, 0);
  ok('  ...and a match win is truthy, not a falsy index', !!r.state.over);
}
{
  let s = at(300);
  s.turn = RULES.TURN_LIMIT;
  s.fighters[0].hp = 120; s.fighters[1].hp = 60;
  const r = resolveTurn(s, ['hustle', 'hustle']);
  eq('time over goes to the health leader', r.state.roundOver?.winner, 0);
  eq('  ...flagged as a time decision', r.state.roundOver?.by, 'time');
}

/* ------------------------------------------------------ stalling (sadness) */

{
  let s = at(700);
  for (let i = 0; i < RULES.STALL_GRACE + 1; i++) s = resolveTurn(s, ['hustle', 'hustle']).state;
  ok('circling forever costs both fighters health', s.fighters[0].hp < CHARS.duelist.hp);
  eq('a connected hit resets the stall clock', resolveTurn(at(80), ['jab', 'hustle']).state.stall, 0);
}

/* ------------------------------------------------------------ characters */

ok('there are three archetypes', CHAR_IDS.length === 3, CHAR_IDS.join(','));
for (const c of CHAR_IDS) {
  const set = neutralSet(c);
  ok(`${c}: 13 neutral options`, set.length === 13, `${set.length}`);
  ok(`${c}: hotkeys are unique`, new Set(set.map((id) => moveOf(c, id).key)).size === set.length);
  ok(`${c}: every move has a blurb`, set.every((id) => moveOf(c, id).blurb));
  ok(`${c}: no move is free`, set.every((id) => moveDuration(moveOf(c, id)) > 0));
  ok(`${c}: has one low, one high and one grab`,
    set.filter((id) => moveOf(c, id).level === 'low' && moveOf(c, id).dmg).length >= 1
    && set.filter((id) => moveOf(c, id).level === 'high').length >= 1
    && set.filter((id) => moveOf(c, id).cat === 'grab').length === 1);
  ok(`${c}: ids match their table keys`,
    Object.entries(moveTable(c)).every(([k, m]) => m.id === k));
}
ok('the three differ in health', new Set(CHAR_IDS.map((c) => CHARS[c].hp)).size === 3);
ok('Blade is the fastest starter',
  Math.min(...neutralSet('blade').map((id) => moveOf('blade', id).dmg ? moveOf('blade', id).startup : 99)) === 3);
ok('Bruiser hits hardest',
  Math.max(...neutralSet('bruiser').map((id) => moveOf('bruiser', id).dmg))
  > Math.max(...neutralSet('blade').map((id) => moveOf('blade', id).dmg)));
ok('Blade reaches furthest',
  Math.max(...neutralSet('blade').map((id) => moveOf('blade', id).range))
  > Math.max(...neutralSet('duelist').map((id) => moveOf('duelist', id).range)));
ok('character tweaks apply to universal moves',
  moveOf('blade', 'closeIn').dash.dist > moveOf('bruiser', 'closeIn').dash.dist);
ok('universal moves are otherwise shared',
  moveOf('blade', 'highGuard').recovery === moveOf('bruiser', 'highGuard').recovery);

/* --------------------------------------------------- cross-character play */

{
  const r = clash('flick', 'hook', 90, { c0: 'blade', c1: 'bruiser' });
  eq("Blade's 3f flick beats Bruiser's 6f hook", atk0(r), 'hit');
}
{
  const r = clash('flick', 'charge', 150, { c0: 'blade', c1: 'bruiser' });
  eq("Bruiser's armour eats a flick", atk0(r), 'armoured');
  eq('  ...and the charge lands', atk1(r), 'hit');
}
{
  const r = clash('snare', 'charge', 74, { c0: 'blade', c1: 'bruiser' });
  eq('a grab still stops an armoured charge', atk0(r), 'hit');
}
{
  const r = clash('thrust', 'hustle', 210, { c0: 'blade' });
  eq('Step Thrust reaches from well outside jab range', atk0(r), 'hit');
}
{
  const r = clash('quake', 'highGuard', 120, { c0: 'bruiser', p0: { meter: 3 } });
  eq("Bruiser's low super goes under High Guard", atk0(r), 'hit');
}
ok('mixed-character matches run to a conclusion', (() => {
  const rand = rng(21);
  let s = newMatch('blade', 'bruiser');
  let turns = 0;
  while (s.over === null && turns < 400) {
    s = resolveTurn(s, [
      chooseAiMove(s, 0, 'fighter', [], rand) ?? availableMoves(s, 0)[0].id,
      chooseAiMove(s, 1, 'fighter', [], rand) ?? availableMoves(s, 1)[0].id,
    ]).state;
    if (s.roundOver && !s.over) s = nextRound(s);
    turns++;
  }
  return s.over !== null;
})());

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
  const s = at(80);
  const b = threatBoard(s, 0, 'jab');
  const replay = resolveTurn(s, ['jab', b.best.move.id]);
  eq('board rows are real simulations, not estimates', replay.summary[0].dmgTaken, b.best.dmgTaken);
  eq('  ...including frame advantage', replay.summary[0].adv, b.best.adv);
}
{
  const s = at(90, { c0: 'blade', c1: 'bruiser' });
  const b = threatBoard(s, 0, 'flick');
  ok('the board works across different characters',
    b.rows.length === availableMoves(s, 1).length && b.rows.every((r) => moveOf('bruiser', r.move.id)));
}
{
  const s = at(80, { p0: { meter: 3 } });
  const profile = riskProfile(s, 0);
  eq('every available move gets a risk rating', Object.keys(profile).length, availableMoves(s, 0).length);
  ok('risk ratings are fractions', Object.values(profile).every((p) => p.risk >= 0 && p.risk <= 1));
}

/* ------------------------------------------------------------ yomi chain */

{
  const s = at(85);
  const chain = yomiChain(s, 0, 'jab');
  ok('the chain starts with your own move', chain[0].move.id === 'jab' && chain[0].side === 0);
  ok('the chain has at least two layers', chain.length >= 2, `${chain.length}`);
  ok('layers alternate sides', chain.every((l, i) => i === 0 || l.side !== chain[i - 1].side));
  ok('every answer after the first carries a verdict', chain.slice(1).every((l) => l.verdict?.label));
  ok('the chain terminates', chain.length <= 5, `${chain.length}`);
  const looped = chain.find((l) => l.loops);
  ok('a repeat is flagged as the loop point', !looped || chain.indexOf(looped) === chain.length - 1);
}
{
  const s = at(85);
  const chain = yomiChain(s, 0, 'jab');
  const answer = bestAnswer(s, 1, 'jab');
  eq('layer 1 is exactly the threat board best answer', chain[1].move.id, answer.move.id);
  eq('  ...and matches the board', chain[1].move.id, threatBoard(s, 0, 'jab').best.move.id);
}
ok('the chain works for every character',
  CHAR_IDS.every((c) => yomiChain(at(85, { c0: c, c1: 'duelist' }), 0, neutralSet(c)[0]).length >= 2));

/* ------------------------------------------------------------ post-mortem */

{
  const s = at(80);
  const pm = postMortem(s, 0, 'jab', 'parry');
  ok('the post-mortem names a better answer to a parry', pm.best.move.id !== 'jab', pm.best.move.name);
  ok('  ...and knows the jab was not it', pm.wasBest === false);
  ok('  ...ranking what you played', pm.rank > 1 && pm.rank <= pm.total, `${pm.rank}/${pm.total}`);
  ok('  ...with a real verdict', !!pm.best.verdict.label);
  const replay = resolveTurn(s, [pm.best.move.id, 'parry']);
  eq('  ...that reproduces on replay', replay.summary[0].dmgDealt, pm.best.dmgDealt);
}
{
  const s = at(80);
  const best = postMortem(s, 0, 'jab', 'hustle').best.move.id;
  const pm = postMortem(s, 0, best, 'hustle');
  ok('playing the best answer is recognised as such', pm.wasBest === true, pm.best.move.name);
  eq('  ...and ranked first', pm.rank, 1);
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
  const rand = rng(11);
  const picks = new Set();
  for (let i = 0; i < 60; i++) picks.add(chooseAiMove(at(90), 1, 'rookie', [], rand));
  ok('a rookie AI mixes it up', picks.size > 4, `${picks.size} distinct`);
}
{
  const rand = rng(5);
  ok('the AI plays legal moves while stunned',
    ['burst', 'diIn', 'diOut'].includes(chooseAiMove(clash('jab', 'hustle').state, 1, 'yomi', [], rand)));
  ok('the AI plays legal moves off the floor',
    ['quickRise', 'rollAway'].includes(chooseAiMove(clash('grab', 'hustle', GRAB_RANGE).state, 1, 'yomi', [], rand)));
}
ok('the AI can play any character',
  CHAR_IDS.every((c) => {
    const s = at(90, { c1: c, p1: { meter: 3 } });
    const id = chooseAiMove(s, 1, 'yomi', [], rng(3));
    return availableMoves(s, 1).some((m) => m.id === id);
  }));

/* -------------------------------------------------------------- symmetry */

/*
 * Neither side may get an edge from being player 0. Resolving A-vs-B must be the exact
 * mirror of B-vs-A: same outcomes, same damage, same frame advantage, just swapped. If
 * this ever fails, one player's attacks genuinely come out first and the game is rigged.
 */
{
  const moves = ['jab', 'sweep', 'overhead', 'lunge', 'grab', 'highGuard', 'lowGuard', 'parry', 'dodge', 'hustle'];
  let asym = null;
  for (const a of moves) {
    for (const b of moves) {
      for (const d of [70, 90, 140, 220]) {
        const ab = resolveTurn(at(d), [a, b]);
        const ba = resolveTurn(at(d), [b, a]);
        const same = ab.summary[0].outcome === ba.summary[1].outcome
          && ab.summary[1].outcome === ba.summary[0].outcome
          && ab.summary[0].dmgDealt === ba.summary[1].dmgDealt
          && ab.summary[1].dmgDealt === ba.summary[0].dmgDealt
          && ab.summary[0].adv === ba.summary[1].adv
          && ab.summary[0].contactAt === ba.summary[1].contactAt;
        if (!same && !asym) asym = `${a} vs ${b} at ${d}`;
      }
    }
  }
  ok('resolution is side-symmetric across every pairing and distance', !asym, String(asym));
}
{
  const evens = ['jab', 'sweep', 'overhead', 'lunge'].every((m) => {
    const r = resolveTurn(at(85), [m, m]);
    return r.summary[0].adv === r.summary[1].adv && r.summary[0].dmgDealt === r.summary[1].dmgDealt;
  });
  ok('mirrored moves trade dead even', evens);
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
  ok('resolution does not mutate the input state', s.fighters[0].hp === MAXHP && s.turn === 1);
}

/* ---------------------------------------------------------- move preview */

/*
 * The planning arena rehearses the move you are holding. If that rehearsal is not the same
 * simulation the fight runs, it is a decoration that lies — so pin it to a real exchange
 * against Hustle, which has no guard, no parry, no armour and no hitbox and is therefore
 * exactly the inert opponent the preview stands one up against.
 */
{
  const at = (d) => {
    const s = newMatch('duelist', 'duelist');
    s.fighters[0].x = 500 - d / 2;
    s.fighters[1].x = 500 + d / 2;
    return s;
  };
  const s = at(100);
  const p = previewTurn(s, 0, 'jab');
  const real = resolveTurn(s, ['jab', 'hustle']);
  ok('a preview is the real simulation', p !== null);
  eq('  ...landing on the same frame as the fight', p.contactAt, real.summary[0].contactAt);
  eq('  ...with the same outcome', p.outcome, real.summary[0].outcome);
  eq('  ...and the same damage', p.dmg, real.summary[0].dmgDealt);
  eq('  ...running exactly as long as the move', p.total, moveDuration(moveOf('duelist', 'jab')));

  const far = previewTurn(at(600), 0, 'jab');
  eq('a preview whiffs when the move cannot reach', far.outcome, 'whiff');
  eq('  ...and connects when it can', previewTurn(at(90), 0, 'jab').outcome, 'hit');

  const before = JSON.stringify(s);
  previewTurn(s, 0, 'overhead');
  previewTurn(s, 1, 'grab');
  eq('previewing never touches the real state', JSON.stringify(s), before);

  // Every legal option must be previewable — the arena calls this on hover, and a null
  // there is a blank screen at the exact moment the player is deciding.
  const gaps = [80, 200, 400].map((d) => at(d));
  let previewable = 0, opts = 0;
  for (const g of gaps) {
    for (const m of availableMoves(g, 0)) {
      opts++;
      const pv = previewTurn(g, 0, m.id);
      if (pv && pv.total >= 1 && pv.timeline.length === pv.total + 1) previewable++;
    }
  }
  eq('every move previews cleanly at every range', previewable, opts);

  const dash = previewTurn(at(400), 0, 'closeIn');
  ok('a movement preview actually moves',
    Math.abs(dash.timeline[dash.total].x[0] - dash.timeline[0].x[0]) > 50);
  eq('  ...while the stand-in stays put',
    dash.timeline[dash.total].x[1], dash.timeline[0].x[1]);
}

/* ------------------------------------------------------------ full match */

{
  const rand = rng(99);
  let s = newMatch();
  let turns = 0;
  while (s.over === null && turns < 500) {
    const mine = availableMoves(s, 0);
    const pick = mine[Math.floor(rand() * mine.length)].id;
    const ai = chooseAiMove(s, 1, 'fighter', [], rand);
    s = resolveTurn(s, [pick, ai]).state;
    if (s.roundOver && !s.over) s = nextRound(s);
    turns++;
  }
  ok('a random match reaches a conclusion', s.over !== null, `${turns} turns`);
  ok('  ...in a sane number of turns', turns < 300, `${turns}`);
  ok('  ...with a legitimate score line', s.wins[0] === 2 || s.wins[1] === 2, s.wins.join('-'));
}
{
  const rand = rng(4242);
  let wins = 0;
  for (let m = 0; m < 5; m++) {
    let s = newMatch();
    let turns = 0;
    while (s.over === null && turns < 400) {
      const mine = availableMoves(s, 0);
      const spam = mine.find((x) => x.id === 'jab') || mine[0];
      s = resolveTurn(s, [spam.id, chooseAiMove(s, 1, 'oracle', ['jab'], rand)]).state;
      if (s.roundOver && !s.over) s = nextRound(s);
      turns++;
    }
    if (s.over?.winner === 1) wins++;
  }
  ok('the Oracle AI punishes a one-button player', wins >= 4, `${wins}/5 AI wins`);
}

console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
