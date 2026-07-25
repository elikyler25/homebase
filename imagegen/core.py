"""Local text-to-image generation via Hugging Face `diffusers`.

Everything in this module runs on *your* machine: model weights are downloaded
once into the Hugging Face cache, and every generation happens on your own
GPU/CPU. No prompt and no image ever leaves the box, and there is no external
content filter anywhere in the path.

The heavy imports (`torch`, `diffusers`) are deferred until you actually load a
model, so `detect_device()` / `deps_installed()` stay import-light and can run
on a machine that hasn't installed the ML stack yet (e.g. a `check` command).
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from importlib.util import find_spec
from typing import Optional

# The default is SDXL: strong quality, ~7 GB, runs on an 8 GB GPU. Override with
# IMAGEGEN_MODEL or --model. See the README for FLUX and low-VRAM alternatives.
DEFAULT_MODEL = os.environ.get(
    "IMAGEGEN_MODEL", "stabilityai/stable-diffusion-xl-base-1.0"
)

# Heavy ML deps this project needs. Kept here so `check` can report what's missing.
REQUIRED_MODULES = ("torch", "diffusers", "transformers", "PIL")


def deps_installed() -> bool:
    """True if the ML stack is importable. Uses find_spec — never imports torch."""
    return all(find_spec(m) for m in REQUIRED_MODULES)


def missing_modules() -> list[str]:
    return [m for m in REQUIRED_MODULES if find_spec(m) is None]


def detect_device() -> tuple[str, str]:
    """Return (device, dtype_name) as ('cuda'|'mps'|'cpu', 'float16'|'float32').

    Half precision on GPU (CUDA/Apple MPS), full precision on CPU where fp16 is
    slow and often unsupported. Returns a CPU default when torch is absent so the
    function is safe to call before the stack is installed.
    """
    if find_spec("torch") is None:
        return ("cpu", "float32")
    import torch

    if torch.cuda.is_available():
        return ("cuda", "float16")
    mps = getattr(torch.backends, "mps", None)
    if mps is not None and mps.is_available():
        return ("mps", "float16")
    return ("cpu", "float32")


@dataclass
class GenRequest:
    """A single generation request. Defaults are tuned for SDXL."""

    prompt: str
    negative_prompt: str = ""
    steps: int = 30
    guidance: float = 6.5
    width: int = 1024
    height: int = 1024
    num_images: int = 1
    seed: Optional[int] = None  # None => random each run


@dataclass
class GenResult:
    images: list  # list[PIL.Image.Image]
    seeds: list[int]
    model: str
    device: str
    elapsed_s: float
    request: GenRequest


# Module-level cache so the web server loads the model once and reuses it.
_PIPELINE = None
_PIPELINE_KEY: Optional[tuple[str, str]] = None


def load_pipeline(model: str = DEFAULT_MODEL, *, verbose: bool = True):
    """Load (and memoize) a text-to-image pipeline for `model`.

    Uses AutoPipelineForText2Image so the same code path handles SD 1.5, SDXL and
    FLUX — diffusers picks the right pipeline class from the model config.
    """
    global _PIPELINE, _PIPELINE_KEY
    if _PIPELINE is not None and _PIPELINE_KEY == (model, _device_key()):
        return _PIPELINE

    if not deps_installed():
        raise RuntimeError(
            "ML dependencies are not installed. Run:\n"
            "    pip install -r imagegen/requirements.txt\n"
            f"Missing: {', '.join(missing_modules())}"
        )

    import torch
    from diffusers import AutoPipelineForText2Image

    device, dtype_name = detect_device()
    dtype = torch.float16 if dtype_name == "float16" else torch.float32

    if verbose:
        print(f"[imagegen] loading {model} on {device} ({dtype_name})...", flush=True)
    t0 = time.time()

    # `variant="fp16"` grabs the half-precision weights when a repo ships them,
    # falling back to the full set otherwise.
    try:
        pipe = AutoPipelineForText2Image.from_pretrained(
            model, torch_dtype=dtype, variant="fp16", use_safetensors=True
        )
    except Exception:
        pipe = AutoPipelineForText2Image.from_pretrained(model, torch_dtype=dtype)

    pipe = pipe.to(device)

    # Memory savers — cheap safety margin on smaller GPUs, no quality cost.
    if hasattr(pipe, "enable_attention_slicing"):
        pipe.enable_attention_slicing()
    if hasattr(pipe, "enable_vae_slicing"):
        pipe.enable_vae_slicing()
    # Opt-in sequential CPU offload for very low VRAM (trades speed for headroom).
    if os.environ.get("IMAGEGEN_LOW_VRAM") == "1" and hasattr(
        pipe, "enable_sequential_cpu_offload"
    ):
        pipe.enable_sequential_cpu_offload()

    # Silence the safety checker if the pipeline bundles one — this runs entirely
    # on your hardware and you own the policy for what it produces.
    if getattr(pipe, "safety_checker", None) is not None:
        pipe.safety_checker = None

    if verbose:
        print(f"[imagegen] loaded in {time.time() - t0:.1f}s", flush=True)

    _PIPELINE = pipe
    _PIPELINE_KEY = (model, _device_key())
    return pipe


def _device_key() -> str:
    return detect_device()[0]


def generate(req: GenRequest, *, model: str = DEFAULT_MODEL, verbose: bool = True) -> GenResult:
    """Run one generation request and return the images plus reproducibility info."""
    import torch

    pipe = load_pipeline(model, verbose=verbose)
    device = _device_key()

    # Resolve a concrete seed per image so results are reproducible even when the
    # caller passed seed=None (random). torch.Generator lives on the target device.
    if req.seed is None:
        base_seed = int.from_bytes(os.urandom(4), "big")
    else:
        base_seed = int(req.seed)
    seeds = [base_seed + i for i in range(req.num_images)]
    gen_device = "cpu" if device == "mps" else device  # mps generators are flaky
    generators = [torch.Generator(device=gen_device).manual_seed(s) for s in seeds]

    t0 = time.time()
    out = pipe(
        prompt=req.prompt,
        negative_prompt=req.negative_prompt or None,
        num_inference_steps=req.steps,
        guidance_scale=req.guidance,
        width=req.width,
        height=req.height,
        num_images_per_prompt=req.num_images,
        generator=generators,
    )
    elapsed = time.time() - t0

    return GenResult(
        images=list(out.images),
        seeds=seeds,
        model=model,
        device=device,
        elapsed_s=elapsed,
        request=req,
    )


def save_image(image, path: str, *, req: GenRequest, seed: int, model: str) -> None:
    """Save a PNG with the prompt/seed/model embedded as metadata (reproducible)."""
    from PIL import PngImagePlugin

    meta = PngImagePlugin.PngInfo()
    meta.add_text("prompt", req.prompt)
    if req.negative_prompt:
        meta.add_text("negative_prompt", req.negative_prompt)
    meta.add_text("seed", str(seed))
    meta.add_text("model", model)
    meta.add_text("steps", str(req.steps))
    meta.add_text("guidance", str(req.guidance))
    meta.add_text("size", f"{req.width}x{req.height}")
    image.save(path, pnginfo=meta)


# ---------------------------------------------------------------------------
# Self-test: exercises the import-light paths that don't need the ML stack.
# ---------------------------------------------------------------------------
def _selftest() -> int:
    ok = True

    dev, dtype = detect_device()
    assert dev in ("cuda", "mps", "cpu"), dev
    assert dtype in ("float16", "float32"), dtype
    # CPU must never claim fp16.
    if dev == "cpu":
        assert dtype == "float32"
    print(f"  device detection: {dev} / {dtype}  ok")

    r = GenRequest(prompt="a red fox", num_images=3, seed=42)
    assert r.width == 1024 and r.height == 1024
    seeds = [42 + i for i in range(r.num_images)]
    assert seeds == [42, 43, 44]
    print("  request defaults + seed derivation: ok")

    missing = missing_modules()
    print(f"  deps_installed={deps_installed()} missing={missing or 'none'}  ok")

    print("core selftest: PASS" if ok else "core selftest: FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    import sys

    if "--selftest" in sys.argv:
        raise SystemExit(_selftest())
    print("This module is a library. Run imagegen.py, or pass --selftest.")
