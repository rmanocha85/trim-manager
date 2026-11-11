# A per-user supervisor: works while signed in and resumes after sleep/network loss.
$ErrorActionPreference = 'Stop'
$taskMutex = [System.Threading.Mutex]::new($false, 'Local\TRIMNotes-Intake-Supervisor')
try {
    try { $taskOwnsMutex = $taskMutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $taskOwnsMutex = $true }
    if (-not $taskOwnsMutex) { exit }
    $taskState = Join-Path $env:LOCALAPPDATA 'TRIMNotes\supervisor-status.json'
    New-Item -ItemType Directory -Path (Split-Path $taskState) -Force | Out-Null
    while ($true) {
        try {
            & (Join-Path $PSScriptRoot 'Start-TRIM.ps1') -NoBrowser -KeepRunning
            @{ checkedAt = [DateTime]::UtcNow.ToString('o'); running = $true; app = $PSScriptRoot } | ConvertTo-Json | Set-Content -LiteralPath $taskState -Encoding UTF8
        } catch {
            @{ checkedAt = [DateTime]::UtcNow.ToString('o'); running = $false; error = $_.Exception.Message; app = $PSScriptRoot } | ConvertTo-Json | Set-Content -LiteralPath $taskState -Encoding UTF8
        }
        Start-Sleep -Seconds 30
    }
} finally { if ($taskOwnsMutex) { $taskMutex.ReleaseMutex() }; $taskMutex.Dispose() }
