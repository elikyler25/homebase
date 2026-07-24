#!/usr/bin/env python3
"""PreToolUse(Bash) guard: block `git commit` if the STAGED diff adds a likely secret.

Regex-based (no gitleaks dependency). Scans only added (+) lines. Exit 2 blocks.
False positive? Commit from a plain terminal.
"""
import json, re, subprocess, sys

PATTERNS = [
    (r"AKIA[0-9A-Z]{16}", "AWS access key id"),
    (r"(?i)aws_secret_access_key\s*=\s*['\"]?[A-Za-z0-9/+]{40}", "AWS secret key"),
    (r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----", "private key"),
    (r"sk-[A-Za-z0-9]{20,}", "OpenAI-style secret key"),
    (r"AIza[0-9A-Za-z_\-]{35}", "Google/Gemini API key"),
    (r"gh[pousr]_[A-Za-z0-9]{36,}", "GitHub token"),
    (r"xox[baprs]-[0-9A-Za-z-]{10,}", "Slack token"),
    (r"(?i)(api[_-]?key|secret|passwd|password|token)\s*[:=]\s*['\"][^'\"]{8,}['\"]",
     "generic credential"),
]


def scan(diff):
    hits = []
    for line in diff.splitlines():
        if not line.startswith("+") or line.startswith("+++"):
            continue
        for pat, label in PATTERNS:
            if re.search(pat, line):
                hits.append(label)
    return sorted(set(hits))


def main():
    if "--selftest" in sys.argv:
        assert scan("+AKIA1234567890ABCDEF") == ["AWS access key id"]
        assert scan("+gkey = AIza" + "B" * 35) == ["Google/Gemini API key"]
        assert scan("+    x = compute(y)  # ordinary code") == []
        assert scan("-secret = 'hunter2000abc'") == []  # removed line, ignored
        print("secret-scan selftest ok")
        return

    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    cmd = (data.get("tool_input") or {}).get("command", "")
    if "git commit" not in cmd:
        sys.exit(0)
    try:
        diff = subprocess.run(["git", "diff", "--cached", "--no-color"],
                              cwd=data.get("cwd") or None,
                              capture_output=True, text=True, timeout=10).stdout
    except Exception:
        sys.exit(0)  # can't scan -> don't block
    hits = scan(diff)
    if hits:
        sys.stderr.write(
            "BLOCKED: staged diff looks like it contains secrets: "
            + ", ".join(hits)
            + ". Remove them (env vars / .gitignore) before committing. "
            "False positive? Commit from a plain terminal.\n")
        sys.exit(2)
    sys.exit(0)


if __name__ == "__main__":
    main()
