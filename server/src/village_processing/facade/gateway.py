from __future__ import annotations

import hashlib
import os
from pathlib import Path, PurePosixPath
import re
from typing import Any
from urllib.parse import urlsplit
from urllib.parse import quote

import httpx

from .models import FacadeRun


BUCKET = "facade-generation"
PHOTO_BUCKET = "house-photos"
ALLOWED_PHOTO_CONTENT_TYPES = {"image/jpeg", "image/png"}
MAX_PHOTO_BYTES = 10 * 1024 * 1024


class FacadeLeaseLost(RuntimeError):
    pass


def safe_message(message: str) -> str:
    text = str(message)
    text = re.sub(r"(?i)\b[a-z]:\\[^\r\n,;]+", "[local path]", text)
    text = re.sub(
        r"(?<![A-Za-z0-9])/(?:srv|home|opt|var|tmp|mnt|work)/[^\s,;]+",
        "[local path]",
        text,
    )
    text = re.sub(r"https?://\S+", "[remote service]", text)
    text = re.sub(r"\beyJ[A-Za-z0-9_.-]{20,}\b", "[credential]", text)
    text = text.replace("Traceback (most recent call last):", "")
    return " ".join(text.split())[:300]


def artifact_path(run: FacadeRun, phase: str, filename: str) -> str:
    phase_path = PurePosixPath(phase)
    file_path = PurePosixPath(filename)
    if (
        not phase
        or phase_path.is_absolute()
        or ".." in phase_path.parts
        or not filename
        or file_path.is_absolute()
        or len(file_path.parts) != 1
        or ".." in file_path.parts
    ):
        raise ValueError("INVALID_ARTIFACT_FILENAME")
    return f"{run.owner_id}/{run.run_id}/{phase}/{filename}"


class FacadeGateway:
    def __init__(self, client, *, http_client: Any | None = None):
        self.client = client
        self.http_client = http_client or httpx
        self._lost_leases: set[str] = set()

    def claim(self, worker_id: str) -> FacadeRun | None:
        rows = self.client.rpc(
            "claim_next_facade_run", {"p_worker_id": worker_id}
        ).execute().data or []
        if not rows:
            return None
        run = FacadeRun.from_row(rows[0])
        self._lost_leases.discard(run.run_id)
        return run

    def renew(self, run_id: str, worker_id: str) -> None:
        try:
            result = self.client.rpc(
                "renew_facade_run_lease",
                {"p_run_id": run_id, "p_worker_id": worker_id},
            ).execute().data
        except Exception:
            self._lost_leases.add(run_id)
            raise
        if result is not True:
            self._lost_leases.add(run_id)
            raise FacadeLeaseLost("FACADE_LEASE_LOST")

    def assert_lease(self, run_id: str) -> None:
        if run_id in self._lost_leases:
            raise FacadeLeaseLost("FACADE_LEASE_LOST")

    def set_state(
        self,
        run_id: str,
        worker_id: str,
        status: str,
        *,
        stage: str | None = None,
        progress: int | None = None,
        error_code: str | None = None,
        error_message: str | None = None,
    ) -> None:
        self.client.rpc(
            "set_facade_run_state",
            {
                "p_run_id": run_id,
                "p_worker_id": worker_id,
                "p_status": status,
                "p_stage": stage,
                "p_progress": progress,
                "p_error_code": error_code,
                "p_error_message": safe_message(error_message) if error_message else None,
            },
        ).execute()

    def fail(self, run_id: str, worker_id: str, error_code: str, message: str) -> None:
        self.set_state(
            run_id,
            worker_id,
            "failed",
            stage="failed",
            error_code=error_code,
            error_message=message,
        )

    def retry_or_fail(self, run_id: str, worker_id: str, code: str, message: str) -> str:
        result = self.client.rpc(
            "retry_or_fail_facade_run",
            {
                "p_run_id": run_id,
                "p_worker_id": worker_id,
                "p_error_code": code,
                "p_error_message": safe_message(message),
            },
        ).execute().data
        return str(result or "")

    def cancel(self, run_id: str, worker_id: str) -> None:
        self.set_state(run_id, worker_id, "canceled", stage="canceled")

    def is_cancel_requested(self, run_id: str) -> bool:
        result = (
            self.client.table("facade_generation_runs")
            .select("status")
            .eq("id", run_id)
            .single()
            .execute()
        )
        return bool(result.data and result.data.get("status") == "cancel_requested")

    def download_photo(self, run: FacadeRun, destination: Path) -> Path:
        storage_path = str(run.source_photo_path or "").strip()
        if storage_path:
            if PurePosixPath(storage_path).is_absolute() or ".." in PurePosixPath(storage_path).parts:
                raise ValueError("PHOTO_STORAGE_PATH_INVALID")
            base = os.environ.get("SUPABASE_URL", "").rstrip("/")
            if not base:
                raise ValueError("SUPABASE_URL_INVALID")
            content = self._download_legacy_photo_url(
                f"{base}/storage/v1/object/public/{PHOTO_BUCKET}/{quote(storage_path, safe='/')}"
            )
        else:
            content = self._download_legacy_photo_url(str(run.source_photo_url or ""))
        if len(content) > MAX_PHOTO_BYTES:
            raise ValueError("PHOTO_TOO_LARGE")
        if not _looks_like_supported_photo(content):
            raise ValueError("PHOTO_CONTENT_INVALID")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
        return destination

    def _download_legacy_photo_url(self, database_url: str) -> bytes:
        target = urlsplit(database_url)
        supabase = urlsplit(os.environ.get("SUPABASE_URL", ""))
        allowed_prefix = f"/storage/v1/object/public/{PHOTO_BUCKET}/"
        if (target.scheme != "https" or not supabase.hostname
                or target.hostname != supabase.hostname or target.port not in (None, 443)
                or target.username or target.password or not target.path.startswith(allowed_prefix)):
            raise ValueError("PHOTO_URL_INVALID")
        chunks: list[bytes] = []
        size = 0
        with self.http_client.stream(
            "GET", database_url, timeout=30, follow_redirects=False,
            headers={"Accept": "image/jpeg,image/png"},
        ) as response:
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code in (403, 404):
                    raise ValueError("PHOTO_NOT_FOUND") from exc
                raise
            content_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
            if content_type not in ALLOWED_PHOTO_CONTENT_TYPES:
                raise ValueError("PHOTO_CONTENT_TYPE_INVALID")
            length = response.headers.get("content-length")
            if length and int(length) > MAX_PHOTO_BYTES:
                raise ValueError("PHOTO_TOO_LARGE")
            for chunk in response.iter_bytes():
                size += len(chunk)
                if size > MAX_PHOTO_BYTES:
                    raise ValueError("PHOTO_TOO_LARGE")
                chunks.append(chunk)
        return b"".join(chunks)

    def download_artifact(
        self,
        run: FacadeRun,
        artifact_type: str,
        destination: Path,
    ) -> Path:
        row = (
            self.client.table("facade_generation_artifacts")
            .select("storage_path")
            .eq("run_id", run.run_id)
            .eq("artifact_type", artifact_type)
            .single()
            .execute()
            .data
        )
        storage_path = str((row or {}).get("storage_path") or "")
        required_prefix = f"{run.owner_id}/{run.run_id}/"
        if not storage_path.startswith(required_prefix) or ".." in PurePosixPath(storage_path).parts:
            raise ValueError("FACADE_ARTIFACT_PATH_INVALID")
        content = self.client.storage.from_(BUCKET).download(storage_path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
        return destination

    def upload_artifact(
        self,
        run: FacadeRun,
        worker_id: str,
        phase: str,
        artifact_type: str,
        source_path: Path,
        content_type: str,
        source: dict,
    ) -> str:
        content = source_path.read_bytes()
        storage_path = artifact_path(run, phase, source_path.name)
        self.client.storage.from_(BUCKET).upload(
            storage_path,
            content,
            {"content-type": content_type, "upsert": "true"},
        )
        self.client.rpc(
            "record_facade_artifact",
            {
                "p_run_id": run.run_id,
                "p_worker_id": worker_id,
                "p_artifact_type": artifact_type,
                "p_storage_path": storage_path,
                "p_content_type": content_type,
                "p_size_bytes": len(content),
                "p_sha256": hashlib.sha256(content).hexdigest(),
                "p_generation_revision": run.generation_revision,
                "p_source": source,
            },
        ).execute()
        return storage_path

    def publish_rectification(
        self,
        run_id: str,
        worker_id: str,
        artifacts: list[dict],
    ) -> None:
        self.client.rpc(
            "publish_facade_rectification",
            {"p_run_id": run_id, "p_worker_id": worker_id, "p_artifacts": artifacts},
        ).execute()

    def complete_generation(
        self,
        run: FacadeRun,
        worker_id: str,
        model_path: Path,
        source: dict,
    ) -> str:
        content = model_path.read_bytes()
        storage_path = artifact_path(
            run,
            f"generation-r{run.generation_revision}",
            model_path.name,
        )
        self.client.storage.from_(BUCKET).upload(
            storage_path,
            content,
            {"content-type": "model/gltf-binary", "upsert": "true"},
        )
        self.client.rpc(
            "publish_facade_generation",
            {
                "p_run_id": run.run_id,
                "p_worker_id": worker_id,
                "p_storage_path": storage_path,
                "p_content_type": "model/gltf-binary",
                "p_size_bytes": len(content),
                "p_sha256": hashlib.sha256(content).hexdigest(),
                "p_generation_revision": run.generation_revision,
                "p_source": source,
            },
        ).execute()
        return storage_path

    def heartbeat(self, worker_id: str, state: str, version: str) -> None:
        self.client.rpc(
            "upsert_worker_heartbeat",
            {"p_worker_id": worker_id, "p_state": state, "p_version": version},
        ).execute()


def _looks_like_supported_photo(content: bytes) -> bool:
    return content.startswith(b"\xff\xd8\xff") or content.startswith(b"\x89PNG\r\n\x1a\n")
