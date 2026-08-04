/*
 * HUSTLE LITE — engine
 *
 * A trimmed-down take on the simultaneous-turn fighting game "Your Only Move Is HUSTLE".
 * Both fighters commit one move per turn, the turn is simulated frame by frame, and the
 * result decides who acts first next turn.
 *
 * Everything in this file is pure: no DOM, no canvas, no timers. `resolveTurn` is the
 * single source of truth — the renderer replays its timeline, the threat board scores its
 * outcomes, and the AI searches over it. Nothing is modelled twice.
 */

export const RULES = {
  MAX_HP: 150,
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
  STALL_GRACE: 8,       // turns of nobody committing before the ring starts biting
  TURN_LIMIT: 60,       // the round ends here; whoever is ahead on health takes it
  PARRY_STUN: 24,
};

/* ------------------------------------------------------------------ moves */

/*
 * Frame anatomy of a strike: [0, startup) wind-up, [startup, startup+active) the hitbox
 * is live, then recovery. `range` is measured centre-to-centre, so a move only connects
 * if the gap has closed enough by the frame the hitbox is live — which is why `dash`
 * moves like Lunge reach further than their raw range suggests. They carry you in.
 */
const M = (def) => ({
  startup: 0, active: 0, recovery: 0, range: 0, level: 'mid', dmg: 0,
  hitstun: 0, blockstun: 0, pushHit: 0, pushBlock: 0, dash: null,
  invuln: null, armour: null, guards: null, parry: null, cost: 0, gain: 0,
  knockdown: false, unblockable: false, parryable: true, tag: '', ...def,
});

export const MOVES = {
  /* --- strikes ---------------------------------------------------------- */
  jab: M({
    id: 'jab', name: 'Jab', cat: 'strike', key: '1',
    startup: 4, active: 2, recovery: 6, range: 95, level: 'mid',
    dmg: 7, hitstun: 12, blockstun: 8, pushHit: 30, pushBlock: 22, gain: 6,
    blurb: 'Fastest thing you own. Beats anything slower to the punch.',
    tag: 'fast',
  }),
  sweep: M({
    id: 'sweep', name: 'Sweep', cat: 'strike', key: '2',
    startup: 8, active: 3, recovery: 12, range: 115, level: 'low',
    dmg: 12, hitstun: 24, blockstun: 10, pushHit: 40, pushBlock: 30, gain: 8,
    knockdown: true,
    blurb: 'Low. Goes under High Guard and puts them on the floor.',
    tag: 'low',
  }),
  overhead: M({
    id: 'overhead', name: 'Overhead', cat: 'strike', key: '3',
    startup: 13, active: 3, recovery: 16, range: 125, level: 'high',
    dmg: 18, hitstun: 26, blockstun: 14, pushHit: 45, pushBlock: 28, gain: 10,
    blurb: 'High. Crushes Low Guard, and slow enough to walk past a Parry.',
    tag: 'high',
  }),
  lunge: M({
    id: 'lunge', name: 'Lunge', cat: 'strike', key: '4',
    startup: 10, active: 4, recovery: 18, range: 120, level: 'mid',
    dmg: 14, hitstun: 24, blockstun: 12, pushHit: 20, pushBlock: 55, gain: 9,
    dash: { from: 2, to: 12, dist: 150, toward: true },
    armour: [2, 10],
    blurb: 'Armoured approach: eats one strike on the way in. Guards and Grabs stop it cold.',
    tag: 'armour 2-9',
  }),
  grab: M({
    id: 'grab', name: 'Grab', cat: 'grab', key: '5',
    startup: 6, active: 2, recovery: 19, range: 72, level: 'grab',
    dmg: 8, hitstun: 30, pushHit: 150, gain: 12,
    knockdown: true, unblockable: true, parryable: false,
    blurb: 'Ignores both guards and the Parry. Loses to anything faster than 6f.',
    tag: 'unblockable',
  }),

  /* --- defence ---------------------------------------------------------- */
  highGuard: M({
    id: 'highGuard', name: 'High Guard', cat: 'guard', key: 'q',
    recovery: 18, guards: ['high', 'mid'], gain: 5,
    blurb: 'Stops highs and mids. Sweeps go straight under it.',
    tag: 'blocks high/mid',
  }),
  lowGuard: M({
    id: 'lowGuard', name: 'Low Guard', cat: 'guard', key: 'w',
    recovery: 18, guards: ['low', 'mid'], gain: 5,
    blurb: 'Stops lows and mids. Overheads come right over the top.',
    tag: 'blocks low/mid',
  }),
  parry: M({
    id: 'parry', name: 'Parry', cat: 'parry', key: 'e',
    recovery: 27, parry: { from: 2, to: 8 }, gain: 30,
    blurb: 'A six-frame window. Eats fast moves whole; slow ones stroll past it.',
    tag: 'frames 2-7',
  }),
  dodge: M({
    id: 'dodge', name: 'Dodge Roll', cat: 'dodge', key: 'r',
    recovery: 22, invuln: [3, 12],
    dash: { from: 0, to: 16, dist: 105, toward: false },
    blurb: 'Invulnerable frames 3-11 and it retreats. Only a Lunge can chase it down.',
    tag: 'i-frames 3-11',
  }),

  /* --- movement --------------------------------------------------------- */
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

  /* --- resource --------------------------------------------------------- */
  hustle: M({
    id: 'hustle', name: 'Hustle', cat: 'hustle', key: 'd',
    recovery: 30, gain: 0,
    blurb: 'Pure greed: +2 meter and thirty frames of standing perfectly still.',
    tag: '+2 meter',
  }),
  super: M({
    id: 'super', name: 'Rising Fang', cat: 'super', key: 'f',
    startup: 5, active: 4, recovery: 30, range: 120, level: 'mid',
    dmg: 30, hitstun: 34, blockstun: 12, pushHit: 70, pushBlock: 40,
    cost: RULES.SUPER_COST, invuln: [0, 9], knockdown: true,
    blurb: 'Invulnerable reversal for 2 meter. Guarded, it is a free round for them.',
    tag: 'i-frames 0-8',
  }),

  /* --- while you are in hitstun ----------------------------------------- */
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

  /* --- while you are knocked down --------------------------------------- */
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
  wakeSuper: M({
    id: 'wakeSuper', name: 'Wakeup Fang', cat: 'super', key: '3',
    startup: 5, active: 4, recovery: 30, range: 120, level: 'mid',
    dmg: 30, hitstun: 34, blockstun: 12, pushHit: 70, pushBlock: 40,
    cost: RULES.SUPER_COST, invuln: [0, 9], knockdown: true,
    blurb: 'The reversal, from the floor. All or nothing.',
    tag: 'i-frames 0-8',
  }),
};

export const NEUTRAL_SET = [
  'jab', 'sweep', 'overhead', 'lunge', 'grab',
  'highGuard', 'lowGuard', 'parry', 'dodge',
  'closeIn', 'backOff', 'hustle', 'super',
];
export const STUN_SET = ['burst', 'diIn', 'diOut'];
export const WAKE_SET = ['quickRise', 'rollAway', 'wakeSuper'];

/* ------------------------------------------------------------------ state */

export function newFighter(x, name) {
  return {
    name, x,
    hp: RULES.MAX_HP,
    meter: 0,
    meterPts: 0,
    burst: RULES.BURST_FULL,
    state: 'neutral',      // 'neutral' | 'stunned' | 'down'
    combo: 0,
    sad: 0,                // "sadness": turns spent refusing to engage
  };
}

export function newMatch() {
  const mid = (RULES.ARENA_MIN + RULES.ARENA_MAX) / 2;
  return {
    turn: 1,
    over: null,
    stall: 0,
    fighters: [
      newFighter(mid - RULES.START_GAP / 2, 'YOU'),
      newFighter(mid + RULES.START_GAP / 2, 'RIVAL'),
    ],
  };
}

export const gap = (s) => Math.abs(s.fighters[0].x - s.fighters[1].x);

/** Which moves fighter `i` may legally pick right now. */
export function availableMoves(state, i) {
  const f = state.fighters[i];
  const ids = f.state === 'down' ? WAKE_SET : f.state === 'stunned' ? STUN_SET : NEUTRAL_SET;
  return ids.map((id) => MOVES[id]).filter((m) => {
    if (m.cost > f.meter) return false;
    if (m.cat === 'burst' && f.burst < RULES.BURST_FULL) return false;
    return true;
  });
}

export const cloneState = (s) => ({
  turn: s.turn, over: s.over, stall: s.stall,
  fighters: s.fighters.map((f) => ({ ...f })),
});

/* -------------------------------------------------------------- simulation */

const within = (f, win) => !!win && f >= win[0] && f < win[1];
export const moveDuration = (m) => m.startup + m.active + m.recovery;
const clampX = (x) => Math.max(RULES.ARENA_MIN, Math.min(RULES.ARENA_MAX, x));

function dashOffset(m, f) {
  // Distance travelled by the end of frame `f`, eased so the fighter glides rather than snaps.
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
 *   `atk` — what my own move did   ('hit' | 'block' | 'parried' | 'clash' | 'whiff' | null)
 *   `def` — what happened to me    ('cut'  | 'guarded' | 'parry'  | 'clash' | null)
 * Conflating them is what makes trades resolve wrong, so they stay separate all the way
 * out to the summary.
 */
export function resolveTurn(state, moveIds) {
  const s = cloneState(state);
  const sides = [0, 1].map((i) => {
    const f = s.fighters[i];
    return {
      i, f, m: MOVES[moveIds[i]],
      x0: f.x, x: f.x, push: 0, dir: 0,
      atk: null, def: null, armourUsed: false,
      contactAt: null, cutAt: null,
      dmgDealt: 0, gainPts: 0, spent: MOVES[moveIds[i]].cost,
    };
  });
  sides[0].dir = sides[0].x0 <= sides[1].x0 ? 1 : -1;
  sides[1].dir = -sides[0].dir;

  const startCombo = [s.fighters[0].combo, s.fighters[1].combo];
  const total = Math.max(moveDuration(sides[0].m), moveDuration(sides[1].m), 1);
  const timeline = [];
  const events = [];

  const cutBefore = (sd, f) => sd.cutAt !== null && sd.cutAt < f;
  const iframed = (sd, f) => !cutBefore(sd, f) && within(f, sd.m.invuln);

  for (let f = 0; f <= total; f++) {
    // 1. movement. A fighter interrupted at frame k freezes where they were at frame k.
    for (const sd of sides) {
      const upto = sd.cutAt === null ? f : sd.cutAt;
      const sign = sd.m.dash && sd.m.dash.toward === false ? -1 : 1;
      sd.x = clampX(sd.x0 + sd.dir * sign * dashOffset(sd.m, upto) + sd.push);
    }
    separate(sides);

    // 2. contact. Both hitboxes are tested against the same frame, so real trades happen
    //    rather than one side silently winning every tie.
    const pending = [];
    for (const atk of sides) {
      if (atk.atk || cutBefore(atk, f)) continue;
      const m = atk.m;
      if (!m.dmg) continue;
      if (f < m.startup || f >= m.startup + m.active) continue;
      if (Math.abs(atk.x - sides[1 - atk.i].x) > m.range) continue;
      pending.push(atk);
    }

    for (const atk of pending) {
      if (atk.atk) continue;                       // already settled by a clash this frame
      const def = sides[1 - atk.i];
      const m = atk.m;
      const dm = def.m;
      const defLive = !cutBefore(def, f);

      // grab vs grab — nobody wins, both bounce off
      if (m.cat === 'grab' && dm.cat === 'grab' && defLive && pending.includes(def)) {
        atk.atk = 'clash'; atk.def = 'clash'; atk.contactAt = f;
        def.atk = 'clash'; def.def = 'clash'; def.contactAt = f;
        atk.push += -atk.dir * 70; def.push += -def.dir * 70;
        events.push({ f, type: 'clash', by: atk.i });
        continue;
      }

      if (iframed(def, f)) { events.push({ f, type: 'iframe', by: atk.i, at: def.i }); continue; }

      // parry window. Grabs are unparryable, which is what keeps Parry an honest gamble.
      if (defLive && dm.parry && within(f, [dm.parry.from, dm.parry.to]) && m.parryable) {
        atk.atk = 'parried'; atk.contactAt = f; atk.cutAt = f;
        def.def = 'parry'; def.contactAt = f; def.gainPts += dm.gain;
        events.push({ f, type: 'parry', by: def.i });
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
        events.push({ f, type: 'block', by: atk.i, dmg: chip });
        continue;
      }

      // Super-armour: absorbs one strike on the way in, at reduced damage and without
      // being interrupted. Grabs go straight through it, which is what keeps the
      // approach game honest — armour beats pokes, Grab beats armour, Dodge beats Grab.
      if (defLive && def.m.armour && !def.armourUsed && within(f, def.m.armour) && m.cat !== 'grab') {
        const soak = Math.max(1, Math.round(scaleDamage(m.dmg, def.f, startCombo[atk.i]) * 0.5));
        def.f.hp = Math.max(0, def.f.hp - soak);
        def.f.burst = Math.min(RULES.BURST_FULL, def.f.burst + soak);
        def.armourUsed = true;
        def.def = 'armour';
        atk.dmgDealt += soak;
        atk.atk = 'armoured'; atk.contactAt = f;
        atk.gainPts += Math.round(m.gain * 0.5);
        events.push({ f, type: 'armour', by: def.i, dmg: soak });
        continue;
      }

      // clean hit
      const dealt = scaleDamage(m.dmg, def.f, startCombo[atk.i]);
      def.f.hp = Math.max(0, def.f.hp - dealt);
      def.f.burst = Math.min(RULES.BURST_FULL, def.f.burst + dealt * 1.6);
      atk.dmgDealt += dealt;
      atk.gainPts += m.gain;
      atk.atk = 'hit'; atk.contactAt = f;
      def.def = 'cut'; def.cutAt = f;
      def.push += def.dir * -m.pushHit * 0.55;
      events.push({ f, type: 'hit', by: atk.i, dmg: dealt, level: m.level, kd: m.knockdown });
    }

    timeline.push({
      f,
      x: [sides[0].x, sides[1].x],
      hp: [s.fighters[0].hp, s.fighters[1].hp],
      phase: sides.map((sd) => phaseOf(sd, f)),
      events: events.filter((e) => e.f === f),
    });
  }

  for (const sd of sides) if (!sd.atk && sd.m.dmg) sd.atk = 'whiff';

  // 3. settle — when does each fighter get to act again?
  const actionable = sides.map((sd) => {
    const other = sides[1 - sd.i];
    if (sd.def === 'parry') return (sd.contactAt ?? 0) + 1;
    if (sd.def === 'guarded') return (sd.contactAt ?? 0) + (other.m.blockstun || 8);
    if (sd.def === 'cut') return (sd.cutAt ?? 0) + other.m.hitstun;
    if (sd.atk === 'parried') return (sd.cutAt ?? 0) + RULES.PARRY_STUN;
    if (sd.def === 'clash') return (sd.contactAt ?? 0) + 12;
    return moveDuration(sd.m);
  });
  const adv = [actionable[1] - actionable[0], actionable[0] - actionable[1]];

  // 4. commit to the real state
  for (const sd of sides) {
    const f = sd.f;
    f.x = clampX(sd.x);
    f.meterPts += sd.gainPts;
    let levels = Math.floor(f.meterPts / RULES.METER_PER_LEVEL);
    f.meterPts -= levels * RULES.METER_PER_LEVEL;
    if (sd.m.cat === 'hustle' && sd.def === null) levels += 2;   // uncontested Hustle
    if (sd.m.cat === 'burst') f.burst = 0;
    f.meter = Math.max(0, Math.min(RULES.MAX_METER, f.meter - sd.spent + levels));
  }
  separateFighters(s.fighters);

  // A trade resets both fighters to neutral: neither earned the pressure.
  const traded = sides[0].def === 'cut' && sides[1].def === 'cut';
  for (const sd of sides) {
    const other = sides[1 - sd.i];
    sd.f.state = (sd.def === 'cut' && !traded)
      ? (other.m.knockdown ? 'down' : 'stunned')
      : 'neutral';
    sd.f.combo = (sd.atk === 'hit' && !traded) ? startCombo[sd.i] + 1 : 0;
  }

  // Sadness, borrowed from the source game: refusing to engage costs you health. It is
  // tracked per fighter rather than globally, so the one running away is the one who
  // bleeds — otherwise two passive fighters just tie on health and the round is a draw.
  const anyDamage = sides.some((sd) => sd.dmgDealt > 0);
  s.stall = anyDamage ? 0 : s.stall + 1;
  const gapBefore = Math.abs(state.fighters[0].x - state.fighters[1].x);
  const gapAfter = Math.abs(s.fighters[0].x - s.fighters[1].x);
  const closing = gapAfter < gapBefore - 5;
  const stallDmg = [0, 0];
  for (const sd of sides) {
    const f = sd.f;
    const engaged = anyDamage || (closing && sd.m.dash?.toward === true);
    f.sad = engaged ? Math.max(0, f.sad - 2) : f.sad + 1;
    if (f.sad > RULES.STALL_GRACE) {
      stallDmg[sd.i] = Math.min(8, (f.sad - RULES.STALL_GRACE) * 2);
      f.hp = Math.max(0, f.hp - stallDmg[sd.i]);
    }
  }

  s.turn += 1;
  // `over` is an object, never a bare index — fighter 0 winning must not read as falsy.
  const down = [s.fighters[0].hp <= 0, s.fighters[1].hp <= 0];
  if (down[0] || down[1]) {
    s.over = { winner: down[0] && down[1] ? null : (down[0] ? 1 : 0), by: 'ko' };
  } else if (s.turn > RULES.TURN_LIMIT) {
    // Time over. Health decides it, so refusing to engage is a losing plan on its own.
    const [a, b] = s.fighters.map((f) => f.hp);
    s.over = { winner: a === b ? null : (a > b ? 0 : 1), by: 'time' };
  }

  const summary = sides.map((sd, i) => ({
    move: sd.m,
    outcome: sd.atk ?? 'idle',
    defence: sd.def,
    dmgDealt: sd.dmgDealt,
    dmgTaken: sides[1 - i].dmgDealt,
    adv: adv[i],
    contactAt: sd.contactAt,
  }));

  return { state: s, timeline, events, summary, adv, actionable, total, traded, stallDmg };
}

function phaseOf(sd, f) {
  if (sd.cutAt !== null && f >= sd.cutAt) return sd.atk === 'parried' ? 'parried' : 'stun';
  const m = sd.m;
  if (m.cat === 'guard') return sd.def === 'guarded' && f >= (sd.contactAt ?? 1e9) ? 'blockstun' : 'guard';
  if (m.cat === 'parry') return within(f, [m.parry.from, m.parry.to]) ? 'parryWindow' : 'parryRecover';
  if (m.cat === 'dodge' || m.cat === 'wake' || m.cat === 'di') {
    return within(f, m.invuln) ? 'invuln' : 'move';
  }
  if (m.cat === 'move') return 'move';
  if (m.cat === 'hustle') return 'hustle';
  if (within(f, m.armour) && f < m.startup) return 'armour';
  if (f < m.startup) return 'startup';
  if (f < m.startup + m.active) return 'active';
  return 'recovery';
}

function scaleDamage(raw, defender, comboCount) {
  let d = raw * Math.max(RULES.COMBO_FLOOR, 1 - RULES.COMBO_DECAY * comboCount);
  if (defender.hp / RULES.MAX_HP < RULES.GUTS_THRESHOLD) d *= RULES.GUTS_SCALE;
  return Math.max(1, Math.round(d));
}

function separate(sides) {
  const [a, b] = sides;
  const d = b.x - a.x;
  if (Math.abs(d) >= RULES.MIN_SEPARATION) return;
  const push = (RULES.MIN_SEPARATION - Math.abs(d)) / 2;
  const sgn = d === 0 ? 1 : Math.sign(d);
  a.x = clampX(a.x - sgn * push);
  b.x = clampX(b.x + sgn * push);
}

function separateFighters(fs) {
  const d = fs[1].x - fs[0].x;
  if (Math.abs(d) >= RULES.MIN_SEPARATION) return;
  const push = (RULES.MIN_SEPARATION - Math.abs(d)) / 2;
  const sgn = d === 0 ? 1 : Math.sign(d);
  fs[0].x = clampX(fs[0].x - sgn * push);
  fs[1].x = clampX(fs[1].x + sgn * push);
}

/* ----------------------------------------------------------- threat board */

/** How good was this exchange for fighter `i`? Higher is better. */
export function scoreFor(result, i) {
  const me = result.summary[i];
  const them = result.summary[1 - i];
  const myF = result.state.fighters[i];
  const theirF = result.state.fighters[1 - i];

  let v = 0;
  v += me.dmgDealt * 1.0;
  v -= them.dmgDealt * 1.15;                    // eating damage stings more than dealing it
  v += Math.max(-40, Math.min(40, me.adv)) * 0.32;
  v += (myF.meter - theirF.meter) * 1.2;
  if (theirF.state === 'down') v += 7;
  if (myF.state === 'down') v -= 7;
  if (theirF.state === 'stunned') v += 5;
  if (myF.state === 'stunned') v -= 5;
  if (result.state.over?.winner === i) v += 500;
  if (result.state.over?.winner === 1 - i) v -= 500;

  // A whiffed attack is a wasted commitment. Without this the AI is happy to throw jabs
  // into thin air forever, because at max range a whiff costs it literally nothing.
  if (me.outcome === 'whiff') v -= 1.6;

  // Being cornered is a genuine loss of options, so hold the middle.
  const wall = Math.min(myF.x - RULES.ARENA_MIN, RULES.ARENA_MAX - myF.x);
  v += Math.min(wall, 180) * 0.012;

  // A one-turn lookahead cannot see that closing the gap is what makes damage possible
  // later, so spacing gets a small explicit nudge toward the range where strikes reach.
  // Kept deliberately small: it breaks ties in neutral without ever outweighing a hit.
  const g = Math.abs(myF.x - theirF.x);
  v += Math.max(0, 1 - Math.abs(g - 100) / 200) * 3.0;
  return v;
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
  if (me.outcome === 'hit') return { key: 'win', label: `HIT · ${me.dmgDealt}` };
  if (me.defence === 'cut') return { key: 'lose', label: `EAT · ${them.dmgDealt}` };
  if (me.outcome === 'block') return { key: 'blocked', label: 'THEY GUARD' };
  if (me.defence === 'guarded') return { key: 'guard', label: 'YOU GUARD' };
  const adv = me.adv;
  if (me.outcome === 'whiff' && adv <= -8) return { key: 'minus', label: `WHIFF · ${adv}` };
  if (adv >= 8) return { key: 'plus', label: `+${adv} FREE TURN` };
  if (adv <= -8) return { key: 'minus', label: `${adv} PUNISHABLE` };
  return { key: 'neutral', label: adv === 0 ? 'EVEN' : (adv > 0 ? `+${adv}` : `${adv}`) };
}

/**
 * The headline feature. For a move *you* are considering, run every legal reply the
 * opponent has and rank them by how well they do against it. This is the real simulation
 * — not a lookup table — so if the engine changes, the board changes with it.
 */
export function threatBoard(state, myIdx, myMoveId) {
  const themIdx = 1 - myIdx;
  const rows = availableMoves(state, themIdx).map((m) => {
    const ids = [];
    ids[myIdx] = myMoveId;
    ids[themIdx] = m.id;
    const result = resolveTurn(state, ids);
    return {
      move: m,
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
    const after = r.result.state.fighters;
    return r.adv <= -8 && Math.abs(after[0].x - after[1].x) <= 220;
  }).length;
  return { rows, best: rows[0], risk: rows.length ? bad / rows.length : 0 };
}

/** Risk rating for every move you could pick — drives the dots on the buttons. */
export function riskProfile(state, myIdx) {
  const out = {};
  for (const m of availableMoves(state, myIdx)) {
    const b = threatBoard(state, myIdx, m.id);
    out[m.id] = { risk: b.risk, best: b.best, rows: b.rows };
  }
  return out;
}

/* -------------------------------------------------------------------- AI */

function payoffMatrix(state, aiIdx) {
  const humanIdx = 1 - aiIdx;
  const mine = availableMoves(state, aiIdx);
  const theirs = availableMoves(state, humanIdx);
  const M2 = mine.map((am) => theirs.map((hm) => {
    const ids = [];
    ids[aiIdx] = am.id;
    ids[humanIdx] = hm.id;
    return scoreFor(resolveTurn(state, ids), aiIdx);
  }));
  return { mine, theirs, M: M2 };
}

/**
 * Fictitious play: each side repeatedly best-responds to the running average of the
 * other's history. It converges toward a mixed equilibrium — exactly the right shape of
 * opponent for a game whose whole premise is that no single answer is ever safe.
 */
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
      if (v > bv) { bv = v; bi = r; }
    }
    rowCount[bi]++;
    let ci = 0, cv = Infinity;
    for (let c = 0; c < C; c++) {
      let v = 0;
      for (let r = 0; r < R; r++) v += M[r][c] * rowCount[r];
      if (v < cv) { cv = v; ci = c; }
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
