from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from experiments.facade_25d.constrained_mesh import rectify_with_constrained_mesh

from .auto_rectify import FacadeRectificationError, RectificationResult
from .image_io import read_image, write_image
from .model_client import LocalModelClient, ModelWorkerError


def _architectural_lines(image: np.ndarray, mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    height, width = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(gray, 42, 130)
    support = cv2.dilate(mask, np.ones((11, 11), np.uint8))
    edges[support == 0] = 0
    found = cv2.HoughLinesP(
        edges,
        1,
        np.pi / 720,
        threshold=max(28, min(height, width) // 24),
        minLineLength=max(28, min(height, width) // 15),
        maxLineGap=max(10, min(height, width) // 55),
    )
    if found is None:
        raise FacadeRectificationError("未能在主建筑内检测到可靠的结构线")
    lines = found[:, 0].astype(np.float64).reshape(-1, 2, 2)
    delta = lines[:, 1] - lines[:, 0]
    length = np.linalg.norm(delta, axis=1)
    horizontal = lines[(np.abs(delta[:, 0]) >= np.abs(delta[:, 1]) * 1.35) & (length >= width * 0.035)]
    vertical = lines[(np.abs(delta[:, 1]) >= np.abs(delta[:, 0]) * 1.35) & (length >= height * 0.035)]
    if len(horizontal) < 2 or len(vertical) < 2:
        raise FacadeRectificationError("主建筑缺少足够的横向或竖向结构线，无法生成正立面")

    horizontal = horizontal.copy()
    horizontal[horizontal[:, 1, 0] < horizontal[:, 0, 0]] = horizontal[
        horizontal[:, 1, 0] < horizontal[:, 0, 0], ::-1
    ]
    vertical = vertical.copy()
    vertical[vertical[:, 1, 1] < vertical[:, 0, 1]] = vertical[
        vertical[:, 1, 1] < vertical[:, 0, 1], ::-1
    ]

    def strongest(values: np.ndarray, count: int = 18) -> np.ndarray:
        lengths = np.linalg.norm(values[:, 1] - values[:, 0], axis=1)
        return values[np.argsort(-lengths)[:count]]

    return strongest(horizontal), strongest(vertical)


def _mask_polygon(mask: np.ndarray) -> np.ndarray:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        raise FacadeRectificationError("SAM2.1 没有返回可用的主建筑掩膜")
    contour = max(contours, key=cv2.contourArea)
    x, y, width, height = cv2.boundingRect(contour)
    if width * height < mask.size * 0.08:
        raise FacadeRectificationError("识别到的主建筑范围过小，请让建筑占据照片主体")
    return np.float64(
        [[x, y], [x + width - 1, y], [x + width - 1, y + height - 1], [x, y + height - 1]]
    )


def _tight_mask_crop(image: np.ndarray, mask: np.ndarray, padding_ratio: float = 0.006) -> tuple[np.ndarray, tuple[int, int, int, int]]:
    ys, xs = np.nonzero(mask > 0)
    if not len(xs):
        raise FacadeRectificationError("矫正后的主建筑掩膜为空")
    pad = max(2, round(image.shape[1] * padding_ratio))
    x0, x1 = max(0, int(xs.min()) - pad), min(image.shape[1], int(xs.max()) + 1 + pad)
    y0, y1 = max(0, int(ys.min()) - pad), min(image.shape[0], int(ys.max()) + 1 + pad)
    return np.ascontiguousarray(image[y0:y1, x0:x1]), (x0, y0, x1, y1)


class FullLocalFacadeRectifier:
    def __init__(self, model_client: LocalModelClient | None = None, output_width: int = 1400):
        self.model_client = model_client or LocalModelClient()
        self.output_width = int(output_width)

    def rectify_file(self, source_path: Path, artifact_dir: Path) -> RectificationResult:
        artifact_dir.mkdir(parents=True, exist_ok=True)
        try:
            model = self.model_client.process(source_path, artifact_dir / "ml")
        except ModelWorkerError as exc:
            raise FacadeRectificationError(str(exc)) from exc
        cleaned = read_image(model.cleaned_source)
        building_mask = cv2.imdecode(np.fromfile(model.building_mask, np.uint8), cv2.IMREAD_GRAYSCALE)
        if cleaned is None or building_mask is None or building_mask.shape != cleaned.shape[:2]:
            raise FacadeRectificationError("本地模型输出的图片或掩膜无效")

        horizontal, vertical = _architectural_lines(cleaned, building_mask)
        polygon = _mask_polygon(building_mask)
        try:
            mesh = rectify_with_constrained_mesh(
                cleaned,
                polygon,
                horizontal,
                vertical,
                columns=np.linspace(0.0, 1.0, 8),
                rows=np.linspace(0.0, 1.0, 8),
                output_width=self.output_width,
                padding=8,
                max_displacement=(18.0, 14.0),
                canvas_mode="union",
            )
        except ValueError as exc:
            raise FacadeRectificationError(f"H0＋结构保持网格矫正失败：{exc}") from exc
        warped_mask = cv2.remap(
            building_mask,
            mesh.map_x,
            mesh.map_y,
            interpolation=cv2.INTER_NEAREST,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=0,
        )
        result, crop = _tight_mask_crop(mesh.image, warped_mask)
        x0, y0, x1, y1 = crop
        aligned_mask = np.ascontiguousarray(warped_mask[y0:y1, x0:x1])
        write_image(artifact_dir / "building_mask_source.png", building_mask, ".png")
        write_image(artifact_dir / "building_mask_rectified.png", aligned_mask, ".png")
        return RectificationResult(
            image=result,
            diagnostics={
                "method": "grounding_dino_sam2_1_lama_global_h0_structure_mesh",
                "resample_passes": 1,
                "horizontal_line_count": int(len(horizontal)),
                "vertical_line_count": int(len(vertical)),
                "rectified_crop": list(crop),
                "mesh": mesh.diagnostics,
                "models": model.diagnostics,
            },
        )
