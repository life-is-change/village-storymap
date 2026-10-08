$ErrorActionPreference = 'Stop'

$Conda = 'E:\anaconda3\Scripts\conda.exe'
$BuildingSource = 'E:\anaconda3\envs\building_clip'
$BuildingTarget = 'E:\anaconda3\envs\platform_building_worker'
$GeoTarget = 'E:\anaconda3\envs\platform_geo_worker'
$PackageCache = 'E:\anaconda3\envs\.platform-pkgs'
$ServerRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$GeoFile = Join-Path $ServerRoot 'environment\platform_geo_worker.yml'
$PackageRoot = Join-Path $ServerRoot 'src\village_processing'
$env:CONDA_PKGS_DIRS = $PackageCache

function Test-CompleteCondaEnvironment {
  param([Parameter(Mandatory = $true)][string]$Prefix)
  return (
    (Test-Path -LiteralPath (Join-Path $Prefix 'python.exe')) -and
    (Test-Path -LiteralPath (Join-Path $Prefix 'conda-meta\history'))
  )
}

if (!(Test-Path -LiteralPath $Conda)) {
  throw "Conda executable not found: $Conda"
}
if (!(Test-Path -LiteralPath $BuildingSource)) {
  throw "Source environment not found: $BuildingSource"
}
if (!(Test-Path -LiteralPath $PackageCache)) {
  New-Item -ItemType Directory -Path $PackageCache | Out-Null
}
if ((Test-Path -LiteralPath $BuildingTarget) -and !(Test-CompleteCondaEnvironment $BuildingTarget)) {
  throw "Incomplete target environment must be removed before retry: $BuildingTarget"
}
if ((Test-Path -LiteralPath $GeoTarget) -and !(Test-CompleteCondaEnvironment $GeoTarget)) {
  throw "Incomplete target environment must be removed before retry: $GeoTarget"
}

if (!(Test-Path -LiteralPath $BuildingTarget)) {
  & $Conda create --prefix $BuildingTarget --clone $BuildingSource -y
  if ($LASTEXITCODE -ne 0) { throw 'Failed to clone the building environment.' }
}

& "$BuildingTarget\python.exe" -m pip install --only-binary=:all: --force-reinstall `
  'numpy==1.26.4' 'scipy==1.11.4' 'pandas==2.1.4' `
  'opencv-python==4.8.1.78' `
  'setuptools==81.0.0' 'pytest>=8,<9'
if ($LASTEXITCODE -ne 0) { throw 'Failed to repair the building Python ABI.' }

if (!(Test-Path -LiteralPath $GeoTarget)) {
  & $Conda env create --prefix $GeoTarget --file $GeoFile -y
  if ($LASTEXITCODE -ne 0) { throw 'Failed to create the GIS environment.' }
}

if (Test-Path -LiteralPath $PackageRoot) {
  & "$BuildingTarget\python.exe" -m pip install --only-binary=:all: `
    --no-build-isolation --editable $ServerRoot
  if ($LASTEXITCODE -ne 0) { throw 'Failed to install the local package in the building environment.' }

  & "$GeoTarget\python.exe" -m pip install --only-binary=:all: `
    --no-build-isolation --editable $ServerRoot
  if ($LASTEXITCODE -ne 0) { throw 'Failed to install the local package in the GIS environment.' }
}

Write-Output 'platform environments ready'
