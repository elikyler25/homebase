# CLAUDE.md — homebase

A Claude Code **plugin** that turns Claude into a cross-project engineering lead: `/setup`
discovers your projects, lets you pick, then **plans → dispatches to agents → adversarially
verifies** the work. It ships a safety net (hooks) and a plugin curator so tokens stay focused.
Read this first when working *on the plugin itself*. (End-user docs live in `README.md`.)

## Ground rules (don't violate without asking)

1. **Never ship anyone's projects.** The registry (`~/.claude/homebase/projects.json`) starts
   blank and lives *outside* this repo, per user. The plugin discovers; it never bundles a project list.
2. **No hardcoded machine paths.** Hooks and scripts must work on a stranger's laptop — resolve
   `$HOME`/`$CLAUDE_*` at runtime, use portable file markers, no `/Users/<me>/...` baked in.
3. **Safety guards fail safe.** A hook that errors must not block the user's edit or leak — it
   degrades to a no-op, never to a false "blocked" or a crash mid-commit.
4. **Curator is reversible.** Disabling a plugin to save tokens must always be re-enable-able on
   demand. Never make a change the user can't undo in one command.

## Layout

| Path | Role |
|------|------|
| `.claude-plugin/plugin.json` | plugin manifest (name, version, keywords) |
| `.claude-plugin/marketplace.json` | marketplace entry so `/plugin marketplace add` works |
| `commands/setup.md` | the `/setup` slash command → enters the homebase-setup skill |
| `skills/homebase-setup/SKILL.md` | the 8-step workflow: curate → discover → plan → dispatch → verify |
| `skills/homebase-setup/scripts/discover.py` | project discovery (registry + `--account` transcript scan) |
| `skills/homebase-setup/scripts/curate_plugins.py` | enable core plugins, disable heavy extras |
| `skills/homebase-setup/scripts/context_meter.py` | agent-readable context/occupancy meter |
| `hooks/hooks.json` + `hooks/*.py` | the safety net (see below) |
| `reference/homebase-design.md` | the full authority spec — the "why" behind the workflow |

## The hooks (safety net)

Each is a standalone Python script wired in `hooks/hooks.json`. Keep them dependency-free (stdlib
only) and fast — they run on every matching tool call.

- `secret-scan.py` — scans staged content for secrets before a commit.
- `protected-path-guard.py` — blocks edits to paths the user marked protected.
- `snapshot-before-edit.py` — snapshots a file before it's edited (undo safety).
- `checkpoint-enforcer.py` — reminds to commit/checkpoint on stop.

## Working on this repo

- **Test a script directly:** `python3 skills/homebase-setup/scripts/curate_plugins.py --selftest`
  (and `discover.py`, `context_meter.py` have their own self-checks / `--dry-run`). Run them before committing.
- **Test a hook** by running it with the JSON payload Claude Code feeds hooks on stdin; assert it
  exits 0 and prints the expected decision. A hook change with no run behind it is unshipped.
- **Two manifests, one version.** Bump `version` in *both* `.claude-plugin/plugin.json` and the
  `marketplace.json` entry together, or installs go stale.
- **Ponytail applies.** Stdlib over deps, reuse over rewrite, the shortest hook that works. This is
  infrastructure a stranger installs — every added line is a line they have to trust.
- Mark deliberate shortcuts with a `# ponytail:` comment naming the ceiling and the upgrade path.

## Conventions

- Commit only when asked; branch off the default branch first. End commit messages with the
  Co-Authored-By trailer.
- Remote: `github.com/elikyler25/homebase`. A pushed change is live for anyone who installs — treat
  `main` as published.
- Keep `README.md` (user-facing) and this file (contributor-facing) in sync when the workflow changes.

## Side build: `drawrace/`

A from-scratch web rebuild of DrawRace 2, living in this repo for now (it is not part of the
plugin and nothing in `skills/` or `hooks/` depends on it). TypeScript → a single self-contained
HTML file, no runtime network. It has its own `README.md` and its own verification story: four
harnesses, and the rule that has held throughout is **fix the harness or fix the game, never the
assertion**. If it grows further it should move to its own repository.

## Status (2026-07-24)

**Done & published:** v0.1.0 — plugin + marketplace manifests, `/setup` command, homebase-setup
skill with the 3 discovery/curation scripts, the 4 safety hooks, README with install path. Live on
GitHub; core companion marketplaces (ponytail, obsidian-second-brain) wired into `/setup`.

**Next:** real-world install shakeout (a Windows install hit a git "unsafe location" error on
`marketplace add` — needs reproducing); verify the discovery `--account` scan on a second machine;
consider a `--selftest` that exercises all four hooks end-to-end.
