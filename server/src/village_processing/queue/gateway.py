import json
from copy import deepcopy
from pathlib import Path
import re

from village_processing.contracts import ArtifactSummary
from .models import QueuedRun


BUCKET = "geoprocessing-results"


def safe_message(message: str) -> str:
    text = re.sub(r"(?i)\b[a-z]:\\[^\r\n,;]+", "[local path]", str(message))
    text = re.sub(r"https?://\S+", "[remote service]", text)
    text = re.sub(r"\beyJ[A-Za-z0-9_.-]{20,}\b", "[credential]", text)
    text = text.replace("Traceback (most recent call last):", "")
    return " ".join(text.split())[:300]


class SupabaseGateway:
    def __init__(self, client):
        self.client = client

    def claim(self, worker_id: str) -> QueuedRun | None:
        rows = self.client.rpc(
            "claim_next_geoprocessing_run", {"p_worker_id": worker_id}
        ).execute().data or []
        if not rows:
            return None
        row = dict(rows[0])
        row["input_manifest"] = self._sign_input_manifest(row.get("input_manifest"))
        return QueuedRun.from_row(row)

    def _sign_input_manifest(self, manifest):
        if not isinstance(manifest, dict):
            return None
        signed = deepcopy(manifest)
        files = signed.get("files")
        if not isinstance(files, dict):
            raise ValueError("DATASET_MANIFEST_INVALID")
        for item in files.values():
            if not isinstance(item, dict):
                raise ValueError("DATASET_MANIFEST_INVALID")
            bucket = str(item.pop("bucket", "village-datasets"))
            path = str(item.pop("path", ""))
            if not path or ".." in Path(path).parts:
                raise ValueError("DATASET_STORAGE_PATH_INVALID")
            result = self.client.storage.from_(bucket).create_signed_url(path, 900)
            url = result.get("signedURL") or result.get("signedUrl")
            if not url:
                raise ValueError("DATASET_SIGNED_URL_FAILED")
            item["url"] = url
        return signed

    def renew(self, run_id: str, worker_id: str) -> None:
        self.client.rpc("renew_geoprocessing_lease", {
            "p_run_id": run_id, "p_worker_id": worker_id,
        }).execute()

    def _state(self, run_id: str, worker_id: str, status: str, **values) -> None:
        payload = {"p_run_id": run_id, "p_worker_id": worker_id, "p_status": status}
        payload.update(values)
        self.client.rpc("set_geoprocessing_run_state", payload).execute()

    def set_running(self, run_id: str, worker_id: str) -> None:
        self._state(run_id, worker_id, "running", p_stage="starting", p_progress=1)

    def set_stage(self, run_id: str, worker_id: str, stage: str, progress: int) -> None:
        self._state(run_id, worker_id, "running", p_stage=stage, p_progress=progress)

    def complete(self, run_id: str, worker_id: str, warnings: tuple[str, ...]) -> None:
        self._state(
            run_id, worker_id, "completed", p_stage="completed", p_progress=100,
            p_warnings=list(warnings),
        )

    def fail(self, run_id: str, worker_id: str, error_code: str, message: str) -> None:
        self._state(
            run_id, worker_id, "failed", p_error_code=error_code,
            p_error_message=safe_message(message),
        )

    def cancel(self, run_id: str, worker_id: str) -> None:
        self._state(run_id, worker_id, "canceled", p_stage="canceled")

    def is_cancel_requested(self, run_id: str) -> bool:
        result = self.client.table("geoprocessing_runs").select("status").eq("id", run_id).single().execute()
        return bool(result.data and result.data.get("status") == "cancel_requested")

    def upload_artifact(
        self, owner_id: str, run_id: str, worker_id: str, summary: ArtifactSummary
    ) -> str:
        storage_path = f"{owner_id}/{run_id}/{summary.path.name}"
        self.client.storage.from_(BUCKET).upload(
            storage_path,
            Path(summary.path).read_bytes(),
            {"content-type": "application/geo+json", "upsert": "true"},
        )
        try:
            source = json.loads(summary.source)
        except (TypeError, json.JSONDecodeError):
            source = {"description": safe_message(summary.source)}
        self.client.rpc("record_geoprocessing_artifact", {
            "p_run_id": run_id,
            "p_worker_id": worker_id,
            "p_artifact_type": summary.artifact_type,
            "p_storage_path": storage_path,
            "p_feature_count": summary.feature_count,
            "p_bbox": list(summary.bbox),
            "p_sha256": summary.sha256,
            "p_source": source,
            "p_warning_code": summary.warning_code,
        }).execute()
        return storage_path

    def heartbeat(self, worker_id: str, state: str, version: str) -> None:
        self.client.rpc("upsert_worker_heartbeat", {
            "p_worker_id": worker_id, "p_state": state, "p_version": version,
        }).execute()
