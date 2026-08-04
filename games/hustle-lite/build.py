#!/usr/bin/env python3
"""Bundle Hustle Lite into one self-contained HTML file.

The dev entry point (index.html) loads src/*.js as ES modules, which is pleasant to work
on but cannot be handed to anyone as a single file. This inlines the CSS and concatenates
the modules in dependency order, stripping the import/export plumbing. Stdlib only.

    python3 build.py            # writes dist/hustle-lite.html (+ the standalone copy)
    python3 build.py --check    # build, then assert the output is actually self-contained

Two files come out. `hustle-lite.html` is a fragment for hosts that supply their own
document wrapper; `hustle-lite-standalone.html` adds the wrapper so it opens by
double-clicking it.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
OUT = ROOT / "dist" / "hustle-lite.html"
OUT_STANDALONE = ROOT / "dist" / "hustle-lite-standalone.html"

# Dependency order matters: concatenation puts everything in one scope, so a module must
# appear after the things it references at load time.
MODULES = ["engine.js", "render.js", "ui.js"]

IMPORT_RE = re.compile(r"^\s*import\s+[^;]*?from\s+['\"][^'\"]+['\"];\s*$", re.M | re.S)
EXPORT_LIST_RE = re.compile(r"^\s*export\s*\{[^}]*\};\s*$", re.M | re.S)
EXPORT_KW_RE = re.compile(r"^(\s*)export\s+(const|let|var|function|class|async)\b", re.M)


def strip_module_syntax(code: str) -> str:
    code = IMPORT_RE.sub("", code)
    code = EXPORT_LIST_RE.sub("", code)
    code = EXPORT_KW_RE.sub(r"\1\2", code)
    return code.strip()


def body_of(html: str) -> str:
    """Everything between <body> and </body>, minus the module bootstrap script."""
    m = re.search(r"<body[^>]*>(.*)</body>", html, re.S)
    if not m:
        raise SystemExit("index.html: no <body> found")
    body = m.group(1)
    body = re.sub(r'<script type="module">.*?</script>', "", body, flags=re.S)
    return body.strip()


def build() -> str:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (SRC / "pixelfont.css").read_text(encoding="utf-8") + "\n" + (SRC / "style.css").read_text(encoding="utf-8")
    js = "\n\n".join(strip_module_syntax((SRC / m).read_text(encoding="utf-8")) for m in MODULES)

    # No <!doctype>, <html>, <head> or <body>: the host wraps this fragment. A <title>
    # is kept because that is what names the page in the tab and the gallery.
    return (
        "<title>Hustle Lite — simultaneous-turn duelling, with the counters shown</title>\n"
        f"<style>\n{css}\n</style>\n\n"
        f"{body_of(html)}\n\n"
        f"<script>\n{js}\n\nboot();\n</script>\n"
    )


DECL_RE = re.compile(r"^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)", re.M)


def clashes() -> list[str]:
    """Top-level names declared in more than one module.

    Concatenation puts every module in one scope, so two files each declaring `stage` is a
    hard SyntaxError at load. Cheap to check here; invisible until the page is opened.
    """
    seen: dict[str, str] = {}
    dupes = []
    for mod in MODULES:
        code = strip_module_syntax((SRC / mod).read_text(encoding="utf-8"))
        # only lines with no leading indentation are top level
        for name in DECL_RE.findall(code):
            if name in seen and seen[name] != mod:
                dupes.append(f"{name!r} declared in both {seen[name]} and {mod}")
            seen.setdefault(name, mod)
    return dupes


def check(out: str) -> None:
    problems = clashes()
    if re.search(r"^\s*import\s+.*from\s", out, re.M):
        problems.append("an ES import survived the bundle")
    if re.search(r"^\s*export\s", out, re.M):
        problems.append("an ES export survived the bundle")
    for tag in ("<!doctype", "<html", "<head>", "<body"):
        if tag in out.lower():
            problems.append(f"output contains a {tag!r} tag; the host supplies that wrapper")
    for needed in ("id=\"arena\"", "id=\"rows\"", "threatBoard", "resolveTurn", "boot();"):
        if needed not in out:
            problems.append(f"missing expected content: {needed}")
    external = [m for m in re.findall(r'(?:src|href)\s*=\s*["\']([^"\']+)', out)
                if m.startswith("http") or m.startswith("//")]
    if external:
        problems.append(f"output references external hosts: {external[:3]}")
    if "Press Start 2P" in out and "data:font/woff2;base64," not in out:
        problems.append("the pixel font is referenced but not embedded")
    if problems:
        for p in problems:
            print(f"  FAIL {p}", file=sys.stderr)
        raise SystemExit(1)
    print(f"  ok   self-contained, {len(out) / 1024:.0f} KB, no external references")


def standalone(fragment: str) -> str:
    """The same page with a document wrapper, so it opens straight from the filesystem.

    The fragment leads with <title> and <style>, so closing </head> and opening <body>
    right after the stylesheet puts every tag where it belongs.
    """
    head = (
        '<!doctype html>\n<html lang="en">\n<head>\n'
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    )
    body = fragment.replace("</style>", "</style>\n</head>\n<body>", 1)
    return f"{head}{body}\n</body>\n</html>\n"


def main() -> None:
    out = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(out, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(out) / 1024:.0f} KB)")

    solo = standalone(out)
    OUT_STANDALONE.write_text(solo, encoding="utf-8")
    print(f"wrote {OUT_STANDALONE.relative_to(ROOT)} ({len(solo) / 1024:.0f} KB)")

    if "--check" in sys.argv:
        check(out)


if __name__ == "__main__":
    main()
