$ErrorActionPreference = 'Stop'

$toolRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = 'E:\研究生工作\332工作\3D村庄规划网页\village-storymap-GIT'
$serverRoot = Join-Path $repoRoot 'server'
$sourceRoot = Join-Path $serverRoot 'src'
$buildingPython = 'E:\anaconda3\envs\platform_building_worker\python.exe'
$geoPython = 'E:\anaconda3\envs\platform_geo_worker\python.exe'
$modelRoot = Join-Path $toolRoot '建筑矢量\china'

$required = @(
  $buildingPython,
  $geoPython,
  (Join-Path $sourceRoot 'village_processing\local_tool.py'),
  (Join-Path $modelRoot 'mask_rcnn_x101_64x4d_fpn_2x_building_combine_total_china_finetune.py'),
  (Join-Path $modelRoot 'mask_rcnn_x101_64x4d_fpn_2x_building_combine_total_china_finetune.pth'),
  (Join-Path $toolRoot '道路、水系\guangdong-260721.osm.pbf'),
  (Join-Path $toolRoot '等高线\广东省_哥白尼DEM.tif')
)
foreach ($path in $required) {
  if (!(Test-Path -LiteralPath $path)) { throw "缺少运行文件：$path" }
}

$env:PYTHONNOUSERSITE = '1'
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:PYTHONPATH = $sourceRoot
$env:PLATFORM_WORK_ROOT = Join-Path $toolRoot 'work'
$env:PLATFORM_MODEL_CONFIG = Join-Path $modelRoot 'mask_rcnn_x101_64x4d_fpn_2x_building_combine_total_china_finetune.py'
$env:PLATFORM_MODEL_CHECKPOINT = Join-Path $modelRoot 'mask_rcnn_x101_64x4d_fpn_2x_building_combine_total_china_finetune.pth'
$env:PLATFORM_MODEL_DEVICE = 'cuda:0'
$env:VILLAGE_DATA_TOOL_ROOT = $toolRoot
$env:GDAL_DATA = 'E:\anaconda3\envs\platform_building_worker\Library\share\gdal'
$env:PROJ_LIB = 'E:\anaconda3\envs\platform_building_worker\Library\share\proj'

$buildingReady = $false
try {
  $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8021/health' -TimeoutSec 2
  $buildingReady = $response.StatusCode -eq 200
} catch {}

if (!$buildingReady) {
  Start-Process -FilePath $buildingPython `
    -ArgumentList '-m','uvicorn','village_processing.building.service:app','--host','127.0.0.1','--port','8021' `
    -WorkingDirectory $serverRoot -WindowStyle Hidden | Out-Null
  $deadline = (Get-Date).AddSeconds(25)
  do {
    Start-Sleep -Milliseconds 500
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8021/health' -TimeoutSec 2
      $buildingReady = $response.StatusCode -eq 200
    } catch {}
  } until ($buildingReady -or (Get-Date) -ge $deadline)
}

if (!$buildingReady) { throw '建筑识别服务未能在 25 秒内启动。请查看系统安全软件或环境配置。' }
New-Item -ItemType Directory -Force -Path (Join-Path $toolRoot 'work'),(Join-Path $toolRoot 'output') | Out-Null
$env:GDAL_DATA = 'E:\anaconda3\envs\platform_geo_worker\Library\share\gdal'
$env:PROJ_LIB = 'E:\anaconda3\envs\platform_geo_worker\Library\share\proj'
& $geoPython -m village_processing.local_tool
