from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import platform
import subprocess
import sys
from pathlib import Path

from experiments.facade_model_ab.adapters import DeepLSDAdapter, GeoCalibAdapter
from experiments.facade_model_ab.report import generate_report
from experiments.facade_model_ab.runner import run_sample_ab


DEFAULT_SAMPLES = ("sample_04", "sample_05", "sample_06")


def discover_sample_manifests(
    samples_root: Path, names: tuple[str, ...] = DEFAULT_SAMPLES
) -> dict[str, Path]:
    samples_root = Path(samples_root)
    manifests: dict[str, Path] = {}
    for name in names:
        manifest = samples_root / name / "constrained-manifest.json"
        if not manifest.is_file():
            raise FileNotFoundError(f"missing constrained manifest for {name}: {manifest}")
        manifests[name] = manifest
    return manifests


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _repo_commit(path: Path) -> str:
    result = subprocess.run(
        ["git", "-C", str(path), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def _environment_inventory(model_root: Path, weights_root: Path) -> dict[str, object]:
    try:
        import torch

        cuda_available = torch.cuda.is_available()
        torch_info: dict[str, object] = {
            "version": torch.__version__,
            "cuda_runtime": torch.version.cuda,
            "cuda_available": cuda_available,
            "device": torch.cuda.get_device_name(0) if cuda_available else "cpu",
        }
    except ImportError:
        torch_info = {"available": False}
    packages: dict[str, str | None] = {}
    for package in ("numpy", "scipy", "opencv-python", "pillow", "scikit-image", "kornia"):
        try:
            packages[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            packages[package] = None
    weights: dict[str, object] = {}
    for path in sorted(weights_root.glob("*.tar")):
        weights[path.name] = {"bytes": path.stat().st_size, "sha256": _sha256(path)}
    return {
        "python": sys.version,
        "platform": platform.platform(),
        "torch": torch_info,
        "packages": packages,
        "repositories": {
            "GeoCalib": _repo_commit(model_root / "GeoCalib"),
            "DeepLSD": _repo_commit(model_root / "DeepLSD"),
        },
        "weights": weights,
        "deeplsd_extraction": "opencv_lsd_compat on this Windows host; official pytlsd on Linux",
    }


def run_real_matrix(
    samples_root: Path,
    output_root: Path,
    model_root: Path,
    weights_root: Path,
    *,
    max_deeplsd_side: int = 1024,
) -> dict[str, Path]:
    manifests = discover_sample_manifests(samples_root)
    output_root.mkdir(parents=True, exist_ok=True)
    geocalib = GeoCalibAdapter(
        weights_root / "geocalib-distorted.tar",
        camera_model="simple_radial",
    )
    deeplsd = DeepLSDAdapter(
        weights_root / "deeplsd_md.tar",
        max_side=max_deeplsd_side,
    )
    sample_roots: dict[str, Path] = {}
    for name, manifest in manifests.items():
        sample_output = output_root / name
        results = run_sample_ab(
            manifest,
            sample_output,
            geocalib=geocalib,
            deeplsd=deeplsd,
        )
        sample_roots[name] = sample_output
        states = ", ".join(f"{variant}={result.status}" for variant, result in results.items())
        print(f"{name}: {states}", flush=True)
    report_paths = generate_report(sample_roots, output_root / "report")
    inventory_path = output_root / "environment.json"
    inventory_path.write_text(
        json.dumps(
            _environment_inventory(model_root, weights_root),
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return {**report_paths, "environment": inventory_path}


def main() -> int:
    parser = argparse.ArgumentParser(description="Run GeoCalib and DeepLSD facade A/B matrix")
    parser.add_argument("--samples-root", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--model-root", type=Path, required=True)
    parser.add_argument("--weights-root", type=Path, required=True)
    parser.add_argument("--max-deeplsd-side", type=int, default=1024)
    args = parser.parse_args()
    paths = run_real_matrix(
        args.samples_root,
        args.output_root,
        args.model_root,
        args.weights_root,
        max_deeplsd_side=args.max_deeplsd_side,
    )
    for name, path in paths.items():
        print(f"{name}: {path.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

