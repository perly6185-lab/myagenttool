$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$pattern = [regex]::new('\[[^\]]+\]\(([^)]+)\)')
$failures = New-Object System.Collections.Generic.List[string]

Get-ChildItem -Path $root -Recurse -Filter "*.md" -File |
  Where-Object {
    $relative = $_.FullName.Substring($root.Length).TrimStart("\", "/")
    -not (
      $relative -match '(^|[\\/])node_modules([\\/]|$)' `
      -or $relative -like ".git*" `
      -or $relative -like ".myagenttool\runtimes*" `
      -or $relative -like "doocs-md*" `
      -or $relative -match '^apps[\\/]electron[\\/](release|vendor[\\/]portable-git)([\\/]|$)'
    )
  } |
  ForEach-Object {
  $path = $_.FullName
  $text = Get-Content -LiteralPath $path -Raw -Encoding UTF8
  if ($null -eq $text) { $text = "" }
  foreach ($match in $pattern.Matches($text)) {
    $target = ($match.Groups[1].Value -split "#", 2)[0]
    if ([string]::IsNullOrWhiteSpace($target)) { continue }
    if ($target -match "://") { continue }
    if ($target.StartsWith("mailto:")) { continue }

    if ($target.StartsWith("/")) {
      $candidate = Join-Path $root $target.TrimStart("/")
    } else {
      $candidate = Join-Path (Split-Path -Parent $path) $target
    }

    if (-not (Test-Path -LiteralPath $candidate)) {
      $relativePath = Resolve-Path -LiteralPath $path -Relative
      $failures.Add("$relativePath -> $target")
    }
  }
}

if ($failures.Count -gt 0) {
  Write-Output "Broken markdown links:"
  $failures | ForEach-Object { Write-Output "  $_" }
  exit 1
}

Write-Output "Markdown relative links OK"
