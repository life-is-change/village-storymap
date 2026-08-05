from __future__ import annotations

import csv
import json
from pathlib import Path

from experiments.facade_model_ab.report import generate_report


def test_generate_report_keeps_success_and_fallback_rows_deterministic(tmp_path: Path) -> None:
    sample = tmp_path / "sample_04"
    baseline = sample / "baseline"
    geocalib = sample / "geocalib"
    baseline.mkdir(parents=True)
    geocalib.mkdir(parents=True)
    (baseline / "02-rectified-facade.png").write_bytes(b"png")
    (baseline / "metrics.json").write_text(
        json.dumps(
            {
                "variant": "baseline",
                "status": "ok",
                "horizontal_residual_deg": {"median": 0.2, "p95": 0.5},
                "vertical_residual_deg": {"median": 0.3, "p95": 0.6},
                "facade_coverage": 0.95,
                "crop_occupancy": 0.9,
                "folded_triangles": 0,
                "remap_passes": 1,
            }
        ),
        encoding="utf-8",
    )
    (geocalib / "metrics.json").write_text(
        json.dumps(
            {
                "variant": "geocalib",
                "status": "fallback",
                "fallback_reason": "dependency_unavailable: geocalib",
            }
        ),
        encoding="utf-8",
    )

    paths = generate_report({"sample_04": sample}, tmp_path / "report")

    summary = json.loads(paths["json"].read_text(encoding="utf-8"))
    assert [(row["sample"], row["variant"], row["status"]) for row in summary["rows"]] == [
        ("sample_04", "baseline", "ok"),
        ("sample_04", "geocalib", "fallback"),
    ]
    with paths["csv"].open("r", encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    assert rows[1]["fallback_reason"] == "dependency_unavailable: geocalib"
    html = paths["html"].read_text(encoding="utf-8")
    assert "sample_04" in html
    assert "dependency_unavailable: geocalib" in html
    assert "../sample_04/baseline/02-rectified-facade.png" in html.replace("\\", "/")
