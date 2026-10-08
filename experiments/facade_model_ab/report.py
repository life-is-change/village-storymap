from __future__ import annotations

import csv
import html
import json
import os
from pathlib import Path
from typing import Any


VARIANT_ORDER = {"baseline": 0, "geocalib": 1, "deeplsd": 2, "combined": 3}


def _flatten(sample: str, metrics: dict[str, Any]) -> dict[str, Any]:
    horizontal = metrics.get("horizontal_residual_deg") or {}
    vertical = metrics.get("vertical_residual_deg") or {}
    return {
        "sample": sample,
        "variant": metrics.get("variant", "unknown"),
        "status": metrics.get("status", "unknown"),
        "fallback_reason": metrics.get("fallback_reason", ""),
        "horizontal_median_deg": horizontal.get("median"),
        "horizontal_p95_deg": horizontal.get("p95"),
        "vertical_median_deg": vertical.get("median"),
        "vertical_p95_deg": vertical.get("p95"),
        "facade_coverage": metrics.get("facade_coverage"),
        "crop_occupancy": metrics.get("crop_occupancy"),
        "folded_triangles": metrics.get("folded_triangles"),
        "remap_passes": metrics.get("remap_passes"),
        "runtime_seconds": metrics.get("runtime_seconds"),
        "cuda_peak_memory_mb": metrics.get("cuda_peak_memory_mb"),
    }


def generate_report(sample_roots: dict[str, Path], output_dir: Path) -> dict[str, Path]:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    rows: list[dict[str, Any]] = []
    images: dict[tuple[str, str], str] = {}
    for sample, root in sorted(sample_roots.items()):
        for metrics_path in sorted(Path(root).glob("*/metrics.json")):
            metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
            row = _flatten(sample, metrics)
            rows.append(row)
            image_path = metrics_path.parent / "rectified-facade.png"
            if not image_path.is_file():
                image_path = metrics_path.parent / "02-rectified-facade.png"
            if image_path.is_file():
                images[(sample, str(row["variant"]))] = os.path.relpath(
                    image_path, output_dir
                ).replace("\\", "/")
    rows.sort(key=lambda row: (str(row["sample"]), VARIANT_ORDER.get(str(row["variant"]), 99)))

    json_path = output_dir / "summary.json"
    json_path.write_text(
        json.dumps({"rows": rows}, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    fieldnames = list(rows[0].keys()) if rows else list(_flatten("", {}).keys())
    csv_path = output_dir / "summary.csv"
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    table_rows: list[str] = []
    for row in rows:
        key = (str(row["sample"]), str(row["variant"]))
        image_cell = ""
        if key in images:
            source = html.escape(images[key], quote=True)
            image_cell = f'<img src="{source}" alt="{html.escape(key[0])} {html.escape(key[1])}">'
        cells = [
            row["sample"],
            row["variant"],
            row["status"],
            row["horizontal_median_deg"],
            row["vertical_median_deg"],
            row["facade_coverage"],
            row["crop_occupancy"],
            row["fallback_reason"],
        ]
        table_rows.append(
            "<tr>"
            + "".join(f"<td>{html.escape(str(value if value is not None else ''))}</td>" for value in cells)
            + f"<td>{image_cell}</td></tr>"
        )
    html_path = output_dir / "comparison.html"
    html_path.write_text(
        "<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\">"
        "<title>Facade Model A/B</title><style>body{font-family:system-ui;margin:24px}"
        "table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccd5df;padding:7px;vertical-align:top}"
        "img{max-width:360px;max-height:260px}th{background:#eef4f8}</style>"
        "<h1>GeoCalib + DeepLSD 正立面对照</h1><table><thead><tr>"
        "<th>样本</th><th>方案</th><th>状态</th><th>水平中位残差°</th>"
        "<th>竖直中位残差°</th><th>立面保留率</th><th>裁剪占用率</th>"
        "<th>回退原因</th><th>结果</th></tr></thead><tbody>"
        + "".join(table_rows)
        + "</tbody></table></html>",
        encoding="utf-8",
    )
    return {"json": json_path, "csv": csv_path, "html": html_path}
