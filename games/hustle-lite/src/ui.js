/*
 * HUSTLE LITE — interface.
 *
 * Owns the DOM, the turn loop and the input. All fight logic lives in engine.js; this
 * file only asks it questions. The threat board and the yomi chain in particular are not
 * tables of hand-written matchups — they are the real simulation, run once per option.
 */
import {
  CHARS, CHAR_IDS, RULES, DIFFICULTY, newMatch, nextRound, resolveTurn, availableMoves,
  riskProfile, chooseAiMove, verdictFor, rng, moveDuration, moveOf, neutralSet,
  yomiChain, postMortem,
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
  rand: rng((Date.now() ^ 0x9e3779b9) >>> 0),
  log: [],
  lastResult: null,
  preTurn: null,               // state before the exchange, for the post-mortem
};

let stage, sfx;

/* --------------------------------------------------------------- helpers */

const fmtAdv = (n) => (n > 0 ? `+${n}` : `${n}`);
const pct = (n) => `${Math.round(n * 100)}%`;
const myChar = () => game.state.fighters[ME].char;
const theirChar = () => game.state.fighters[THEM].char;

function riskColour(r) {
  if (r < 0.25) return 'var(--good)';
  if (r < 0.55) return 'var(--warn)';
  return 'var(--bad)';
}
const myMoves = () => availableMoves(game.state, ME);

/** Move groups are derived from the character's own set, so every roster stays in sync. */
function groupsFor(charId, fighterState) {
  if (fighterState === 'stunned') return [{ title: 'Escape', ids: ['burst', 'diIn', 'diOut'] }];
  if (fighterState === 'down') return [{ title: 'Wake-up', ids: ['quickRise', 'rollAway', 'wakeSuper'] }];
  const strikes = Object.values(CHARS[charId].strikes).map((m) => m.id);
  return [
    { title: 'Strikes', ids: strikes },
    { title: 'Defence', ids: ['highGuard', 'lowGuard', 'parry', 'dodge'] },
    { title: 'Footsies & Meter', ids: ['closeIn', 'backOff', 'hustle', CHARS[charId].superMove.id] },
  ];
}

/* ------------------------------------------------------------------ HUD */

function renderHud() {
  const [me, them] = game.state.fighters;
  for (const [side, f] of [['#p0', me], ['#p1', them]]) {
    const root = $(side);
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
    for (let i = 0; i < RULES.ROUNDS_TO_WIN; i++) {
      rounds.append(el('span', `rd${i < game.state.wins[side === '#p0' ? 0 : 1] ? ' won' : ''}`));
    }
  }
  const left = Math.max(0, RULES.TURN_LIMIT - game.state.turn + 1);
  $('#clock .t').textContent = left;
  $('#clock .l').textContent = `round ${game.state.round} · turns left`;
  $('#clock').classList.toggle('low', left <= 10);
}

/* ------------------------------------------------------------- move grid */

function renderMoves() {
  const host = $('#moves');
  host.textContent = '';
  const avail = new Map(myMoves().map((m) => [m.id, m]));

  for (const grp of groupsFor(myChar(), game.state.fighters[ME].state)) {
    const box = el('div', 'movegroup');
    box.append(el('h3', null, grp.title));
    const grid = el('div', 'grid');
    for (const id of grp.ids) {
      const m = moveOf(myChar(), id);
      if (!m) continue;
      const b = el('button', 'mv');
      b.type = 'button';
      b.disabled = !avail.has(id) || game.phase !== 'choosing';
      b.setAttribute('aria-pressed', String(game.picked === id));
      b.dataset.id = id;

      const n = el('div', 'n');
      n.append(el('span', null, m.name));
      n.append(el('span', 'k', m.key.toUpperCase()));
      b.append(n);
      b.append(el('div', 'd', frameLine(m)));

      const risk = el('div', 'risk');
      const fill = el('i');
      const p = game.profile?.[id];
      if (p && game.oracle !== 'off') {
        fill.style.width = pct(p.risk);
        fill.style.background = riskColour(p.risk);
        b.title = `${m.blurb}\nRisk ${pct(p.risk)} — best answer: ${p.best.move.name}`;
      } else {
        fill.style.width = '0%';
        b.title = m.blurb;
      }
      risk.append(fill);
      b.append(risk);

      b.addEventListener('mouseenter', () => setHover(id));
      b.addEventListener('focus', () => setHover(id));
      b.addEventListener('mouseleave', () => setHover(null));
      b.addEventListener('click', () => commit(id));
      grid.append(b);
    }
    box.append(grid);
    host.append(box);
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

  const m = moveOf(myChar(), focusId);
  const p = game.profile[focusId];
  sub.innerHTML = `If you throw <b>${m.name}</b>, their options rank like this:`;

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
    nm.append(el('span', null, row.move.name));
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
    nm.append(el('span', null, link.move.name));
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
  const mine = focusId ? moveOf(myChar(), focusId) : null;
  const showThreat = game.oracle === 'full' || game.oracle === 'chain';
  const best = focusId && showThreat ? game.profile[focusId].best.move : null;
  stage.setPreview(game.state, mine, best, showThreat);
}

function refreshTurn() {
  game.picked = null;
  game.hovered = null;
  game.profile = riskProfile(game.state, ME);
  renderHud();
  renderMoves();
  renderBoard();
  paintStage();
}

function commit(id) {
  if (game.phase !== 'choosing') return;
  if (!myMoves().some((m) => m.id === id)) return;

  sfx.click();
  game.picked = id;
  game.phase = 'playing';
  game.history.push(id);
  game.preTurn = game.state;

  const theirId = chooseAiMove(game.state, THEM, game.difficulty, game.history, game.rand)
    ?? availableMoves(game.state, THEM)[0].id;

  const result = resolveTurn(game.state, [id, theirId]);
  game.lastResult = result;

  renderMoves();
  renderBoard();
  $('#scrub').max = String(result.total);
  $('#scrubwrap').hidden = false;

  stage.onFrame = (f) => {
    $('#scrub').value = String(f);
    for (const e of result.timeline[f].events) sfx.event(e.type);
  };
  stage.onEnd = () => finishTurn(result, id, theirId);
  stage.play(result, game.state);

  showBanner(`${moveOf(myChar(), id).name}  vs  ${moveOf(theirChar(), theirId).name}`);
}

function finishTurn(result, myId, theirId) {
  const v = verdictFor(result, ME);
  showBanner(`${v.label}   ·   ${fmtAdv(result.summary[ME].adv)}f`, v.key);
  renderCoach(myId, theirId);

  const bits = [`T${game.state.turn}`, moveOf(myChar(), myId).name, 'vs',
    moveOf(theirChar(), theirId).name, '→', v.label];
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
  const them = moveOf(theirChar(), theirId).name;

  if (pm.wasBest) {
    box.className = 'coach good';
    box.append(el('b', null, 'Best answer available. '));
    box.append(document.createTextNode(`They played ${them} and nothing beat it harder than ${pm.played.move.name}.`));
    return;
  }
  box.className = 'coach';
  box.append(el('b', null, `They played ${them}. `));
  box.append(document.createTextNode(
    `${pm.best.move.name} was the answer — ${pm.best.verdict.label.toLowerCase()}, `
    + `you end ${fmtAdv(pm.best.adv)}f. Yours ranked ${pm.rank} of ${pm.total}.`,
  ));
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
  ov.querySelector('h2').textContent = won ? 'YOU WIN' : 'YOU LOSE';
  ov.querySelector('h2').style.color = won ? 'var(--you)' : 'var(--them)';
  ov.querySelector('p').textContent =
    `Match over, ${game.state.wins[0]}–${game.state.wins[1]}. ${o.by === 'time' ? 'Took the last round on time.' : 'Closed it with a knockout.'}`;
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
  const host = $('#roster');
  host.textContent = '';
  for (const id of CHAR_IDS) {
    const c = CHARS[id];
    const card = el('button', `card${game.chars[ME] === id ? ' picked' : ''}`);
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
      game.chars[ME] = id;
      host.querySelectorAll('.card').forEach((n) => n.classList.toggle('picked', n.dataset.id === id));
    });
    host.append(card);
  }
  if (!dlg.open) dlg.showModal();
}

function startMatch() {
  $('#select').close();
  const rivalPick = $('#rival').value;
  game.chars[THEM] = rivalPick === 'random'
    ? CHAR_IDS[Math.floor(game.rand() * CHAR_IDS.length)]
    : rivalPick;
  game.state = newMatch(game.chars[ME], game.chars[THEM]);
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
  $('#replay').addEventListener('click', () => {
    if (game.lastResult) { stage.play(game.lastResult); stage.onEnd = () => {}; }
  });
  $('#scrub').addEventListener('input', (e) => stage.seek(Number(e.target.value)));

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'SELECT' || $('#help').open) return;
    if (e.key === '?') { $('#help').showModal(); return; }
    if ($('#select').open) { if (e.key === 'Enter') startMatch(); return; }
    if (e.key === 'Enter' && (game.phase === 'over' || game.phase === 'roundover')) { advance(); return; }
    if (game.phase !== 'choosing') return;
    const hit = myMoves().find((m) => m.key === e.key.toLowerCase());
    if (hit) { e.preventDefault(); commit(hit.id); }
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
