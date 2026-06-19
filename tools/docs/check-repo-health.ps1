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
  "docs/engineering/ADR_INDEX.md",
  "docs/engineering/ADR_0002_M0_REALTIME_TRANSPORT.md",
  "docs/engineering/ADR_0003_M0_DESKTOP_BRIDGE_RUNTIME.md",
  "docs/engineering/ADR_0004_M0_SERVER_STORAGE_QUEUE.md",
  "docs/engineering/ADR_0005_M0_WEB_CONSOLE_APP_SHELL.md",
  "packages/protocol",
  "packages/adapters",
  "packages/shared",
  "tools/docs",
  "tools/ai",
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
