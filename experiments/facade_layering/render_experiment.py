from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import cv2
import numpy as np

from rural_house_generator.backend.app.facade.image_io import read_image, write_image

from .inpaint_provider import run_lama
from .layered_rectify import LayerSpec, composite_planar_layer, rectify_base
from .manifest import ManifestError, load_manifest


def _safe_name(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]+", "-", value).strip("-") or "layer"


def render(
    manifest_path: Path,
    output_dir: Path,
    lama_python: Path | None = None,
    lama_worker_script: Path | None = None,
) -> list[Path]:
    source = read_image(manifest_path.parent / "input.jpg")
    if source is None:
        raise ManifestError("image file cannot be decoded")
    manifest = load_manifest(manifest_path, source.shape[:2])
    if manifest.image_path != (manifest_path.parent / "input.jpg").resolve():
        source = read_image(manifest.image_path)
        if source is None:
            raise ManifestError("image file cannot be decoded")

    output_dir.mkdir(parents=True, exist_ok=True)
    output_paths: list[Path] = []
    canvas, base_transform = rectify_base(source, manifest.base_quad, manifest.output_size)
    base_path = output_dir / "01-base-rectified.png"
    write_image(base_path, canvas, ".png")
    output_paths.append(base_path)

    progressive = canvas
    for index, layer in enumerate(manifest.layers, start=1):
        progressive, _ = composite_planar_layer(
            progressive,
            source,
            LayerSpec(
                source_quad=layer.source_quad,
                destination_box=layer.destination_box,
                feather_px=layer.feather_px,
            ),
        )
        layer_path = output_dir / f"02-layer-{index:02d}-{_safe_name(layer.name)}.png"
        write_image(layer_path, progressive, ".png")
        output_paths.append(layer_path)

    layered_path = output_dir / "03-layered.png"
    write_image(layered_path, progressive, ".png")
    output_paths.append(layered_path)

    if manifest.occlusion_mask_path is not None:
        encoded_mask = np.fromfile(str(manifest.occlusion_mask_path), dtype=np.uint8)
        source_mask = cv2.imdecode(encoded_mask, cv2.IMREAD_GRAYSCALE)
        if source_mask is None:
            raise ManifestError("occlusion_mask file cannot be decoded")
        mask_width, mask_height = manifest.output_size
        rectified_mask = cv2.warpPerspective(
            source_mask,
            base_transform,
            (mask_width, mask_height),
            flags=cv2.INTER_NEAREST,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=0,
        )
        source_mask_bgr = cv2.cvtColor(source_mask, cv2.COLOR_GRAY2BGR)
        for layer in manifest.layers:
            layer_mask_bgr, _ = composite_planar_layer(
                np.zeros_like(progressive),
                source_mask_bgr,
                LayerSpec(
                    source_quad=layer.source_quad,
                    destination_box=layer.destination_box,
                    feather_px=0,
                ),
            )
            rectified_mask = np.maximum(
                rectified_mask,
                cv2.cvtColor(layer_mask_bgr, cv2.COLOR_BGR2GRAY),
            )
        rectified_mask = np.where(rectified_mask >= 128, 255, 0).astype(np.uint8)
        mask_path = output_dir / "03-occlusion-mask.png"
        write_image(mask_path, rectified_mask, ".png")
        output_paths.append(mask_path)

        if lama_python is not None:
            lama_path = output_dir / "04-lama.png"
            result = run_lama(
                layered_path,
                mask_path,
                lama_path,
                lama_python,
                worker_script=lama_worker_script,
            )
            output_paths.append(result.output_path)
            report_path = output_dir / "inpaint-result.json"
            report_path.write_text(
                json.dumps(
                    {
                        "provider": result.provider,
                        "elapsed_seconds": round(result.elapsed_seconds, 3),
                        "output": result.output_path.name,
                        "notes": list(result.notes),
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            output_paths.append(report_path)

    debug = source.copy()
    cv2.polylines(debug, [manifest.base_quad.astype(np.int32)], True, (0, 255, 0), 5)
    for index, layer in enumerate(manifest.layers, start=1):
        polygon = layer.source_quad.astype(np.int32)
        cv2.polylines(debug, [polygon], True, (0, 165, 255), 4)
        anchor = tuple(polygon[0].tolist())
        cv2.putText(
            debug,
            str(index),
            anchor,
            cv2.FONT_HERSHEY_SIMPLEX,
            1.2,
            (0, 0, 255),
            3,
            cv2.LINE_AA,
        )
    debug_path = output_dir / "debug-overlay.png"
    write_image(debug_path, debug, ".png")
    output_paths.append(debug_path)
    return output_paths


def main() -> int:
    parser = argparse.ArgumentParser(description="Render a layered facade experiment")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--lama-python", type=Path)
    args = parser.parse_args()
    paths = render(
        args.manifest.resolve(),
        args.output_dir.resolve(),
        lama_python=args.lama_python.resolve() if args.lama_python else None,
    )
    for path in paths:
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
