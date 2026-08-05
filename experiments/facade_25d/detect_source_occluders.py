from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

import cv2
import numpy as np
import torch
import torchvision
from PIL import Image
from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor


PROMPT = "car. automobile. motorcycle. scooter. electric bicycle. bicycle. person. tree. shrub. plant. clothes. canopy."


def _load_sam2(device: str):
    root = Path(os.environ.get("BUILD_SEG_ROOT", r"E:\建筑分割"))
    repo = root / "repos" / "sam2"
    if str(repo) not in sys.path:
        sys.path.insert(0, str(repo))
    from sam2.build_sam import build_sam2
    from sam2.sam2_image_predictor import SAM2ImagePredictor
    checkpoint = root / "checkpoints" / "sam2.1_hiera_large.pt"
    model = build_sam2("configs/sam2.1/sam2.1_hiera_l.yaml", str(checkpoint), device=device)
    return "large", SAM2ImagePredictor(model)


def _post_process(processor, outputs, inputs, image, box_threshold: float, text_threshold: float):
    return processor.post_process_grounded_object_detection(
        outputs, inputs.input_ids, threshold=box_threshold,
        text_threshold=text_threshold, target_sizes=[image.size[::-1]],
    )[0]


def _filter_boxes(boxes, scores, image_shape, max_boxes=40):
    height, width = image_shape[:2]
    sizes = boxes[:, 2:4] - boxes[:, 0:2]
    areas = sizes[:, 0] * sizes[:, 1]
    keep = (sizes[:, 0] >= 12) & (sizes[:, 1] >= 12) & (areas <= width * height * .30)
    boxes, scores = boxes[keep], scores[keep]
    if not len(boxes):
        return boxes, scores
    indices = torchvision.ops.nms(torch.as_tensor(boxes), torch.as_tensor(scores), .65).cpu().numpy()
    return boxes[indices[:max_boxes]], scores[indices[:max_boxes]]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample-root", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--samples", nargs="+", default=["sample_01", "sample_04", "sample_05", "sample_06"])
    parser.add_argument("--max-dim", type=int, default=1600)
    args = parser.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    processor = AutoProcessor.from_pretrained("IDEA-Research/grounding-dino-base")
    dino = AutoModelForZeroShotObjectDetection.from_pretrained(
        "IDEA-Research/grounding-dino-base"
    ).to(device).eval()
    sam_name, predictor = _load_sam2(device)

    for sample in args.samples:
        source_path = args.sample_root / sample / "input.jpg"
        bgr = cv2.imdecode(np.fromfile(source_path, dtype=np.uint8), cv2.IMREAD_COLOR)
        if bgr is None:
            raise RuntimeError(f"cannot decode {source_path}")
        scale = min(1.0, args.max_dim / max(bgr.shape[:2]))
        if scale < 1:
            bgr = cv2.resize(bgr, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        pil = Image.fromarray(rgb)
        inputs = processor(images=pil, text=PROMPT, return_tensors="pt").to(device)
        with torch.inference_mode():
            outputs = dino(**inputs)
        result = _post_process(processor, outputs, inputs, pil, 0.23, 0.18)
        boxes = result["boxes"].detach().cpu().numpy()
        scores = result["scores"].detach().cpu().numpy()
        boxes, scores = _filter_boxes(boxes, scores, rgb.shape)
        predictor.set_image(rgb)
        if len(boxes):
            masks, sam_scores, _ = predictor.predict(
                box=boxes.astype(np.float32), multimask_output=False
            )
            masks = np.asarray(masks)
            if masks.ndim == 4:
                masks = masks[:, 0]
            sam_scores = np.asarray(sam_scores).reshape(len(boxes), -1)[:, 0]
            areas = masks.reshape(len(masks), -1).sum(axis=1)
            keep = np.flatnonzero((areas >= 120) & (areas <= rgb.shape[0] * rgb.shape[1] * .30))
            boxes, scores, masks, sam_scores = boxes[keep], scores[keep], masks[keep], sam_scores[keep]
            instance_masks = masks.astype(np.uint8) * 255
        else:
            sam_scores = np.zeros((0,), np.float32)
            masks = np.zeros((0, *rgb.shape[:2]), bool)
            instance_masks = np.zeros((0, *rgb.shape[:2]), np.uint8)

        kernel = np.ones((9, 9), np.uint8)
        instance_masks = np.asarray(
            [cv2.dilate(mask, kernel, iterations=1) for mask in instance_masks],
            dtype=np.uint8,
        )
        union = np.any(instance_masks > 0, axis=0).astype(np.uint8) * 255 if len(instance_masks) else np.zeros(rgb.shape[:2], np.uint8)
        out = args.output_root / sample
        out.mkdir(parents=True, exist_ok=True)
        cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, 95])[1].tofile(out / "source-resized.jpg")
        cv2.imencode(".png", union)[1].tofile(out / "source-occlusion-mask.png")
        np.savez_compressed(out / "source-occlusion-instances.npz", masks=instance_masks)
        overlay = bgr.copy()
        overlay[union > 0] = (0.55 * overlay[union > 0] + 0.45 * np.array([30, 30, 240])).astype(np.uint8)
        for box in boxes:
            x1, y1, x2, y2 = np.rint(box).astype(int)
            cv2.rectangle(overlay, (x1, y1), (x2, y2), (0, 220, 255), 2)
        cv2.imencode(".jpg", overlay, [cv2.IMWRITE_JPEG_QUALITY, 95])[1].tofile(out / "source-occlusion-overlay.jpg")
        (out / "source-detection.json").write_text(json.dumps({
            "sam_model": sam_name,
            "device": device,
            "prompt": PROMPT,
            "boxes": boxes.tolist(),
            "dino_scores": scores.tolist(),
            "sam_scores": sam_scores.tolist(),
            "mask_area_ratio": float((union > 0).mean()),
            "image_size": [int(bgr.shape[1]), int(bgr.shape[0])],
        }, indent=2), encoding="utf-8")
        print(f"{sample}: boxes={len(boxes)} mask={float((union > 0).mean()):.4f}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
