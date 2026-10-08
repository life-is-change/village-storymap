from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from experiments.facade_25d.plane_atlas_pipeline import (
    PlaneSpec,
    decide_inpaint,
    render_plane_atlas,
    select_intersecting_safe_components,
)
from experiments.facade_layering.inpaint_provider import run_lama


CONFIG = {
    "sample_01": [
        ("roof-front", [[.145,.082],[.925,.112],[.940,.135],[.140,.108]], .00,.06),
        ("upper-floor", [[.205,.140],[.870,.158],[.885,.248],[.190,.235]], .06,.27),
        ("upper-parapet", [[.130,.245],[.940,.265],[.950,.310],[.110,.300]], .27,.36),
        ("middle-floor", [[.180,.300],[.885,.310],[.895,.425],[.165,.418]], .36,.57),
        ("middle-parapet", [[.085,.425],[.955,.440],[.970,.515],[.060,.515]], .57,.66),
        ("canopy-front", [[.055,.510],[.980,.510],[.980,.545],[.045,.545]], .66,.70),
        ("ground-floor", [[.080,.580],[.960,.580],[.950,.755],[.040,.755]], .70,.92),
        ("base", [[.040,.755],[.965,.755],[.965,.825],[.035,.825]], .92,1.00),
    ],
    "sample_04": [
        ("upper-floor", [[.244,.263],[.754,.307],[.754,.464],[.229,.415]], .00,.43),
        ("balcony-front", [[.229,.415],[.754,.464],[.743,.527],[.231,.482]], .43,.57),
        ("ground-floor", [[.272,.485],[.741,.526],[.730,.664],[.257,.637]], .57,1.00),
    ],
    "sample_05": [
        ("roof-fascia", [[.289,.302],[.787,.368],[.789,.428],[.286,.360]], .00,.16),
        ("upper-floor", [[.296,.394],[.769,.455],[.791,.605],[.292,.550]], .16,.62),
        ("lower-floor-faithful", [[.365,.580],[.763,.619],[.735,.752],[.300,.738]], .62,1.00),
    ],
    "sample_06": [
        ("roof-front", [[.309,.431],[.659,.469],[.655,.535],[.304,.508]], .00,.23),
        ("main-wall", [[.303,.516],[.650,.548],[.650,.792],[.286,.782]], .23,1.00),
    ],
}


def _read(path: Path, flags: int = cv2.IMREAD_COLOR):
    image = cv2.imdecode(np.fromfile(path, dtype=np.uint8), flags)
    if image is None:
        raise RuntimeError(f"cannot decode {path}")
    return image


def _write(path: Path, image: np.ndarray):
    path.parent.mkdir(parents=True, exist_ok=True)
    ext = path.suffix or ".png"
    cv2.imencode(ext, image)[1].tofile(path)


def _planes(sample: str, shape: tuple[int, int]) -> tuple[PlaneSpec, ...]:
    height, width = shape
    scale = np.float32([width - 1, height - 1])
    return tuple(PlaneSpec(name, np.float32(quad) * scale, (0, top, 1, bottom)) for name, quad, top, bottom in CONFIG[sample])


def _atlas_mask(mask: np.ndarray, planes: tuple[PlaneSpec, ...], size: tuple[int, int]) -> np.ndarray:
    bgr = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)
    rendered = render_plane_atlas(bgr, planes, size)
    return np.where(rendered.preview[..., 0] >= 128, 255, 0).astype(np.uint8)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample-root", type=Path, required=True)
    parser.add_argument("--detection-root", type=Path, required=True)
    parser.add_argument("--previous-root", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--lama-python", type=Path, required=True)
    args = parser.parse_args()

    summaries = []
    rows = []
    for sample in CONFIG:
        out = args.output_root / sample
        out.mkdir(parents=True, exist_ok=True)
        source = _read(args.detection_root / sample / "source-resized.jpg")
        source_mask = _read(args.detection_root / sample / "source-occlusion-mask.png", cv2.IMREAD_GRAYSCALE)
        planes = _planes(sample, source.shape[:2])
        size = (1400, 1500 if sample == "sample_01" else 900)
        faithful = render_plane_atlas(source, planes, size)
        source_target_mask = np.zeros(source.shape[:2], np.uint8)
        for plane in planes:
            cv2.fillConvexPoly(source_target_mask, np.rint(plane.source_quad).astype(np.int32), 255)
        component_limit = .20 if sample == "sample_04" else .08
        instances_path = args.detection_root / sample / "source-occlusion-instances.npz"
        if instances_path.is_file():
            instance_masks = np.load(instances_path)["masks"]
            accepted_instances = []
            for instance in instance_masks:
                selected = instance > 0
                if not np.any(selected & (source_target_mask > 0)):
                    continue
                if int(selected.sum()) / max(1, int((source_target_mask > 0).sum())) > component_limit:
                    continue
                if selected[0].any() or selected[-1].any() or selected[:, 0].any() or selected[:, -1].any():
                    continue
                accepted_instances.append(selected)
            filtered_source_mask = (
                np.any(accepted_instances, axis=0).astype(np.uint8) * 255
                if accepted_instances else np.zeros_like(source_mask)
            )
        else:
            filtered_source_mask = select_intersecting_safe_components(
                source_mask, source_target_mask, max_component_ratio=component_limit
            )
        atlas_mask = _atlas_mask(filtered_source_mask, planes, size)
        target_area = int((source_target_mask > 0).sum())
        total_limit = .30 if sample == "sample_04" else .16
        decision = decide_inpaint(filtered_source_mask, target_area, max_area_ratio=total_limit)

        _write(out / "01-source.jpg", source)
        overlay = source.copy()
        for plane in planes:
            cv2.polylines(overlay, [np.rint(plane.source_quad).astype(np.int32)], True, (0, 220, 255), 4, cv2.LINE_AA)
        _write(out / "02-plane-controls.jpg", overlay)
        _write(out / "03-faithful-plane-atlas.png", faithful.preview)
        _write(out / "04-atlas-occlusion-mask.png", atlas_mask)
        _write(out / "04-source-occlusion-mask-filtered.png", filtered_source_mask)
        cleaned = faithful.preview
        provider = "skipped"
        if decision.accepted:
            result = run_lama(
                args.detection_root / sample / "source-resized.jpg",
                out / "04-source-occlusion-mask-filtered.png",
                out / "05-source-lama-cleaned.png",
                args.lama_python,
            )
            cleaned_source = _read(result.output_path)
            cleaned = render_plane_atlas(cleaned_source, planes, size).preview
            _write(out / "06-lama-cleaned-atlas.png", cleaned)
            provider = result.provider
        else:
            _write(out / "06-lama-skipped-faithful.png", cleaned)

        previous = _read(args.previous_root / sample / "02-h0-mesh" / "02-rectified-facade.png")
        def fit(img, w=420, h=300):
            scale = min(w / img.shape[1], h / img.shape[0])
            resized = cv2.resize(img, (max(1, round(img.shape[1]*scale)), max(1, round(img.shape[0]*scale))))
            canvas = np.full((h, w, 3), 245, np.uint8)
            y=(h-resized.shape[0])//2; x=(w-resized.shape[1])//2
            canvas[y:y+resized.shape[0],x:x+resized.shape[1]]=resized
            return canvas
        row = np.hstack((fit(source), fit(previous), fit(faithful.preview), fit(cv2.cvtColor(atlas_mask, cv2.COLOR_GRAY2BGR)), fit(cleaned)))
        cv2.putText(row, sample, (10, 25), cv2.FONT_HERSHEY_SIMPLEX, .8, (0,0,0), 2, cv2.LINE_AA)
        _write(out / "comparison.jpg", row)
        rows.append(row)
        summary = {
            "sample": sample,
            "planes": [p.name for p in planes],
            "output_size": [faithful.preview.shape[1], faithful.preview.shape[0]],
            "inpaint": {"accepted": decision.accepted, "reason": decision.reason, "area_ratio": round(decision.area_ratio, 6), "provider": provider},
            "inpaint_component_limit": component_limit,
            "geometry": "independent facade-plane homographies; soffits and side walls excluded",
        }
        (out / "diagnostics.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        summaries.append(summary)
        print(f"{sample}: {decision.reason} ratio={decision.area_ratio:.4f}", flush=True)
    _write(args.output_root / "comparison-all-samples.jpg", np.vstack(rows))
    (args.output_root / "summary.json").write_text(json.dumps(summaries, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
