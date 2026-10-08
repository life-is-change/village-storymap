from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class ModelWorkerError(RuntimeError):
    pass


@dataclass(frozen=True)
class ModelArtifacts:
    cleaned_source: Path
    building_mask: Path
    occlusion_mask: Path
    diagnostics: dict[str, object]


class LocalModelClient:
    def __init__(self, base_url: str | None = None, timeout_seconds: float = 300.0):
        self.base_url = (base_url or os.environ.get("RURAL_FACADE_ML_URL") or "http://127.0.0.1:8012").rstrip("/")
        self.timeout_seconds = float(timeout_seconds)

    def health(self) -> dict[str, object]:
        return self._request("GET", "/health")

    def process(self, source_path: Path, output_dir: Path) -> ModelArtifacts:
        payload = self._request(
            "POST",
            "/process",
            {"source_path": str(source_path.resolve()), "output_dir": str(output_dir.resolve())},
        )
        if not payload.get("ok"):
            raise ModelWorkerError(str(payload.get("error") or "本地识别模型处理失败"))
        artifacts = payload.get("artifacts") or {}
        required = ("cleaned_source", "building_mask", "occlusion_mask")
        missing = [name for name in required if not artifacts.get(name)]
        if missing:
            raise ModelWorkerError(f"模型服务缺少输出：{', '.join(missing)}")
        paths = {name: Path(str(artifacts[name])) for name in required}
        absent = [name for name, path in paths.items() if not path.is_file()]
        if absent:
            raise ModelWorkerError(f"模型服务输出文件不存在：{', '.join(absent)}")
        return ModelArtifacts(
            cleaned_source=paths["cleaned_source"],
            building_mask=paths["building_mask"],
            occlusion_mask=paths["occlusion_mask"],
            diagnostics=dict(payload.get("diagnostics") or {}),
        )

    def _request(self, method: str, path: str, payload: dict[str, object] | None = None) -> dict[str, object]:
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        request = Request(
            f"{self.base_url}{path}",
            data=data,
            method=method,
            headers={"Content-Type": "application/json"},
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise ModelWorkerError(f"本地模型服务返回 {exc.code}：{detail[-500:]}") from exc
        except (URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            raise ModelWorkerError(
                "无法连接本地 Grounding DINO＋SAM2.1 服务；请运行 start_facade_generator.ps1"
            ) from exc
