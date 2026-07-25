"""Local web UI for imagegen — stdlib `http.server` only.

Binds to 127.0.0.1 by default so it is reachable only from your own machine.
The pipeline is loaded once (on the first generate request) and reused; requests
are serialized with a lock because a single GPU can only render one batch at a
time. Images are returned to the browser as base64 data URLs and also written to
the output directory with their prompt/seed embedded as PNG metadata.
"""
from __future__ import annotations

import base64
import io
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import core

WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")

# Set by run(); read by the handler.
_MODEL = core.DEFAULT_MODEL
_OUT_DIR = ""
_LOCK = threading.Lock()


def _slug(text: str, limit: int = 40) -> str:
    keep = "".join(c if c.isalnum() or c in " -_" else "" for c in text)
    return "-".join(keep.lower().split())[:limit] or "image"


def _png_data_url(image) -> str:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


class Handler(BaseHTTPRequestHandler):
    server_version = "imagegen/1.0"

    # Quieter logging — one line per request is plenty for a local tool.
    def log_message(self, fmt, *a):  # noqa: N802
        pass

    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, code: int, obj: dict) -> None:
        self._send(code, json.dumps(obj).encode("utf-8"), "application/json")

    def do_GET(self):  # noqa: N802
        if self.path in ("/", "/index.html"):
            return self._serve_file("index.html", "text/html; charset=utf-8")
        if self.path == "/api/status":
            device, dtype = core.detect_device()
            return self._send_json(
                200,
                {
                    "model": _MODEL,
                    "device": device,
                    "dtype": dtype,
                    "deps_installed": core.deps_installed(),
                    "missing": core.missing_modules(),
                },
            )
        return self._send(404, b"not found", "text/plain")

    def _serve_file(self, name: str, ctype: str) -> None:
        path = os.path.join(WEB_DIR, name)
        try:
            with open(path, "rb") as fh:
                self._send(200, fh.read(), ctype)
        except OSError:
            self._send(404, b"ui asset missing", "text/plain")

    def do_POST(self):  # noqa: N802
        if self.path != "/api/generate":
            return self._send(404, b"not found", "text/plain")

        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, TypeError):
            return self._send_json(400, {"error": "invalid JSON body"})

        prompt = (payload.get("prompt") or "").strip()
        if not prompt:
            return self._send_json(400, {"error": "prompt is required"})

        if not core.deps_installed():
            return self._send_json(
                503,
                {
                    "error": "ML dependencies not installed. Run: "
                    "pip install -r imagegen/requirements.txt",
                    "missing": core.missing_modules(),
                },
            )

        req = core.GenRequest(
            prompt=prompt,
            negative_prompt=(payload.get("negative_prompt") or "").strip(),
            steps=int(payload.get("steps", 30)),
            guidance=float(payload.get("guidance", 6.5)),
            width=int(payload.get("width", 1024)),
            height=int(payload.get("height", 1024)),
            num_images=max(1, min(int(payload.get("num_images", 1)), 8)),
            seed=payload.get("seed"),
        )

        # Serialize: one batch at a time per GPU. Others wait rather than OOM.
        with _LOCK:
            try:
                result = core.generate(req, model=_MODEL, verbose=True)
            except Exception as exc:  # surface the real error to the UI
                return self._send_json(500, {"error": f"{type(exc).__name__}: {exc}"})

            images_out = []
            os.makedirs(_OUT_DIR, exist_ok=True)
            for img, seed in zip(result.images, result.seeds):
                name = f"{_slug(prompt)}-{seed}.png"
                try:
                    core.save_image(
                        img, os.path.join(_OUT_DIR, name), req=req, seed=seed, model=_MODEL
                    )
                except OSError:
                    pass  # a failed disk write shouldn't lose the in-memory result
                images_out.append({"data_url": _png_data_url(img), "seed": seed, "file": name})

        return self._send_json(
            200,
            {
                "images": images_out,
                "model": result.model,
                "device": result.device,
                "elapsed_s": round(result.elapsed_s, 1),
            },
        )


def run(host: str = "127.0.0.1", port: int = 8791, *, model: str = core.DEFAULT_MODEL,
        out_dir: str = "") -> int:
    global _MODEL, _OUT_DIR
    _MODEL = model
    _OUT_DIR = out_dir or os.path.join(os.path.expanduser("~"), ".imagegen", "outputs")

    httpd = ThreadingHTTPServer((host, port), Handler)
    device, dtype = core.detect_device()
    print(f"imagegen serving at http://{host}:{port}")
    print(f"  model:  {model}")
    print(f"  device: {device} ({dtype})")
    print(f"  output: {_OUT_DIR}")
    if not core.deps_installed():
        print("  WARNING: ML deps not installed — the UI loads but generation will 503.")
    print("  (Ctrl-C to stop. Model loads on the first request.)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped.")
    finally:
        httpd.server_close()
    return 0
