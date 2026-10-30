param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$taskNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if (-not (Test-Path -LiteralPath $taskNode)) { $taskNode = (Get-Command node -ErrorAction Stop).Source }
$taskUrl = 'http://127.0.0.1:4317/'
try { $taskResponse = Invoke-RestMethod -Uri ($taskUrl + 'health') -TimeoutSec 2; $taskRunning = $taskResponse.app -eq 'trim-app' -and $taskResponse.version -eq '20261030-workspace1' } catch { $taskRunning = $false }
if (-not $taskRunning) {
    $taskExisting = Get-NetTCPConnection -LocalPort 4317 -State Listen -ErrorAction SilentlyContinue
    if ($taskExisting) { throw 'An older TRIM service or another program is using port 4317. Close that service before starting this version. Your saved work has not been changed.' }
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules\jose'))) { throw 'Install the dependencies in this app folder first (pnpm install --frozen-lockfile).' }
    Start-Process -FilePath $taskNode -ArgumentList ('"' + (Join-Path $PSScriptRoot 'server.mjs') + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
    $taskRunning = $false
    for ($taskAttempt = 0; $taskAttempt -lt 20; $taskAttempt++) {
        Start-Sleep -Milliseconds 250
        try { $taskResponse = Invoke-RestMethod -Uri ($taskUrl + 'health') -TimeoutSec 1; if ($taskResponse.app -eq 'trim-app') { $taskRunning = $true; break } } catch {}
    }
    if (-not $taskRunning) { throw 'TRIM did not start. Your records remain in their existing Drive folders.' }
}
if (-not $NoBrowser) { Start-Process $taskUrl }
