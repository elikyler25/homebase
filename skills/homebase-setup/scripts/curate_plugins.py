#!/usr/bin/env python3
"""Curate which Claude Code plugins load, so tokens aren't spread across everything.

Claude Code loads every ENABLED plugin's commands/skills/agents into context each
session. With ~18 plugins installed that is a lot of surface. Homebase keeps a small
always-on CORE and disables the rest, re-enabling extras only for the session that
needs them.

  curate_plugins.py                      # report: core / extras-on / would-disable
  curate_plugins.py --apply              # set enabled = CORE (+ any already-core), disable rest
  curate_plugins.py --apply --keep a@m b@m   # CORE + these extras, for this session
  curate_plugins.py --selftest           # runnable check, touches nothing real

Writes ~/.claude/settings.json's enabledPlugins map (backs it up first).
NOTE: plugins load at session start — changes take effect on the NEXT Claude session.
obsidian-second-brain is a skills-dir skill, not a plugin, so it is ALWAYS available
and never appears here. ponytail (the always-on laziness reflex) is CORE.
"""
import json, os, shutil, sys

SETTINGS = os.path.expanduser("~/.claude/settings.json")

# Always-on: the reflexes and memory homebase itself relies on. Keep this small.
CORE = {
    "homebase@homebase",                 # this plugin (self)
    "ponytail@ponytail",                 # laziness reflex, wanted on every coding turn
    "obsidian-second-brain@obsidian-second-brain",  # knowledge vault (when installed as a plugin)
    "claude-mem@thedotmack",             # cross-session memory / observations
    "superpowers@claude-plugins-official",  # the skills engine (brainstorming, TDD, ...)
    "security-guidance@claude-plugins-official",  # cheap safety guidance
}


def load_settings():
    with open(SETTINGS) as f:
        return json.load(f)


def plan(enabled_map, keep=()):
    """Return (final_map, turned_on, turned_off) for CORE + keep."""
    want_on = set(CORE) | set(keep)
    final = {}
    turned_on, turned_off = [], []
    for pid, was_on in enabled_map.items():
        on = pid in want_on
        final[pid] = on
        if on and not was_on:
            turned_on.append(pid)
        if not on and was_on:
            turned_off.append(pid)
    # CORE/keep entries not present in the map yet (e.g. homebase just installed)
    for pid in want_on:
        if pid not in final:
            final[pid] = True
            turned_on.append(pid)
    return final, sorted(turned_on), sorted(turned_off)


def report(enabled_map, keep=()):
    final, on, off = plan(enabled_map, keep)
    core_present = sorted(p for p in enabled_map if p in CORE)
    extras_on = sorted(p for p, v in enabled_map.items() if v and p not in CORE)
    lines = ["CORE (always on):    " + (", ".join(core_present) or "(none installed)")]
    if keep:
        lines.append("KEEP (this session): " + ", ".join(sorted(keep)))
    lines.append("extras now ON:       " + (", ".join(extras_on) or "(none)"))
    lines.append("would DISABLE:       " + (", ".join(off) or "(none — already lean)"))
    return "\n".join(lines)


def apply(keep=()):
    s = load_settings()
    enabled = s.get("enabledPlugins", {})
    final, on, off = plan(enabled, keep)
    if enabled == final:
        return "Already lean — nothing to change."
    shutil.copyfile(SETTINGS, SETTINGS + ".bak")
    s["enabledPlugins"] = final
    with open(SETTINGS, "w") as f:
        json.dump(s, f, indent=2)
        f.write("\n")
    return (f"Applied. Disabled {len(off)}: {', '.join(off) or '—'}\n"
            f"Enabled {len(on)}: {', '.join(on) or '—'}\n"
            f"Backup: {SETTINGS}.bak — takes effect next Claude session.")


def selftest():
    m = {
        "ponytail@ponytail": True,
        "claude-mem@thedotmack": True,
        "impeccable@impeccable": True,
        "context7@claude-plugins-official": True,
        "ecc@ecc": False,
    }
    final, on, off = plan(m)
    assert final["ponytail@ponytail"] is True, "core stays on"
    assert final["impeccable@impeccable"] is False, "non-core disabled"
    assert final["ecc@ecc"] is False, "already-off stays off"
    assert set(off) == {"impeccable@impeccable", "context7@claude-plugins-official"}, off
    assert "homebase@homebase" in final and final["homebase@homebase"], "self added"
    # keep re-enables one extra
    final2, on2, off2 = plan(m, keep=["impeccable@impeccable"])
    assert final2["impeccable@impeccable"] is True, "keep overrides disable"
    assert "impeccable@impeccable" not in off2
    print("selftest ok")


def main():
    a = sys.argv[1:]
    if "--selftest" in a:
        return selftest()
    keep = []
    if "--keep" in a:
        keep = a[a.index("--keep") + 1:]
    if "--apply" in a:
        print(apply(keep))
    else:
        print(report(load_settings().get("enabledPlugins", {}), keep))
        print("\n(dry run — add --apply to write; --keep a@m b@m to spare extras)")


if __name__ == "__main__":
    main()
