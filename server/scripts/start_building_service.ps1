$ErrorActionPreference = 'Stop'
$env:PYTHONNOUSERSITE = '1'
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:GDAL_DATA = 'E:\anaconda3\envs\platform_building_worker\Library\share\gdal'
$env:PROJ_LIB = 'E:\anaconda3\envs\platform_building_worker\Library\share\proj'

if (!$env:PLATFORM_WORK_ROOT) { throw 'PLATFORM_WORK_ROOT is required.' }
if (!$env:PLATFORM_MODEL_CONFIG) { throw 'PLATFORM_MODEL_CONFIG is required.' }
if (!$env:PLATFORM_MODEL_CHECKPOINT) { throw 'PLATFORM_MODEL_CHECKPOINT is required.' }

& 'E:\anaconda3\envs\platform_building_worker\python.exe' -m uvicorn `
  village_processing.building.service:app --host 127.0.0.1 --port 8021
