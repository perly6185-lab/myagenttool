$ErrorActionPreference = "Stop"

$username = Read-Host "163 Mail address"
if ([string]::IsNullOrWhiteSpace($username) -or $username -notmatch "@163\.com$") {
  throw "Enter a complete @163.com address."
}
$authorizationCode = Read-Host "163 Mail client authorization code" -AsSecureString
$protected = ConvertFrom-SecureString $authorizationCode

$mailDir = Join-Path $env:APPDATA "myagenttool\mail"
$readinessDir = Join-Path $env:APPDATA "myagenttool\credential-readiness"
New-Item -ItemType Directory -Force -Path $mailDir, $readinessDir | Out-Null

@{
  provider = "netease"
  scope = "imap.readonly"
  username = $username.Trim()
  protectedAuthorizationCode = $protected
} | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $mailDir "163.json")

@{
  applicationId = "app_163_mail_v2"
  provider = "netease"
  scope = "imap.readonly"
  obtainedAt = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $readinessDir "app_163_mail_v2.json")

Write-Host "163 Mail credential stored with Windows DPAPI."
Write-Host "Set BRIDGE_CREDENTIAL_DIR=$readinessDir before starting the Desktop Bridge."
