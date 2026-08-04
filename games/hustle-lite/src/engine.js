/*
 * HUSTLE LITE — engine
 *
 * A trimmed-down take on the simultaneous-turn fighting game "Your Only Move Is HUSTLE".
 * Both fighters commit one move per turn, the turn is simulated frame by frame, and the
 * result decides who acts first next turn.
 *
 * Everything in this file is pure: no DOM, no canvas, no timers. `resolveTurn` is the
 * single source of truth — the renderer replays its timeline, the threat board scores its
 * outcomes, the yomi chain walks it, and the AI searches over it. Nothing is modelled
 * twice, so the numbers on screen are always the numbers that were actually simulated.
 */

export const RULES = {
  MAX_METER: 5,
  BURST_FULL: 100,
  ARENA_MIN: 60,
  ARENA_MAX: 940,
  START_GAP: 300,
  MIN_SEPARATION: 55,
  CHIP_RATIO: 0.11,
  COMBO_DECAY: 0.13,
  COMBO_FLOOR: 0.35,
  GUTS_THRESHOLD: 0.4,
  GUTS_SCALE: 0.75,
  SUPER_COST: 2,
  METER_PER_LEVEL: 25,
  STALL_GRACE: 8,        // turns of refusing to engage before the ring starts biting
  TURN_LIMIT: 70,        // per round; whoever leads on health takes it at time over
  PARRY_STUN: 24,
  COUNTER_SCALE: 1.28,    // damage bonus for interrupting an opponent's wind-up
  COUNTER_STUN: 6,       // extra hitstun on a counter-hit
  ARMOUR_TAX: 0.72,      // damage you keep after powering through a hit on armour
  ROUNDS_TO_WIN: 2,      // best of three
  BENCH_HEAL: 1,         // health a benched teammate recovers per turn
  BENCH_HEAL_CAP: 0.5,   // ...but only back up to half. Tagging out is a plan, not a reset
  SQUAD_HP_SCALE: 0.78,  // three lives a side would otherwise never run out inside the clock
  ASSIST_DELAY: 6,       // frames before a called teammate arrives
  ASSIST_LEAD: 44,       // how far in front of you they arrive — which is why they are hittable
  ASSIST_VULN: 1.5,      // damage an exposed assist takes
  ASSIST_COOLDOWN: 5,    // turns before that teammate can be called again
  ASSIST_PUNISHED: 9,    // ...or after they got hit on the way in
  SQUAD_TURN_LIMIT: 110, // squad matches run long; three lives a side
};

/* ------------------------------------------------------------------ moves */

/*
 * Frame anatomy of a strike: [0, startup) wind-up, [startup, startup+active) the hitbox
 * is live, then recovery. `range` is measured centre-to-centre, so a move only connects
 * if the gap has closed enough by the frame the hitbox is live — which is why `dash`
 * moves reach further than their raw range suggests. They carry you in.
 */
const M = (def) => ({
  startup: 0, active: 0, recovery: 0, range: 0, level: 'mid', dmg: 0,
  hitstun: 0, blockstun: 0, pushHit: 0, pushBlock: 0, dash: null,
  invuln: null, armour: null, guards: null, parry: null, cost: 0, gain: 0,
  knockdown: false, unblockable: false, parryable: true, tag: '', ...def,
});

/* Shared by every fighter. Characters may tweak the numbers but never the roles. */
const UNIVERSAL = {
  highGuard: M({
    id: 'highGuard', name: 'High Guard', cat: 'guard', key: 'q',
    recovery: 18, guards: ['high', 'mid'], gain: 5,
    blurb: 'Stops highs and mids. Lows go straight under it.',
    tag: 'blocks high/mid',
  }),
  lowGuard: M({
    id: 'lowGuard', name: 'Low Guard', cat: 'guard', key: 'w',
    recovery: 18, guards: ['low', 'mid'], gain: 5,
    blurb: 'Stops lows and mids. Highs come right over the top.',
    tag: 'blocks low/mid',
  }),
  parry: M({
    id: 'parry', name: 'Parry', cat: 'parry', key: 'e',
    recovery: 25, parry: { from: 2, to: 10 }, gain: 30,
    blurb: 'Live on frames 2-9. Eats fast moves whole; slow ones stroll past it.',
    tag: 'frames 2-9',
  }),
  dodge: M({
    id: 'dodge', name: 'Dodge Roll', cat: 'dodge', key: 'r',
    recovery: 19, invuln: [3, 12],
    dash: { from: 0, to: 16, dist: 70, toward: false }, gain: 3,
    blurb: 'Invulnerable frames 3-11 and it retreats. Chasing moves still catch it.',
    tag: 'i-frames 3-11',
  }),
  closeIn: M({
    id: 'closeIn', name: 'Close In', cat: 'move', key: 'a',
    recovery: 14, dash: { from: 0, to: 12, dist: 135, toward: true }, gain: 4,
    blurb: 'Walk into your own range. Whoever owns the gap owns the round.',
    tag: 'advance',
  }),
  backOff: M({
    id: 'backOff', name: 'Back Off', cat: 'move', key: 's',
    recovery: 14, dash: { from: 0, to: 12, dist: 135, toward: false }, gain: 2,
    blurb: 'Make their whole moveset whiff. Costs you the corner eventually.',
    tag: 'retreat',
  }),
  hustle: M({
    id: 'hustle', name: 'Hustle', cat: 'hustle', key: 'd',
    recovery: 30, gain: 0,
    blurb: 'Pure greed: +2 meter and thirty frames of standing perfectly still.',
    tag: '+2 meter',
  }),
  burst: M({
    id: 'burst', name: 'Burst', cat: 'burst', key: '1',
    startup: 8, active: 3, recovery: 19, range: 110, level: 'mid',
    dmg: 3, hitstun: 16, blockstun: 10, pushHit: 260, pushBlock: 60,
    invuln: [0, 15],
    blurb: 'Blows the combo apart. They can bait it by guarding — then it is gone.',
    tag: 'escape',
  }),
  diIn: M({
    id: 'diIn', name: 'DI Inward', cat: 'di', key: '2',
    recovery: 1, dash: { from: 0, to: 1, dist: 55, toward: true },
    blurb: 'Drift toward them while stunned, so you stay in their face.',
    tag: 'drift',
  }),
  diOut: M({
    id: 'diOut', name: 'DI Outward', cat: 'di', key: '3',
    recovery: 1, dash: { from: 0, to: 1, dist: 55, toward: false },
    blurb: 'Drift away while stunned. Their next move may not reach.',
    tag: 'drift',
  }),
  tag1: M({
    id: 'tag1', name: 'Tag →', cat: 'tag', key: 'z',
    recovery: 24,
    blurb: 'Swap your point fighter. Twenty-four naked frames — do it after a knockdown.',
    tag: 'swap point',
  }),
  tag2: M({
    id: 'tag2', name: 'Tag ⇒', cat: 'tag', key: 'x',
    recovery: 24,
    blurb: 'Swap to your third. Same cost, different body.',
    tag: 'swap point',
  }),
  quickRise: M({
    id: 'quickRise', name: 'Quick Rise', cat: 'wake', key: '1',
    recovery: 10,
    blurb: 'Up fast, no protection. Fine if they guessed wrong.',
    tag: 'fast wake',
  }),
  rollAway: M({
    id: 'rollAway', name: 'Roll Away', cat: 'wake', key: '2',
    recovery: 22, invuln: [3, 16],
    dash: { from: 2, to: 18, dist: 150, toward: false },
    blurb: 'Invulnerable retreat off the floor. Slow to recover.',
    tag: 'i-frames 3-15',
  }),
};

/* ------------------------------------------------------------- characters */

/*
 * Three archetypes sharing one defensive skeleton. Each brings five strikes and a super;
 * guards, Parry, Dodge, movement, Hustle, Burst and wake-ups stay universal so the
 * rock-paper-scissors web is the same game whoever you pick. Identity comes from where
 * each fighter sits on the speed / reach / damage triangle, not from extra rules.
 */
export const CHARS = {
  duelist: {
    id: 'duelist', name: 'Duelist', accent: '#3fe0cf', hp: 144,
    tagline: 'Balanced. Every tool is adequate and none of them is an excuse.',
    strikes: {
      jab: M({
        id: 'jab', name: 'Jab', cat: 'strike', key: '1',
        startup: 4, active: 2, recovery: 6, range: 105, level: 'mid',
        dmg: 7, hitstun: 12, blockstun: 8, pushHit: 30, pushBlock: 22, gain: 6,
        blurb: 'Fastest thing you own. Beats anything slower to the punch.', tag: 'fast',
      }),
      sweep: M({
        id: 'sweep', name: 'Sweep', cat: 'strike', key: '2',
        startup: 7, active: 3, recovery: 12, range: 120, level: 'low',
        dmg: 12, hitstun: 24, blockstun: 10, pushHit: 40, pushBlock: 30, gain: 8,
        knockdown: true,
        blurb: 'Low and quick. Goes under High Guard and puts them on the floor.', tag: 'low',
      }),
      overhead: M({
        id: 'overhead', name: 'Overhead', cat: 'strike', key: '3',
        startup: 13, active: 3, recovery: 16, range: 125, level: 'high',
        dmg: 17, hitstun: 26, blockstun: 14, pushHit: 45, pushBlock: 28, gain: 10,
        blurb: 'High. Crushes Low Guard, and slow enough to walk past a Parry.', tag: 'high',
      }),
      lunge: M({
        id: 'lunge', name: 'Lunge', cat: 'strike', key: '4',
        startup: 10, active: 4, recovery: 18, range: 120, level: 'mid',
        dmg: 12, hitstun: 24, blockstun: 12, pushHit: 20, pushBlock: 55, gain: 9,
        dash: { from: 2, to: 12, dist: 144, toward: true }, armour: [2, 8],
        blurb: 'Armoured approach: eats one strike on the way in. Guards and Grabs stop it.',
        tag: 'armour 2-7',
      }),
      grab: M({
        id: 'grab', name: 'Grab', cat: 'grab', key: '5',
        startup: 6, active: 2, recovery: 19, range: 72, level: 'grab',
        dmg: 8, hitstun: 30, pushHit: 150, gain: 12,
        knockdown: true, unblockable: true, parryable: false,
        blurb: 'Ignores both guards and the Parry. Loses to anything faster than 6f.',
        tag: 'unblockable',
      }),
    },
    superMove: M({
      id: 'risingFang', name: 'Rising Fang', cat: 'super', key: 'f',
      startup: 5, active: 4, recovery: 30, range: 120, level: 'mid',
      dmg: 29, hitstun: 34, blockstun: 12, pushHit: 70, pushBlock: 40,
      cost: RULES.SUPER_COST, invuln: [0, 9], knockdown: true,
      blurb: 'Invulnerable reversal. Guarded, it is a free round for them.',
      tag: 'i-frames 0-8',
    }),
  },

  bruiser: {
    id: 'bruiser', name: 'Bruiser', accent: '#ff9f43', hp: 172,
    tagline: 'Slow, armoured, enormous. Nothing you own is fast, so stop trying to be.',
    tweaks: {
      closeIn: { dash: { from: 0, to: 12, dist: 118, toward: true } },
      backOff: { dash: { from: 0, to: 12, dist: 112, toward: false } },
      dodge: { recovery: 22, dash: { from: 0, to: 16, dist: 58, toward: false } },
    },
    strikes: {
      hook: M({
        id: 'hook', name: 'Hook', cat: 'strike', key: '1',
        startup: 5, active: 2, recovery: 8, range: 88, level: 'mid',
        dmg: 9, hitstun: 14, blockstun: 8, pushHit: 34, pushBlock: 24, gain: 6,
        blurb: 'Your "fast" button, and it still loses the speed war. It hits like a truck.',
        tag: 'heavy poke',
      }),
      shin: M({
        id: 'shin', name: 'Shin Kick', cat: 'strike', key: '2',
        startup: 9, active: 3, recovery: 13, range: 108, level: 'low',
        dmg: 13, hitstun: 24, blockstun: 10, pushHit: 42, pushBlock: 30, gain: 8,
        knockdown: true,
        blurb: 'Low. Slower than most sweeps and it hurts a great deal more.', tag: 'low',
      }),
      hammer: M({
        id: 'hammer', name: 'Hammer', cat: 'strike', key: '3',
        startup: 15, active: 3, recovery: 17, range: 122, level: 'high',
        dmg: 20, hitstun: 28, blockstun: 15, pushHit: 55, pushBlock: 30, gain: 12,
        blurb: 'High, and glacial. If it lands you were not the one guessing.', tag: 'high',
      }),
      charge: M({
        id: 'charge', name: 'Charge', cat: 'strike', key: '4',
        startup: 11, active: 4, recovery: 19, range: 118, level: 'mid',
        dmg: 14, hitstun: 24, blockstun: 12, pushHit: 24, pushBlock: 58, gain: 9,
        dash: { from: 2, to: 13, dist: 155, toward: true }, armour: [2, 10],
        blurb: 'The best armour in the game and the whole reason you get to play offence.',
        tag: 'armour 2-9',
      }),
      clinch: M({
        id: 'clinch', name: 'Clinch', cat: 'grab', key: '5',
        startup: 7, active: 2, recovery: 20, range: 76, level: 'grab',
        dmg: 10, hitstun: 32, pushHit: 150, gain: 12,
        knockdown: true, unblockable: true, parryable: false,
        blurb: 'Longer and meaner than most grabs. One frame slower to start.',
        tag: 'unblockable',
      }),
    },
    superMove: M({
      id: 'quake', name: 'Quake', cat: 'super', key: 'f',
      startup: 8, active: 5, recovery: 30, range: 150, level: 'low',
      dmg: 30, hitstun: 34, blockstun: 14, pushHit: 80, pushBlock: 44,
      cost: RULES.SUPER_COST, invuln: [0, 10], knockdown: true,
      blurb: 'A low, invulnerable reversal with huge reach. High Guard does not save them.',
      tag: 'low · i-frames 0-9',
    }),
  },

  blade: {
    id: 'blade', name: 'Blade', accent: '#a78bfa', hp: 124,
    tagline: 'Fastest and longest, made of glass. You win the exchange or you lose the round.',
    tweaks: {
      closeIn: { dash: { from: 0, to: 11, dist: 150, toward: true } },
      backOff: { dash: { from: 0, to: 11, dist: 152, toward: false } },
      dodge: { recovery: 17, dash: { from: 0, to: 15, dist: 82, toward: false } },
    },
    strikes: {
      flick: M({
        id: 'flick', name: 'Flick', cat: 'strike', key: '1',
        startup: 3, active: 2, recovery: 7, range: 108, level: 'mid',
        dmg: 7, hitstun: 11, blockstun: 7, pushHit: 26, pushBlock: 20, gain: 6,
        blurb: 'Three frames. Nothing in the game beats it to the punch — it just barely hurts.',
        tag: 'fastest',
      }),
      slice: M({
        id: 'slice', name: 'Slice', cat: 'strike', key: '2',
        startup: 7, active: 3, recovery: 12, range: 128, level: 'low',
        dmg: 13, hitstun: 22, blockstun: 9, pushHit: 36, pushBlock: 28, gain: 8,
        knockdown: true,
        blurb: 'Low, long, and quick. Your main way to make High Guard a mistake.', tag: 'low',
      }),
      crescent: M({
        id: 'crescent', name: 'Crescent', cat: 'strike', key: '3',
        startup: 11, active: 3, recovery: 15, range: 138, level: 'high',
        dmg: 16, hitstun: 25, blockstun: 13, pushHit: 42, pushBlock: 30, gain: 10,
        blurb: 'High, and faster than most overheads. Still too slow for a Parry to catch.',
        tag: 'high',
      }),
      thrust: M({
        id: 'thrust', name: 'Step Thrust', cat: 'strike', key: '4',
        startup: 9, active: 3, recovery: 18, range: 148, level: 'mid',
        dmg: 16, hitstun: 22, blockstun: 12, pushHit: 30, pushBlock: 52, gain: 9,
        dash: { from: 2, to: 11, dist: 96, toward: true }, invuln: [2, 7],
        blurb: 'Steps through fast pokes on the way in, at absurd reach. Guards and Grabs stop it.',
        tag: 'i-frames 2-6 · longest reach',
      }),
      snare: M({
        id: 'snare', name: 'Snare', cat: 'grab', key: '5',
        startup: 5, active: 2, recovery: 19, range: 66, level: 'grab',
        dmg: 8, hitstun: 28, pushHit: 150, gain: 12,
        knockdown: true, unblockable: true, parryable: false,
        blurb: 'The fastest grab there is, and the weakest. You want the knockdown, not the damage.',
        tag: 'unblockable',
      }),
    },
    superMove: M({
      id: 'zeroStance', name: 'Zero Stance', cat: 'super', key: 'f',
      startup: 4, active: 4, recovery: 31, range: 150, level: 'mid',
      dmg: 29, hitstun: 34, blockstun: 12, pushHit: 70, pushBlock: 40,
      cost: RULES.SUPER_COST, invuln: [0, 8], knockdown: true,
      blurb: 'Four frames of invulnerable reversal with absurd reach. Parry still eats it.',
      tag: 'i-frames 0-7',
    }),
  },
};

export const CHAR_IDS = Object.keys(CHARS);

/* Move tables are built once per character and never mutated. */
const TABLES = {};
function buildTable(charId) {
  const c = CHARS[charId];
  const t = {};
  for (const [id, m] of Object.entries(UNIVERSAL)) t[id] = c.tweaks?.[id] ? M({ ...m, ...c.tweaks[id] }) : m;
  for (const m of Object.values(c.strikes)) t[m.id] = m;
  t[c.superMove.id] = c.superMove;
  // The wake-up super is the same move, restricted to the floor and keyed differently.
  t.wakeSuper = M({ ...c.superMove, id: 'wakeSuper', name: `Wakeup ${c.superMove.name}`, cat: 'super', key: '3' });
  return t;
}
export function moveTable(charId) {
  return (TABLES[charId] ||= buildTable(charId));
}
export const moveOf = (charId, id) => moveTable(charId)[id];

export const neutralSet = (charId) => [
  ...Object.values(CHARS[charId].strikes).map((m) => m.id),
  'highGuard', 'lowGuard', 'parry', 'dodge', 'closeIn', 'backOff', 'hustle',
  CHARS[charId].superMove.id,
];
const STUN_SET = ['burst', 'diIn', 'diOut'];
const WAKE_SET = ['quickRise', 'rollAway', 'wakeSuper'];

/* ------------------------------------------------------------------ state */

export function newFighter(x, name, charId) {
  const hp = CHARS[charId].hp;
  return {
    name, x, char: charId,
    hp, maxHp: hp,
    meter: 0, meterPts: 0,
    burst: RULES.BURST_FULL,
    state: 'neutral',      // 'neutral' | 'stunned' | 'down'
    combo: 0,
    sad: 0,                // "sadness": turns spent refusing to engage
  };
}

export function newMatch(charA = 'duelist', charB = 'duelist') {
  const mid = (RULES.ARENA_MIN + RULES.ARENA_MAX) / 2;
  return {
    turn: 1,
    round: 1,
    wins: [0, 0],
    over: null,            // match result, once someone takes ROUNDS_TO_WIN rounds
    roundOver: null,       // this round's result, cleared by nextRound()
    stall: 0,
    fighters: [
      newFighter(mid - RULES.START_GAP / 2, 'YOU', charA),
      newFighter(mid + RULES.START_GAP / 2, 'RIVAL', charB),
    ],
  };
}

/** Reset the arena for the next round, carrying the round tally forward. */
export function nextRound(state) {
  const s = newMatch(state.fighters[0].char, state.fighters[1].char);
  s.round = state.round + 1;
  s.wins = [...state.wins];
  return s;
}

export const gap = (s) => Math.abs(s.fighters[0].x - s.fighters[1].x);

/** Which moves fighter `i` may legally pick right now. */
export function availableMoves(state, i) {
  const f = state.fighters[i];
  const ids = f.state === 'down' ? WAKE_SET : f.state === 'stunned' ? STUN_SET : neutralSet(f.char);
  const table = moveTable(f.char);
  return ids.map((id) => table[id]).filter((m) => {
    if (m.cost > f.meter) return false;
    if (m.cat === 'burst' && f.burst < RULES.BURST_FULL) return false;
    return true;
  });
}

export const cloneState = (s) => (Array.isArray(s.teams)
  ? {
    turn: s.turn, round: s.round, wins: [...s.wins],
    over: s.over, roundOver: s.roundOver, stall: s.stall,
    teams: s.teams.map((t) => t.map((f) => ({ ...f }))),
    point: [...s.point],
    cooldown: s.cooldown.map((c) => [...c]),
  }
  : {
    turn: s.turn, round: s.round, wins: [...s.wins],
    over: s.over, roundOver: s.roundOver, stall: s.stall,
    fighters: s.fighters.map((f) => ({ ...f })),
  });

/* -------------------------------------------------------------- simulation */

const within = (f, win) => !!win && f >= win[0] && f < win[1];
export const moveDuration = (m) => m.startup + m.active + m.recovery;
const clampX = (x) => Math.max(RULES.ARENA_MIN, Math.min(RULES.ARENA_MAX, x));

function dashOffset(m, f) {
  if (!m.dash) return 0;
  const { from, to, dist } = m.dash;
  if (f <= from) return 0;
  const t = Math.min(1, (f - from) / Math.max(1, to - from));
  return dist * (1 - Math.pow(1 - t, 2));
}

/**
 * Play one turn out, frame by frame.
 *
 * Two distinct results are tracked per fighter and they are not the same thing:
 *   `atk` — what my own move did   ('hit' | 'block' | 'armoured' | 'parried' | 'clash' | 'whiff')
 *   `def` — what happened to me    ('cut' | 'guarded' | 'parry' | 'armour' | 'clash')
 * Conflating them is what makes trades resolve wrong, so they stay separate all the way
 * out to the summary.
 */
/*
 * The frame loop is written against a flat list of *actors*, not two fighters. In a solo
 * duel that list is exactly the two point fighters and everything below reduces to the
 * original 1v1 rules. In squad mode it also carries called assists, which is what lets a
 * team combo exist at all: a second attacker landing inside the stun your first one caused.
 */
function makeActor(team, role, f, m, delay = 0, xOffset = 0) {
  return {
    team, role, f, m, delay,
    x0: f.x + xOffset, x: f.x + xOffset, push: 0, dir: 0,
    atk: null, def: null, armourUsed: false, counter: false,
    contactAt: null, cutAt: null,
    dmgDealt: 0, gainPts: 0, spent: m.cost,
  };
}

const isPoint = (a) => a.role === 'point';
/** Local frame for this actor — assists start their move a few frames late. */
const lf = (a, f) => f - a.delay;

/**
 * Play one turn out, frame by frame, over an arbitrary set of actors.
 *
 * Two distinct results are tracked per actor and they are not the same thing:
 *   `atk` — what my own move did   ('hit' | 'block' | 'armoured' | 'parried' | 'clash' | 'whiff')
 *   `def` — what happened to me    ('cut' | 'guarded' | 'parry' | 'armour' | 'clash')
 * Conflating them is what makes trades resolve wrong, so they stay separate throughout.
 */
function simulate(s, actors, startCombo) {
  const points = [actors.find((a) => a.team === 0 && isPoint(a)), actors.find((a) => a.team === 1 && isPoint(a))];
  points[0].dir = points[0].x0 <= points[1].x0 ? 1 : -1;
  points[1].dir = -points[0].dir;
  for (const a of actors) if (!isPoint(a)) a.dir = points[a.team].dir;

  const total = Math.max(...actors.map((a) => a.delay + moveDuration(a.m)), 1);
  const timeline = [];
  const events = [];

  const cutBefore = (a, f) => a.cutAt !== null && a.cutAt < f;
  const active = (a, f) => lf(a, f) >= 0 && lf(a, f) <= moveDuration(a.m) && !cutBefore(a, f);
  const iframed = (a, f) => !cutBefore(a, f) && within(lf(a, f), a.m.invuln);

  for (let f = 0; f <= total; f++) {
    // 1. movement. An actor interrupted at frame k freezes where they were at frame k.
    for (const a of actors) {
      const upto = a.cutAt === null ? lf(a, f) : lf(a, a.cutAt);
      const sign = a.m.dash && a.m.dash.toward === false ? -1 : 1;
      a.x = clampX(a.x0 + a.dir * sign * dashOffset(a.m, Math.max(0, upto)) + a.push);
    }
    separate(points);

    // 2. contact. Every live hitbox is tested against the same frame, so genuine trades
    //    happen rather than one side silently winning every tie.
    const pending = [];
    for (const atk of actors) {
      if (atk.atk || cutBefore(atk, f)) continue;
      const k = lf(atk, f);
      const m = atk.m;
      if (!m.dmg || k < m.startup || k >= m.startup + m.active) continue;
      if (!targetFor(actors, atk, f)) continue;
      pending.push(atk);
    }

    for (const atk of pending) {
      if (atk.atk) continue;                       // already settled by a clash this frame
      const def = targetFor(actors, atk, f);
      if (!def) continue;
      const m = atk.m;
      const dm = def.m;
      const defLive = !cutBefore(def, f) && active(def, f);
      const dk = lf(def, f);

      // grab vs grab — nobody wins, both bounce off
      if (m.cat === 'grab' && dm.cat === 'grab' && defLive && pending.includes(def)) {
        atk.atk = 'clash'; atk.def = 'clash'; atk.contactAt = f;
        def.atk = 'clash'; def.def = 'clash'; def.contactAt = f;
        atk.push += -atk.dir * 70; def.push += -def.dir * 70;
        events.push({ f, type: 'clash', by: atk.team });
        continue;
      }

      if (iframed(def, f)) { events.push({ f, type: 'iframe', by: atk.team, at: def.team }); continue; }

      // parry window. Grabs are unparryable, which keeps Parry an honest gamble.
      if (defLive && dm.parry && within(dk, [dm.parry.from, dm.parry.to]) && m.parryable) {
        atk.atk = 'parried'; atk.contactAt = f; atk.cutAt = f;
        def.def = 'parry'; def.contactAt = f; def.gainPts += dm.gain;
        events.push({ f, type: 'parry', by: def.team });
        continue;
      }

      // guard
      if (defLive && dm.guards && !m.unblockable && dm.guards.includes(m.level)) {
        const chip = Math.max(1, Math.round(m.dmg * RULES.CHIP_RATIO));
        def.f.hp = Math.max(0, def.f.hp - chip);
        atk.dmgDealt += chip;
        atk.atk = 'block'; atk.contactAt = f;
        def.def = 'guarded'; def.contactAt = f;
        def.gainPts += dm.gain + 6;
        atk.gainPts += Math.round(m.gain * 0.4);
        def.push += def.dir * -m.pushBlock * 0.55;
        events.push({ f, type: 'block', by: atk.team, dmg: chip });
        continue;
      }

      // Super-armour: absorbs one strike on the way in, at reduced damage and without
      // being interrupted. Grabs go straight through it, which keeps the approach game
      // honest — armour beats pokes, Grab beats armour, Dodge beats Grab.
      if (defLive && dm.armour && !def.armourUsed && within(dk, dm.armour) && m.cat !== 'grab') {
        const soak = Math.max(1, Math.round(scaleDamage(m.dmg, def.f, startCombo[atk.team]) * 0.5));
        def.f.hp = Math.max(0, def.f.hp - soak);
        def.f.burst = Math.min(RULES.BURST_FULL, def.f.burst + soak);
        def.armourUsed = true;
        def.def = 'armour';
        atk.dmgDealt += soak;
        atk.atk = 'armoured'; atk.contactAt = f;
        atk.gainPts += Math.round(m.gain * 0.5);
        events.push({ f, type: 'armour', by: def.team, dmg: soak });
        continue;
      }

      // Counter-hit: catching someone in the wind-up of their own attack pays extra. This
      // is what makes raw speed worth having — the fastest button in the game is only a
      // 3-frame poke until it starts interrupting people, and then it is a threat.
      const counter = dm.dmg > 0 && active(def, f) && dk < dm.startup;
      // Powering through a hit on armour costs you some of your own follow-through.
      const armourTax = atk.armourUsed ? RULES.ARMOUR_TAX : 1;
      // An assist caught in the open is exposed — that is the price of calling one early.
      const exposed = isPoint(def) ? 1 : RULES.ASSIST_VULN;
      const dealt = Math.round(
        scaleDamage(m.dmg, def.f, startCombo[atk.team])
        * (counter ? RULES.COUNTER_SCALE : 1) * armourTax * exposed,
      );
      if (counter) atk.counter = true;
      def.f.hp = Math.max(0, def.f.hp - dealt);
      def.f.burst = Math.min(RULES.BURST_FULL, def.f.burst + dealt * 1.6);
      atk.dmgDealt += dealt;
      atk.gainPts += m.gain;
      atk.atk = 'hit'; atk.contactAt = f;
      def.def = 'cut'; def.cutAt = f;
      def.push += def.dir * -m.pushHit * 0.55;
      events.push({
        f, type: 'hit', by: atk.team, dmg: dealt, level: m.level,
        kd: m.knockdown, counter, onAssist: !isPoint(def), fromAssist: !isPoint(atk),
      });
    }

    timeline.push({
      f,
      x: [points[0].x, points[1].x],
      hp: [points[0].f.hp, points[1].f.hp],
      phase: points.map((a) => phaseOf(a, lf(a, f))),
      extras: actors.filter((a) => !isPoint(a) && lf(a, f) <= moveDuration(a.m))
        .map((a) => ({
          team: a.team, char: a.f.char, x: a.x,
          phase: lf(a, f) < 0 ? 'move' : phaseOf(a, lf(a, f)),
        })),
      events: events.filter((e) => e.f === f),
    });
  }

  for (const a of actors) if (!a.atk && a.m.dmg) a.atk = 'whiff';
  return { points, total, timeline, events };
}

/** Who does this attack connect with? The nearest enemy inside its reach. */
function targetFor(actors, atk, f) {
  let best = null, bestD = Infinity;
  for (const d of actors) {
    if (d.team === atk.team) continue;
    if (lf(d, f) > moveDuration(d.m)) continue;                   // already left the field
    const dist = Math.abs(atk.x - d.x);
    if (dist > atk.m.range) continue;
    // Ties go to the point fighter: an assist standing on top of them is not a shield.
    if (dist < bestD - 0.001 || (Math.abs(dist - bestD) <= 0.001 && isPoint(d))) {
      best = d; bestD = dist;
    }
  }
  return best;
}

/** When can this point fighter act again? */
function actionableAt(a, enemyPoint, actors) {
  if (a.def === 'parry') return (a.contactAt ?? 0) + 1;
  // Whoever actually connected decides the stun, which in squad mode may be an assist.
  const hitter = actors.find((o) => o.team !== a.team && o.contactAt === (a.contactAt ?? a.cutAt)
    && (o.atk === 'hit' || o.atk === 'block')) ?? enemyPoint;
  if (a.def === 'guarded') return (a.contactAt ?? 0) + (hitter.m.blockstun || 8);
  if (a.def === 'cut') return (a.cutAt ?? 0) + hitter.m.hitstun + (hitter.counter ? RULES.COUNTER_STUN : 0);
  if (a.atk === 'parried') return (a.cutAt ?? 0) + RULES.PARRY_STUN;
  if (a.def === 'clash') return (a.contactAt ?? 0) + 12;
  return a.delay + moveDuration(a.m);
}

/** Bank meter, spend costs, and apply the uncontested-Hustle bonus. */
function commitMeter(a) {
  const f = a.f;
  f.meterPts += a.gainPts;
  let levels = Math.floor(f.meterPts / RULES.METER_PER_LEVEL);
  f.meterPts -= levels * RULES.METER_PER_LEVEL;
  if (a.m.cat === 'hustle' && a.def === null) levels += 2;
  if (a.m.cat === 'burst') f.burst = 0;
  f.meter = Math.max(0, Math.min(RULES.MAX_METER, f.meter - a.spent + levels));
}

export function resolveTurn(state, moveIds) {
  const s = cloneState(state);
  s.roundOver = null;
  const startCombo = [s.fighters[0].combo, s.fighters[1].combo];
  const actors = [0, 1].map((i) => makeActor(i, 'point', s.fighters[i], moveOf(s.fighters[i].char, moveIds[i])));

  const { points, total, timeline, events } = simulate(s, actors, startCombo);
  const actionable = points.map((a) => actionableAt(a, points[1 - a.team], actors));
  const adv = [actionable[1] - actionable[0], actionable[0] - actionable[1]];

  for (const a of actors) { a.f.x = clampX(a.x); commitMeter(a); }
  separateFighters(s.fighters, points[0].dir === 1 ? 0 : 1);

  // A trade resets both fighters to neutral: neither earned the pressure.
  const traded = points[0].def === 'cut' && points[1].def === 'cut';
  for (const a of points) {
    const other = points[1 - a.team];
    a.f.state = (a.def === 'cut' && !traded) ? (other.m.knockdown ? 'down' : 'stunned') : 'neutral';
    a.f.combo = (a.atk === 'hit' && !traded) ? startCombo[a.team] + 1 : 0;
  }

  const stallDmg = applySadness(s, state, points);
  s.turn += 1;
  settleRound(s);

  const summary = points.map((a, i) => ({
    move: a.m,
    outcome: a.atk ?? 'idle',
    defence: a.def,
    dmgDealt: a.dmgDealt,
    dmgTaken: points[1 - i].dmgDealt,
    adv: adv[i],
    counter: a.counter,
    contactAt: a.contactAt,
  }));

  return { state: s, timeline, events, summary, adv, actionable, total, traded, stallDmg };
}

/*
 * Sadness, borrowed from the source game: refusing to engage costs you health. It is
 * tracked per fighter rather than globally, so the one running away is the one who bleeds —
 * otherwise two passive fighters just tie on health and the round is a draw.
 */
function applySadness(s, before, points) {
  const anyDamage = points.some((a) => a.dmgDealt > 0);
  s.stall = anyDamage ? 0 : s.stall + 1;
  const beforeFs = before.fighters ?? before.teams.map((t, i) => t[before.point[i]]);
  const afterFs = s.fighters ?? s.teams.map((t, i) => t[s.point[i]]);
  const gapBefore = Math.abs(beforeFs[0].x - beforeFs[1].x);
  const gapAfter = Math.abs(afterFs[0].x - afterFs[1].x);
  const closing = gapAfter < gapBefore - 5;
  const stallDmg = [0, 0];
  for (const a of points) {
    const f = a.f;
    const engaged = anyDamage || (closing && a.m.dash?.toward === true);
    f.sad = engaged ? Math.max(0, f.sad - 2) : f.sad + 1;
    if (f.sad > RULES.STALL_GRACE) {
      stallDmg[a.team] = Math.min(8, (f.sad - RULES.STALL_GRACE) * 2);
      f.hp = Math.max(0, f.hp - stallDmg[a.team]);
    }
  }
  return stallDmg;
}


/* ------------------------------------------------------------------ squad */

/*
 * Squad mode: three fighters a side, one on point and two on the bench.
 *
 * Every turn you order your point fighter *and* may call one benched teammate, who runs in
 * ahead of you and performs their chosen assist move a few frames later. That delay is the
 * whole feature: land a knockdown, call an assist into the stun, and the two of them combo
 * together. The cost is that the assist arrives in front of you and is fully exposed, so a
 * call into a fast poke gets your teammate hurt and puts them on a long cooldown.
 */

export function newSquadMatch(teamA, teamB) {
  const mid = (RULES.ARENA_MIN + RULES.ARENA_MAX) / 2;
  const build = (team, side) => team.map((slot, n) => {
    const f = newFighter(mid + (side === 0 ? -1 : 1) * RULES.START_GAP / 2, `P${side + 1}-${n + 1}`, slot.char);
    f.assist = slot.assist ?? Object.values(CHARS[slot.char].strikes)[0].id;
    // Three fighters a side share the round, so each carries a smaller pool. Otherwise a
    // squad match simply never finishes inside the clock.
    f.maxHp = Math.round(f.maxHp * RULES.SQUAD_HP_SCALE);
    f.hp = f.maxHp;
    return f;
  });
  return {
    turn: 1, round: 1, wins: [0, 0], over: null, roundOver: null, stall: 0,
    teams: [build(teamA, 0), build(teamB, 1)],
    point: [0, 0],
    cooldown: [[0, 0, 0], [0, 0, 0]],
  };
}

export const isSquad = (s) => Array.isArray(s.teams);
export const pointOf = (s, i) => (isSquad(s) ? s.teams[i][s.point[i]] : s.fighters[i]);
export const teamAlive = (s, i) => s.teams[i].filter((f) => f.hp > 0).length;

/** Living teammates who are not currently on point, in slot order. */
export const benchOf = (s, i) => s.teams[i]
  .map((f, n) => ({ f, n }))
  .filter(({ f, n }) => n !== s.point[i] && f.hp > 0);

/** A squad choice is "<moveId>" or "<moveId>|<slot>" when a teammate is called with it. */
export const encodeChoice = (moveId, assistSlot) => (assistSlot == null ? moveId : `${moveId}|${assistSlot}`);
export function decodeChoice(id) {
  const bar = id.indexOf('|');
  return bar < 0 ? { moveId: id, assist: null } : { moveId: id.slice(0, bar), assist: Number(id.slice(bar + 1)) };
}

/** Point-fighter moves available in squad mode, including the tag options. */
function squadMoves(s, i) {
  const f = pointOf(s, i);
  const bench = benchOf(s, i);
  if (f.hp <= 0) return bench.map((b, k) => moveOf(f.char, k === 0 ? 'tag1' : 'tag2'));   // forced swap
  const ids = f.state === 'down' ? ['quickRise', 'rollAway', 'wakeSuper']
    : f.state === 'stunned' ? ['burst', 'diIn', 'diOut']
      : neutralSet(f.char);
  const table = moveTable(f.char);
  const list = ids.map((id) => table[id]).filter((m) => {
    if (m.cost > f.meter) return false;
    if (m.cat === 'burst' && f.burst < RULES.BURST_FULL) return false;
    return true;
  });
  // Tagging is only legal from neutral — you cannot swap out of hitstun.
  if (f.state === 'neutral') bench.forEach((b, k) => list.push(table[k === 0 ? 'tag1' : 'tag2']));
  return list;
}

/**
 * Every legal choice for this side: each point move on its own, plus the same move paired
 * with each teammate who is off cooldown. Solo states return their moves unchanged, so the
 * threat board, the yomi chain and the AI all work in both modes without knowing which.
 */
export function optionsFor(state, i) {
  if (!isSquad(state)) {
    return availableMoves(state, i).map((m) => ({ id: m.id, move: m, assist: null }));
  }
  const out = [];
  const callable = benchOf(state, i).filter(({ n }) => state.cooldown[i][n] === 0);
  for (const m of squadMoves(state, i)) {
    out.push({ id: m.id, move: m, assist: null });
    if (m.cat === 'tag') continue;                     // you cannot swap and call at once
    for (const { n, f } of callable) {
      out.push({ id: encodeChoice(m.id, n), move: m, assist: n, assistFighter: f });
    }
  }
  return out;
}

/** Resolve a turn in whichever mode this state is. */
export const resolve = (state, ids) => (isSquad(state) ? resolveSquadTurn(state, ids) : resolveTurn(state, ids));

export function resolveSquadTurn(state, choiceIds) {
  const s = cloneState(state);
  s.roundOver = null;
  const picks = choiceIds.map(decodeChoice);
  const points = [0, 1].map((i) => pointOf(s, i));
  const startCombo = [points[0].combo, points[1].combo];

  const actors = [];
  const called = [null, null];
  for (const i of [0, 1]) {
    const f = points[i];
    actors.push(makeActor(i, 'point', f, moveOf(f.char, picks[i].moveId)));
    const slot = picks[i].assist;
    if (slot != null && s.teams[i][slot]?.hp > 0 && s.cooldown[i][slot] === 0) {
      const mate = s.teams[i][slot];
      mate.x = f.x;
      const lead = (f.x <= points[1 - i].x ? 1 : -1) * RULES.ASSIST_LEAD;
      actors.push(makeActor(i, 'assist', mate, moveOf(mate.char, mate.assist), RULES.ASSIST_DELAY, lead));
      called[i] = slot;
    }
  }

  const sim = simulate(s, actors, startCombo);
  const pts = sim.points;
  const actionable = pts.map((a) => actionableAt(a, pts[1 - a.team], actors));
  const adv = [actionable[1] - actionable[0], actionable[0] - actionable[1]];

  for (const a of actors) { if (isPoint(a)) a.f.x = clampX(a.x); commitMeter(a); }
  keepApart(...(pts[0].dir === 1 ? [pts[0].f, pts[1].f] : [pts[1].f, pts[0].f]));

  const traded = pts[0].def === 'cut' && pts[1].def === 'cut';
  for (const a of pts) {
    const hitter = actors.find((o) => o.team !== a.team && o.cutAt === null && o.contactAt === a.cutAt && o.atk === 'hit')
      ?? pts[1 - a.team];
    a.f.state = (a.def === 'cut' && !traded) ? (hitter.m.knockdown ? 'down' : 'stunned') : 'neutral';
    a.f.combo = (a.atk === 'hit' && !traded) ? startCombo[a.team] + 1 : 0;
  }
  // A team combo is one combo. Two attackers connecting in the same turn is a two-hit
  // string, so the count climbs by both and proration applies across the pair.
  for (const i of [0, 1]) {
    const hits = actors.filter((a) => a.team === i && a.atk === 'hit').length;
    if (hits && !traded) pts[i].f.combo = startCombo[i] + hits;
    // An assist that lands leaves the victim stunned even if the point fighter whiffed.
    const lander = actors.filter((a) => a.team === i && a.atk === 'hit' && !isPoint(a)).pop();
    const victim = pts[1 - i];
    if (lander && !traded && victim.f.hp > 0 && victim.def !== 'parry') {
      victim.f.state = lander.m.knockdown ? 'down' : 'stunned';
    }
  }

  const stallDmg = applySadness(s, state, pts);

  // Cooldowns tick down; a called teammate goes on ice, longer if they got caught.
  for (const i of [0, 1]) {
    s.cooldown[i] = s.cooldown[i].map((c) => Math.max(0, c - 1));
    if (called[i] != null) {
      const assist = actors.find((a) => a.team === i && !isPoint(a));
      s.cooldown[i][called[i]] = assist?.def === 'cut' ? RULES.ASSIST_PUNISHED : RULES.ASSIST_COOLDOWN;
    }
  }

  // Tagging, and the forced swap when your point fighter is down.
  for (const i of [0, 1]) {
    const pick = picks[i];
    const bench = benchOf(state, i);
    if (pick.moveId === 'tag1' || pick.moveId === 'tag2') {
      const target = bench[pick.moveId === 'tag1' ? 0 : 1];
      if (target) swapPoint(s, i, target.n);
    } else if (pointOf(s, i).hp <= 0) {
      const next = benchOf(s, i)[0];
      if (next) swapPoint(s, i, next.n);
    }
  }

  // Benched fighters catch their breath — but only back up to half health. Uncapped, two
  // benched teammates regenerate faster than a fight deals damage, and every match runs
  // to the clock instead of to a knockout.
  for (const i of [0, 1]) {
    s.teams[i].forEach((f, n) => {
      if (n === s.point[i] || f.hp <= 0) return;
      const cap = f.maxHp * RULES.BENCH_HEAL_CAP;
      if (f.hp < cap) f.hp = Math.min(cap, f.hp + RULES.BENCH_HEAL);
    });
  }

  s.turn += 1;
  settleSquad(s);

  const summary = pts.map((a, i) => ({
    move: a.m,
    outcome: a.atk ?? 'idle',
    defence: a.def,
    dmgDealt: actors.filter((o) => o.team === i).reduce((n, o) => n + o.dmgDealt, 0),
    dmgTaken: actors.filter((o) => o.team !== i).reduce((n, o) => n + o.dmgDealt, 0),
    adv: adv[i],
    counter: a.counter,
    contactAt: a.contactAt,
    assist: actors.find((o) => o.team === i && !isPoint(o)) ?? null,
  }));

  return {
    state: s, timeline: sim.timeline, events: sim.events, summary, adv, actionable,
    total: sim.total, traded, stallDmg, called,
  };
}

function swapPoint(s, i, slot) {
  const out = s.teams[i][s.point[i]];
  const inc = s.teams[i][slot];
  inc.x = out.x;
  inc.state = 'neutral';
  inc.combo = 0;
  s.point[i] = slot;
}

/** Squad matches have no rounds — the three lives are the rounds. */
function settleSquad(s) {
  const alive = [teamAlive(s, 0), teamAlive(s, 1)];
  if (alive[0] === 0 || alive[1] === 0) {
    s.over = { winner: alive[0] === 0 && alive[1] === 0 ? null : (alive[0] === 0 ? 1 : 0), by: 'ko' };
    return;
  }
  if (s.turn > RULES.SQUAD_TURN_LIMIT) {
    const share = [0, 1].map((i) => s.teams[i].reduce((n, f) => n + f.hp, 0) / s.teams[i].reduce((n, f) => n + f.maxHp, 0));
    s.over = { winner: share[0] === share[1] ? null : (share[0] > share[1] ? 0 : 1), by: 'time' };
  }
}

/** Decide whether this round (and then the match) has ended. */
function settleRound(s) {
  // `winner` is an index, so results are always objects — a bare 0 would read as falsy.
  const down = [s.fighters[0].hp <= 0, s.fighters[1].hp <= 0];
  let result = null;
  if (down[0] || down[1]) {
    result = { winner: down[0] && down[1] ? null : (down[0] ? 1 : 0), by: 'ko' };
  } else if (s.turn > RULES.TURN_LIMIT) {
    // Time over. Health share decides it, so refusing to engage is a losing plan by itself.
    const [a, b] = s.fighters.map((f) => f.hp / f.maxHp);
    result = { winner: a === b ? null : (a > b ? 0 : 1), by: 'time' };
  }
  if (!result) return;

  s.roundOver = result;
  if (result.winner !== null) s.wins[result.winner] += 1;
  if (s.wins[0] >= RULES.ROUNDS_TO_WIN || s.wins[1] >= RULES.ROUNDS_TO_WIN) {
    s.over = { winner: s.wins[0] >= RULES.ROUNDS_TO_WIN ? 0 : 1, by: result.by };
  }
}

function phaseOf(sd, f) {
  if (sd.m.cat === 'tag') return 'move';
  if (sd.cutAt !== null && f >= sd.cutAt) return sd.atk === 'parried' ? 'parried' : 'stun';
  const m = sd.m;
  if (m.cat === 'guard') return sd.def === 'guarded' && f >= (sd.contactAt ?? 1e9) ? 'blockstun' : 'guard';
  if (m.cat === 'parry') return within(f, [m.parry.from, m.parry.to]) ? 'parryWindow' : 'parryRecover';
  if (m.cat === 'dodge' || m.cat === 'wake' || m.cat === 'di') return within(f, m.invuln) ? 'invuln' : 'move';
  if (m.cat === 'move') return 'move';
  if (m.cat === 'hustle') return 'hustle';
  if (within(f, m.armour) && f < m.startup) return 'armour';
  if (f < m.startup) return 'startup';
  if (f < m.startup + m.active) return 'active';
  return 'recovery';
}

function scaleDamage(raw, defender, comboCount) {
  let d = raw * Math.max(RULES.COMBO_FLOOR, 1 - RULES.COMBO_DECAY * comboCount);
  if (defender.hp / defender.maxHp < RULES.GUTS_THRESHOLD) d *= RULES.GUTS_SCALE;
  return Math.max(1, Math.round(d));
}

/*
 * Keep the fighters apart *and* in their original left/right order. Using the current
 * sign of the gap instead lets an overshooting dash teleport straight past the opponent
 * and swap the sides mid-round, which reads as a bug even when the maths is fine.
 */
function keepApart(left, right) {
  const overlap = RULES.MIN_SEPARATION - (right.x - left.x);
  if (overlap <= 0) return;
  left.x = clampX(left.x - overlap / 2);
  right.x = clampX(right.x + overlap / 2);
}

const separate = (sides) => keepApart(...(sides[0].dir === 1 ? sides : [sides[1], sides[0]]));

function separateFighters(fs, leftIdx) {
  keepApart(fs[leftIdx], fs[1 - leftIdx]);
}

/* ----------------------------------------------------------- threat board */

/** How good was this exchange for fighter `i`? Higher is better. */
export function scoreFor(result, i) {
  const me = result.summary[i];
  const them = result.summary[1 - i];
  const myF = pointOf(result.state, i);
  const theirF = pointOf(result.state, 1 - i);

  let v = 0;
  // Damage is weighed against each fighter's own health pool, so a Bruiser and a Blade
  // value the same 15 points correctly differently.
  v += (me.dmgDealt / theirF.maxHp) * 150;
  v -= (them.dmgDealt / myF.maxHp) * 172;
  v += Math.max(-40, Math.min(40, me.adv)) * 0.32;
  v += (myF.meter - theirF.meter) * 1.2;
  if (theirF.state === 'down') v += 7;
  if (myF.state === 'down') v -= 7;
  if (theirF.state === 'stunned') v += 5;
  if (myF.state === 'stunned') v -= 5;
  const ended = result.state.over ?? result.state.roundOver;
  if (ended?.winner === i) v += 500;
  if (ended?.winner === 1 - i) v -= 500;

  // Squad mode: the point fighter's health is not the whole picture. Chipping a teammate
  // off the board is worth real value, and losing your own assist to a poke is not free.
  if (isSquad(result.state)) {
    const share = (n) => result.state.teams[n].reduce((a, f) => a + f.hp, 0)
      / result.state.teams[n].reduce((a, f) => a + f.maxHp, 0);
    // Weighted lightly on purpose. Valuing team health too highly makes both sides turtle,
    // and every squad match ends on the clock at three-quarters health instead of with a
    // knockout. The point-fighter damage terms above already carry the exchange.
    v += (share(i) - share(1 - i)) * 12;
    v += (teamAlive(result.state, 1 - i) < teamAlive(result.state, i) ? 12 : 0);
  }

  // Being cornered is a genuine loss of options, so hold the middle.
  const wall = Math.min(myF.x - RULES.ARENA_MIN, RULES.ARENA_MAX - myF.x);
  v += Math.min(wall, 180) * 0.012;

  // A one-turn lookahead cannot see that closing the gap is what makes damage possible
  // later, so spacing needs an explicit pull toward the range where strikes reach. The
  // target is per character: a Blade wants to sit where a Bruiser cannot touch it.
  //
  // This weight matters more than it looks. Too low and both sides drift to a 270-unit
  // stand-off where nothing reaches, only 4% of turns land, and every match is decided by
  // the clock. At 9 the AI holds a real fighting range and roughly a fifth of turns connect.
  const g = Math.abs(myF.x - theirF.x);
  v += Math.max(0, 1 - Math.abs(g - preferredGap(myF.char)) / 200) * 9.0;

  // A whiffed attack is a wasted commitment. Without this the AI is happy to throw pokes
  // into thin air forever, because at max range a whiff costs it nothing at all.
  if (me.outcome === 'whiff') v -= 1.6;
  return v;
}

/** Where this fighter's own strikes actually land — the gap they should be fighting at. */
const GAPS = {};
export function preferredGap(charId) {
  return (GAPS[charId] ??= 0.85 * Math.max(
    ...neutralSet(charId).map((id) => moveOf(charId, id).dmg ? moveOf(charId, id).range : 0),
  ));
}

/** Classify an exchange from fighter `i`'s point of view, for display. */
export function verdictFor(result, i) {
  const me = result.summary[i];
  const them = result.summary[1 - i];
  if (result.traded) return { key: 'trade', label: `TRADE · ${them.dmgDealt}` };
  if (me.defence === 'parry') return { key: 'parry', label: 'YOU PARRY' };
  if (me.outcome === 'parried') return { key: 'parried', label: 'PARRIED' };
  if (me.defence === 'clash') return { key: 'clash', label: 'CLASH' };
  if (me.defence === 'armour' && me.outcome === 'hit') return { key: 'win', label: `TANK & HIT · ${me.dmgDealt}` };
  if (me.outcome === 'armoured') return { key: 'blocked', label: 'THEY TANK IT' };
  if (me.defence === 'armour') return { key: 'guard', label: 'YOU TANK IT' };
  if (me.outcome === 'hit') return { key: 'win', label: `${me.counter ? 'COUNTER' : 'HIT'} · ${me.dmgDealt}` };
  if (me.defence === 'cut') return { key: 'lose', label: `EAT · ${them.dmgDealt}` };
  if (me.outcome === 'block') return { key: 'blocked', label: 'THEY GUARD' };
  if (me.defence === 'guarded') return { key: 'guard', label: 'YOU GUARD' };
  const adv = me.adv;
  if (me.outcome === 'whiff' && adv <= -8) return { key: 'minus', label: `WHIFF · ${adv}` };
  if (adv >= 8) return { key: 'plus', label: `+${adv} FREE TURN` };
  if (adv <= -8) return { key: 'minus', label: `${adv} PUNISHABLE` };
  return { key: 'neutral', label: adv === 0 ? 'EVEN' : (adv > 0 ? `+${adv}` : `${adv}`) };
}

/** Resolve a specific pairing without caring which index is which. */
function pair(state, aIdx, aMove, bMove) {
  const ids = [];
  ids[aIdx] = aMove;
  ids[1 - aIdx] = bMove;
  return resolve(state, ids);
}

/** Display name for a choice — squad choices carry the teammate they call. */
export function choiceLabel(state, i, id) {
  const { moveId, assist } = decodeChoice(id);
  const f = pointOf(state, i);
  const name = moveOf(f.char, moveId)?.name ?? moveId;
  if (assist == null || !isSquad(state)) return name;
  return `${name} + ${CHARS[state.teams[i][assist].char].name}`;
}

/**
 * The headline feature. For a move *you* are considering, run every legal reply the
 * opponent has and rank them by how well they do against it. This is the real simulation
 * — not a lookup table — so if the engine changes, the board changes with it.
 */
export function threatBoard(state, myIdx, myMoveId) {
  const themIdx = 1 - myIdx;
  const rows = optionsFor(state, themIdx).map((opt) => {
    const m = opt.move;
    const result = pair(state, myIdx, myMoveId, opt.id);
    return {
      move: m,
      option: opt,
      label: choiceLabel(state, themIdx, opt.id),
      score: scoreFor(result, themIdx),
      mine: scoreFor(result, myIdx),
      verdict: verdictFor(result, myIdx),
      dmgTaken: result.summary[myIdx].dmgTaken,
      dmgDealt: result.summary[myIdx].dmgDealt,
      adv: result.summary[myIdx].adv,
      result,
    };
  });
  rows.sort((a, b) => b.score - a.score);
  const lo = Math.min(...rows.map((r) => r.score));
  const hi = Math.max(...rows.map((r) => r.score));
  for (const r of rows) r.heat = hi === lo ? 0.5 : (r.score - lo) / (hi - lo);

  // "Risky" means they get something out of it: damage, or a free turn from close enough
  // to actually spend it. Being minus at full screen costs you nothing and is not counted.
  const bad = rows.filter((r) => {
    if (r.dmgTaken > 0) return true;
    const gapAfter = Math.abs(pointOf(r.result.state, 0).x - pointOf(r.result.state, 1).x);
    return r.adv <= -8 && gapAfter <= 220;
  }).length;
  return { rows, best: rows[0], risk: rows.length ? bad / rows.length : 0 };
}

/** The single best reply `responder` has to a move the other side has committed to. */
export function bestAnswer(state, responder, committedMove) {
  let best = null;
  for (const opt of optionsFor(state, responder)) {
    const result = pair(state, 1 - responder, committedMove, opt.id);
    const score = scoreFor(result, responder);
    if (!best || score > best.score) {
      best = {
        move: opt.move, id: opt.id, option: opt, score, result,
        label: choiceLabel(state, responder, opt.id),
        verdict: verdictFor(result, responder),
      };
    }
  }
  return best;
}

/**
 * The yomi ladder, made visible.
 *
 * Layer 1 is what beats your move. Layer 2 is what beats *that* — the move to play if you
 * expect them to have read you. Layer 3 is their answer to the read, and so on. Every
 * layer is evaluated in the same current situation, because that is how the guess actually
 * works: nobody is planning turns ahead, they are planning how deep to think right now.
 *
 * Chains in this game close quickly, so the walk stops as soon as a side repeats itself —
 * that repeat is the point where the read loops and you are back to a coin flip.
 */
export function yomiChain(state, myIdx, myMoveId, depth = 4) {
  const chain = [{
    side: myIdx,
    move: moveOf(pointOf(state, myIdx).char, decodeChoice(myMoveId).moveId),
    name: choiceLabel(state, myIdx, myMoveId),
    label: 'You commit',
  }];
  const seen = [new Set([myMoveId]), new Set()];
  let side = myIdx;
  let committed = myMoveId;

  for (let d = 0; d < depth; d++) {
    const responder = 1 - side;
    const answer = bestAnswer(state, responder, committed);
    if (!answer) break;
    const loops = seen[responder].has(answer.id);
    chain.push({
      side: responder,
      move: answer.move,
      name: answer.label,
      verdict: answer.verdict,
      label: responder === myIdx ? 'So you' : 'They answer',
      loops,
    });
    if (loops) break;
    seen[responder].add(answer.id);
    side = responder;
    committed = answer.id;
  }
  return chain;
}

/**
 * After the fact: given what they actually played, what should you have played?
 * The threat board teaches you before the guess; this teaches you after it.
 */
export function postMortem(preState, myIdx, myMoveId, theirMoveId) {
  const rows = optionsFor(preState, myIdx).map((opt) => {
    const m = opt.move;
    const result = pair(preState, myIdx, opt.id, theirMoveId);
    return {
      move: m,
      id: opt.id,
      label: choiceLabel(preState, myIdx, opt.id),
      score: scoreFor(result, myIdx),
      verdict: verdictFor(result, myIdx),
      dmgDealt: result.summary[myIdx].dmgDealt,
      dmgTaken: result.summary[myIdx].dmgTaken,
      adv: result.summary[myIdx].adv,
    };
  });
  rows.sort((a, b) => b.score - a.score);
  const played = rows.find((r) => r.id === myMoveId) ?? null;
  const best = rows[0];
  return {
    best,
    played,
    wasBest: !!played && !!best && played.id === best.id,
    rank: played ? rows.indexOf(played) + 1 : null,
    total: rows.length,
  };
}

/**
 * Risk rating for the moves you could pick — drives the bars on the buttons.
 *
 * In squad mode the assist call is a separate toggle in the UI rather than 38 separate
 * buttons, so pass the currently selected teammate and only those options get scored. That
 * keeps the per-turn cost near the solo game's instead of tripling it.
 */
export function riskProfile(state, myIdx, assistSlot = undefined) {
  const out = {};
  for (const opt of optionsFor(state, myIdx)) {
    if (assistSlot !== undefined && opt.assist !== assistSlot && opt.move.cat !== 'tag') continue;
    const b = threatBoard(state, myIdx, opt.id);
    out[opt.id] = { risk: b.risk, best: b.best, rows: b.rows, option: opt };
  }
  return out;
}

/* -------------------------------------------------------------------- AI */

function payoffMatrix(state, aiIdx) {
  const humanIdx = 1 - aiIdx;
  const mine = optionsFor(state, aiIdx);
  const theirs = optionsFor(state, humanIdx);
  const M2 = mine.map((am) => theirs.map((hm) => scoreFor(pair(state, aiIdx, am.id, hm.id), aiIdx)));
  return { mine, theirs, M: M2 };
}

/**
 * Fictitious play: each side repeatedly best-responds to the running average of the
 * other's history. It converges toward a mixed equilibrium — exactly the right shape of
 * opponent for a game whose whole premise is that no single answer is ever safe.
 */
const EPS = 1e-9;
function fictitiousPlay(M, iters = 250) {
  const R = M.length, C = M[0].length;
  const rowCount = new Array(R).fill(0);
  const colCount = new Array(C).fill(0);
  rowCount[0] = 1; colCount[0] = 1;
  for (let t = 0; t < iters; t++) {
    let bi = 0, bv = -Infinity;
    for (let r = 0; r < R; r++) {
      let v = 0;
      for (let c = 0; c < C; c++) v += M[r][c] * colCount[c];
      // On a tie, favour whichever option has been chosen least. Strict `>` would pile
      // every tie onto the first option in the list and quietly kill its equals.
      if (v > bv + EPS || (Math.abs(v - bv) <= EPS && rowCount[r] < rowCount[bi])) { bv = v; bi = r; }
    }
    rowCount[bi]++;
    let ci = 0, cv = Infinity;
    for (let c = 0; c < C; c++) {
      let v = 0;
      for (let r = 0; r < R; r++) v += M[r][c] * rowCount[r];
      if (v < cv - EPS || (Math.abs(v - cv) <= EPS && colCount[c] < colCount[ci])) { cv = v; ci = c; }
    }
    colCount[ci]++;
  }
  const tot = rowCount.reduce((a, b) => a + b, 0);
  return rowCount.map((n) => n / tot);
}

export const DIFFICULTY = {
  rookie: { noise: 0.62, readWeight: 0.0, label: 'Rookie', note: 'Mostly random. Learn the buttons.' },
  fighter: { noise: 0.32, readWeight: 0.25, label: 'Fighter', note: 'Plays the odds, forgives habits.' },
  yomi: { noise: 0.1, readWeight: 0.55, label: 'Yomi', note: 'Mixes well and starts reading you.' },
  oracle: { noise: 0.02, readWeight: 0.85, label: 'Oracle', note: 'Punishes any pattern you show.' },
};

// Small deterministic PRNG so replays and tests are reproducible.
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/**
 * Pick the AI's move. It solves the same matrix the threat board shows you, then mixes:
 * partly the equilibrium strategy, partly a direct read of what you have been leaning on.
 * Higher difficulty means less noise and a sharper read.
 */
export function chooseAiMove(state, aiIdx, difficulty, history, rand) {
  const cfg = DIFFICULTY[difficulty] ?? DIFFICULTY.fighter;
  const { mine, theirs, M } = payoffMatrix(state, aiIdx);
  if (!mine.length) return null;
  if (!theirs.length) return mine[0].id;

  const mix = fictitiousPlay(M);

  // Read layer: assume you will keep doing what you have been doing.
  const read = new Array(mine.length).fill(0);
  const counts = {};
  let seen = 0;
  for (const h of history.slice(-8)) { counts[h] = (counts[h] || 0) + 1; seen++; }
  let hasRead = false;
  if (seen && cfg.readWeight > 0) {
    const w = theirs.map((t) => (counts[t.id] || 0) / seen);
    if (w.some((v) => v > 0)) {
      const ev = M.map((row) => row.reduce((a, v, c) => a + v * w[c], 0));
      read[ev.indexOf(Math.max(...ev))] = 1;
      hasRead = true;
    }
  }
  const rw = hasRead ? cfg.readWeight : 0;

  const probs = mine.map((_, r) => {
    const base = (1 - rw) * mix[r] + rw * read[r];
    return base * (1 - cfg.noise) + (cfg.noise / mine.length);
  });
  const tot = probs.reduce((a, b) => a + b, 0);
  let roll = rand() * tot;
  for (let r = 0; r < probs.length; r++) {
    roll -= probs[r];
    if (roll <= 0) return mine[r].id;
  }
  return mine[mine.length - 1].id;
}
