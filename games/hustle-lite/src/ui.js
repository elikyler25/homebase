/*
 * HUSTLE LITE — interface.
 *
 * Owns the DOM, the turn loop and the input. All fight logic lives in engine.js; this
 * file only asks it questions. The threat board in particular is not a table of hand-
 * written matchups — it is `threatBoard()` running the real simulation once per option.
 */
import {
  MOVES, RULES, DIFFICULTY, newMatch, resolveTurn, availableMoves,
  riskProfile, chooseAiMove, verdictFor, rng, moveDuration,
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

const GROUPS = [
  { title: 'Strikes', ids: ['jab', 'sweep', 'overhead', 'lunge', 'grab'] },
  { title: 'Defence', ids: ['highGuard', 'lowGuard', 'parry', 'dodge'] },
  { title: 'Footsies & Meter', ids: ['closeIn', 'backOff', 'hustle', 'super'] },
  { title: 'Escape', ids: ['burst', 'diIn', 'diOut'] },
  { title: 'Wake-up', ids: ['quickRise', 'rollAway', 'wakeSuper'] },
];

const game = {
  state: newMatch(),
  phase: 'choosing',           // 'choosing' | 'playing' | 'over'
  hovered: null,
  picked: null,
  profile: null,               // riskProfile for the current state
  history: [],                 // what the player has been doing, for the AI's read
  difficulty: 'fighter',
  oracle: 'full',              // 'full' | 'risk' | 'off'
  rand: rng((Date.now() ^ 0x9e3779b9) >>> 0),
  log: [],
  lastResult: null,
};

let stage, sfx;

/* --------------------------------------------------------------- helpers */

const fmtAdv = (n) => (n > 0 ? `+${n}` : `${n}`);
const pct = (n) => `${Math.round(n * 100)}%`;

function riskColour(r) {
  if (r < 0.25) return 'var(--good)';
  if (r < 0.55) return 'var(--warn)';
  return 'var(--bad)';
}

/** Everything the player can currently choose, in display order. */
function myMoves() { return availableMoves(game.state, ME); }

/* ------------------------------------------------------------------ HUD */

function renderHud() {
  const [me, them] = game.state.fighters;
  for (const [side, f] of [['#p0', me], ['#p1', them]]) {
    const root = $(side);
    root.querySelector('.hp i').style.width = `${(f.hp / RULES.MAX_HP) * 100}%`;
    root.querySelector('.hpv').textContent = Math.max(0, Math.round(f.hp));
    const pips = root.querySelectorAll('.pip');
    pips.forEach((p, i) => p.classList.toggle('on', i < f.meter));
    const b = root.querySelector('.burst');
    b.querySelector('i').style.width = `${(f.burst / RULES.BURST_FULL) * 100}%`;
    b.classList.toggle('ready', f.burst >= RULES.BURST_FULL);
    const st = root.querySelector('.st');
    st.textContent = f.state === 'down' ? 'DOWN' : f.state === 'stunned' ? 'STUNNED'
      : f.sad > RULES.STALL_GRACE ? 'SADNESS' : '';
  }
  const left = Math.max(0, RULES.TURN_LIMIT - game.state.turn + 1);
  $('#clock .t').textContent = left;
  $('#clock').classList.toggle('low', left <= 10);
}

/* ------------------------------------------------------------- move grid */

function renderMoves() {
  const host = $('#moves');
  host.textContent = '';
  const avail = new Map(myMoves().map((m) => [m.id, m]));
  const st = game.state.fighters[ME].state;
  // Stunned and knocked-down fighters get their own small menus, exactly as the engine
  // allows — the grid never shows a move you are not actually permitted to pick.
  const shown = st === 'down' ? [GROUPS[4]] : st === 'stunned' ? [GROUPS[3]] : GROUPS.slice(0, 3);

  for (const grp of shown) {
    const ids = grp.ids.filter((id) => MOVES[id]);
    if (!ids.length) continue;
    const box = el('div', 'movegroup');
    box.append(el('h3', null, grp.title));
    const grid = el('div', 'grid');
    for (const id of ids) {
      const m = MOVES[id];
      const usable = avail.has(id);
      const b = el('button', 'mv');
      b.type = 'button';
      b.disabled = !usable || game.phase !== 'choosing';
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
  if (m.dmg) bits.push(`${m.startup}f · ${m.dmg} dmg · ${m.range}r`);
  else bits.push(`${moveDuration(m)}f`);
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

  if (game.oracle === 'off') {
    sub.textContent = 'Oracle is off — you are reading them blind.';
    $('#riskwrap').hidden = true;
    rowsHost.append(el('div', 'empty', 'Turn the Oracle back on from the header to see their answers.'));
    return;
  }
  if (game.phase !== 'choosing') {
    sub.textContent = 'Resolving…';
    $('#riskwrap').hidden = true;
    rowsHost.append(el('div', 'empty', 'Watching the exchange play out.'));
    return;
  }
  if (!focusId) {
    sub.textContent = 'Hover a move to see how they can answer it.';
    $('#riskwrap').hidden = true;
    rowsHost.append(el('div', 'empty', 'Every option they hold, ranked by how well it does against yours.'));
    return;
  }

  const m = MOVES[focusId];
  const p = game.profile[focusId];
  sub.innerHTML = `If you throw <b>${m.name}</b>, their options rank like this:`;

  const wrap = $('#riskwrap');
  wrap.hidden = false;
  $('#riskval').textContent = `${pct(p.risk)} of their answers beat it`;
  const bar = $('#riskfill');
  bar.style.width = pct(Math.max(0.03, p.risk));
  bar.style.background = riskColour(p.risk);

  if (game.oracle === 'risk') {
    rowsHost.append(el('div', 'empty', 'Risk-only mode: you get the temperature, not the list.'));
    return;
  }

  p.rows.forEach((row, i) => {
    const r = el('div', `row${i === 0 ? ' best' : ''}`);
    const nm = el('div', 'nm');
    nm.append(el('span', null, row.move.name));
    if (i === 0) nm.append(el('span', 'crown', 'BEST ANSWER'));
    r.append(nm);

    const v = el('span', `vd ${row.verdict.key}`, row.verdict.label);
    r.append(v);

    const parts = [];
    if (row.dmgTaken) parts.push(`you take ${row.dmgTaken}`);
    if (row.dmgDealt) parts.push(`you deal ${row.dmgDealt}`);
    parts.push(`you end ${fmtAdv(row.adv)}f`);
    r.append(el('div', 'meta', parts.join('  ·  ')));

    r.addEventListener('mouseenter', () => previewCounter(focusId, row));
    rowsHost.append(r);
  });
}

/* ------------------------------------------------------------ turn loop */

function setHover(id) {
  if (game.phase !== 'choosing') return;
  game.hovered = id;
  renderBoard();
  paintStage();
}

function previewCounter(myId, row) {
  // Draw their best answer's reach next to yours, so the spacing read is visual too.
  stage.setPreview(game.state, MOVES[myId], row.move, game.oracle !== 'off');
}

function paintStage() {
  if (game.phase !== 'choosing') return;
  const focusId = game.hovered || game.picked;
  const mine = focusId ? MOVES[focusId] : null;
  const best = focusId && game.oracle === 'full' ? game.profile[focusId].best.move : null;
  stage.setPreview(game.state, mine, best, game.oracle === 'full');
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
  const legal = myMoves().some((m) => m.id === id);
  if (!legal) return;

  sfx.click();
  game.picked = id;
  game.phase = 'playing';
  game.history.push(id);

  const theirId = chooseAiMove(game.state, THEM, game.difficulty, game.history, game.rand)
    ?? availableMoves(game.state, THEM)[0].id;

  const ids = [];
  ids[ME] = id; ids[THEM] = theirId;
  const result = resolveTurn(game.state, ids);
  game.lastResult = result;

  renderMoves();
  renderBoard();
  $('#scrub').max = String(result.total);
  $('#scrubwrap').hidden = false;

  stage.onFrame = (f) => {
    $('#scrub').value = String(f);
    const tl = result.timeline[f];
    for (const e of tl.events) sfx.event(e.type);
  };
  stage.onEnd = () => finishTurn(result, id, theirId);
  stage.play(result);

  showBanner(`${MOVES[id].name}  vs  ${MOVES[theirId].name}`);
}

function finishTurn(result, myId, theirId) {
  const v = verdictFor(result, ME);
  const mine = result.summary[ME];
  showBanner(`${v.label}   ·   ${fmtAdv(mine.adv)}f`, v.key);

  const bits = [`T${game.state.turn}`, MOVES[myId].name, 'vs', MOVES[theirId].name, '→', v.label];
  if (result.stallDmg?.some?.((d) => d > 0)) bits.push(`(sadness ${result.stallDmg.join('/')})`);
  game.log.unshift(bits.join(' '));
  game.log.length = Math.min(game.log.length, 30);
  $('#log').textContent = '';
  for (const line of game.log.slice(0, 6)) $('#log').append(el('div', null, line));

  game.state = result.state;
  renderHud();

  if (game.state.over) {
    game.phase = 'over';
    endMatch();
    return;
  }
  game.phase = 'choosing';
  refreshTurn();
}

function showBanner(text, key) {
  const b = $('#banner');
  b.firstElementChild.textContent = text;
  b.firstElementChild.className = key ? `vd ${key}` : '';
  b.classList.add('show');
  clearTimeout(showBanner.t);
  showBanner.t = setTimeout(() => b.classList.remove('show'), 2600);
}

function endMatch() {
  const o = game.state.over;
  const ov = $('#overlay');
  ov.hidden = false;
  const won = o.winner === ME;
  ov.querySelector('h2').textContent = o.winner === null ? 'DRAW' : won ? 'YOU WIN' : 'YOU LOSE';
  ov.querySelector('h2').style.color = o.winner === null ? 'var(--warn)' : won ? 'var(--you)' : 'var(--them)';
  const hp = game.state.fighters.map((f) => Math.max(0, Math.round(f.hp)));
  ov.querySelector('p').textContent = o.by === 'time'
    ? `Time over on turn ${game.state.turn - 1}. Health decided it, ${hp[0]} to ${hp[1]}.`
    : `Knockout on turn ${game.state.turn - 1}. ${hp[0]} health to ${hp[1]}.`;
  renderMoves();
}

function restart() {
  game.state = newMatch();
  game.phase = 'choosing';
  game.history = [];
  game.log = [];
  game.lastResult = null;
  $('#overlay').hidden = true;
  $('#scrubwrap').hidden = true;
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
  $('#restart').addEventListener('click', restart);
  $('#playagain').addEventListener('click', restart);
  $('#helpbtn').addEventListener('click', () => $('#help').showModal());
  $('#helpclose').addEventListener('click', () => $('#help').close());
  $('#replay').addEventListener('click', () => {
    if (game.lastResult) { stage.play(game.lastResult); stage.onEnd = () => {}; }
  });
  $('#scrub').addEventListener('input', (e) => stage.seek(Number(e.target.value)));

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'SELECT' || $('#help').open) return;
    if (e.key === '?') { $('#help').showModal(); return; }
    if (e.key === 'Enter' && game.phase === 'over') { restart(); return; }
    if (game.phase !== 'choosing') return;
    const k = e.key.toLowerCase();
    const hit = myMoves().find((m) => m.key === k);
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

  refreshTurn();
}
