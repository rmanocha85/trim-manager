param([switch]$Quiet)
$ErrorActionPreference = 'Stop'
$taskBase = 'http://127.0.0.1:4317'
try { $taskHealth = Invoke-RestMethod -Uri ($taskBase + '/health') -TimeoutSec 3 } catch { Write-Output 'TRIM is already stopped.'; exit 0 }
if ($taskHealth.app -ne 'trim-app') { throw 'Port 4317 belongs to another application. Nothing was stopped.' }
$taskHeaders = @{ Origin = $taskBase; 'X-Trim-Local' = '1' }
$taskConnection = Invoke-WebRequest -Uri ($taskBase + '/api/connect') -Method Post -Headers $taskHeaders -SessionVariable taskSession -UseBasicParsing
$taskCsrf = ($taskConnection.Content | ConvertFrom-Json).csrf
$taskHeaders = @{ Origin = $taskBase; 'X-Trim-Session' = $taskCsrf; 'Content-Type' = 'application/json' }
try { $taskResult = Invoke-RestMethod -Uri ($taskBase + '/api/service/stop') -Method Post -Headers $taskHeaders -WebSession $taskSession -Body '{}' -TimeoutSec 5 } catch { throw 'TRIM could not stop safely. Let any processing or saving finish, then try again.' }
if (-not $taskResult.stopping) { throw 'TRIM did not acknowledge the stop request.' }
Write-Output 'TRIM stopped. Open the TRIM desktop shortcut when you next need Notes. Your saved work and ChatGPT connection are retained.'
