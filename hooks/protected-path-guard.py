#!/usr/bin/env python3
"""PreToolUse(Write|Edit) guard: block edits to protected paths. Exit 2 blocks."""
import json, re, sys

BLOCK = [
    (r"/acr_refs/", "Camera-Raw ground-truth references (acr_refs/) are read-only"),
    (r"/\.env(\.|$)", ".env files hold secrets"),
    (r"\.pem$", "PEM key file"),
    (r"/(id_rsa|id_ed25519)$", "SSH private key"),
    (r"/\.git/", "internal git metadata"),
]


def blocked(fp):
    for pat, why in BLOCK:
        if re.search(pat, fp):
            return why
    return None


def main():
    if "--selftest" in sys.argv:
        assert blocked("/x/acr_refs/ref01.tif")
        assert blocked("/proj/.env")
        assert blocked("/home/u/.ssh/id_rsa")
        assert blocked("/x/pipeline/develop.py") is None
        print("protected-path-guard selftest ok")
        return
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    fp = (data.get("tool_input") or {}).get("file_path", "")
    why = blocked(fp)
    if why:
        sys.stderr.write(f"BLOCKED: {fp}\n{why}. Ask Elias if this really needs to change.\n")
        sys.exit(2)
    sys.exit(0)


if __name__ == "__main__":
    main()
