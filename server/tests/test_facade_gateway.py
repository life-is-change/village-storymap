from pathlib import Path

import pytest

from village_processing.facade.gateway import FacadeGateway, artifact_path, safe_message
from village_processing.facade.models import FacadeRun


class Result:
    def __init__(self, data):
        self.data = data


class FakeCall:
    def __init__(self, client, name, payload):
        self.client = client
        self.name = name
        self.payload = payload

    def execute(self):
        self.client.calls.append((self.name, self.payload))
        return Result(self.client.rpc_results.get(self.name, []))


class FakeQuery:
    def __init__(self, client, table_name):
        self.client = client
        self.table_name = table_name
        self.filters = {}

    def select(self, _columns):
        return self

    def eq(self, column, value):
        self.filters[column] = value
        return self

    def single(self):
        return self

    def execute(self):
        self.client.table_calls.append((self.table_name, dict(self.filters)))
        return Result(self.client.table_results.get(self.table_name))


class FakeBucket:
    def __init__(self, client, name):
        self.client = client
        self.name = name

    def download(self, path):
        self.client.downloads.append((self.name, path))
        return self.client.files[(self.name, path)]

    def upload(self, path, content, options):
        self.client.uploads.append((self.name, path, content, options))
        self.client.files[(self.name, path)] = content


class FakeStorage:
    def __init__(self, client):
        self.client = client

    def from_(self, name):
        return FakeBucket(self.client, name)


class FakeSupabase:
    def __init__(self):
        self.calls = []
        self.rpc_results = {}
        self.table_calls = []
        self.table_results = {}
        self.downloads = []
        self.uploads = []
        self.files = {}
        self.storage = FakeStorage(self)

    def rpc(self, name, payload):
        return FakeCall(self, name, payload)

    def table(self, name):
        return FakeQuery(self, name)


class FakeStreamResponse:
    def __init__(self, chunks, content_type="image/jpeg"):
        self.chunks = chunks
        self.headers = {"content-type": content_type}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def raise_for_status(self):
        return None

    def iter_bytes(self):
        yield from self.chunks


class FakeHttp:
    def __init__(self, chunks):
        self.chunks = chunks
        self.calls = []

    def stream(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        return FakeStreamResponse(self.chunks)


def run_row(**overrides):
    row = {
        "id": "run-1",
        "owner_id": "user-1",
        "photo_id": 4,
        "object_code": "B-1",
        "space_id": "current",
        "status": "queued_generation",
        "generation_revision": 2,
        "source_photo_path": "project/village/current/building/front.jpg",
        "crop_top": 0.18,
        "roof_type": "gable",
        "building_width": 10,
        "building_depth": 8,
    }
    row.update(overrides)
    return row


def test_facade_run_preserves_stage_and_revision():
    run = FacadeRun.from_row(run_row())

    assert run.phase == "generation"
    assert run.generation_revision == 2


def test_awaiting_crop_is_not_a_claimable_phase():
    run = FacadeRun.from_row(run_row(status="awaiting_crop"))

    with pytest.raises(ValueError, match="UNCLAIMABLE_FACADE_STATUS"):
        _ = run.phase


def test_gateway_claims_from_facade_rpc():
    client = FakeSupabase()
    client.rpc_results["claim_next_facade_run"] = [
        run_row(status="claimed_rectification", generation_revision=0)
    ]

    run = FacadeGateway(client).claim("linux-4090-01")

    assert run.phase == "rectification"
    assert client.calls == [("claim_next_facade_run", {"p_worker_id": "linux-4090-01"})]


def test_artifact_path_is_owner_run_and_phase_scoped():
    run = FacadeRun.from_row(run_row())

    assert artifact_path(run, "generation-r2", "building.glb") == (
        "user-1/run-1/generation-r2/building.glb"
    )
    with pytest.raises(ValueError, match="INVALID_ARTIFACT_FILENAME"):
        artifact_path(run, "generation-r2", "../building.glb")


def test_download_photo_uses_frozen_run_photo_path(monkeypatch, tmp_path):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    client = FakeSupabase()
    run = FacadeRun.from_row(run_row())
    http = FakeHttp([b"\xff\xd8\xffphoto"])

    output = FacadeGateway(client, http_client=http).download_photo(run, tmp_path / "source.jpg")

    assert output.read_bytes() == b"\xff\xd8\xffphoto"
    assert "/house-photos/project/village/current/building/front.jpg" in http.calls[0][1]
    assert client.table_calls == []


def test_legacy_photo_url_is_restricted_to_configured_supabase(monkeypatch, tmp_path):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    run = FacadeRun.from_row(run_row(
        source_photo_path=None,
        source_photo_url="https://evil.example/storage/v1/object/public/house-photos/front.jpg",
    ))

    with pytest.raises(ValueError, match="PHOTO_URL_INVALID"):
        FacadeGateway(FakeSupabase()).download_photo(run, tmp_path / "source.jpg")


def test_allowed_legacy_photo_is_streamed_without_redirects(monkeypatch, tmp_path):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    url = "https://project.supabase.co/storage/v1/object/public/house-photos/old/front.jpg"
    run = FacadeRun.from_row(run_row(source_photo_path=None, source_photo_url=url))
    http = FakeHttp([b"\xff\xd8\xff", b"photo"])

    output = FacadeGateway(FakeSupabase(), http_client=http).download_photo(
        run, tmp_path / "source.jpg"
    )

    assert output.read_bytes() == b"\xff\xd8\xffphoto"
    assert http.calls[0][2]["follow_redirects"] is False


def test_storage_photo_has_ten_megabyte_stream_limit(monkeypatch, tmp_path):
    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    run = FacadeRun.from_row(run_row())
    http = FakeHttp([b"\xff\xd8\xff", b"x" * (10 * 1024 * 1024)])

    with pytest.raises(ValueError, match="PHOTO_TOO_LARGE"):
        FacadeGateway(FakeSupabase(), http_client=http).download_photo(run, tmp_path / "source.jpg")


def test_renew_rejects_lost_lease():
    client = FakeSupabase()
    client.rpc_results["renew_facade_run_lease"] = False
    gateway = FacadeGateway(client)

    with pytest.raises(RuntimeError, match="FACADE_LEASE_LOST"):
        gateway.renew("run-1", "worker-1")
    with pytest.raises(RuntimeError, match="FACADE_LEASE_LOST"):
        gateway.assert_lease("run-1")


def test_upload_artifact_sets_mime_hash_and_deterministic_path(tmp_path):
    source = tmp_path / "preview.webp"
    source.write_bytes(b"webp-preview")
    client = FakeSupabase()
    run = FacadeRun.from_row(run_row())

    storage_path = FacadeGateway(client).upload_artifact(
        run,
        "linux-4090-01",
        "rectification",
        "rectified_preview",
        source,
        "image/webp",
        {"pipeline": "facade"},
    )

    assert storage_path == "user-1/run-1/rectification/preview.webp"
    assert client.uploads[0][3] == {"content-type": "image/webp", "upsert": "true"}
    rpc_name, payload = client.calls[-1]
    assert rpc_name == "record_facade_artifact"
    assert payload["p_storage_path"] == storage_path
    assert payload["p_size_bytes"] == 12
    assert payload["p_sha256"] == "ab916ea41dfe485fc982a481aeddd13a7b6bdf4321827d13ac654251a6f5e9ca"


def test_complete_generation_uses_atomic_publication_rpc(tmp_path):
    model = tmp_path / "building.glb"
    model.write_bytes(b"glTF" + b"\x00" * 24)
    client = FakeSupabase()
    run = FacadeRun.from_row(run_row(status="generating"))

    FacadeGateway(client).complete_generation(run, "linux-4090-01", model, {"blender": "3.0.1"})

    assert client.calls[-1][0] == "publish_facade_generation"
    assert client.calls[-1][1]["p_generation_revision"] == 2
    assert client.calls[-1][1]["p_content_type"] == "model/gltf-binary"


def test_failure_message_redacts_windows_posix_urls_and_credentials():
    value = safe_message(
        r"C:\secret\front.jpg and /srv/private/model.ckpt at https://example.test eyJabcdefghijklmnopqrstuvwxyz.abc"
    )

    assert "C:\\" not in value
    assert "/srv/private" not in value
    assert "https://" not in value
    assert "eyJ" not in value
