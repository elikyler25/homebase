#!/usr/bin/env python3
"""homebase project discovery: read the registry, enrich each project, emit JSON.

  discover.py            -> JSON of registered projects with status
  discover.py --scan     -> also list NEW project-like dirs not yet registered
"""
import glob, json, os, subprocess, sys

REG = os.path.expanduser("~/.claude/homebase/projects.json")
ROOTS = [os.path.expanduser(p) for p in ("~", "~/Desktop", "~/Downloads", "~/CodexWorkspace")]
SKIP = {"node_modules", ".venv", "venv", "Library", ".Trash", "__pycache__", ".cache", ".git"}


def is_git(path):
    return os.path.isdir(os.path.join(path, ".git"))


def has_marker(path):
    try:
        for n in os.listdir(path):
            up = n.upper()
            if up.startswith("START-HERE") or n in ("STATE.md", "CLAUDE.md") \
               or (up.startswith("SPEC") and up.endswith(".MD")) \
               or ("SPEC" in up and up.endswith(".MD")):
                return True
    except OSError:
        return False
    return False


def classify(path):
    if not os.path.isdir(path):
        return None
    if is_git(path):
        return "git"
    if has_marker(path):
        return "bundle"
    return None


def git_status(path):
    def g(*a):
        try:
            return subprocess.run(["git", "-C", path, *a],
                                  capture_output=True, text=True, timeout=5).stdout.strip()
        except Exception:
            return ""
    return {
        "branch": g("rev-parse", "--abbrev-ref", "HEAD"),
        "last_commit": g("log", "-1", "--format=%s"),
        "dirty": bool(g("status", "--porcelain")),
        "remote": g("remote", "get-url", "origin") or None,
    }


def _md_candidates(path):
    """Markdown files worth reading a title from, best first: START-HERE, README, rest."""
    try:
        names = os.listdir(path)
    except OSError:
        return []
    md = [n for n in names if n.lower().endswith(".md")]
    pref = [n for n in md if "START-HERE" in n.upper()]
    pref += [n for n in md if n.upper().startswith("README") and n not in pref]
    pref += [n for n in md if n not in pref]
    return [os.path.join(path, n) for n in pref]


def status_summary(path):
    sp = os.path.join(path, "STATE.md")
    if os.path.isfile(sp):
        try:
            with open(sp) as f:
                for line in f:
                    if line.strip().lower().startswith("**last updated"):
                        return line.replace("**", "").strip()
        except OSError:
            pass
    # bundles: first real heading from a markdown START-HERE / README, skipping HTML
    for cand in _md_candidates(path):
        try:
            with open(cand) as f:
                for line in f:
                    s = line.strip().lstrip("#").strip()
                    if s and not s.startswith("<"):
                        return s[:120]
        except OSError:
            pass
    return ""


def ensure_registry():
    """First run on a fresh install: create ~/.claude/homebase/ and a blank registry
    so scanning works and new projects have somewhere to be appended. Never overwrites."""
    d = os.path.dirname(REG)
    os.makedirs(os.path.join(d, "logs"), exist_ok=True)
    if not os.path.exists(REG):
        with open(REG, "w") as f:
            json.dump({"projects": [], "ignore": []}, f, indent=2)


def load_registry():
    try:
        return json.load(open(REG)).get("projects", [])
    except Exception:
        return []


def enrich(reg):
    out = []
    for entry in reg:
        p = entry["path"]
        t = (classify(p) or "dir") if os.path.isdir(p) else "missing"
        rec = {"name": entry["name"], "path": p, "type": t}
        if t == "git":
            rec["git"] = git_status(p)
        rec["status"] = status_summary(p)
        out.append(rec)
    return out


def scan_new(known_paths, roots=ROOTS):
    known = {os.path.realpath(p) for p in known_paths}
    roots_rp = {os.path.realpath(r) for r in roots}  # scan containers, never "projects"

    def under_known(rp):
        # a candidate inside (or equal to) a registered project is not "new"
        return any(rp == k or rp.startswith(k + os.sep) for k in known)

    found = []
    for root in roots:
        if not os.path.isdir(root):
            continue
        try:
            stack = [os.path.join(root, n) for n in os.listdir(root)
                     if n not in SKIP and not n.startswith(".")]
        except OSError:
            stack = []
        # one level deeper for wrappers (e.g. PIPS-EVERYTHING/PIPS-app)
        for p in list(stack):
            if os.path.isdir(p):
                try:
                    stack += [os.path.join(p, n) for n in os.listdir(p)
                              if n not in SKIP and not n.startswith(".")]
                except OSError:
                    pass
        for p in stack:
            rp = os.path.realpath(p)
            if not os.path.isdir(p) or under_known(rp) or rp in roots_rp:
                continue
            if classify(p):
                known.add(rp)  # so its own children are pruned too
                found.append(p)
    return found


def _project_root(path):
    """Resolve a working dir to its project root: git toplevel, else nearest marker
    ancestor, else None. Used to turn a Claude Code cwd into a real project."""
    if not os.path.isdir(path):
        return None
    try:
        r = subprocess.run(["git", "-C", path, "rev-parse", "--show-toplevel"],
                           capture_output=True, text=True, timeout=5)
        top = r.stdout.strip()
        if r.returncode == 0 and top and "/.claude/" not in top + "/":
            return top  # skip agent worktrees living under .claude/
    except Exception:
        pass
    d = path
    while d and d != "/" and not d.endswith("/.claude") and "/.claude/" not in d + "/":
        if has_marker(d):
            return d
        d = os.path.dirname(d)
    return None


def scan_account(projects_dir="~/.claude/projects"):
    """Real project roots this Claude Code account has actually worked in, read from the
    recorded cwd in each project's transcript (reliable; no lossy dir-name decoding)."""
    base = os.path.expanduser(projects_dir)
    roots = set()
    try:
        pdirs = [os.path.join(base, d) for d in os.listdir(base)]
    except OSError:
        return []
    for pd in pdirs:
        jsonls = glob.glob(os.path.join(pd, "*.jsonl")) if os.path.isdir(pd) else []
        if not jsonls:
            continue
        newest = max(jsonls, key=os.path.getmtime)
        try:
            with open(newest) as f:
                for line in f:
                    try:
                        c = json.loads(line).get("cwd")
                    except ValueError:
                        continue
                    if c:
                        root = _project_root(c)
                        if root:
                            roots.add(root)
        except OSError:
            continue
    return sorted(roots)


def load_ignore():
    try:
        return json.load(open(REG)).get("ignore", [])
    except Exception:
        return []


def main():
    ensure_registry()
    reg = load_registry()
    result = {"projects": enrich(reg)}
    known = {e["path"] for e in reg} | set(load_ignore())
    known_rp = {os.path.realpath(k) for k in known}
    if "--scan" in sys.argv:
        result["new_candidates"] = scan_new(known)
    if "--account" in sys.argv:
        roots_rp = {os.path.realpath(r) for r in ROOTS}

        def _new(p):
            rp = os.path.realpath(p)
            if rp in roots_rp or "/.claude/" in rp + "/":
                return False
            return not any(rp == k or rp.startswith(k + os.sep) for k in known_rp)

        result["account_projects"] = [p for p in scan_account() if _new(p)]
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
