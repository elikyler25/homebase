#!/usr/bin/env python3
"""Read this session's context occupancy from the transcript JSONL.

The statusline shows context to the human; this lets an AGENT read its own
occupancy on demand, which is what the relay engine / circuit breaker needs.

Usage:
  context_meter.py                 # newest transcript for cwd -> human line
  context_meter.py --pct           # just the used-% integer
  context_meter.py /path/x.jsonl   # explicit transcript
  echo '<hook json>' | context_meter.py --hook   # hook mode: warn to stderr past threshold

Occupancy = input + cache_creation + cache_read of the LAST assistant turn.
Limit defaults to 1,000,000 (Opus 4.8 [1m]); override CLAUDE_CONTEXT_LIMIT.
Warn threshold CLAUDE_CONTEXT_WARN_PCT (default 40).
"""
import json, os, sys, glob

LIMIT = int(os.environ.get("CLAUDE_CONTEXT_LIMIT", "1000000"))
WARN_PCT = int(os.environ.get("CLAUDE_CONTEXT_WARN_PCT", "40"))


def newest_transcript():
    base = os.path.expanduser("~/.claude/projects")
    enc = "-" + os.getcwd().strip("/").replace("/", "-")
    # prefer this project's transcripts; fall back to the newest across all projects
    for pat in (os.path.join(base, enc, "*.jsonl"), os.path.join(base, "*", "*.jsonl")):
        files = glob.glob(pat)
        if files:
            return max(files, key=os.path.getmtime)
    return None


def occupancy(path):
    """Tokens in the window as of the last assistant turn, or None on read error."""
    used = None
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    o = json.loads(line)
                except ValueError:
                    continue
                u = (o.get("message") or {}).get("usage")
                if isinstance(u, dict):
                    n = ((u.get("input_tokens") or 0)
                         + (u.get("cache_creation_input_tokens") or 0)
                         + (u.get("cache_read_input_tokens") or 0))
                    if n:
                        used = n  # last one wins = current occupancy
    except OSError:
        return None
    return used


def main():
    argv = sys.argv[1:]

    if "--selftest" in argv:
        import tempfile
        rows = [
            {"message": {"usage": {"input_tokens": 10, "cache_read_input_tokens": 20,
                                   "cache_creation_input_tokens": 5}}},
            {"message": {"usage": {"input_tokens": 100, "cache_read_input_tokens": 50000,
                                   "cache_creation_input_tokens": 300}}},
        ]
        fd, p = tempfile.mkstemp(suffix=".jsonl")
        with os.fdopen(fd, "w") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")
        assert occupancy(p) == 50400, occupancy(p)   # last turn, not the sum of turns
        os.unlink(p)
        print("context_meter selftest ok")
        return

    hook = "--hook" in argv
    pct_only = "--pct" in argv
    path = next((a for a in argv if a.endswith(".jsonl")), None)

    if hook and not path:
        try:
            path = json.load(sys.stdin).get("transcript_path")
        except Exception:
            sys.exit(0)  # never break the session over the meter
    if not path:
        path = newest_transcript()
    if not path or not os.path.exists(path):
        if not hook:
            print("ctx: no transcript found")
        sys.exit(0)

    used = occupancy(path)
    if used is None:
        sys.exit(0)
    pct = round(100 * used / LIMIT)

    if hook:
        if pct >= WARN_PCT:
            sys.stderr.write(
                f"[context] {pct}% of the window used ({used:,}/{LIMIT:,}). "
                f"Wrap up: update STATE.md/handoff and finish this chunk so the next "
                f"agent starts fresh.\n")
        sys.exit(0)
    if pct_only:
        print(pct)
        return
    print(f"context: {pct}% used  ({used:,} / {LIMIT:,} tokens)  warn at {WARN_PCT}%")


if __name__ == "__main__":
    main()
