/*
 * HUSTLE LITE — interface.
 *
 * Owns the DOM, the turn loop and the input. All fight logic lives in engine.js; this
 * file only asks it questions. The threat board and the yomi chain in particular are not
 * tables of hand-written matchups — they are the real simulation, run once per option.
 */
import {
  CHARS, CHAR_IDS, RULES, DIFFICULTY, newMatch, newSquadMatch, nextRound, resolve,
  availableMoves, optionsFor, riskProfile, chooseAiMove, verdictFor, rng, moveDuration,
  moveOf, neutralSet, yomiChain, postMortem, isSquad, pointOf, benchOf, teamAlive,
  encodeChoice, decodeChoice, choiceLabel,
} from './engine.js';
import { Stage, Sfx } from './render.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};

const ME = 0, THEM = 1;

const game = {
  state: null,
  phase: 'select',             // 'select' | 'choosing' | 'playing' | 'roundover' | 'over'
  hovered: null,
  picked: null,
  profile: null,               // riskProfile for the current state
  history: [],                 // what the player has been doing, for the AI's read
  difficulty: 'fighter',
  oracle: 'full',              // 'full' | 'chain' | 'risk' | 'off'
  chars: ['duelist', 'blade'],
  mode: 'solo',                // 'solo' | 'squad'
  squad: [                     // your lineup; slot 0 starts on point
    { char: 'duelist', assist: 'sweep' },
    { char: 'blade', assist: 'slice' },
    { char: 'bruiser', assist: 'hammer' },
  ],
  assistPick: null,            // teammate slot currently armed, or null
  rand: rng((Date.now() ^ 0x9e3779b9) >>> 0),
  log: [],
  lastResult: null,
  preTurn: null,               // state before the exchange, for the post-mortem
};

let stage, sfx;

/* --------------------------------------------------------------- helpers */

const fmtAdv = (n) => (n > 0 ? `+${n}` : `${n}`);
const pct = (n) => `${Math.round(n * 100)}%`;
const myChar = () => pointOf(game.state, ME).char;
const theirChar = () => pointOf(game.state, THEM).char;
const squadMode = () => isSquad(game.state);
/** The choice id for a move, folding in the teammate currently armed. */
const choiceId = (moveId) => {
  if (!squadMode() || game.assistPick == null) return moveId;
  const m = moveOf(myChar(), moveId);
  if (m?.cat === 'tag') return moveId;              // cannot swap and call at once
  return encodeChoice(moveId, game.assistPick);
};

function riskColour(r) {
  if (r < 0.25) return 'var(--good)';
  if (r < 0.55) return 'var(--warn)';
  return 'var(--bad)';
}
/** Distinct point-fighter moves available now — assists are a separate toggle. */
function myMoves() {
  if (!squadMode()) return availableMoves(game.state, ME);
  const seen = new Set();
  return optionsFor(game.state, ME)
    .filter((o) => o.assist === null && !seen.has(o.move.id) && seen.add(o.move.id))
    .map((o) => o.move);
}

/** Move groups are derived from the character's own set, so every roster stays in sync. */
function groupsFor(charId, fighterState) {
  if (fighterState === 'stunned') return [{ title: 'Escape', ids: ['burst', 'diIn', 'diOut'] }];
  if (fighterState === 'down') return [{ title: 'Wake-up', ids: ['quickRise', 'rollAway', 'wakeSuper'] }];
  const strikes = Object.values(CHARS[charId].strikes).map((m) => m.id);
  const groups = [
    { title: 'Strikes', ids: strikes },
    { title: 'Defence', ids: ['highGuard', 'lowGuard', 'parry', 'dodge'] },
    { title: 'Footsies & Meter', ids: ['closeIn', 'backOff', 'hustle', CHARS[charId].superMove.id] },
  ];
  if (squadMode()) groups.push({ title: 'Tag', ids: ['tag1', 'tag2'] });
  return groups;
}

/* ------------------------------------------------------------------ HUD */

function renderHud() {
  for (const i of [ME, THEM]) {
    const f = pointOf(game.state, i);
    const root = $(i === ME ? '#p0' : '#p1');
    renderSquadBars(root, i);
    root.querySelector('.hp i').style.width = `${(f.hp / f.maxHp) * 100}%`;
    root.querySelector('.hpv').textContent = Math.max(0, Math.round(f.hp));
    root.querySelector('.nm').textContent = CHARS[f.char].name;
    root.querySelector('.nm').style.color = CHARS[f.char].accent;
    root.querySelectorAll('.pip').forEach((p, i) => p.classList.toggle('on', i < f.meter));
    const b = root.querySelector('.burst');
    b.querySelector('i').style.width = `${(f.burst / RULES.BURST_FULL) * 100}%`;
    b.classList.toggle('ready', f.burst >= RULES.BURST_FULL);
    root.querySelector('.st').textContent = f.state === 'down' ? 'DOWN'
      : f.state === 'stunned' ? 'STUNNED'
        : f.sad > RULES.STALL_GRACE ? 'SADNESS' : '';
    const rounds = root.querySelector('.rounds');
    rounds.textContent = '';
    if (!squadMode()) {
      for (let n = 0; n < RULES.ROUNDS_TO_WIN; n++) {
        rounds.append(el('span', `rd${n < game.state.wins[i] ? ' won' : ''}`));
      }
    }
  }
  const limit = squadMode() ? RULES.SQUAD_TURN_LIMIT : RULES.TURN_LIMIT;
  const left = Math.max(0, limit - game.state.turn + 1);
  $('#clock .t').textContent = left;
  $('#clock .l').textContent = squadMode()
    ? `${teamAlive(game.state, ME)} v ${teamAlive(game.state, THEM)} · turns left`
    : `round ${game.state.round} · turns left`;
  $('#clock').classList.toggle('low', left <= 10);
}

/** Three slim bars a side in squad mode: who is on point, who is hurt, who is out. */
function renderSquadBars(root, i) {
  const host = root.querySelector('.squadbars');
  host.hidden = !squadMode();
  host.textContent = '';
  if (!squadMode()) return;
  game.state.teams[i].forEach((f, n) => {
    const row = el('div', `sq${n === game.state.point[i] ? ' point' : ''}${f.hp <= 0 ? ' out' : ''}`);
    const name = el('span', 'sqn', CHARS[f.char].name);
    name.style.color = CHARS[f.char].accent;
    const bar = el('span', 'sqb');
    const fill = el('i');
    fill.style.width = `${Math.max(0, (f.hp / f.maxHp) * 100)}%`;
    fill.style.background = CHARS[f.char].accent;
    bar.append(fill);
    const cd = game.state.cooldown[i][n];
    const badge = el('span', 'sqc', f.hp <= 0 ? 'OUT'
      : n === game.state.point[i] ? 'PT' : (cd ? `${cd}` : '●'));
    // The right-hand side mirrors, so build it in reverse rather than flipping text
    // direction — `direction: rtl` reorders the glyphs and the labels collide.
    row.append(...(i === ME ? [name, bar, badge] : [badge, bar, name]));
    host.append(row);
  });
}

/* ------------------------------------------------------------- move grid */

function renderMoves() {
  const host = $('#moves');
  host.textContent = '';
  const avail = new Map(myMoves().map((m) => [m.id, m]));

  renderAssistBar();
  for (const grp of groupsFor(myChar(), pointOf(game.state, ME).state)) {
    const box = el('div', 'movegroup');
    box.append(el('h3', null, grp.title));
    const grid = el('div', 'grid');
    for (const id of grp.ids) {
      const m = moveOf(myChar(), id);
      if (!m) continue;
      const b = el('button', 'mv');
      b.type = 'button';
      b.disabled = !avail.has(id) || game.phase !== 'choosing';
      b.setAttribute('aria-pressed', String(game.picked === choiceId(id)));
      b.dataset.id = id;

      const n = el('div', 'n');
      n.append(el('span', null, m.name));
      n.append(el('span', 'k', m.key.toUpperCase()));
      b.append(n);
      b.append(el('div', 'd', frameLine(m)));

      const risk = el('div', 'risk');
      const fill = el('i');
      const p = game.profile?.[choiceId(id)];
      if (p && game.oracle !== 'off') {
        fill.style.width = pct(p.risk);
        fill.style.background = riskColour(p.risk);
        b.title = `${m.blurb}\nRisk ${pct(p.risk)} — best answer: ${p.best.label ?? p.best.move.name}`;
      } else {
        fill.style.width = '0%';
        b.title = m.blurb;
      }
      risk.append(fill);
      b.append(risk);

      b.addEventListener('mouseenter', () => setHover(choiceId(id)));
      b.addEventListener('focus', () => setHover(choiceId(id)));
      b.addEventListener('mouseleave', () => setHover(null));
      b.addEventListener('click', () => commit(choiceId(id)));
      grid.append(b);
    }
    box.append(grid);
    host.append(box);
  }
}

/**
 * The assist toggle. Arming a teammate here folds them into whichever move you press next,
 * which keeps the grid at thirteen buttons instead of thirty-eight while still letting you
 * order two of your three fighters in the same turn.
 */
function renderAssistBar() {
  const bar = $('#assistbar');
  bar.hidden = !squadMode();
  if (!squadMode()) return;
  bar.textContent = '';
  bar.append(el('span', 'lbl', 'Call teammate'));

  const mk = (slot, label, sub, disabled) => {
    const b = el('button', `as${game.assistPick === slot ? ' on' : ''}`);
    b.type = 'button';
    b.disabled = disabled || game.phase !== 'choosing';
    b.append(el('span', 'an', label));
    if (sub) b.append(el('span', 'ad', sub));
    b.addEventListener('click', () => {
      game.assistPick = slot;
      refreshProfile();
      renderMoves(); renderBoard(); paintStage();
    });
    return b;
  };
  bar.append(mk(null, 'Solo', 'no call', false));
  for (const { f, n } of benchOf(game.state, ME)) {
    const cd = game.state.cooldown[ME][n];
    bar.append(mk(n, CHARS[f.char].name, cd ? `${cd} turn${cd > 1 ? 's' : ''}` : moveOf(f.char, f.assist).name, cd > 0));
  }
}

function frameLine(m) {
  const bits = [];
  bits.push(m.dmg ? `${m.startup}f · ${m.dmg} dmg · ${m.range}r` : `${moveDuration(m)}f`);
  if (m.cost) bits.push(`${m.cost} meter`);
  if (m.tag) bits.push(m.tag);
  return bits.join(' · ');
}

/* ---------------------------------------------------------- threat board */

function renderBoard() {
  const rowsHost = $('#rows');
  const sub = $('#boardsub');
  const focusId = game.hovered || game.picked;
  rowsHost.textContent = '';
  $('#riskwrap').hidden = true;

  if (game.oracle === 'off') {
    sub.textContent = 'Oracle is off — you are reading them blind.';
    rowsHost.append(el('div', 'empty', 'Turn the Oracle back on from the header to see their answers.'));
    return;
  }
  if (game.phase !== 'choosing') {
    sub.textContent = 'Resolving…';
    rowsHost.append(el('div', 'empty', 'Watching the exchange play out.'));
    return;
  }
  if (!focusId) {
    sub.textContent = 'Hover a move to see how they can answer it.';
    rowsHost.append(el('div', 'empty', 'Every option they hold, ranked by how well it does against yours.'));
    return;
  }

  const p = game.profile[focusId];
  if (!p) { rowsHost.append(el('div', 'empty', 'Pick a move to see their answers.')); return; }
  const m = p.option?.move ?? moveOf(myChar(), decodeChoice(focusId).moveId);
  sub.innerHTML = `If you throw <b>${choiceLabel(game.state, ME, focusId)}</b>, their options rank like this:`;

  $('#riskwrap').hidden = false;
  $('#riskval').textContent = `${pct(p.risk)} of their answers beat it`;
  const bar = $('#riskfill');
  bar.style.width = pct(Math.max(0.03, p.risk));
  bar.style.background = riskColour(p.risk);

  if (game.oracle === 'risk') {
    rowsHost.append(el('div', 'empty', 'Risk-only mode: you get the temperature, not the list.'));
    return;
  }
  if (game.oracle === 'chain') {
    renderChain(rowsHost, focusId);
    return;
  }

  p.rows.forEach((row, i) => {
    const r = el('div', `row${i === 0 ? ' best' : ''}`);
    const nm = el('div', 'nm');
    nm.append(el('span', null, row.label ?? row.move.name));
    if (i === 0) nm.append(el('span', 'crown', 'BEST ANSWER'));
    r.append(nm);
    r.append(el('span', `vd ${row.verdict.key}`, row.verdict.label));

    const parts = [];
    if (row.dmgTaken) parts.push(`you take ${row.dmgTaken}`);
    if (row.dmgDealt) parts.push(`you deal ${row.dmgDealt}`);
    parts.push(`you end ${fmtAdv(row.adv)}f`);
    r.append(el('div', 'meta', parts.join('  ·  ')));

    r.addEventListener('mouseenter', () => stage.setPreview(game.state, m, row.move, true));
    rowsHost.append(r);
  });
}

/**
 * The yomi ladder. Layer 1 is what beats your move; layer 2 is what to play if you expect
 * them to have read you; layer 3 is their answer to that. The loop closing is the point —
 * it is where thinking one level deeper stops helping and it becomes a guess again.
 */
function renderChain(host, focusId) {
  const chain = yomiChain(game.state, ME, focusId);
  const wrap = el('div', 'chain');
  chain.forEach((link, i) => {
    const node = el('div', `link ${link.side === ME ? 'mine' : 'theirs'}${link.loops ? ' loops' : ''}`);
    node.append(el('div', 'depth', i === 0 ? 'YOU COMMIT' : `LAYER ${i}`));
    const nm = el('div', 'nm');
    nm.append(el('span', null, link.name ?? link.move.name));
    nm.style.color = CHARS[link.side === ME ? myChar() : theirChar()].accent;
    node.append(nm);
    node.append(el('div', 'who', link.side === ME ? 'your read' : 'their read'));
    if (link.verdict) node.append(el('span', `vd ${link.verdict.key}`, link.verdict.label));
    if (link.loops) node.append(el('div', 'meta', 'the read loops here — from now on it is a coin flip'));
    wrap.append(node);
    if (i < chain.length - 1) wrap.append(el('div', 'arrow', '↓'));
  });
  host.append(wrap);
}

/* ------------------------------------------------------------ turn loop */

function setHover(id) {
  if (game.phase !== 'choosing') return;
  game.hovered = id;
  renderBoard();
  paintStage();
}

function paintStage() {
  if (game.phase !== 'choosing') return;
  const focusId = game.hovered || game.picked;
  const mine = focusId ? moveOf(myChar(), decodeChoice(focusId).moveId) : null;
  const showThreat = game.oracle === 'full' || game.oracle === 'chain';
  const best = focusId && showThreat ? game.profile[focusId]?.best.move ?? null : null;
  stage.setPreview(game.state, mine, best, showThreat);
}

function refreshProfile() {
  game.profile = squadMode()
    ? riskProfile(game.state, ME, game.assistPick)
    : riskProfile(game.state, ME);
}

function refreshTurn() {
  game.picked = null;
  game.hovered = null;
  // An armed teammate who is now on cooldown (or on point) cannot be called any more.
  if (squadMode() && game.assistPick != null
    && !benchOf(game.state, ME).some(({ n }) => n === game.assistPick && game.state.cooldown[ME][n] === 0)) {
    game.assistPick = null;
  }
  refreshProfile();
  renderHud();
  renderMoves();
  renderBoard();
  paintStage();
}

function commit(id) {
  if (game.phase !== 'choosing') return;
  if (!optionsFor(game.state, ME).some((o) => o.id === id)) return;

  sfx.click();
  game.picked = id;
  game.phase = 'playing';
  game.history.push(id);
  game.preTurn = game.state;

  const theirId = chooseAiMove(game.state, THEM, game.difficulty, game.history, game.rand)
    ?? optionsFor(game.state, THEM)[0].id;

  const result = resolve(game.state, [id, theirId]);
  game.lastResult = result;

  renderMoves();
  renderBoard();
  $('#scrub').max = String(result.total);
  $('#scrubwrap').hidden = false;

  game.lastAdv = result.summary[ME].adv;
  stage.onFrame = (f) => {
    $('#scrub').value = String(f);
    $('#scrubval').textContent = `${f}f`;
    for (const e of result.timeline[f].events) sfx.event(e.type);
  };
  stage.onEnd = () => finishTurn(result, id, theirId);
  stage.play(result, game.state, result.summary[ME].adv);

  showBanner(`${choiceLabel(game.state, ME, id)}  vs  ${choiceLabel(game.state, THEM, theirId)}`);
}

function finishTurn(result, myId, theirId) {
  const v = verdictFor(result, ME);
  showBanner(`${v.label}   ·   ${fmtAdv(result.summary[ME].adv)}f`, v.key);
  renderCoach(myId, theirId);

  const bits = [`T${game.state.turn}`, choiceLabel(game.state, ME, myId), 'vs',
    choiceLabel(game.state, THEM, theirId), '→', v.label];
  if (result.stallDmg?.some((d) => d > 0)) bits.push(`(sadness ${result.stallDmg.join('/')})`);
  game.log.unshift(bits.join(' '));
  game.log.length = Math.min(game.log.length, 30);
  $('#log').textContent = '';
  for (const line of game.log.slice(0, 5)) $('#log').append(el('div', null, line));

  game.state = result.state;
  renderHud();

  if (game.state.over) { game.phase = 'over'; endMatch(); return; }
  if (game.state.roundOver) { game.phase = 'roundover'; endRound(); return; }
  game.phase = 'choosing';
  refreshTurn();
}

/**
 * The threat board teaches you before the guess. This teaches you after it: given what
 * they actually did, what was the right button?
 */
function renderCoach(myId, theirId) {
  if (game.oracle === 'off' || !game.preTurn) { $('#coach').hidden = true; return; }
  const pm = postMortem(game.preTurn, ME, myId, theirId);
  const box = $('#coach');
  box.hidden = false;
  box.textContent = '';
  const them = choiceLabel(game.preTurn, THEM, theirId);

  if (pm.wasBest) {
    box.className = 'coach good';
    box.append(el('b', null, 'Best answer available. '));
    box.append(document.createTextNode(`They played ${them} and nothing beat it harder than ${pm.played.label}.`));
    return;
  }
  box.className = 'coach';
  box.append(el('b', null, `They played ${them}. `));
  box.append(document.createTextNode(
    `${pm.best.label} was the answer — ${pm.best.verdict.label.toLowerCase()}, `
    + `you end ${fmtAdv(pm.best.adv)}f. Yours ranked ${pm.rank} of ${pm.total}.`,
  ));
}

/** Re-watch the last exchange. The result is kept alive so this works any time. */
function replay() {
  if (!game.lastResult) return;
  stage.onFrame = (f) => {
    $('#scrub').value = String(f);
    $('#scrubval').textContent = `${f}f`;
  };
  stage.onEnd = () => {};
  stage.play(game.lastResult, null, game.lastAdv);
}

function showBanner(text, key) {
  const b = $('#banner');
  b.firstElementChild.textContent = text;
  b.firstElementChild.className = key ? `vd ${key}` : '';
  b.classList.add('show');
  clearTimeout(showBanner.t);
  showBanner.t = setTimeout(() => b.classList.remove('show'), 2600);
}

/* ---------------------------------------------------------- round / match */

function endRound() {
  const r = game.state.roundOver;
  const ov = $('#overlay');
  ov.hidden = false;
  ov.querySelector('h2').textContent = r.winner === null ? 'DRAWN ROUND'
    : r.winner === ME ? 'ROUND WON' : 'ROUND LOST';
  ov.querySelector('h2').style.color = r.winner === null ? 'var(--warn)'
    : r.winner === ME ? 'var(--you)' : 'var(--them)';
  ov.querySelector('p').textContent =
    `${r.by === 'time' ? 'Time over' : 'Knockout'}. Rounds ${game.state.wins[0]}–${game.state.wins[1]}.`;
  $('#playagain').textContent = 'Next round';
  renderMoves();
}

function endMatch() {
  const o = game.state.over;
  const ov = $('#overlay');
  ov.hidden = false;
  const won = o.winner === ME;
  ov.querySelector('h2').textContent = o.winner === null ? 'DRAW' : won ? 'YOU WIN' : 'YOU LOSE';
  ov.querySelector('h2').style.color = o.winner === null ? 'var(--warn)' : won ? 'var(--you)' : 'var(--them)';
  ov.querySelector('p').textContent = squadMode()
    ? `Squad match over, ${teamAlive(game.state, ME)} fighter(s) left to ${teamAlive(game.state, THEM)}. `
      + (o.by === 'time' ? 'Decided on team health.' : 'A whole team went down.')
    : `Match over, ${game.state.wins[0]}–${game.state.wins[1]}. `
      + (o.by === 'time' ? 'Took the last round on time.' : 'Closed it with a knockout.');
  $('#playagain').textContent = 'Fight again';
  renderMoves();
}

function advance() {
  $('#overlay').hidden = true;
  if (game.phase === 'over') { openSelect(); return; }
  game.state = nextRound(game.state);
  game.phase = 'choosing';
  game.log = [];
  $('#log').textContent = '';
  $('#coach').hidden = true;
  $('#scrubwrap').hidden = true;
  refreshTurn();
}

/* ------------------------------------------------------- character select */

function openSelect() {
  game.phase = 'select';
  const dlg = $('#select');
  renderRoster();
  renderLineup();
  $('#modewrap').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === game.mode));
  $('#squadwrap').hidden = game.mode !== 'squad';
  $('#rivalwrap').hidden = game.mode === 'squad';
  if (!dlg.open) dlg.showModal();
}

function renderRoster() {
  const host = $('#roster');
  host.textContent = '';
  for (const id of CHAR_IDS) {
    const c = CHARS[id];
    const chosen = game.mode === 'squad' ? game.squad.some((s) => s.char === id) : game.chars[ME] === id;
    const card = el('button', `card${chosen ? ' picked' : ''}`);
    card.type = 'button';
    card.dataset.id = id;
    const h = el('h3', null, c.name);
    h.style.color = c.accent;
    card.append(h);
    card.append(el('p', null, c.tagline));
    const stats = el('div', 'stats');
    const fastest = Math.min(...neutralSet(id).map((m) => (moveOf(id, m).dmg ? moveOf(id, m).startup : 99)));
    const reach = Math.max(...neutralSet(id).map((m) => moveOf(id, m).range));
    const hit = Math.max(...neutralSet(id).map((m) => moveOf(id, m).dmg));
    for (const [k, val, max] of [['health', c.hp, 170], ['fastest', 16 - fastest, 14], ['reach', reach, 160], ['biggest hit', hit, 30]]) {
      const row = el('div', 'stat');
      row.append(el('span', 'k', k));
      const b = el('span', 'b');
      const f = el('i');
      f.style.width = `${Math.min(100, (val / max) * 100)}%`;
      f.style.background = c.accent;
      b.append(f);
      row.append(b);
      row.append(el('span', 'v', k === 'fastest' ? `${fastest}f` : String(val)));
      stats.append(row);
    }
    card.append(stats);
    card.addEventListener('click', () => {
      if (game.mode === 'squad') {
        // Clicking a card sets your point fighter; the rest of the lineup shuffles down.
        game.squad = [
          { char: id, assist: defaultAssist(id) },
          ...game.squad.filter((s) => s.char !== id),
        ].slice(0, 3);
        renderLineup();
      } else {
        game.chars[ME] = id;
      }
      renderRoster();
    });
    host.append(card);
  }
}

const defaultAssist = (charId) => Object.values(CHARS[charId].strikes)[1]?.id
  ?? Object.values(CHARS[charId].strikes)[0].id;

/**
 * The lineup editor. Slot 1 starts on point; the other two are your assists, and the move
 * you pick here is the one they run in and perform when you call them.
 */
function renderLineup() {
  const host = $('#lineup');
  host.textContent = '';
  game.squad.forEach((slot, n) => {
    const row = el('div', 'lrow');
    row.append(el('span', 'ln', String(n + 1)));
    const pick = el('select', 'lchar');
    for (const id of CHAR_IDS) {
      const o = el('option', null, CHARS[id].name);
      o.value = id;
      if (id === slot.char) o.selected = true;
      pick.append(o);
    }
    pick.addEventListener('change', () => {
      game.squad[n] = { char: pick.value, assist: defaultAssist(pick.value) };
      renderLineup(); renderRoster();
    });
    row.append(pick);
    row.append(el('span', 'lrole', n === 0 ? 'point' : 'assist'));

    const amove = el('select', 'lmove');
    for (const m of Object.values(CHARS[slot.char].strikes)) {
      const o = el('option', null, `${m.name} · ${m.startup}f · ${m.dmg}`);
      o.value = m.id;
      if (m.id === slot.assist) o.selected = true;
      amove.append(o);
    }
    amove.disabled = n === 0;
    amove.addEventListener('change', () => { game.squad[n].assist = amove.value; });
    row.append(amove);
    host.append(row);
  });
  const dupes = new Set(game.squad.map((s) => s.char)).size !== game.squad.length;
  $('#lineupnote').textContent = dupes
    ? 'Duplicates are allowed — two of the same fighter is a legitimate plan.'
    : 'Slot 1 starts on point. The other two are assists; their move is what they run in and do.';
}

function startMatch() {
  $('#select').close();
  const roll = () => CHAR_IDS[Math.floor(game.rand() * CHAR_IDS.length)];
  if (game.mode === 'squad') {
    const rival = [0, 1, 2].map(() => {
      const c = roll();
      return { char: c, assist: defaultAssist(c) };
    });
    game.state = newSquadMatch(game.squad.map((s) => ({ ...s })), rival);
  } else {
    const rivalPick = $('#rival').value;
    game.chars[THEM] = rivalPick === 'random' ? roll() : rivalPick;
    game.state = newMatch(game.chars[ME], game.chars[THEM]);
  }
  game.assistPick = null;
  game.phase = 'choosing';
  game.history = [];
  game.log = [];
  game.lastResult = null;
  game.preTurn = null;
  $('#overlay').hidden = true;
  $('#scrubwrap').hidden = true;
  $('#coach').hidden = true;
  $('#log').textContent = '';
  refreshTurn();
}

/* ------------------------------------------------------------------ boot */

export function boot() {
  stage = new Stage($('#arena'));
  sfx = new Sfx();

  $('#difficulty').addEventListener('change', (e) => {
    game.difficulty = e.target.value;
    $('#diffnote').textContent = DIFFICULTY[game.difficulty].note;
  });
  $('#oracle').addEventListener('change', (e) => {
    game.oracle = e.target.value;
    renderMoves(); renderBoard(); paintStage();
  });
  $('#sound').addEventListener('click', (e) => {
    sfx.on = !sfx.on;
    e.target.textContent = sfx.on ? 'Sound on' : 'Sound off';
  });
  $('#restart').addEventListener('click', openSelect);
  $('#playagain').addEventListener('click', advance);
  $('#helpbtn').addEventListener('click', () => $('#help').showModal());
  $('#helpclose').addEventListener('click', () => $('#help').close());
  $('#startfight').addEventListener('click', startMatch);
  $('#modewrap').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b) return;
    game.mode = b.dataset.mode;
    openSelect();
  });
  $('#replay').addEventListener('click', replay);
  $('#scrub').addEventListener('input', (e) => {
    stage.seek(Number(e.target.value));
    $('#scrubval').textContent = `${e.target.value}f`;
  });
  $('#boxes').addEventListener('click', (e) => {
    stage.boxes = !stage.boxes;
    e.target.classList.toggle('on', stage.boxes);
    stage.draw();
  });

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'SELECT' || $('#help').open) return;
    if (e.key === '?') { $('#help').showModal(); return; }
    if ($('#select').open) { if (e.key === 'Enter') startMatch(); return; }
    if (e.key === 'Enter' && (game.phase === 'over' || game.phase === 'roundover')) { advance(); return; }
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && stage.scrubbable) {
      e.preventDefault();
      const f = stage.frame + (e.key === 'ArrowRight' ? 1 : -1);
      stage.seek(f);
      $('#scrub').value = String(stage.frame);
      $('#scrubval').textContent = `${stage.frame}f`;
      return;
    }
    if (game.phase !== 'choosing') return;
    const k = e.key.toLowerCase();
    if (squadMode() && (k === 'c' || k === 'v' || k === 'b')) {
      e.preventDefault();
      const bench = benchOf(game.state, ME);
      const want = k === 'c' ? null : bench[k === 'v' ? 0 : 1]?.n ?? null;
      if (want === null || game.state.cooldown[ME][want] === 0) {
        game.assistPick = want;
        refreshProfile(); renderMoves(); renderBoard(); paintStage();
      }
      return;
    }
    const hit = myMoves().find((m) => m.key === k);
    if (hit) { e.preventDefault(); commit(choiceId(hit.id)); }
  });

  $('#diffnote').textContent = DIFFICULTY[game.difficulty].note;

  let last = performance.now();
  const loop = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    stage.update(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  openSelect();
}
