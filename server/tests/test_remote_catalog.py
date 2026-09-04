import hashlib
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

import pytest

from village_processing.catalog import DatasetCatalog, VillageDataset
from village_processing.contracts import ProcessingParameters, ProcessingRequest
from village_processing.pipeline import resolve_dataset
from village_processing.remote_catalog import RemoteDatasetResolver


AOI = {"type": "Polygon", "coordinates": [[[113, 23], [114, 23], [114, 24], [113, 23]]]}


def make_request(**overrides):
    request = ProcessingRequest(
        run_id=str(uuid4()),
        village_id="village-1",
        aoi=AOI,
        requested_steps=("buildings",),
        parameters=ProcessingParameters(),
        work_dir=Path("runs/example"),
        dataset_id="dataset-1",
        input_manifest=overrides.pop("input_manifest", None),
    )
    return replace(request, **overrides)


def test_remote_manifest_rejects_unlisted_host(tmp_path):
    resolver = RemoteDatasetResolver(
        download=lambda url, target: None,
        allowed_hosts={"rzmbmwauomzwiyenafha.supabase.co"},
    )
    request = make_request(input_manifest={"files": {"imagery": {"url": "https://example.com/a.tif", "size": 1, "sha256": "0" * 64}}})
    with pytest.raises(ValueError, match="DATASET_URL_NOT_ALLOWED"):
        resolver.resolve(request, tmp_path)


def test_remote_manifest_downloads_and_checks_hash(tmp_path):
    content = b"dataset"
    digest = hashlib.sha256(content).hexdigest()
    manifest = {
        "display_name": "正式村庄",
        "bounds": [113, 23, 114, 24],
        "files": {
            key: {"url": f"https://rzmbmwauomzwiyenafha.supabase.co/storage/{key}", "size": len(content), "sha256": digest}
            for key in ("imagery", "dem", "osm", "model_config", "model_checkpoint")
        },
    }

    def download(_url, target):
        target.write_bytes(content)

    dataset = RemoteDatasetResolver(download=download).resolve(
        make_request(input_manifest=manifest), tmp_path
    )
    assert dataset.village_id == "village-1"
    assert dataset.imagery.read_bytes() == content


def test_mibu_without_dataset_id_uses_local_catalog(tmp_path):
    files = []
    for name in ("imagery", "dem", "osm", "model.py", "model.pth"):
        path = tmp_path / name
        path.touch()
        files.append(path)
    item = VillageDataset("mibu", "米埗村", *files[:3], (113, 23, 114, 24), *files[3:], "snapshot", "dem")
    request = make_request(village_id="mibu", dataset_id=None, input_manifest=None)
    assert resolve_dataset(request, DatasetCatalog({"mibu": item}), None).village_id == "mibu"


def test_formal_village_requires_dataset_id(tmp_path):
    request = make_request(dataset_id=None, input_manifest=None)
    with pytest.raises(ValueError, match="DATASET_ID_REQUIRED"):
        resolve_dataset(request, DatasetCatalog({}), None)
