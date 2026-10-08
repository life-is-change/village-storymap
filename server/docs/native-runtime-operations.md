# Native geoprocessing runtime

The Windows pilot uses two isolated Conda environments. `platform_building_worker`
loads the CUDA model and exposes only `127.0.0.1:8021`; `platform_geo_worker`
validates requests and produces OSM, contour, and final manifest artifacts.

## Start the building service

Set `PLATFORM_WORK_ROOT`, `PLATFORM_MODEL_CONFIG`, and
`PLATFORM_MODEL_CHECKPOINT`, then run `server/scripts/start_building_service.ps1`.
The service must remain loopback-only. Check `http://127.0.0.1:8021/health`.

## Run one local request

Set `PLATFORM_DATA_ROOT=E:\村规平台学生体验版` and
`PLATFORM_WORK_ROOT=<repository>\server\runtime`, then run:

```powershell
E:\anaconda3\envs\platform_geo_worker\python.exe -m village_processing run `
  --request server\tests\fixtures\mibu-request.json
```

The run directory contains the cropped model input, five GeoJSON layers, and
`manifest.json`. Runtime data, source TIF/PBF files, weights, and secrets are
excluded from Git.
