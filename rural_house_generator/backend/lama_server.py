from __future__ import annotations

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image


class LamaRuntime:
    def __init__(self):
        self._model = None

    def ready(self) -> dict[str, object]:
        if self._model is None:
            from simple_lama_inpainting import SimpleLama
            self._model = SimpleLama()
        return {"status": "ready", "service": "rural-facade-lama"}

    def process(self, source_path: Path, mask_path: Path, output_path: Path) -> dict[str, object]:
        self.ready()
        image = Image.open(source_path).convert("RGB")
        mask = Image.open(mask_path).convert("L")
        if image.size != mask.size:
            raise ValueError("LaMa 图片和掩膜尺寸不一致")
        result = self._model(image, mask)
        if result.size != image.size:
            result = result.crop((0, 0, image.width, image.height))
        output_path.parent.mkdir(parents=True, exist_ok=True)
        result.save(output_path)
        return {"ok": True, "output_path": str(output_path.resolve())}


def build_handler(runtime: LamaRuntime):
    class Handler(BaseHTTPRequestHandler):
        def _json(self, status: int, payload: dict[str, object]):
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/health":
                self._json(200, {"status": "ok", "service": "rural-facade-lama", "loaded": runtime._model is not None})
            elif self.path == "/ready":
                try:
                    self._json(200, runtime.ready())
                except Exception as exc:
                    self._json(503, {"status": "not_ready", "error": str(exc)})
            else:
                self._json(404, {"error": "not found"})

        def do_POST(self):
            if self.path != "/inpaint":
                self._json(404, {"error": "not found"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                result = runtime.process(
                    Path(payload["source_path"]), Path(payload["mask_path"]), Path(payload["output_path"])
                )
                self._json(200, result)
            except Exception as exc:
                self._json(422, {"ok": False, "error": str(exc)})

        def log_message(self, *_):
            return

    return Handler


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8013)
    args = parser.parse_args()
    runtime = LamaRuntime()
    ThreadingHTTPServer((args.host, args.port), build_handler(runtime)).serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
