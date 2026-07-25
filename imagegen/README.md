# imagegen — a private, local image generator

Text-to-image on **your own hardware**. It runs open-weights diffusion models
(SDXL by default; FLUX and SD 1.5 supported) through Hugging Face
[`diffusers`](https://github.com/huggingface/diffusers). Every prompt and every
image stays on your machine — there's no API key, no per-image cost, and no
external content filter anywhere in the path.

> **Not part of the homebase plugin.** This lives *alongside* homebase in the
> repo, as its own project. The plugin itself stays stdlib-only and zero-dep;
> this directory is the one place that pulls in the heavy ML stack, and only on
> the machine where you choose to run it.

## What you need

- **A GPU is strongly recommended.** NVIDIA (CUDA), AMD (ROCm), or Apple Silicon
  (MPS) all work. CPU-only works too but a single 1024×1024 image can take
  minutes instead of seconds.
- **Disk + VRAM for the model.** SDXL is ~7 GB on disk and comfortable on an 8 GB
  GPU. See [low-VRAM](#low-vram--slow-machines) below if you have less.
- **Python 3.9+.**

## Install

Install PyTorch first (its build is platform-specific — use the official
selector at <https://pytorch.org/get-started/locally/>), then the rest:

```bash
# 1) torch — pick the line that matches your machine:
pip install torch --index-url https://download.pytorch.org/whl/cu121   # NVIDIA CUDA 12.1
# pip install torch                                                    # Apple Silicon / CPU

# 2) everything else:
pip install -r imagegen/requirements.txt
```

Check the machine is ready (this step needs **no** ML deps — it only reports):

```bash
python3 imagegen/imagegen.py check
```

## Use

### Web UI (recommended)

```bash
python3 imagegen/imagegen.py serve
# open http://127.0.0.1:8791
```

A dark, single-page UI: type a prompt, pick size / steps / guidance / seed, and
generate. Results show inline and are saved to disk. The server binds to
`127.0.0.1` only, so it's reachable just from your machine; the model loads once
on the first request and is reused after that.

### One-shot from the CLI

```bash
python3 imagegen/imagegen.py generate "a lone lighthouse in a storm, cinematic, volumetric light" \
    --num 2 --seed 42
```

Images are written to `~/.imagegen/outputs/` (override with `--out` or the
`IMAGEGEN_OUT` env var), each PNG carrying its prompt, seed, model, and settings
as embedded metadata so any result is reproducible.

## Choosing a model

Set `--model` (CLI/serve) or the `IMAGEGEN_MODEL` env var to any diffusers
text-to-image repo. `AutoPipelineForText2Image` picks the right pipeline class,
so the same code handles all of these:

| Model | `--model` | Notes |
|-------|-----------|-------|
| **SDXL** (default) | `stabilityai/stable-diffusion-xl-base-1.0` | Great quality, ~8 GB VRAM. Use ~30 steps, guidance ~6.5. |
| **FLUX.1-schnell** | `black-forest-labs/FLUX.1-schnell` | Fast (4 steps), Apache-2.0, big (~24 GB). Set `--steps 4 --guidance 0`. |
| **SD 1.5** | `runwayml/stable-diffusion-v1-5` | Small & fast, lower fidelity. Use `--width 512 --height 512`. |

## Low-VRAM / slow machines

- `IMAGEGEN_LOW_VRAM=1` enables sequential CPU offload (fits big models on small
  GPUs, at the cost of speed).
- Drop to SD 1.5 at 512×512 for the lightest footprint.
- Attention and VAE slicing are on by default — no action needed.

## Layout

| File | Role |
|------|------|
| `imagegen.py` | CLI entry — `check` / `generate` / `serve` |
| `core.py` | model loading + generation (the diffusers logic) |
| `server.py` | local web server (stdlib `http.server`) |
| `web/index.html` | the browser UI |
| `requirements.txt` | the ML stack (torch, diffusers, …) |

## A note on "no filter"

Running open weights locally means *you* own what it produces — there's no
service deciding for you. That also means the responsibility is yours: generate
lawfully, and don't create images of real people without consent or anything
that harms others.

## Self-test

The import-light paths (device detection, request/seed logic, dependency
probing) have a self-check that runs without the ML stack:

```bash
python3 imagegen/core.py --selftest
```
