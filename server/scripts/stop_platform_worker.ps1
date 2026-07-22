$ErrorActionPreference = 'Stop'
$ServerRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$PidRoot = Join-Path $ServerRoot 'runtime\pids'
$Targets = @(
  @{ Pid = 'building.pid'; Executable = 'E:\anaconda3\envs\platform_building_worker\python.exe' },
  @{ Pid = 'worker.pid'; Executable = 'E:\anaconda3\envs\platform_geo_worker\python.exe' }
)

foreach ($target in $Targets) {
  $pidFile = Join-Path $PidRoot $target.Pid
  if (!(Test-Path -LiteralPath $pidFile)) { continue }
  $processId = [int](Get-Content -LiteralPath $pidFile -Raw)
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if ($process -and $process.Path -ieq $target.Executable) {
    Stop-Process -Id $processId
  } elseif ($process) {
    throw 'PID path guard rejected a non-platform process.'
  }
  Remove-Item -LiteralPath $pidFile -Force
}
Write-Output 'platform worker stopped'
