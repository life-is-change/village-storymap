from __future__ import annotations

import argparse
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen

import cv2
import numpy as np
import torch
import torchvision
from PIL import Image
from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

from .grounding_dino_compat import post_process_grounding_dino

try:
    from village_processing.gpu_lock import default_gpu_lock_path, gpu_lock
except ModuleNotFoundError:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "server" / "src"))
    from village_processing.gpu_lock import default_gpu_lock_path, gpu_lock


BUILDING_PROMPT = "building. house. residential building. building facade. roof."
OCCLUSION_PROMPT = "car. automobile. motorcycle. scooter. electric bicycle. bicycle. person. tree. shrub. plant. clothes. canopy."


def _read(path: Path) -> np.ndarray:
    image = cv2.imdecode(np.fromfile(path, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"无法读取图片：{path}")
    return image


def _write(path: Path, image: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    ok, encoded = cv2.imencode(path.suffix or ".png", image)
    if not ok:
        raise OSError(f"无法保存图片：{path}")
    encoded.tofile(path)


class FacadeMLRuntime:
    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.processor = None
        self.dino = None
        self.sam = None
        self._load_lock = threading.Lock()

    def _load(self):
        if self.dino is not None and self.sam is not None:
            return
        with self._load_lock:
            if self.dino is not None and self.sam is not None:
                return
            # Build into locals so a failed SAM initialization cannot leave a
            # half-ready runtime that skips the next readiness retry.
            processor = AutoProcessor.from_pretrained(
                "IDEA-Research/grounding-dino-base", local_files_only=True
            )
            dino = AutoModelForZeroShotObjectDetection.from_pretrained(
                "IDEA-Research/grounding-dino-base", local_files_only=True
            ).to(self.device).eval()
            configured_root = os.environ.get("BUILD_SEG_ROOT", "").strip()
            if not configured_root:
                raise RuntimeError("BUILD_SEG_ROOT is not configured")
            root = Path(configured_root)
            repo = root / "repos" / "sam2"
            if str(repo) not in sys.path:
                sys.path.insert(0, str(repo))
            from sam2.build_sam import build_sam2
            from sam2.sam2_image_predictor import SAM2ImagePredictor

            checkpoint = Path(os.environ.get(
                "SAM2_CHECKPOINT", root / "checkpoints" / "sam2.1_hiera_large.pt"
            ))
            if not checkpoint.is_file():
                raise FileNotFoundError(f"SAM2 checkpoint not found: {checkpoint}")
            model = build_sam2(
                "configs/sam2.1/sam2.1_hiera_l.yaml", str(checkpoint), device=self.device
            )
            sam = SAM2ImagePredictor(model)
            self.processor, self.dino, self.sam = processor, dino, sam

    def ready(self) -> dict[str, object]:
        self._load()
        if self.dino is None or self.sam is None:
            raise RuntimeError("FACADE_MODELS_NOT_LOADED")
        return {"status": "ready", "service": "rural-facade-ml", "device": self.device}

    def _detect(self, rgb: np.ndarray, prompt: str, box_threshold: float, text_threshold: float):
        pil = Image.fromarray(rgb)
        inputs = self.processor(images=pil, text=prompt, return_tensors="pt").to(self.device)
        with torch.inference_mode():
            outputs = self.dino(**inputs)
        result = post_process_grounding_dino(
            self.processor,
            outputs,
            inputs.input_ids,
            box_threshold=box_threshold,
            text_threshold=text_threshold,
            target_sizes=[pil.size[::-1]],
        )
        boxes = result["boxes"].detach().cpu().numpy().astype(np.float32)
        scores = result["scores"].detach().cpu().numpy().astype(np.float32)
        labels = list(result.get("text_labels") or [""] * len(boxes))
        return boxes, scores, labels

    @staticmethod
    def _building_envelope(boxes: np.ndarray, scores: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
        height, width = shape
        if not len(boxes):
            raise ValueError("Grounding DINO 没有识别到主建筑")
        sizes = boxes[:, 2:4] - boxes[:, 0:2]
        ratios = sizes[:, 0] * sizes[:, 1] / float(width * height)
        centers = (boxes[:, :2] + boxes[:, 2:4]) * 0.5
        valid = np.flatnonzero((ratios >= 0.025) & (ratios <= 0.92))
        if not len(valid):
            raise ValueError("Grounding DINO 识别到的建筑范围不可信")
        rank = scores[valid] * 1.8 + np.sqrt(ratios[valid]) - np.abs(centers[valid, 0] / width - 0.5) * 0.55
        seed = int(valid[int(np.argmax(rank))])
        selected = [seed]
        seed_box = boxes[seed]
        seed_width = max(1.0, float(seed_box[2] - seed_box[0]))
        for index in valid:
            if int(index) == seed:
                continue
            box = boxes[index]
            overlap = max(0.0, min(float(seed_box[2]), float(box[2])) - max(float(seed_box[0]), float(box[0])))
            center_gap = abs(float((box[0] + box[2] - seed_box[0] - seed_box[2]) * 0.5))
            if overlap / min(seed_width, max(1.0, float(box[2] - box[0]))) >= 0.42 and center_gap <= width * 0.22:
                selected.append(int(index))
        subset = boxes[selected]
        envelope = np.float32([subset[:, 0].min(), subset[:, 1].min(), subset[:, 2].max(), subset[:, 3].max()])
        margin = np.float32([width * .015, height * .015, width * .015, height * .02])
        envelope += np.float32([-margin[0], -margin[1], margin[2], margin[3]])
        envelope[[0, 2]] = np.clip(envelope[[0, 2]], 0, width - 1)
        envelope[[1, 3]] = np.clip(envelope[[1, 3]], 0, height - 1)
        return envelope

    def _infer_masks(self, rgb: np.ndarray):
        boxes, scores, _ = self._detect(rgb, BUILDING_PROMPT, .20, .16)
        envelope = self._building_envelope(boxes, scores, rgb.shape[:2])
        self.sam.set_image(rgb)
        masks, sam_scores, _ = self.sam.predict(box=envelope[None, :], multimask_output=True)
        masks = np.asarray(masks)
        if masks.ndim == 4:
            masks = masks[0]
        best = int(np.argmax(np.asarray(sam_scores).reshape(-1)))
        building = masks[best].astype(np.uint8) * 255

        occ_boxes, occ_scores, labels = self._detect(rgb, OCCLUSION_PROMPT, .17, .14)
        detected_labels = list(labels)
        if len(occ_boxes):
            sizes = occ_boxes[:, 2:4] - occ_boxes[:, 0:2]
            areas = sizes[:, 0] * sizes[:, 1]
            keep = (sizes[:, 0] >= 12) & (sizes[:, 1] >= 12) & (areas <= rgb.shape[0] * rgb.shape[1] * .18)
            occ_boxes, occ_scores = occ_boxes[keep], occ_scores[keep]
            labels = [label for label, accepted in zip(labels, keep, strict=True) if accepted]
        if len(occ_boxes):
            indices = torchvision.ops.nms(torch.as_tensor(occ_boxes), torch.as_tensor(occ_scores), .62).cpu().numpy()[:35]
            occ_boxes = occ_boxes[indices]
            labels = [labels[int(index)] for index in indices]
            masks, _, _ = self.sam.predict(box=occ_boxes.astype(np.float32), multimask_output=False)
            masks = np.asarray(masks)
            if masks.ndim == 4:
                masks = masks[:, 0]
        else:
            masks = np.zeros((0, *rgb.shape[:2]), bool)
        return envelope, building, occ_boxes, labels, masks, detected_labels

    def process(self, source_path: Path, output_dir: Path) -> dict[str, object]:
        source = _read(source_path)
        original_shape = source.shape[:2]
        scale = min(1.0, 1600.0 / max(original_shape))
        working = cv2.resize(source, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else source.copy()
        rgb = cv2.cvtColor(working, cv2.COLOR_BGR2RGB)
        lock_path = Path(os.environ.get("PLATFORM_GPU_LOCK_PATH") or default_gpu_lock_path())
        with gpu_lock(lock_path):
            self._load()
            envelope, building, occ_boxes, labels, masks, detected_labels = self._infer_masks(rgb)
        building = cv2.morphologyEx(building, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
        expanded = cv2.dilate(building, np.ones((31, 31), np.uint8)) > 0
        accepted = []
        accepted_labels = []
        for label, mask, box in zip(labels, masks, occ_boxes, strict=True):
            normalized_label = label.lower()
            is_vehicle = any(word in normalized_label for word in ("car", "automobile", "motorcycle", "scooter", "bicycle"))
            raw_mask = mask.astype(bool)
            if is_vehicle:
                envelope_width = float(envelope[2] - envelope[0])
                envelope_height = float(envelope[3] - envelope[1])
                allowed = np.float32([
                    envelope[0] - envelope_width * .10,
                    envelope[1] - envelope_height * .05,
                    envelope[2] + envelope_width * .10,
                    min(rgb.shape[0] - 1, envelope[3] + envelope_height * .22),
                ])
                overlap_width = max(0.0, min(float(box[2]), float(allowed[2])) - max(float(box[0]), float(allowed[0])))
                overlap_height = max(0.0, min(float(box[3]), float(allowed[3])) - max(float(box[1]), float(allowed[1])))
                overlap_ratio = overlap_width * overlap_height / max(1.0, float((box[2] - box[0]) * (box[3] - box[1])))
                candidate = raw_mask if overlap_ratio >= .12 else (raw_mask & expanded)
            else:
                candidate = raw_mask & expanded
                selected_x = np.flatnonzero(candidate.any(axis=0))
                selected_y = np.flatnonzero(candidate.any(axis=1))
                if selected_x.size and selected_y.mean() < float(
                    envelope[1] + (envelope[3] - envelope[1]) * .35
                ):
                    continue
            ratio = float(candidate.mean())
            inside = float(candidate.sum()) / max(1.0, float(raw_mask.sum()))
            minimum_inside = .05 if is_vehicle else .35
            maximum_ratio = .10 if is_vehicle else .075
            if .00015 <= ratio <= maximum_ratio and inside >= minimum_inside:
                accepted.append(candidate)
                accepted_labels.append(label)
        occlusion = np.any(accepted, axis=0).astype(np.uint8) * 255 if accepted else np.zeros(rgb.shape[:2], np.uint8)
        if np.any(occlusion):
            occlusion = cv2.dilate(occlusion, np.ones((9, 9), np.uint8))

        if scale < 1:
            size = (original_shape[1], original_shape[0])
            building = cv2.resize(building, size, interpolation=cv2.INTER_NEAREST)
            occlusion = cv2.resize(occlusion, size, interpolation=cv2.INTER_NEAREST)
        output_dir.mkdir(parents=True, exist_ok=True)
        building_path = output_dir / "building_mask.png"
        occlusion_path = output_dir / "occlusion_mask.png"
        cleaned_path = output_dir / "cleaned_source.png"
        _write(building_path, building)
        _write(occlusion_path, occlusion)
        cleanup_status = "not_needed"
        if np.any(occlusion):
            lama_url = os.environ.get("RURAL_LAMA_URL", "http://127.0.0.1:8013").rstrip("/")
            request = Request(
                f"{lama_url}/inpaint",
                data=json.dumps({"source_path": str(source_path.resolve()), "mask_path": str(occlusion_path.resolve()), "output_path": str(cleaned_path.resolve())}).encode(),
                method="POST", headers={"Content-Type": "application/json"},
            )
            try:
                with urlopen(request, timeout=360) as response:
                    payload = json.loads(response.read().decode())
                cleanup_status = "completed" if payload.get("ok") else "failed_preserved_original"
            except Exception:
                cleanup_status = "failed_preserved_original"
        if not cleaned_path.is_file():
            _write(cleaned_path, source)
        diagnostics = {
            "dino_model": "IDEA-Research/grounding-dino-base",
            "sam_model": "sam2.1_hiera_large",
            "device": self.device,
            "building_box": (envelope / max(scale, 1e-9)).tolist(),
            "building_mask_area_ratio": float((building > 0).mean()),
            "occlusion_mask_area_ratio": float((occlusion > 0).mean()),
            "occlusion_labels": accepted_labels,
            "detected_occlusion_labels": detected_labels,
            "lama_status": cleanup_status,
        }
        (output_dir / "model_diagnostics.json").write_text(json.dumps(diagnostics, ensure_ascii=False, indent=2), encoding="utf-8")
        return {
            "ok": True,
            "artifacts": {"cleaned_source": str(cleaned_path.resolve()), "building_mask": str(building_path.resolve()), "occlusion_mask": str(occlusion_path.resolve())},
            "diagnostics": diagnostics,
        }


def build_handler(runtime: FacadeMLRuntime):
    class Handler(BaseHTTPRequestHandler):
        def _json(self, status, payload):
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/health":
                self._json(200, {"status": "ok", "service": "rural-facade-ml", "loaded": runtime.dino is not None, "device": runtime.device})
            elif self.path == "/ready":
                try:
                    self._json(200, runtime.ready())
                except Exception as exc:
                    self._json(503, {"status": "not_ready", "error": str(exc)})
            else:
                self._json(404, {"error": "not found"})

        def do_POST(self):
            if self.path != "/process":
                self._json(404, {"error": "not found"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                self._json(200, runtime.process(Path(payload["source_path"]), Path(payload["output_dir"])))
            except Exception as exc:
                self._json(422, {"ok": False, "error": str(exc)})

        def log_message(self, *_):
            return

    return Handler


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8012)
    args = parser.parse_args()
    ThreadingHTTPServer((args.host, args.port), build_handler(FacadeMLRuntime())).serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
