# homebase

A cross-project **engineering lead** for Claude Code. Run `/setup` and homebase
discovers your projects, lets you pick what to work on, then **plans → dispatches to
agents → adversarially verifies** the work to a high bar — instead of you driving every
edit by hand. It also keeps the workspace lean so your tokens aren't pulled in a hundred
directions.

## What you get

- **`/setup`** — the entry point. Curates plugins, discovers projects, and runs the
  plan/dispatch/verify loop across the ones you choose.
- **Plugin curator** — keeps a small always-on core (ponytail, memory, superpowers,
  security guidance) and disables heavy extras until a session needs them. Re-enable any on
  demand.
- **Safety net (hooks)** — secret-scan before commits, protected-path + snapshot guards
  before edits, a checkpoint reminder on stop, and an agent-readable context meter.
- **Project discovery** — reads a per-user registry (`~/.claude/homebase/projects.json`)
  and can auto-find projects you've actually worked in from your Claude transcript history.

## Install

Inside **Claude Code** (not your shell), run:

```
/plugin marketplace add elikyler25/homebase
/plugin install homebase@homebase
```

Then start with `/setup`.

## First run

The registry starts **blank** — homebase never ships anyone else's projects. On first
`/setup` it offers to auto-register the projects your account has worked in
(`discover.py --account`). Your registry lives at `~/.claude/homebase/projects.json`,
outside this plugin.

## The core plugins it keeps

- **ponytail** — a "lazy senior dev" reflex: the simplest solution that works. Reuse before
  writing, stdlib before a dependency, one line before fifty. Fires on every coding turn.
- **obsidian-second-brain** — a self-rewriting knowledge vault (decisions, people, projects,
  research), kept reconciled. It's a *skill*, always available.

## Layout

```
homebase/
  .claude-plugin/plugin.json, marketplace.json
  commands/setup.md
  skills/homebase-setup/SKILL.md + scripts/{discover,context_meter,curate_plugins}.py
  hooks/hooks.json + *.py
  reference/homebase-design.md   # full authority spec
```

MIT.
