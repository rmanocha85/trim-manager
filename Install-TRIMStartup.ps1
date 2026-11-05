param([switch]$Disable)
$ErrorActionPreference = 'Stop'
$taskKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$taskName = 'TRIM Notes Intake'
$taskScript = Join-Path $PSScriptRoot 'Watch-TRIM.ps1'
$taskCommand = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $taskScript + '"'
$taskOld = (Get-ItemProperty -LiteralPath $taskKey -Name $taskName -ErrorAction SilentlyContinue).$taskName
if ($taskOld -and $taskOld -ne $taskCommand) { throw 'A different TRIM startup registration exists. Reconcile it before changing this entry.' }
if ($Disable) {
    if ($taskOld) { Remove-ItemProperty -LiteralPath $taskKey -Name $taskName }
    Write-Output 'TRIM automatic startup disabled for future sign-ins.'
} else {
    New-ItemProperty -LiteralPath $taskKey -Name $taskName -Value $taskCommand -PropertyType String -Force | Out-Null
    if ((Get-ItemProperty -LiteralPath $taskKey -Name $taskName).$taskName -ne $taskCommand) { throw 'Startup registration did not verify.' }
    Start-Process -FilePath powershell.exe -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $taskScript + '"') -WindowStyle Hidden
    Write-Output 'TRIM intake startup enabled for this Windows user.'
}
