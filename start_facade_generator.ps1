$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = 'E:\anaconda3\envs\building_facade_pilot\python.exe'
$SamPython = 'E:\anaconda3\envs\building_sam2\python.exe'
$LamaPython = 'E:\anaconda3\envs\building_lama\Scripts\python.exe'
$Blender = 'D:\Blender\blender.exe'
$RuntimeRoot = Join-Path $env:LOCALAPPDATA 'VillageFacadeGenerator\runtime_storage'

if (-not (Test-Path -LiteralPath $Python)) {
  throw "Python environment not found: $Python"
}
if (-not (Test-Path -LiteralPath $Blender)) {
  throw "Blender not found: $Blender"
}
if (-not (Test-Path -LiteralPath $SamPython)) {
  throw "Grounding DINO + SAM2.1 environment not found: $SamPython"
}
if (-not (Test-Path -LiteralPath $LamaPython)) {
  throw "LaMa environment not found: $LamaPython"
}

$env:BLENDER_EXECUTABLE = $Blender
$env:RURAL_FACADE_RUNTIME_ROOT = $RuntimeRoot
$env:BUILD_SEG_ROOT = 'E:\建筑分割'
$SegRoot = 'E:\' + [char]0x5EFA + [char]0x7B51 + [char]0x5206 + [char]0x5272
$env:BUILD_SEG_ROOT = $SegRoot
$env:SAM2_CHECKPOINT = Join-Path $SegRoot 'checkpoints\sam2.1_hiera_large.pt'
$env:RURAL_FACADE_ML_URL = 'http://127.0.0.1:8012'
$env:RURAL_LAMA_URL = 'http://127.0.0.1:8013'
$env:RURAL_FACADE_PIPELINE = 'full-local'
New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
$lamaArgs = @('-m', 'rural_house_generator.backend.lama_server', '--host', '127.0.0.1', '--port', '8013')
$mlArgs = @('-m', 'rural_house_generator.backend.ml_worker', '--host', '127.0.0.1', '--port', '8012')
$backendArgs = @(
  '-m', 'uvicorn',
  'rural_house_generator.backend.app.main:app',
  '--host', '127.0.0.1',
  '--port', '8011'
)
$staticArgs = @('-m', 'http.server', '8000', '--bind', '127.0.0.1')

$lama = Start-Process -FilePath $LamaPython -ArgumentList $lamaArgs -WorkingDirectory $RepoRoot -WindowStyle Hidden -PassThru
$ml = Start-Process -FilePath $SamPython -ArgumentList $mlArgs -WorkingDirectory $RepoRoot -WindowStyle Hidden -PassThru
$backend = Start-Process -FilePath $Python -ArgumentList $backendArgs -WorkingDirectory $RepoRoot -WindowStyle Hidden -PassThru
$static = Start-Process -FilePath $Python -ArgumentList $staticArgs -WorkingDirectory $RepoRoot -WindowStyle Hidden -PassThru

$healthy = $false
for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8011/health' -TimeoutSec 2
    $mlHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:8012/health' -TimeoutSec 2
    $lamaHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:8013/health' -TimeoutSec 2
    $reportedRuntime = [IO.Path]::GetFullPath([string]$health.runtime_root)
    $expectedRuntime = [IO.Path]::GetFullPath($RuntimeRoot)
    if ($health.status -eq 'ok' -and $health.service -eq 'rural-facade-generator' -and $reportedRuntime -eq $expectedRuntime -and $mlHealth.status -eq 'ok' -and $lamaHealth.status -eq 'ok') {
      $healthy = $true
      break
    }
  } catch {
    Start-Sleep -Milliseconds 500
  }
}

if (-not $healthy) {
  throw "Facade backend failed to start. Backend PID=$($backend.Id)"
}

Write-Host "Facade backend ready: http://127.0.0.1:8011/health"
Write-Host "Grounding DINO + SAM2.1 ready: http://127.0.0.1:8012/health"
Write-Host "LaMa ready: http://127.0.0.1:8013/health"
Write-Host "Generator ready: http://127.0.0.1:8000/rural_house_generator/index.html"
Write-Host "Runtime storage: $RuntimeRoot"
Write-Host "Backend PID=$($backend.Id), ML PID=$($ml.Id), LaMa PID=$($lama.Id), static server PID=$($static.Id)"
