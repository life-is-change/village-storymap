# Native Geoprocessing Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Windows 11 上建立两个 `platform_*` Conda 环境，并用同一任务清单稳定生成建筑、道路、水系和等高线 GeoJSON。

**Architecture:** `platform_geo_worker` 负责数据目录、AOI、OSM、DEM 和统一 CLI；`platform_building_worker` 运行常驻的本机建筑推理服务。两者共享纯 Python 契约，建筑服务只接受 Worker 生成的本地任务清单并绑定 `127.0.0.1`。

**Tech Stack:** Python 3.10/3.11、Conda、PyTorch 2.1 + CUDA 11.8、MMDetection 2.28.2、MMCV 1.7.2、GDAL/OGR、Rasterio、GeoPandas、Shapely、SciPy、FastAPI、pytest。

## Global Constraints

- 环境前缀必须是 `E:\anaconda3\envs\platform_building_worker` 和 `E:\anaconda3\envs\platform_geo_worker`。
- 不修改 `E:\anaconda3\envs\building_clip`；建筑环境从它克隆后单独修复。
- 禁止安装 Microsoft C++ Build Tools；pip 一律使用 `--only-binary=:all:`，需要源码编译时停止。
- 原始 TIF、PBF、PTH、运行结果和 `.env` 不进入 Git。
- 数据根目录固定由 `PLATFORM_DATA_ROOT` 提供，试运行值为 `E:\村规平台学生体验版`。
- 所有发布 GeoJSON 使用 WGS84 坐标语义；中间计算可使用 UTM。
- 建筑初始运行参数为 tile 1536、overlap 384、batch 1。
- 本阶段不安装 Docker 或 WSL。

---

### Task 1: Python 项目骨架与环境创建脚本

**Files:**
- Create: `server/pyproject.toml`
- Create: `server/environment/platform_geo_worker.yml`
- Create: `server/scripts/create_platform_envs.ps1`
- Create: `server/scripts/export_platform_envs.ps1`
- Create: `server/tests/test_environment_contract.py`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `platform_geo_worker` 与 `platform_building_worker` 两个可寻址 Python 前缀；`python -m village_processing` 入口。

- [ ] **Step 1: 写环境约束失败测试**

```python
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def test_environment_files_forbid_source_builds_and_expected_prefixes():
    script = (ROOT / "server/scripts/create_platform_envs.ps1").read_text("utf-8")
    assert "platform_building_worker" in script
    assert "platform_geo_worker" in script
    assert "--only-binary=:all:" in script
    assert "Build Tools" not in script

def test_large_runtime_assets_are_ignored():
    ignore = (ROOT / ".gitignore").read_text("utf-8")
    for pattern in ("*.pth", "*.pbf", "server/runtime/", "server/.env"):
        assert pattern in ignore
```

- [ ] **Step 2: 运行测试确认失败**

Run: `E:\anaconda3\python.exe -m pytest server/tests/test_environment_contract.py -v`

Expected: FAIL，因为环境脚本尚不存在。

- [ ] **Step 3: 添加项目元数据和 GIS 环境定义**

```toml
# server/pyproject.toml
[build-system]
requires = ["setuptools==70.3.0"]
build-backend = "setuptools.build_meta"

[project]
name = "village-processing"
version = "0.1.0"
requires-python = ">=3.10,<3.12"

[tool.setuptools.packages.find]
where = ["src"]

[tool.pytest.ini_options]
pythonpath = ["src"]
testpaths = ["tests"]
```

```yaml
# server/environment/platform_geo_worker.yml
name: platform_geo_worker
channels:
  - conda-forge
dependencies:
  - python=3.11
  - gdal>=3.10,<3.11
  - rasterio>=1.4,<1.5
  - geopandas>=1.0,<1.2
  - shapely>=2.1,<2.2
  - pyproj>=3.7,<3.8
  - scipy>=1.15,<1.16
  - pyyaml>=6.0,<7
  - httpx>=0.27,<0.29
  - pytest>=8,<9
  - pip
  - pip:
      - supabase>=2.15,<3
```

- [ ] **Step 4: 添加只使用二进制包的创建脚本**

```powershell
# server/scripts/create_platform_envs.ps1
$ErrorActionPreference = 'Stop'
$Conda = 'E:\anaconda3\Scripts\conda.exe'
$BuildingSource = 'E:\anaconda3\envs\building_clip'
$BuildingTarget = 'E:\anaconda3\envs\platform_building_worker'
$GeoTarget = 'E:\anaconda3\envs\platform_geo_worker'

if (!(Test-Path -LiteralPath $BuildingTarget)) {
  & $Conda create --prefix $BuildingTarget --clone $BuildingSource -y
}
& $BuildingTarget\python.exe -m pip install --only-binary=:all: --force-reinstall `
  'numpy==1.26.4' 'setuptools==70.3.0'

if (!(Test-Path -LiteralPath $GeoTarget)) {
  & $Conda env create --prefix $GeoTarget --file server\environment\platform_geo_worker.yml -y
}

& $BuildingTarget\python.exe -m pip install --only-binary=:all: -e server --no-build-isolation
& $GeoTarget\python.exe -m pip install --only-binary=:all: -e server --no-build-isolation
```

`export_platform_envs.ps1` 使用两个前缀分别执行 `conda env export --from-history`，输出到 `server/environment/platform_building_worker.lock.yml` 和 `platform_geo_worker.lock.yml`，随后用文本检查拒绝写入 `E:\村规平台学生体验版` 和任何 `SUPABASE_` 值。

- [ ] **Step 5: 扩充 `.gitignore` 并运行静态测试**

```gitignore
# Geoprocessing server runtime and large local assets
server/.env
server/runtime/
server/environment/*.explicit.txt
*.pth
*.pbf
*.tif
*.tif.ovr
```

Run: `E:\anaconda3\python.exe -m pytest server/tests/test_environment_contract.py -v`

Expected: 2 passed。

- [ ] **Step 6: 创建环境并做 ABI/CUDA 验证**

Run: `powershell -ExecutionPolicy Bypass -File server\scripts\create_platform_envs.ps1`

Run:

```powershell
$env:PYTHONNOUSERSITE='1'
E:\anaconda3\envs\platform_building_worker\python.exe -c "import numpy,torch,mmcv,mmdet; print(numpy.__version__); print(torch.cuda.is_available()); print(torch.from_numpy(numpy.array([1],dtype=numpy.float32)))"
E:\anaconda3\envs\platform_geo_worker\python.exe -c "from osgeo import gdal,ogr; import rasterio,geopandas,shapely,pyproj,scipy; print(gdal.VersionInfo()); print(ogr.GetDriverByName('OSM') is not None)"
```

Expected: NumPy 为 1.26.4；CUDA 为 True；Torch 能接收 NumPy 数组；OSM 驱动为 True；无 `_multiarray_umath` 和 PROJ 数据库错误。

- [ ] **Step 7: 提交**

```bash
git add .gitignore server/pyproject.toml server/environment server/scripts server/tests/test_environment_contract.py
git commit -m "build: add platform worker environments"
```

### Task 2: 数据集目录、任务契约与路径安全

**Files:**
- Create: `server/config/villages.yaml`
- Create: `server/.env.example`
- Create: `server/src/village_processing/__init__.py`
- Create: `server/src/village_processing/contracts.py`
- Create: `server/src/village_processing/catalog.py`
- Create: `server/src/village_processing/raster.py`
- Create: `server/src/village_processing/__main__.py`
- Create: `server/tests/test_catalog.py`
- Create: `server/tests/fixtures/aoi_mibu.geojson`

**Interfaces:**
- Produces: `load_catalog(path, data_root) -> DatasetCatalog`；`DatasetCatalog.resolve(village_id) -> VillageDataset`；`ProcessingRequest.from_json(path)`；基础 CLI `catalog-check` 和 `crop-imagery`。

- [ ] **Step 1: 写目录和逃逸测试**

```python
from pathlib import Path
import pytest
from village_processing.catalog import load_catalog, resolve_under_root

def test_mibu_catalog_resolves_existing_relative_assets(tmp_path: Path):
    (tmp_path / "imagery.tif").touch()
    (tmp_path / "dem.tif").touch()
    (tmp_path / "osm.pbf").touch()
    manifest = tmp_path / "villages.yaml"
    manifest.write_text("villages:\n  mibu:\n    imagery: imagery.tif\n    dem: dem.tif\n    osm: osm.pbf\n", "utf-8")
    item = load_catalog(manifest, tmp_path).resolve("mibu")
    assert item.imagery == (tmp_path / "imagery.tif").resolve()

def test_path_escape_is_rejected(tmp_path: Path):
    with pytest.raises(ValueError, match="DATASET_PATH_ESCAPE"):
        resolve_under_root(tmp_path, "../secret.txt")
```

- [ ] **Step 2: 运行测试确认失败**

Run: `E:\anaconda3\envs\platform_geo_worker\python.exe -m pytest server/tests/test_catalog.py -v`

Expected: FAIL，模块尚不存在。

- [ ] **Step 3: 实现不可变契约和安全解析**

```python
# server/src/village_processing/catalog.py
from dataclasses import dataclass
from pathlib import Path
import yaml

def resolve_under_root(root: Path, relative: str) -> Path:
    root = root.resolve()
    target = (root / relative).resolve()
    if target != root and root not in target.parents:
        raise ValueError("DATASET_PATH_ESCAPE")
    return target

@dataclass(frozen=True)
class VillageDataset:
    village_id: str
    imagery: Path
    dem: Path
    osm: Path
    bounds: tuple[float, float, float, float]
    model_config: Path
    model_checkpoint: Path

class DatasetCatalog:
    def __init__(self, items): self._items = items
    def resolve(self, village_id: str) -> VillageDataset:
        if village_id not in self._items:
            raise KeyError("DATASET_NOT_REGISTERED")
        return self._items[village_id]
```

`contracts.py` 定义 `ProcessingRequest(run_id, village_id, aoi, requested_steps, parameters, work_dir)`，验证 run ID 为 UUID、步骤属于 `buildings/roads_water/contours`、AOI 为 WGS84 Polygon/MultiPolygon、建筑阈值 0.1–0.95、等高距仅 5/10、平滑仅 0/1。它同时定义 `ArtifactSummary(path, artifact_type, feature_count, bbox, sha256, source, warning_code=None)`，后续三个处理器只返回该类型。

`raster.py` 实现 `crop_imagery(source_tif, aoi, output_tif)`，使用 Rasterio window/mask 只写 AOI+50m 缓冲的三波段 GeoTIFF。`__main__.py` 此时先注册 `catalog-check` 和 `crop-imagery` 两个子命令，后续任务在同一 parser 上追加 `osm/contours/run/worker/health`，避免 smoke 命令引用不存在的入口。

`aoi_mibu.geojson` 使用以下确定内容：

```json
{"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[[[113.661,23.676],[113.665,23.676],[113.665,23.679],[113.661,23.679],[113.661,23.676]]]}}
```

- [ ] **Step 4: 写入米埗村版本化相对路径清单**

```yaml
villages:
  mibu:
    imagery: "建筑矢量/input_tif/米埗村（洛一洛二洛三）.tif"
    dem: "等高线/广东省_哥白尼DEM.tif"
    osm: "道路、水系/guangdong-260721.osm.pbf"
    bounds: [113.6578225, 23.6739555, 113.6695615, 23.6806181]
    model_config: "建筑矢量/china/mask_rcnn_x101_64x4d_fpn_2x_building_combine_total_china_finetune.py"
    model_checkpoint: "建筑矢量/china/mask_rcnn_x101_64x4d_fpn_2x_building_combine_total_china_finetune.pth"
    osm_snapshot: "2026-07-21"
    dem_source: "Copernicus DEM GLO-30"
```

- [ ] **Step 5: 运行测试和真实目录只读校验**

Run:

```powershell
$env:PLATFORM_DATA_ROOT='E:\村规平台学生体验版'
E:\anaconda3\envs\platform_geo_worker\python.exe -m pytest server/tests/test_catalog.py -v
E:\anaconda3\envs\platform_geo_worker\python.exe -m village_processing catalog-check --catalog server\config\villages.yaml --village mibu
```

Expected: 测试通过；打印三个源数据路径、影像范围和 `catalog_ok=true`，不打印权重内容。

- [ ] **Step 6: 提交**

```bash
git add server/config server/.env.example server/src/village_processing server/tests
git commit -m "feat: add safe village dataset catalog"
```

### Task 3: 建筑推理适配器与回环服务

**Files:**
- Create: `server/src/village_processing/building/legacy_pipeline.py`
- Create: `server/src/village_processing/building/engine.py`
- Create: `server/src/village_processing/building/service.py`
- Create: `server/src/village_processing/building/smoke.py`
- Create: `server/tests/test_building_engine.py`
- Create: `server/scripts/start_building_service.ps1`

**Interfaces:**
- Consumes: `VillageDataset`、run 工作目录、裁剪后的 GeoTIFF。
- Produces: `BuildingEngine.process(tif_path, output_geojson, score_threshold, batch_size=1) -> ArtifactSummary`；HTTP `POST /process` 和 `GET /health`。

- [ ] **Step 1: 复制现有算法并先写模型注入测试**

Run:

```powershell
Copy-Item -LiteralPath 'E:\村规平台学生体验版\建筑矢量\遥感影像农房矢量化正则化.py' -Destination 'server\src\village_processing\building\legacy_pipeline.py'
```

```python
# server/tests/test_building_engine.py
def test_engine_reuses_loaded_model_and_forces_batch_one(tmp_path, monkeypatch):
    calls = []
    engine = BuildingEngine(model=object(), runner=lambda **kw: calls.append(kw) or kw["output_geojson"])
    out = engine.process(tmp_path / "in.tif", tmp_path / "buildings.geojson", 0.35)
    assert out.name == "buildings.geojson"
    assert calls[0]["model"] is engine.model
    assert calls[0]["batch_size"] == 1
```

- [ ] **Step 2: 运行测试确认失败**

Run: `E:\anaconda3\envs\platform_building_worker\python.exe -m pytest server/tests/test_building_engine.py -v`

Expected: FAIL，`BuildingEngine` 尚不存在。

- [ ] **Step 3: 将旧脚本改成单影像可调用函数**

在 `legacy_pipeline.py` 中保留现有分块、中心区过滤、实例转面和正则化函数，删除顶部四个旧绝对路径常量，并把 `main()` 的单影像主体提取为以下明确接口：

```python
def process_tif(*, model, tif_path, output_dir, score_threshold=0.35,
                batch_size=1, tile_size=1536, overlap=384):
    """Return the path of the regularized shapefile for one GeoTIFF."""
```

该函数不得再次调用 `init_detector`；`engine.py` 只在构造时执行一次：

```python
class BuildingEngine:
    def __init__(self, config_path, checkpoint_path, device="cuda:0", model=None, runner=process_tif):
        self.model = model or init_detector(str(config_path), str(checkpoint_path), device=device)
        self.runner = runner

    def process(self, tif_path, output_geojson, score_threshold, batch_size=1):
        shp = self.runner(model=self.model, tif_path=tif_path,
                          output_dir=output_geojson.parent,
                          score_threshold=score_threshold,
                          batch_size=batch_size, tile_size=1536, overlap=384)
        gdf = geopandas.read_file(shp).to_crs(4326)
        gdf["source"] = "building_model"
        gdf.to_file(output_geojson, driver="GeoJSON")
        return output_geojson
```

`ArtifactSummary.source` 必须记录配置文件 SHA-256、权重 SHA-256、score threshold、tile、overlap、batch 和 device；日志只打印哈希前 12 位，不打印权重内容。

- [ ] **Step 4: 添加仅回环监听的 FastAPI 服务**

`service.py` 的 `/process` 只接受 `manifest_path`，解析后要求其位于 `PLATFORM_WORK_ROOT`，并拒绝请求中的 config/checkpoint/path 覆盖。启动脚本必须固定：

```powershell
$env:PYTHONNOUSERSITE='1'
E:\anaconda3\envs\platform_building_worker\python.exe -m uvicorn `
  village_processing.building.service:app --host 127.0.0.1 --port 8021
```

- [ ] **Step 5: 运行单元测试和小 AOI GPU smoke test**

Run: `E:\anaconda3\envs\platform_building_worker\python.exe -m pytest server/tests/test_building_engine.py -v`

Run: `E:\anaconda3\envs\platform_geo_worker\python.exe -m village_processing crop-imagery --village mibu --aoi server\tests\fixtures\aoi_mibu.geojson --output server\runtime\smoke\building-input.tif`

Run: `E:\anaconda3\envs\platform_building_worker\python.exe -m village_processing.building.smoke --input server\runtime\smoke\building-input.tif --output server\runtime\smoke\buildings.geojson --batch 1`

Expected: CUDA 加载一次；退出码 0；输出为有效 Polygon/MultiPolygon FeatureCollection；显存溢出时返回 `GPU_OUT_OF_MEMORY` 而不是留下半成品。

- [ ] **Step 6: 提交**

```bash
git add server/src/village_processing/building server/tests/test_building_engine.py server/scripts/start_building_service.ps1
git commit -m "feat: add persistent building inference service"
```

### Task 4: OSM 道路与水系处理器

**Files:**
- Create: `server/config/osm_filters.yaml`
- Create: `server/src/village_processing/processors/osm.py`
- Create: `server/tests/test_osm_processor.py`

**Interfaces:**
- Produces: `extract_osm_layers(pbf_path, aoi, output_dir) -> list[ArtifactSummary]`，固定输出 `roads.geojson`、`waterways.geojson`、`water_areas.geojson`。

- [ ] **Step 1: 写分类与空图层测试**

```python
def test_osm_tag_classification():
    assert classify_line({"highway": "residential"}) == "road"
    assert classify_line({"waterway": "ditch"}) == "waterway"
    assert classify_area({"natural": "water"}) == "water_area"

def test_empty_layer_is_valid_warning(tmp_path):
    summary = write_geojson([], tmp_path / "waterways.geojson", "waterways")
    assert summary.feature_count == 0
    assert summary.warning_code == "OSM_LAYER_EMPTY"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `E:\anaconda3\envs\platform_geo_worker\python.exe -m pytest server/tests/test_osm_processor.py -v`

Expected: FAIL，处理器尚不存在。

- [ ] **Step 3: 实现受控 OGR 提取**

`osm.py` 使用参数数组调用 `ogr2ogr`，不使用 shell 拼接。先以 AOI bbox 和 `-where` 从 PBF 的 `lines`/`multipolygons` 提取临时 GeoPackage，再用 GeoPandas 精确裁剪。允许标签固定为：

```yaml
roads: [motorway, trunk, primary, secondary, tertiary, residential, service, living_street, track, path, footway, cycleway]
waterways: [river, stream, canal, ditch, drain]
water_areas:
  natural: [water]
  landuse: [reservoir, basin]
```

命令构造必须保持参数数组：

```python
cmd = [ogr2ogr, "-f", "GPKG", str(temp_gpkg), str(pbf_path), "lines",
       "-spat", str(minx), str(miny), str(maxx), str(maxy),
       "-where", where_clause, "-nln", target_layer]
subprocess.run(cmd, check=True, capture_output=True, text=True)
```

每个要素添加 `source=osm`、`osm_snapshot=2026-07-21`、`attribution=© OpenStreetMap contributors`；空结果写有效空 FeatureCollection 和 warning，不抛异常。

- [ ] **Step 4: 运行单元测试和真实 PBF smoke test**

Run:

```powershell
E:\anaconda3\envs\platform_geo_worker\python.exe -m pytest server/tests/test_osm_processor.py -v
E:\anaconda3\envs\platform_geo_worker\python.exe -m village_processing osm --village mibu --aoi server\tests\fixtures\aoi_mibu.geojson --output server\runtime\smoke\osm
```

Expected: 三个 GeoJSON 均存在；有要素的图层全部位于 AOI；空图层为 warning 而非任务失败。

- [ ] **Step 5: 提交**

```bash
git add server/config/osm_filters.yaml server/src/village_processing/processors/osm.py server/tests/test_osm_processor.py
git commit -m "feat: extract OSM roads and water layers"
```

### Task 5: 掩膜感知 DEM 平滑与等高线处理器

**Files:**
- Create: `server/src/village_processing/processors/contours.py`
- Create: `server/tests/test_contours.py`

**Interfaces:**
- Produces: `masked_gaussian(data, valid, sigma)`；`generate_contours(dem_path, aoi, output_geojson, interval_m, smoothing_sigma) -> ArtifactSummary`。

- [ ] **Step 1: 写合成 DEM 的红灯测试**

```python
def test_masked_gaussian_does_not_bleed_nodata():
    data = np.array([[0, 0, 0], [0, 100, 110], [0, 120, 130]], dtype="float32")
    valid = data != 0
    out = masked_gaussian(data, valid, sigma=1)
    assert np.isnan(out[0, 0])
    assert out[1, 1] > 90

def test_contours_are_interval_multiples(synthetic_dem, square_aoi, tmp_path):
    summary = generate_contours(synthetic_dem, square_aoi, tmp_path / "contours.geojson", 5, 1)
    gdf = geopandas.read_file(summary.path)
    assert len(gdf) > 0
    assert all((gdf.elevation_m % 5) == 0)
    assert gdf.crs.to_epsg() == 4326
```

- [ ] **Step 2: 运行测试确认失败**

Run: `E:\anaconda3\envs\platform_geo_worker\python.exe -m pytest server/tests/test_contours.py -v`

Expected: FAIL，函数尚不存在。

- [ ] **Step 3: 实现固定处理顺序**

```python
def masked_gaussian(data, valid, sigma):
    if sigma == 0:
        return np.where(valid, data, np.nan)
    weights = gaussian_filter(valid.astype("float32"), sigma=sigma)
    values = gaussian_filter(np.where(valid, data, 0).astype("float32"), sigma=sigma)
    return np.where(valid & (weights > 0), values / np.maximum(weights, 1e-6), np.nan)
```

`generate_contours` 必须按顺序执行：AOI+300m 缓冲裁剪；有效像元比例检查；依据质心选 UTM（米埗村 EPSG:32649）；双线性重投影到 30m；`sigma=0/1`；GDAL `ContourGenerate`；`elevation_m` 字段；2m `preserve_topology` 简化；裁回原 AOI；转 EPSG:4326。有效像元比例小于 0.6 时抛 `DEM_INSUFFICIENT_VALID_DATA`。

- [ ] **Step 4: 运行单元测试和广东 DEM smoke test**

Run:

```powershell
E:\anaconda3\envs\platform_geo_worker\python.exe -m pytest server/tests/test_contours.py -v
E:\anaconda3\envs\platform_geo_worker\python.exe -m village_processing contours --village mibu --aoi server\tests\fixtures\aoi_mibu.geojson --interval 5 --smoothing 1 --output server\runtime\smoke\contours.geojson
```

Expected: 测试通过；实际输出存在；`elevation_m` 全为 5 的倍数；没有穿越 NoData 的明显连线；manifest 记录 UTM、sigma、有效比例和 Copernicus GLO-30。

- [ ] **Step 5: 提交**

```bash
git add server/src/village_processing/processors/contours.py server/tests/test_contours.py
git commit -m "feat: generate reproducible DEM contours"
```

### Task 6: 统一 CLI 与本地三模块验收

**Files:**
- Modify: `server/src/village_processing/__main__.py`
- Create: `server/src/village_processing/pipeline.py`
- Create: `server/tests/test_pipeline.py`
- Create: `server/tests/fixtures/mibu-request.json`
- Create: `server/docs/native-runtime-operations.md`

**Interfaces:**
- Produces: `run_pipeline(request, catalog, processors) -> RunManifest`；CLI `python -m village_processing run --request <json>`。

- [ ] **Step 1: 写阶段隔离和 manifest 测试**

```python
def test_pipeline_writes_manifest_after_all_requested_steps(tmp_path, fake_catalog, fake_processors):
    manifest = run_pipeline(request_for(tmp_path, ["buildings", "roads_water", "contours"]),
                            fake_catalog, fake_processors)
    assert manifest.status == "completed"
    assert {a.artifact_type for a in manifest.artifacts} == {
        "buildings", "roads", "waterways", "water_areas", "contours"
    }
    assert all(a.sha256 for a in manifest.artifacts)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `E:\anaconda3\envs\platform_geo_worker\python.exe -m pytest server/tests/test_pipeline.py -v`

Expected: FAIL，pipeline 尚不存在。

- [ ] **Step 3: 实现顺序执行与原子发布**

每个处理器先写 `*.partial`，验证 FeatureCollection、CRS、几何和 AOI 后用 `Path.replace()` 原子改名。`manifest.json` 包含 run ID、各阶段状态、warnings、文件大小、feature count、bbox、SHA-256、来源与参数。任一请求阶段失败则 run 为 failed，但保留已完成 artifact 供诊断。

```python
def run_pipeline(request, catalog, processors):
    dataset = catalog.resolve(request.village_id)
    artifacts, warnings = [], []
    if "buildings" in request.requested_steps:
        artifacts.append(processors.buildings(request, dataset))
    if "roads_water" in request.requested_steps:
        osm_items = processors.roads_water(request, dataset)
        artifacts.extend(osm_items)
        warnings.extend(item.warning_code for item in osm_items if item.warning_code)
    if "contours" in request.requested_steps:
        artifacts.append(processors.contours(request, dataset))
    return write_run_manifest(request, artifacts, warnings)
```

`mibu-request.json` 使用固定 smoke run UUID、`village_id=mibu`、五点闭合 AOI `[[113.661,23.676],[113.665,23.676],[113.665,23.679],[113.661,23.679],[113.661,23.676]]`，请求三步骤，建筑阈值 0.35、等高距 5、平滑 1，work dir 为 `server/runtime/smoke`。

- [ ] **Step 4: 运行全部 Python 测试**

Run: `E:\anaconda3\envs\platform_geo_worker\python.exe -m pytest server/tests -v`

Expected: 全部通过，0 failed。

- [ ] **Step 5: 对米埗村运行完整本地任务**

Run: `E:\anaconda3\envs\platform_geo_worker\python.exe -m village_processing run --request server\runtime\smoke\mibu-request.json`

Expected: `server/runtime/smoke/<run-id>/` 下产生五个 GeoJSON 和 manifest；建筑服务只加载模型一次；任务退出码 0。

- [ ] **Step 6: 导出环境并提交文档**

Run: `powershell -ExecutionPolicy Bypass -File server\scripts\export_platform_envs.ps1`

```bash
git add server/src/village_processing server/tests server/docs server/environment/*.lock.yml
git commit -m "feat: complete native geoprocessing runtime"
```
