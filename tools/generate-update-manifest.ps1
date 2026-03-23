param(
  [string]$BaseUrl,
  [string]$Version,
  [string]$ArtifactPath,
  [string]$OutputPath = "latest.json"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $BaseUrl) {
  throw "Missing -BaseUrl. Example: https://downloads.example.com/fshell"
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$tauriConfigPath = Join-Path $repoRoot "src-tauri\\tauri.conf.json"
$tauriConfig = Get-Content -Path $tauriConfigPath -Raw | ConvertFrom-Json
$resolvedVersion = if ($Version) { $Version } else { [string]$tauriConfig.version }

if (-not $ArtifactPath) {
  $bundleDir = Join-Path $repoRoot "src-tauri\\target\\release\\bundle\\nsis"
  $artifact = Get-ChildItem -Path $bundleDir -File -Filter "*setup.exe" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

  if (-not $artifact) {
    throw "NSIS setup executable was not found. Run 'npx tauri build --bundles nsis --ci' first."
  }
} else {
  $artifact = Get-Item -Path $ArtifactPath
}

$signaturePath = "$($artifact.FullName).sig"
if (-not (Test-Path -Path $signaturePath)) {
  throw "Missing signature file: $signaturePath. Ensure bundle.createUpdaterArtifacts is enabled and the build used the signing key."
}

$signature = (Get-Content -Path $signaturePath -Raw).Trim()
$normalizedBaseUrl = $BaseUrl.TrimEnd("/")
$outputFullPath = if ([System.IO.Path]::IsPathRooted($OutputPath)) {
  $OutputPath
} else {
  Join-Path $repoRoot $OutputPath
}

$manifest = [ordered]@{
  version = $resolvedVersion
  notes = "FShell $resolvedVersion"
  pub_date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{
      signature = $signature
      url = "$normalizedBaseUrl/$($artifact.Name)"
    }
  }
}

$manifestJson = $manifest | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($outputFullPath, $manifestJson, [System.Text.UTF8Encoding]::new($false))

Write-Host "Manifest generated: $outputFullPath"
Write-Host "Version: $resolvedVersion"
Write-Host "Artifact: $($artifact.FullName)"
