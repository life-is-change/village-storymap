$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$ServerRoot = Join-Path $RepoRoot 'server'
$EnvFile = Join-Path $ServerRoot '.env'
$PidRoot = Join-Path $ServerRoot 'runtime\pids'
$BuildingStartupTimeoutSeconds = 60

function Wait-ForBuildingService {
  param(
    [Parameter(Mandatory = $true)]
    [System.Diagnostics.Process] $Process,
    [Parameter(Mandatory = $true)]
    [int] $TimeoutSeconds
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if ($Process.HasExited) {
      throw "Building service exited during startup with code $($Process.ExitCode)."
    }
    try {
      Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8021/health' -TimeoutSec 2 | Out-Null
      return
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  throw "Building service did not become healthy within $TimeoutSeconds seconds."
}

if (!(Test-Path -LiteralPath $EnvFile)) { throw 'server/.env is required.' }
foreach ($line in Get-Content -LiteralPath $EnvFile -Encoding UTF8) {
  if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
  $name, $value = $line -split '=', 2
  [Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim(), 'Process')
}
$env:PYTHONNOUSERSITE = '1'
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:GDAL_DATA = 'E:\anaconda3\envs\platform_geo_worker\Library\share\gdal'
$env:PROJ_LIB = 'E:\anaconda3\envs\platform_geo_worker\Library\share\proj'

Push-Location $RepoRoot
try {
  & 'E:\anaconda3\envs\platform_geo_worker\python.exe' -m village_processing health --local
  if ($LASTEXITCODE -ne 0) { throw 'Platform health checks failed.' }
  New-Item -ItemType Directory -Path $PidRoot -Force | Out-Null
  $env:GDAL_DATA = 'E:\anaconda3\envs\platform_building_worker\Library\share\gdal'
  $env:PROJ_LIB = 'E:\anaconda3\envs\platform_building_worker\Library\share\proj'
  $building = Start-Process -FilePath 'E:\anaconda3\envs\platform_building_worker\python.exe' `
    -ArgumentList '-m','uvicorn','village_processing.building.service:app','--host','127.0.0.1','--port','8021' `
    -WindowStyle Hidden -PassThru
  Set-Content -LiteralPath (Join-Path $PidRoot 'building.pid') -Value $building.Id -Encoding ASCII
  Wait-ForBuildingService -Process $building -TimeoutSeconds $BuildingStartupTimeoutSeconds
  $env:GDAL_DATA = 'E:\anaconda3\envs\platform_geo_worker\Library\share\gdal'
  $env:PROJ_LIB = 'E:\anaconda3\envs\platform_geo_worker\Library\share\proj'
  & 'E:\anaconda3\envs\platform_geo_worker\python.exe' -m village_processing health
  if ($LASTEXITCODE -ne 0) { throw 'Remote platform health checks failed.' }
  $worker = Start-Process -FilePath 'E:\anaconda3\envs\platform_geo_worker\python.exe' `
    -ArgumentList '-m','village_processing','worker' -WindowStyle Hidden -PassThru
  Set-Content -LiteralPath (Join-Path $PidRoot 'worker.pid') -Value $worker.Id -Encoding ASCII
  Write-Output 'platform worker started'
} finally {
  Pop-Location
}
