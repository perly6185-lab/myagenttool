$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$required = @(
  "pnpm-workspace.yaml",
  "package.json",
  "tsconfig.base.json",
  "apps/web",
  "apps/server",
  "apps/desktop",
  "docs/design",
  "packages/protocol",
  "packages/adapters",
  "packages/shared",
  "tools/docs",
  "tools/dev",
  "tools/github",
  "tools/release"
)

$missing = @()
foreach ($item in $required) {
  $path = Join-Path $root $item
  if (-not (Test-Path -LiteralPath $path)) {
    $missing += $item
  }
}

if ($missing.Count -gt 0) {
  Write-Output "Missing required scaffold paths:"
  $missing | ForEach-Object { Write-Output "  $_" }
  exit 1
}

Write-Output "Repository scaffold OK"
