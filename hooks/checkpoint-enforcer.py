#!/usr/bin/env python3
"""Stop / SubagentStop reminder: if code changed this session but no checkpoint/notes
file was touched, nudge to record a resume point. Reminder-level (never blocks) for
now; upgrade to exit 2 on SubagentStop to make it hard teeth for relay agents.
"""
import json, os, subprocess, sys

CODE_EXT = (".py", ".js", ".ts", ".tsx", ".jsx", ".css", ".html", ".rs", ".go",
            ".swift", ".c", ".cpp", ".h", ".java", ".rb")
NOTE_NAMES = ("STATE.md", "CLAUDE.md", "AGENTS.md", "HANDOFF.md", "README.md")


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    cwd = data.get("cwd") or os.getcwd()
    try:
        out = subprocess.run(["git", "-C", cwd, "status", "--porcelain"],
                             capture_output=True, text=True, timeout=5)
        if out.returncode != 0:
            sys.exit(0)  # not a repo -> nothing to check
        changed = [l[3:] for l in out.stdout.splitlines() if len(l) > 3]
    except Exception:
        sys.exit(0)
    code_changed = any(c.endswith(CODE_EXT) for c in changed)
    note_changed = any(os.path.basename(c) in NOTE_NAMES for c in changed)
    if code_changed and not note_changed:
        sys.stderr.write(
            "[checkpoint] Code changed but no STATE.md/CLAUDE.md/handoff update this "
            "session. Before ending, record what changed, what's next, and the exact "
            "resume point so the next agent starts clean.\n")
    sys.exit(0)


if __name__ == "__main__":
    main()
