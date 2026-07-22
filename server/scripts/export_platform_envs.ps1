$ErrorActionPreference = 'Stop'

$Conda = 'E:\anaconda3\Scripts\conda.exe'
$BuildingTarget = 'E:\anaconda3\envs\platform_building_worker'
$GeoTarget = 'E:\anaconda3\envs\platform_geo_worker'
$EnvironmentDir = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\environment')).Path

function Export-SanitizedEnvironment {
  param(
    [Parameter(Mandatory = $true)][string]$Prefix,
    [Parameter(Mandatory = $true)][string]$OutputPath
  )

  $lines = & $Conda env export --prefix $Prefix --from-history
  if ($LASTEXITCODE -ne 0) { throw "Failed to export environment: $Prefix" }
  $sanitized = $lines | Where-Object { $_ -notmatch '^prefix:\s' }
  $text = $sanitized -join [Environment]::NewLine
  if ($text -match '(?im)^prefix:\s' -or $text -match 'SUPABASE_') {
    throw 'Environment export contains local data or secret configuration.'
  }
  [IO.File]::WriteAllText($OutputPath, $text + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
}

Export-SanitizedEnvironment `
  -Prefix $BuildingTarget `
  -OutputPath (Join-Path $EnvironmentDir 'platform_building_worker.lock.yml')
Export-SanitizedEnvironment `
  -Prefix $GeoTarget `
  -OutputPath (Join-Path $EnvironmentDir 'platform_geo_worker.lock.yml')

Write-Output 'sanitized environment files exported'
