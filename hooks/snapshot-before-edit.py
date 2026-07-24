#!/usr/bin/env python3
"""PreToolUse(Write|Edit): snapshot a file before edit IF it is not under git.

Git repos already have undo; bundles like DESLOT / PIPS-EVERYTHING do not, so this
is their only safety net. Best-effort, never blocks (always exit 0).
"""
import json, os, shutil, subprocess, sys, time


def in_git_repo(path):
    d = os.path.dirname(os.path.abspath(path)) or "."
    try:
        r = subprocess.run(["git", "-C", d, "rev-parse", "--is-inside-work-tree"],
                           capture_output=True, text=True, timeout=5)
        return r.returncode == 0 and r.stdout.strip() == "true"
    except Exception:
        return False


def main():
    if "--selftest" in sys.argv:
        # /tmp is not a git repo; $HOME/.claude likely isn't either. Just prove the
        # branch runs without raising and returns a bool.
        assert isinstance(in_git_repo("/tmp/nope.txt"), bool)
        print("snapshot-before-edit selftest ok")
        return
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    fp = (data.get("tool_input") or {}).get("file_path")
    if not fp or not os.path.isfile(fp) or in_git_repo(fp):
        sys.exit(0)  # new file, or git already protects it
    try:
        snapdir = os.path.join(os.path.dirname(fp), ".snapshots")
        os.makedirs(snapdir, exist_ok=True)
        ts = time.strftime("%Y%m%d-%H%M%S")
        shutil.copy2(fp, os.path.join(snapdir, f"{os.path.basename(fp)}.{ts}.bak"))
    except Exception:
        pass  # never break the edit over a snapshot
    sys.exit(0)


if __name__ == "__main__":
    main()
