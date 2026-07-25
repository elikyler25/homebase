#!/usr/bin/env python3
"""imagegen — a private, local text-to-image generator.

Runs open-weights diffusion models (SDXL / FLUX / SD 1.5) on your own hardware
via Hugging Face `diffusers`. Nothing leaves your machine; there is no external
content filter in the path.

    python3 imagegen/imagegen.py check                 # env + GPU report (no ML deps needed)
    python3 imagegen/imagegen.py generate "a red fox"  # one-shot render to a PNG
    python3 imagegen/imagegen.py serve                 # local web UI at http://127.0.0.1:8791

The `check` subcommand and `--help` run with only the standard library, so you
can sanity-check a machine before installing torch. `generate` and `serve`
import the ML stack lazily and print install instructions if it's absent.
"""
from __future__ import annotations

import argparse
import os
import sys

import core

DEFAULT_OUT = os.environ.get(
    "IMAGEGEN_OUT", os.path.join(os.path.expanduser("~"), ".imagegen", "outputs")
)


def _slug(text: str, limit: int = 40) -> str:
    keep = "".join(c if c.isalnum() or c in " -_" else "" for c in text)
    return "-".join(keep.lower().split())[:limit] or "image"


def cmd_check(_args: argparse.Namespace) -> int:
    """Report Python, dependency, and device status without importing torch heavily."""
    print(f"python:      {sys.version.split()[0]} ({sys.executable})")
    installed = core.deps_installed()
    print(f"ml deps:     {'installed' if installed else 'NOT installed'}")
    if not installed:
        print(f"  missing:   {', '.join(core.missing_modules())}")
        print("  install:   pip install -r imagegen/requirements.txt")
    device, dtype = core.detect_device()
    print(f"device:      {device} ({dtype})")
    if device == "cpu" and installed:
        print("  note:      no GPU detected — generation will be slow but works.")
    print(f"model:       {core.DEFAULT_MODEL}")
    print(f"output dir:  {DEFAULT_OUT}")
    print()
    print("ready to generate." if installed else "install deps, then run again.")
    return 0


def cmd_generate(args: argparse.Namespace) -> int:
    if not core.deps_installed():
        print(
            "ML dependencies are not installed. Run:\n"
            "    pip install -r imagegen/requirements.txt\n"
            f"Missing: {', '.join(core.missing_modules())}",
            file=sys.stderr,
        )
        return 1

    req = core.GenRequest(
        prompt=args.prompt,
        negative_prompt=args.negative or "",
        steps=args.steps,
        guidance=args.guidance,
        width=args.width,
        height=args.height,
        num_images=args.num,
        seed=args.seed,
    )
    result = core.generate(req, model=args.model)

    os.makedirs(args.out, exist_ok=True)
    stamp = str(result.seeds[0])
    saved = []
    for img, seed in zip(result.images, result.seeds):
        name = f"{_slug(req.prompt)}-{seed}.png"
        path = os.path.join(args.out, name)
        core.save_image(img, path, req=req, seed=seed, model=result.model)
        saved.append(path)

    print(
        f"generated {len(saved)} image(s) in {result.elapsed_s:.1f}s "
        f"on {result.device} — seeds {result.seeds}"
    )
    for p in saved:
        print(f"  {p}")
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    import server

    return server.run(host=args.host, port=args.port, model=args.model, out_dir=args.out)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="imagegen",
        description="Private, local text-to-image generation on your own hardware.",
    )
    sub = p.add_subparsers(dest="command")

    pc = sub.add_parser("check", help="report environment, deps, and device")
    pc.set_defaults(func=cmd_check)

    pg = sub.add_parser("generate", help="render a prompt to a PNG")
    pg.add_argument("prompt", help="text prompt")
    pg.add_argument("-n", "--negative", default="", help="negative prompt")
    pg.add_argument("--model", default=core.DEFAULT_MODEL)
    pg.add_argument("--steps", type=int, default=30)
    pg.add_argument("--guidance", type=float, default=6.5)
    pg.add_argument("--width", type=int, default=1024)
    pg.add_argument("--height", type=int, default=1024)
    pg.add_argument("--num", type=int, default=1, help="images per prompt")
    pg.add_argument("--seed", type=int, default=None, help="fixed seed (reproducible)")
    pg.add_argument("--out", default=DEFAULT_OUT, help="output directory")
    pg.set_defaults(func=cmd_generate)

    ps = sub.add_parser("serve", help="start the local web UI")
    ps.add_argument("--host", default="127.0.0.1", help="bind host (keep local!)")
    ps.add_argument("--port", type=int, default=8791)
    ps.add_argument("--model", default=core.DEFAULT_MODEL)
    ps.add_argument("--out", default=DEFAULT_OUT, help="output directory")
    ps.set_defaults(func=cmd_serve)

    return p


def main(argv: list[str]) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "func", None):
        parser.print_help()
        return 0
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
