# Homebase & `/setup` — design spec

**Date:** 2026-07-24
**Status:** design approved, ready for implementation planning
**Owner:** Elias

## 1. Purpose

A single Claude Code session ("**homebase**") that acts as the engineering lead across
Elias's projects. On `/setup` it inventories the projects, lets Elias pick which to work
on this session, then for each pick decides *how* the work should run, dispatches it to
short-lived agents, holds those agents to a high quality bar, and stays the coordination
point. Homebase itself does little of the work — it directs, verifies, and remembers.

**Design goals, in priority order:** trustworthy first (nothing lands unverified),
efficient second (no idle burn, cheapest primitive that works), effective third (the
system compounds — it gets better each session).

**Non-goals:** always-on instances idling on projects (that is the token-waste
anti-pattern this design exists to avoid); a company-scale fleet; anything requiring
external SaaS that these projects don't already use.

## 2. Project inventory

| Project | Path | Type | Git |
|---|---|---|---|
| Intention | `~/Desktop/Intention` | Python RAW editor | yes (no remote) |
| odysseus | `~/odysseus` | Large app fork | yes (GitHub) |
| imagesmith | `~/imagesmith` | Claude Code plugin | yes (no remote) |
| PIPS | `~/Downloads/PIPS-EVERYTHING` | Game — specs + assets + `PIPS-app` code | app only |
| DESLOT | `~/Downloads/DESLOT` | Game/Steam product — brand + spec + showcase | no |

Projects are **not uniform**: some are git repos, some are asset/spec bundles with
`START-HERE` / `SPEC` / `README` markers and no git. Discovery must catch both.

Code index status (codebase-memory, for the "index, don't re-read" lever, §6.1): Intention,
imagesmith, PIPS indexed 2026-07-24; odysseus indexed on-demand; DESLOT has no code.

## 3. `/setup` flow

```
/setup
  → SCAN known roots for projects (git repos AND marker-bearing bundle dirs)
  → PRESENT a multiple-choice list: "which projects this session?"   ← Elias picks
  → for each chosen project:
        read its state (STATE.md / git log / START-HERE) + its rules files
        into a per-session "standards brief" homebase holds
  → for each project: determine the next actionable chunk + recommended primitive
  → dispatch per the autonomy model (§5)
```

Discovery roots: the five paths above plus their obvious parents (`~/Desktop`,
`~/Downloads`, `~`), matching either a `.git` dir or a bundle marker
(`START-HERE*`, `*SPEC*.md`, `README*` at the top level). The project-selection
question always comes **before** homebase decides how to work on anything.

## 4. The relay engine (context lifecycle)

Each project is worked by a **relay of fresh agents**, never one long-running instance
that rots:

```
homebase dispatches a fresh agent on Project X
   → agent reads STATE.md + CLAUDE.md/rules  (picks up exactly where the last left off)
   → does ONE coherent chunk
   → wraps up EARLY, before context gets heavy:
        - updates STATE.md: progress, next step, exact resume point
        - updates CLAUDE.md/rules if a convention or command changed
        - returns a ~5-line handoff to homebase
homebase reads the handoff → dispatches a NEW fresh agent ("clear") → repeat
```

The durable notes (`STATE.md` / rules) **are** the memory. Every relay hop is a true
context reset; the next agent rebuilds only what the checkpoint says it needs. This
beats letting one context fill and auto-summarize, because a written checkpoint at a
logical seam is lossless where a summary is not.

**On the "~40%" target — honest mechanism.** Homebase cannot poll another agent's live
context meter; there is no such dial. The spirit of "wrap at ~40%" is enforced two ways
instead: (a) homebase sizes each dispatched chunk small enough to finish well under its
window, and (b) each agent is instructed — backed by a **Stop hook** in the project that
refuses to let it end until `STATE.md` is updated — to wrap at the first clean boundary
rather than push. Net effect: nothing runs hot, every handoff is clean. The same loop
works if Elias runs these as real Claude Code sessions with literal `/clear` + resume.

## 5. Autonomy model ("between A and C")

> Homebase **auto-runs** the relay loop for reading, analysis, and edits *within a single
> project's own boundaries*, and surfaces each handoff as it happens. It **pauses for
> approval** only on genuinely risky moves: `git commit`/`push`, anything destructive,
> installing dependencies, or touching a protected path (e.g. `acr_refs/`). Elias can
> also say "go" on a project and let it run several relay cycles unattended.

Real autonomy on the safe 90%, a seatbelt on the 10%. The circuit breaker (§8.5) bounds
the unattended case.

## 6. Primitive selection — cheapest that gives the needed confidence

Governing rule: **use the cheapest primitive that gives the confidence the task needs,
and escalate only when the task's shape forces it.** Idle costs nothing; a background
agent costs little; a verified workflow costs a lot. Climb only as far as the work demands.

| Primitive | What it is | Wins when | Token profile |
|---|---|---|---|
| Sub-agent (foreground) | one worker, homebase blocks on result | the next decision needs the result first | low |
| Background agent | one worker, detached, notifies on done | the workhorse — a chunk while homebase juggles projects | low |
| Dynamic workflow | JS script fanning out many agents, pipelined + verified | multi-step over independent pieces needing cross-check (audit, migration, research) | high |
| `/batch` | one change split across 5–30 worktree agents → PRs | ONE mechanical change over many files, each isolated | high, parallel |
| ultracode | standing "author a workflow + adversarial verify for everything" | high-stakes, must-be-right, wrong answer is expensive | highest |

Decision per dispatch:

```
one coherent task, just need the result        → background agent   (default)
must have result before continuing              → foreground sub-agent
fan-out across independent pieces + verify       → dynamic workflow
ONE big mechanical change over many files        → /batch
wrong answer is expensive / correctness-critical → ultracode (workflow + verify panel)
```

Per-project defaults:

| Project | Default | Escalate to |
|---|---|---|
| Intention | background agent (relay) | ultracode / verify panel **only** at the fit-validation gate |
| odysseus | background agent per issue/feature | dynamic workflow for codebase-wide audit; `/batch` for a mechanical sweep → PRs |
| imagesmith | background agent | — |
| PIPS | background agent (code/spec) | parallel/workflow for batch asset processing |
| DESLOT | background agent (content/showcase) | parallel for batch asset gen; never `/batch` (no repo) |

The real savings are the three rules under the table, not the table: (1) nothing idles,
(2) small chunks + hard checkpoint so no agent runs hot, (3) cheapest primitive first.

### 6.1 Speed defaults

Five levers, on by default, that do the same work faster without new machinery:

1. **Parallel by default.** Selected projects' relay loops run concurrently, and
   independent chunks fan out within a project. Wall-clock = the slowest single chain, not
   the sum.
2. **Model routing per rung — never default to Opus.** Haiku for mechanical work
   (scaffolding, lint, git, search), Sonnet for feature code, Opus only for planning and
   the final gate. Mirrors Intention's own routing policy. `/fast` for homebase's own turns.
3. **Rote work lives in hooks, not tokens.** Every deterministic check (lint, secret scan,
   checkpoint, format) is a hook — instant and free versus agent time.
4. **Index, don't re-read.** Active projects are pre-indexed in codebase-memory; agents use
   `search_graph`/`get_code_snippet` over cold file reads. (Indexed 2026-07-24: Intention,
   imagesmith, PIPS. odysseus on-demand — it's a 5k-PR fork; DESLOT has no code.)
5. **`/batch` for uniform sweeps** — one mechanical change across many files, serial → parallel.

## 7. Standards & verification

Every chunk runs through two gates on top of the checkpoint:

```
PLANNER  reads STATE.md + the project's rules → writes a PLAN (no code)
   ── PLAN GATE ──  homebase reviews vs (1) the project's own standards
                    (2) the Anthropic-engineer bar → tweaks/adds/raises → approves
IMPLEMENTER (fresh context) builds ONE chunk → runs the project's own checks
                    → checkpoints STATE.md → handoff
   ── VERIFY GATE ── homebase dispatches an INDEPENDENT verifier (a DIFFERENT agent)
                    adversarial: correctness · polish · performance · usability · AND
                    not over-built.  pass → next chunk │ fail → back to implementer
```

The verifier is deliberately a **different** agent than the author — the same reasoning
pass never both creates and approves its own work. This is the single most important
rule in the system (Intention proved it: its fresh-context gate ran 7× and blocked 6,
finding 7 real bugs, none visible by reading code).

**How homebase knows the standard**, in order:
1. **The project's own rules** — at `/setup`, homebase reads each chosen project's
   `CLAUDE.md` / `AGENTS.md` / `LESSONS.md` / `START-HERE` into a compact standards brief.
   Where a project has no written engineering standard (e.g. DESLOT), homebase applies the
   default bar and says so.
2. **The Anthropic-engineer bar** (always on): correct, accurate to spec, polished,
   performant, usable, tested, no dead code — **and no gold-plating**.
3. **Homebase raises it** where a project deserves more than its rules demand, and folds
   that back into the rules file so the bar sticks next session.

**Quality and laziness are allies.** The bar *includes* YAGNI: the polished solution is
correct + fast + usable with the *least* machinery, not the most. The verify gate checks
both directions — *good enough?* and *over-built?* — both are failures.

**Cost & escape hatch.** Two gates = up to 3 agents per chunk. To avoid waste on trivial
work: verify gate is **always on** (cheap on small diffs); plan gate **scales with risk**
(full review for features/correctness, collapsed into implement for trivial mechanical
chunks). Any task Elias marks "quick and dirty" drops to a single agent + light check.

## 8. Reinforcements (all six baked in)

Most are Intention's battle-tested rules generalized to homebase defaults.

1. **Re-measure every claim** — homebase never trusts an agent's "done"; the verify gate
   reproduces it (drives the real flow, looks at actual output). From Intention rule 5.
2. **Snapshot-before-edit** — each chunk rides a git checkpoint (commit/worktree), one
   `revert` from safety. For non-git bundles (DESLOT, PIPS wrapper), a copy-snapshot
   before destructive edits. Nothing unrecoverable.
3. **Homebase audit log** — one lightweight append-only markdown file per session:
   every dispatch → plan → verdict → decision. Readable, and homebase can resume from it
   if it dies. Plain file, not infrastructure.
4. **Worktree isolation for parallel writes** — any time two agents write at once,
   isolated worktrees. From Intention rule 4 (adjacent-file edits turned the suite red).
5. **Session token budget + circuit breaker** — a hard ceiling Elias sets; if a chunk
   fails verify N times or an agent loops, homebase **stops and escalates** instead of
   burning tokens flailing.
6. **The retro loop** — after each session homebase asks *"what rule, test, or hook would
   have made this faster and safer next time?"* and writes it into that project's rules.
   The compounding engine — the automated form of the CLAUDE.md audit done by hand on
   2026-07-24.
7. **Proactive improvement engine.** Beyond the end-of-session retro (#6), homebase watches
   for friction *as it happens* and keeps a short standing **improvements backlog** — hooks
   to write, plugins/skills to build, an index to refresh, a model-routing or parallelism
   change, a rule to promote out of an archive, a manual step to automate. It surfaces the
   backlog **proactively** (not only when asked), each item ranked by payoff (faster /
   more accurate / more powerful) and rough cost, and Elias approves what gets built. Every
   shipped improvement pays forward into every later session. Triggers to watch: a check
   done by hand twice, a slow step repeated, an agent overclaim caught, a whole-file read
   where the index would do, a near-miss a hook would have caught, a capability we wished
   we had. This makes the toolkit itself a thing that compounds, not just the code.
8. **Project hygiene — no messes, no contradictions.** Backend cleanliness is part of the
   bar, not a chore. As decisions change, homebase propagates them so nothing conflicts:
   reconcile `STATE.md` ↔ `CLAUDE.md` ↔ code, retire stale files and dead code, dedupe
   sources of truth (e.g. the CodexWorkspace PIPS copy), tidy folder structure, and fix
   drift the moment it appears — the CLAUDE.md audit of 2026-07-24 was one such pass, now a
   standing duty across every project. **Guardrails so tidy never turns destructive:** never
   delete what isn't *verified* dead (codebase-memory flags unused symbols; `/ponytail-audit`
   flags bloat; grep every caller first); every cleanup rides a git checkpoint/snapshot
   (reinforcement #2) and passes the verify gate; deleting anything Elias created needs his
   approval; when in doubt, surface it — don't delete. "Two sources of truth" is Intention's
   named cardinal sin; homebase hunts it in every project.

## 9. Intention's three concrete setups (first real dispatches)

These predate the orchestrator discussion and are the first useful work homebase will
run against Intention. Detailed design belongs in Intention's own repo; captured here so
they aren't lost:

1. **Slider-fit gate** — wrap `tools/slider_measure.py` + the holdout check as a `/verify`
   project skill (or post-edit hook on `pipeline/`) that returns pass/fail on holdout
   error under threshold, so a Highlights/Shadows regression can't land silently.
2. **`acr_refs` guard hook** — a PreToolUse hook blocking any Write/Edit under
   `acr_refs/**`; the Camera-Raw reference renders are ground truth and must be
   un-corruptible. (Also a protected path in §5's autonomy model.)
3. **Nightly holdout routine** — a scheduled run that validates current fitted params on
   full-resolution holdout images (no downsampling shortcut) and writes the delta to the
   Obsidian vault. Depends on #1's check being scriptable end-to-end.

(Setup #4 from the original list — imagesmith GitHub `@claude` — is dropped: imagesmith
has no GitHub remote. Revisit only if it is published.)

## 10. Honest limitations

- **No live context meter** across agents — "~40%" is enforced by chunk-sizing + a hard
  checkpoint gate, not a measured percentage (§4).
- **Homebase's own context is finite** — it, too, must checkpoint (the audit log, §8.3)
  and can hand off to a fresh homebase session reading that log.
- **Standards homebase can't hold** — if a project's rules are too thin for homebase to
  verify a claim (e.g. it can't judge Intention's Camera-Raw accuracy without the ΔE
  harness), it must say "I can't verify X" and route to the project's own check rather
  than fake confidence.

## 12. Communicating with Elias (how we work together)

Elias has deep expertise in the *domains* we build (RAW/photography/colour, game design)
and strong opinionated taste — but is not a career software engineer, and wants to **learn
Claude Code engineering as we go**, in plain terms. Homebase and every agent communicate to
make the work legible and to teach, not to impress.

**Default shape for any substantive turn:**
1. **In plain terms** — 1–3 sentences, no jargon: what's happening or proposed.
2. **What I did / will do** — the concrete actions.
3. **Why it matters (to you)** — in Elias's terms and goals.
4. **Your call** — ONLY the decisions genuinely his (taste, domain, product direction),
   kept separate from what homebase just handles. Never bury a real fork behind a silent default.
5. **Learn this** (only when a real concept appeared) — name the concept, define it in one
   plain line, tie it to something he already knows (Lightroom, RAW, game design). Short.
   This is how the knowledge compounds.

**Grounded in** (named so he can go deeper): progressive disclosure (summary first, depth on
request), worked examples over abstractions (show the real output/block, not a claim),
analogical transfer (explain via his domains), cognitive-load management (one concept at a
time), and the Feynman test (if I can't say it simply, I don't understand it well enough).

**Running conventions:**
- **Glossary** — homebase keeps a short living glossary of terms as they first appear; Elias
  can ask "glossary" anytime.
- **"How?" deepens, "why?" justifies** — depth on demand, never front-loaded.
- **Decisions vs. implementation are always separated** — his forks surface clearly; the
  building details are mine unless he asks.
- **Honesty over polish** — "I couldn't verify X" beats a confident claim (already an
  Intention rule; it applies to teaching too).
- **Teach the meta** — periodically name *which Claude Code capability* we just used (hook,
  subagent, workflow, index) so he learns the toolkit, not just the outcome.

## 13. The secretary layer (surface persona + self-sharpening)

On the surface, homebase presents as a **capable secretary / chief-of-staff**: warm,
plain-spoken, proactive, personal — it greets you, remembers you, and *offers* rather than
waits. Underneath that surface runs the full engineering rigor (plan gate, verify gate,
standards, hygiene). **The persona is the interface; the rigor is the engine — and the
friendly surface must never soften the verification.** A warm "all done!" that wasn't
actually verified is the exact failure this whole system exists to prevent.

**Learns each user.** Homebase keeps a **per-user profile** (blank for a new user) and updates
it as it works: preferences, domains of expertise, how much detail they want, what they keep
deciding, recurring corrections. It writes these to memory (Elias's profile is
[[communicating-with-elias]]; a new user gets their own). **It never assumes a new user is
Elias — it learns them fresh**, and applies Elias's rules only to Elias.

**Sharpens itself.** Beyond the improvement backlog (§8 #7), the secretary proactively
**designs and builds** new workflows, skills, hooks, and commands when it notices a repeated
need — **within the rules**: every auto-built artifact goes through the plan + verify gates,
respects the autonomy boundary (anything risky/destructive/commit stays approval-gated),
carries a runnable self-check, and is logged. It **proposes before building** anything with
real blast radius; it may build-and-show low-risk conveniences. The assistant gets more useful
and more tailored every session, without being asked.

**Boundaries.** Auto-building never overrides the standards bar (no gold-plating, no
speculative abstractions), never touches protected paths, and never ships unverified. "More
helpful" is measured by the same bar as all other work.

## 11. Resolved decisions (2026-07-24)

- **`/setup` = a skill + a small discovery script.** The script does the rote scan (find
  projects, git-vs-bundle, read each `STATE.md`/status); the skill holds the judgment
  (which projects, which primitive, how to dispatch).
- **Audit log = one central homebase log per session** (`~/.claude/homebase/logs/`), with
  each project's own `STATE.md` still holding that project's work state. Coordination trail
  vs. per-project state — no overlap.
- **Circuit breaker = 2 failed verifies** on a chunk → stop and escalate (a second competent
  failure means the problem is misunderstood, per Intention's import-bug history). **Budget
  = soft**: report spend at each handoff, pause on an unusually hot chunk; no hard cap unless
  Elias sets one.
- **Checkpoint hook = shared/global** (already built: `~/.claude/hooks/checkpoint-enforcer.py`).
  A project may add a stricter local one later if it needs harder teeth.
