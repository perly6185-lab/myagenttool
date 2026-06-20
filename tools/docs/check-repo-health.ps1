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
  "docs/engineering/M0_CORE_PROTOCOL_SERVICE.md",
  "docs/engineering/M0_DESKTOP_AGENT_BRIDGE.md",
  "docs/engineering/M0_WEB_CONSOLE_LOOP.md",
  "docs/engineering/M0_ACCEPTANCE_CLOSEOUT.md",
  "docs/engineering/M0_MANUAL_ACCEPTANCE.md",
  "docs/engineering/M0_GOVERNANCE_CLOSEOUT.md",
  "docs/engineering/OPEN_DESIGN_WORKFLOW.md",
  "docs/engineering/AI_DELIVERY_CLOSEOUT.md",
  "docs/engineering/M1_ISSUE_PLAN.md",
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
