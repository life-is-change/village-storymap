from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


class JobNotFoundError(KeyError):
    pass


class DiskJobStore:
    def __init__(self, runtime_root: Path):
        self.runtime_root = Path(runtime_root)
        self.runtime_root.mkdir(parents=True, exist_ok=True)

    def job_dir(self, job_id: str) -> Path:
        if not job_id or any(character not in "0123456789abcdef-" for character in job_id):
            raise JobNotFoundError(job_id)
        return self.runtime_root / job_id

    def create(self, record: dict[str, Any]) -> dict[str, Any]:
        job_dir = self.job_dir(record["id"])
        job_dir.mkdir(parents=False, exist_ok=False)
        (job_dir / "inputs").mkdir()
        self.write(record["id"], record)
        return record

    def write(self, job_id: str, record: dict[str, Any]) -> None:
        job_dir = self.job_dir(job_id)
        job_dir.mkdir(parents=True, exist_ok=True)
        target = job_dir / "job.json"
        temporary = job_dir / "job.json.tmp"
        temporary.write_text(
            json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        os.replace(temporary, target)

    def get(self, job_id: str) -> dict[str, Any]:
        try:
            target = self.job_dir(job_id) / "job.json"
        except JobNotFoundError:
            raise
        if not target.is_file():
            raise JobNotFoundError(job_id)
        return json.loads(target.read_text(encoding="utf-8"))
