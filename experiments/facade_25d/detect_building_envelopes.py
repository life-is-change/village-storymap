from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image
from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

from experiments.facade_25d.structural_envelope import merge_target_building_boxes


PROMPT = "building. house. residential building. building facade. roof."


def _read(path: Path) -> np.ndarray:
    image = cv2.imdecode(np.fromfile(path, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError(f"cannot decode {path}")
    return image


def _write(path: Path, image: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imencode(path.suffix or ".png", image)[1].tofile(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample-root", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--samples", nargs="+", default=["sample_05", "sample_06"])
    parser.add_argument("--max-dim", type=int, default=1600)
    args = parser.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    processor = AutoProcessor.from_pretrained("IDEA-Research/grounding-dino-base")
    model = AutoModelForZeroShotObjectDetection.from_pretrained(
        "IDEA-Research/grounding-dino-base"
    ).to(device).eval()

    for sample in args.samples:
        image = _read(args.sample_root / sample / "input.jpg")
        scale = min(1.0, args.max_dim / max(image.shape[:2]))
        if scale < 1:
            image = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        pil = Image.fromarray(rgb)
        inputs = processor(images=pil, text=PROMPT, return_tensors="pt").to(device)
        with torch.inference_mode():
            outputs = model(**inputs)
        result = processor.post_process_grounded_object_detection(
            outputs,
            inputs.input_ids,
            threshold=.20,
            text_threshold=.16,
            target_sizes=[pil.size[::-1]],
        )[0]
        boxes = result["boxes"].detach().cpu().numpy().astype(np.float32)
        scores = result["scores"].detach().cpu().numpy().astype(np.float32)
        labels = list(result.get("text_labels", [""] * len(boxes)))
        sizes = boxes[:, 2:4] - boxes[:, 0:2]
        ratios = sizes[:, 0] * sizes[:, 1] / float(rgb.shape[0] * rgb.shape[1])
        keep = np.flatnonzero((ratios >= .008) & (ratios <= .95))
        boxes, scores = boxes[keep], scores[keep]
        labels = [labels[int(index)] for index in keep]
        order = np.argsort(-scores)[:30]
        boxes, scores = boxes[order], scores[order]
        labels = [labels[int(index)] for index in order]

        envelope = merge_target_building_boxes(boxes, scores, rgb.shape[:2])
        raw = image.copy()
        palette = [(0, 220, 255), (255, 150, 30), (40, 220, 60), (230, 60, 220)]
        for index, (box, score) in enumerate(zip(boxes, scores, strict=True)):
            x1, y1, x2, y2 = np.rint(box).astype(int)
            color = palette[index % len(palette)]
            cv2.rectangle(raw, (x1, y1), (x2, y2), color, 2, cv2.LINE_AA)
            cv2.putText(raw, f"{index}:{score:.2f}", (x1, max(18, y1 - 4)), cv2.FONT_HERSHEY_SIMPLEX, .55, color, 2, cv2.LINE_AA)
        merged = raw.copy()
        x1, y1, x2, y2 = np.rint(envelope.envelope).astype(int)
        cv2.rectangle(merged, (x1, y1), (x2, y2), (0, 0, 255), 6, cv2.LINE_AA)
        cv2.putText(merged, "STRUCTURAL ENVELOPE", (x1, max(32, y1 - 10)), cv2.FONT_HERSHEY_SIMPLEX, .8, (0, 0, 255), 3, cv2.LINE_AA)

        out = args.output_root / sample
        _write(out / "01-dino-boxes.jpg", raw)
        _write(out / "02-structural-envelope.jpg", merged)
        (out / "envelope.json").write_text(json.dumps({
            "sample": sample,
            "image_size": [int(image.shape[1]), int(image.shape[0])],
            "prompt": PROMPT,
            "boxes": boxes.tolist(),
            "scores": scores.tolist(),
            "labels": labels,
            "member_indices": list(envelope.member_indices),
            "rejected_scene_indices": list(envelope.rejected_scene_indices),
            "components": [list(component) for component in envelope.component_indices],
            "envelope": envelope.envelope.tolist(),
            "envelope_normalized": (envelope.envelope / np.float32([image.shape[1], image.shape[0], image.shape[1], image.shape[0]])).tolist(),
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"{sample}: members={envelope.member_indices} envelope={envelope.envelope.tolist()}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
