/*
 * Squad-mode self-tests. Run: node games/hustle-lite/tests/squad.test.mjs
 *
 * Squad mode adds three things the solo game does not have: a second attacker on your side
 * inside the same turn, a point fighter you can swap, and three lives instead of rounds.
 * These lock down the parts that make a team combo actually work — and the counterplay
 * that stops it being free.
 */
import {
  CHARS, RULES, newSquadMatch, resolveSquadTurn, optionsFor, pointOf, benchOf, teamAlive,
  isSquad, encodeChoice, decodeChoice, threatBoard, yomiChain, postMortem, chooseAiMove,
  riskProfile, choiceLabel, rng, moveOf, resolve, newMatch, previewTurn,
} from '../src/engine.js';

let pass = 0, fail = 0;
const results = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; results.push(`  ok   ${name}`); }
  else { fail++; results.push(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};
const eq = (name, a, b) => ok(name, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const TEAM_A = [
  { char: 'duelist', assist: 'sweep' },
  { char: 'blade', assist: 'flick' },
  { char: 'bruiser', assist: 'hammer' },
];
// Team B leads with the Duelist so both sides share move names in these tests; the
// bench still mixes characters, which is what exercises the per-fighter move tables.
const TEAM_B = [
  { char: 'duelist', assist: 'jab' },
  { char: 'bruiser', assist: 'shin' },
  { char: 'blade', assist: 'crescent' },
];

/** A squad match with the point fighters exactly `d` apart. */
function sq(d = 90, patch = {}) {
  const s = newSquadMatch(patch.a || TEAM_A, patch.b || TEAM_B);
  const mid = (RULES.ARENA_MIN + RULES.ARENA_MAX) / 2;
  s.teams[0][s.point[0]].x = mid - d / 2;
  s.teams[1][s.point[1]].x = mid + d / 2;
  Object.assign(pointOf(s, 0), patch.p0 || {});
  Object.assign(pointOf(s, 1), patch.p1 || {});
  return s;
}
const go = (s, a, b) => resolveSquadTurn(s, [a, b]);

/* ------------------------------------------------------------ shape */

{
  const s = sq();
  ok('a squad state is recognised as one', isSquad(s));
  ok('a solo state is not', !isSquad(newMatch()));
  eq('three fighters a side', s.teams[0].length, 3);
  eq('slot 0 starts on point', s.point[0], 0);
  eq('two teammates on the bench', benchOf(s, 0).length, 2);
  eq('everyone starts alive', teamAlive(s, 0), 3);
  eq('each fighter carries their own health pool',
    pointOf(s, 0).maxHp, Math.round(CHARS.duelist.hp * RULES.SQUAD_HP_SCALE));
  ok('  ...smaller than a solo pool, because there are three of them',
    pointOf(s, 0).maxHp < CHARS.duelist.hp);
  ok('bench fighters keep their own characters',
    s.teams[0].map((f) => f.char).join(',') === 'duelist,blade,bruiser');
}

/* ---------------------------------------------------------- choices */

{
  const s = sq();
  const opts = optionsFor(s, 0);
  const solo = opts.filter((o) => o.assist === null);
  const withAssist = opts.filter((o) => o.assist !== null);
  ok('every point move is offered on its own', solo.length >= 13, `${solo.length}`);
  ok('...and paired with each callable teammate', withAssist.length > 0, `${withAssist.length}`);
  ok('tag options appear from neutral', solo.some((o) => o.move.cat === 'tag'));
  ok('tagging cannot be combined with an assist call',
    !withAssist.some((o) => o.move.cat === 'tag'));
  eq('choice ids round-trip', decodeChoice(encodeChoice('jab', 2)).assist, 2);
  eq('  ...and plain ids decode cleanly', decodeChoice('jab').assist, null);
  ok('labels name the teammate being called',
    choiceLabel(s, 0, encodeChoice('jab', 1)).includes('Blade'), choiceLabel(s, 0, encodeChoice('jab', 1)));
}

/* ------------------------------------------------------- the assist */

{
  const r = go(sq(90), encodeChoice('jab', 1), 'hustle');
  eq('the point fighter connects', r.summary[0].outcome, 'hit');
  eq('  ...and so does the called assist', r.summary[0].assist?.atk, 'hit');
  ok('the assist deals damage of its own', r.summary[0].assist?.dmgDealt > 0,
    String(r.summary[0].assist?.dmgDealt));
  ok('total damage counts both attackers',
    r.summary[0].dmgDealt > r.summary[0].assist.dmgDealt, `${r.summary[0].dmgDealt}`);
  ok('the assist shows up in the playback timeline', r.timeline.some((t) => t.extras.length));
  ok('the assist arrives in front of the point fighter', (() => {
    const frame = r.timeline.find((t) => t.extras.length);
    return Math.abs(frame.extras[0].x - frame.x[1]) < Math.abs(frame.x[0] - frame.x[1]);
  })());
}
{
  // The point of the whole mode: a second attacker landing inside the stun the first caused.
  const r = go(sq(90), encodeChoice('jab', 1), 'hustle');
  ok('a team combo counts as one combo, not two',
    pointOf(r.state, 0).combo >= 2, `combo ${pointOf(r.state, 0).combo}`);
  const solo = go(sq(90), 'jab', 'hustle');
  ok('  ...so the pair out-damages the point fighter alone',
    r.summary[0].dmgDealt > solo.summary[0].dmgDealt,
    `${r.summary[0].dmgDealt} vs ${solo.summary[0].dmgDealt}`);
  ok('  ...and proration still applies across the pair',
    r.summary[0].dmgDealt < solo.summary[0].dmgDealt * 3);
}
{
  const r = go(sq(90), encodeChoice('hustle', 1), 'hustle');
  eq('calling a teammate puts them on cooldown', r.state.cooldown[0][1], RULES.ASSIST_COOLDOWN);
  ok('a teammate on cooldown cannot be called again',
    !optionsFor(r.state, 0).some((o) => o.assist === 1));
  ok('the other teammate is still callable',
    optionsFor(r.state, 0).some((o) => o.assist === 2));
}
{
  let s = sq(90);
  s = go(s, encodeChoice('hustle', 1), 'hustle').state;
  const before = s.cooldown[0][1];
  s = go(s, 'hustle', 'hustle').state;
  eq('cooldowns tick down each turn', s.cooldown[0][1], before - 1);
}

/* ------------------------------------------------ assist counterplay */

{
  // Called into a fast poke, the teammate is the one standing closest and eats it.
  const r = go(sq(90), encodeChoice('hustle', 1), 'jab');
  ok('an assist called into a poke gets hit', r.summary[0].assist?.def === 'cut',
    String(r.summary[0].assist?.def));
  ok('  ...and the teammate takes the damage, not the point fighter',
    r.state.teams[0][1].hp < r.state.teams[0][1].maxHp);
  eq('  ...leaving them on a longer cooldown', r.state.cooldown[0][1], RULES.ASSIST_PUNISHED);
  ok('  ...and exposed assists take extra damage',
    r.summary[1].dmgDealt > moveOf('duelist', 'jab').dmg, `${r.summary[1].dmgDealt}`);
}
{
  const r = go(sq(90), encodeChoice('hustle', 1), 'jab');
  ok('the point fighter is untouched when the assist eats it',
    pointOf(r.state, 0).hp === pointOf(r.state, 0).maxHp);
  eq('  ...so they are not put in hitstun either', pointOf(r.state, 0).state, 'neutral');
}
{
  const r = go(sq(90), encodeChoice('jab', 1), 'jab');
  ok('a point-vs-point trade still resolves normally',
    r.summary[0].outcome === 'hit' && r.summary[1].outcome === 'hit');
}

/* --------------------------------------------------------- tagging */

{
  const r = go(sq(300), 'tag1', 'hustle');
  eq('tag swaps the point fighter', r.state.point[0], 1);
  eq('  ...to the right teammate', pointOf(r.state, 0).char, 'blade');
  ok('  ...inheriting the position', Math.abs(pointOf(r.state, 0).x - pointOf(sq(300), 0).x) < 1);
  eq('  ...and arriving in neutral', pointOf(r.state, 0).state, 'neutral');
  eq('tag2 reaches the third fighter', go(sq(300), 'tag2', 'hustle').state.point[0], 2);
}
{
  const r = go(sq(90), 'tag1', 'jab');
  ok('tagging is naked — a poke punishes it', r.summary[1].dmgDealt > 0);
}
{
  const s = sq(90, { p0: { state: 'stunned' } });
  ok('you cannot tag out of hitstun', !optionsFor(s, 0).some((o) => o.move.cat === 'tag'));
}
{
  let s = sq(300);
  s = go(s, 'tag1', 'hustle').state;
  const benched = s.teams[0][0];
  benched.hp = 20;
  const after = go(s, 'hustle', 'hustle').state;
  eq('benched fighters recover slowly', after.teams[0][0].hp, 20 + RULES.BENCH_HEAL);
  ok('  ...but only back up to half, never to full', (() => {
    let t = sq(300);
    t = go(t, 'tag1', 'hustle').state;
    const cap = t.teams[0][0].maxHp * RULES.BENCH_HEAL_CAP;
    t.teams[0][0].hp = cap - 0.5;
    const one = go(t, 'hustle', 'hustle').state.teams[0][0].hp;
    const two = go(go(t, 'hustle', 'hustle').state, 'hustle', 'hustle').state.teams[0][0].hp;
    return Math.abs(one - cap) < 0.001 && Math.abs(two - cap) < 0.001;
  })());
  ok('  ...and a fighter already above half does not heal', (() => {
    let t = sq(300);
    t = go(t, 'tag1', 'hustle').state;
    const hp = t.teams[0][0].hp;
    return go(t, 'hustle', 'hustle').state.teams[0][0].hp === hp;
  })());
}

/* ------------------------------------------------------- lives & KO */

{
  const r = go(sq(90, { p1: { hp: 4 } }), 'overhead', 'hustle');
  eq('a downed point fighter is replaced automatically', r.state.point[1], 1);
  eq('  ...and the team is down to two', teamAlive(r.state, 1), 2);
  ok('  ...but the match is not over', r.state.over === null);
}
{
  const s = sq(90, { p1: { hp: 4 } });
  s.teams[1][1].hp = 0;
  s.teams[1][2].hp = 0;
  const r = go(s, 'overhead', 'hustle');
  eq('losing all three loses the match', r.state.over?.winner, 0);
  eq('  ...by knockout', r.state.over?.by, 'ko');
}
{
  const s = sq(300);
  s.turn = RULES.SQUAD_TURN_LIMIT;
  s.teams[1][0].hp = 5;
  const r = go(s, 'hustle', 'hustle');
  eq('time over goes to the healthier team', r.state.over?.winner, 0);
  eq('  ...flagged as a time decision', r.state.over?.by, 'time');
}
{
  const s = sq(90, { p0: { hp: 0 } });
  const opts = optionsFor(s, 0);
  ok('a dead point fighter can only tag out', opts.every((o) => o.move.cat === 'tag'), `${opts.length} options`);
}

/* ------------------------------------------- oracle features in squad */

{
  const s = sq(90);
  const b = threatBoard(s, 0, encodeChoice('jab', 1));
  eq('the threat board covers every squad reply', b.rows.length, optionsFor(s, 1).length);
  ok('rows are ranked best-answer-first', b.rows.every((r, i) => i === 0 || b.rows[i - 1].score >= r.score));
  ok('rows carry a readable label', b.rows.every((r) => r.label));
  ok('the board names a best answer', !!b.best.label, b.best.label);
  const replay = resolve(s, [encodeChoice('jab', 1), b.best.option.id]);
  eq('  ...and it is a real simulation', replay.summary[0].dmgTaken, b.best.dmgTaken);
  eq('  ...including frame advantage', replay.summary[0].adv, b.best.adv);
}
{
  const chain = yomiChain(sq(90), 0, encodeChoice('jab', 1));
  ok('the yomi chain works in squad mode', chain.length >= 2, `${chain.length}`);
  ok('layers alternate sides', chain.every((l, i) => i === 0 || l.side !== chain[i - 1].side));
  ok('every layer has a name', chain.every((l) => l.name));
}
{
  const s = sq(90);
  const pm = postMortem(s, 0, 'hustle', 'jab');
  ok('the post-mortem ranks squad choices', pm.total === optionsFor(s, 0).length, `${pm.total}`);
  ok('  ...and names a better one than hustling into a jab', pm.best.id !== 'hustle', pm.best.label);
  ok('  ...with a label', !!pm.best.label);
}
{
  const profile = riskProfile(sq(90), 0);
  eq('every squad option gets a risk rating', Object.keys(profile).length, optionsFor(sq(90), 0).length);
  ok('risk ratings are fractions', Object.values(profile).every((p) => p.risk >= 0 && p.risk <= 1));
}

/* -------------------------------------------------------------- AI */

{
  const rand = rng(17);
  for (const diff of ['rookie', 'fighter', 'yomi', 'oracle']) {
    const s = sq(90);
    const id = chooseAiMove(s, 1, diff, [], rand);
    ok(`${diff} AI picks a legal squad choice`, optionsFor(s, 1).some((o) => o.id === id), String(id));
  }
}
{
  const rand = rng(29);
  const picks = new Set();
  for (let i = 0; i < 40; i++) picks.add(chooseAiMove(sq(90), 1, 'fighter', [], rand));
  ok('the AI mixes across squad choices', picks.size > 4, `${picks.size} distinct`);
  ok('  ...and does call assists', [...picks].some((p) => p.includes('|')), [...picks].slice(0, 5).join(' '));
}

/* ------------------------------------------------------- move preview */

/*
 * The planning arena has to rehearse a squad choice the same way it rehearses a solo one,
 * assist and all — otherwise the one mode where two bodies arrive at different times is
 * the one mode where you cannot see it coming before you commit.
 */
{
  const s = sq(90);
  const solo = previewTurn(s, 0, 'jab');
  const withMate = previewTurn(s, 0, encodeChoice('jab', 1));
  ok('a squad choice previews', withMate !== null);
  ok('  ...with the teammate on the field', (withMate.timeline.at(-1).extras ?? []).length
    + (withMate.timeline[RULES.ASSIST_DELAY].extras ?? []).length > 0);
  ok('  ...running at least as long as the assist needs',
    withMate.total >= RULES.ASSIST_DELAY, `${withMate.total}f`);
  ok('  ...and longer than the same move called alone', withMate.total > solo.total,
    `${withMate.total} vs ${solo.total}`);

  const before = JSON.stringify(s);
  previewTurn(s, 0, encodeChoice('sweep', 2));
  ok('previewing a squad choice never touches the real state', JSON.stringify(s) === before);

  let clean = 0;
  const opts = optionsFor(s, 0);
  for (const o of opts) {
    const pv = previewTurn(s, 0, o.id);
    if (pv && pv.timeline.length === pv.total + 1) clean++;
  }
  ok('every squad option previews cleanly', clean === opts.length, `${clean}/${opts.length}`);
}

/* -------------------------------------------------------- full match */

{
  const rand = rng(77);
  let s = sq(300);
  let turns = 0;
  while (s.over === null && turns < 400) {
    const mine = optionsFor(s, 0);
    const pick = mine[Math.floor(rand() * mine.length)].id;
    const ai = chooseAiMove(s, 1, 'fighter', [], rand);
    s = resolveSquadTurn(s, [pick, ai]).state;
    turns++;
  }
  ok('a squad match reaches a conclusion', s.over !== null, `${turns} turns`);
  ok('  ...in a sane number of turns', turns < 300, `${turns}`);
  ok('  ...with one team wiped out or ahead on health',
    teamAlive(s, 0) === 0 || teamAlive(s, 1) === 0 || s.over.by === 'time');
}
{
  const s = sq(90);
  const a = resolveSquadTurn(s, [encodeChoice('jab', 1), 'highGuard']);
  const b = resolveSquadTurn(s, [encodeChoice('jab', 1), 'highGuard']);
  ok('squad resolution is deterministic', JSON.stringify(a.summary) === JSON.stringify(b.summary));
  ok('  ...and does not mutate the input state',
    s.teams[0][1].hp === s.teams[0][1].maxHp && s.cooldown[0][1] === 0 && s.turn === 1);
}

console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
