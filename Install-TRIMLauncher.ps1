param([switch]$Disable)
$ErrorActionPreference = 'Stop'
$taskKey = 'HKCU:\Software\Classes\trim-notes'
$taskCommandKey = Join-Path $taskKey 'shell\open\command'
$taskExe = Join-Path $PSScriptRoot 'TRIMNotesLauncher.exe'
$taskCommand = '"' + $taskExe + '" "%1"'
$taskExisting = if (Test-Path -LiteralPath $taskCommandKey) { (Get-Item -LiteralPath $taskCommandKey).GetValue('') } else { $null }
if ((Test-Path -LiteralPath $taskKey) -and $taskExisting -ne $taskCommand) { throw 'A different application owns trim-notes. Nothing was changed.' }
if ($Disable) {
    if ($taskExisting) {
        $taskResolvedKey = (Get-Item -LiteralPath $taskKey).Name
        if ($taskResolvedKey -ne 'HKEY_CURRENT_USER\Software\Classes\trim-notes') { throw 'Unexpected protocol key. Nothing was removed.' }
        Remove-Item -LiteralPath $taskKey -Recurse
    }
    Write-Output 'TRIM website launcher removed. The desktop shortcut still works.'
    exit 0
}
$taskCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $taskCompiler)) { $taskCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
$taskSource = Join-Path $PSScriptRoot 'launcher\TrimNotesLauncher.cs'
& $taskCompiler /nologo /target:winexe /optimize+ /reference:System.Windows.Forms.dll ('/win32icon:' + (Join-Path $PSScriptRoot 'launcher\TRIMNotes.ico')) ('/out:' + $taskExe) $taskSource
if ($LASTEXITCODE -ne 0) { throw 'TRIM launcher compilation failed. Registration was not changed.' }
$taskValidation = Start-Process -FilePath $taskExe -ArgumentList @('--validate','trim-notes://open') -WindowStyle Hidden -Wait -PassThru
if ($taskValidation.ExitCode -ne 0) { throw 'TRIM launcher self-check failed.' }
foreach ($taskPath in @($taskKey,(Join-Path $taskKey 'Application'),(Join-Path $taskKey 'DefaultIcon'),$taskCommandKey)) { New-Item -Path $taskPath -Force | Out-Null }
Set-Item -LiteralPath $taskKey -Value 'URL:TRIM Notes'
New-ItemProperty -LiteralPath $taskKey -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
New-ItemProperty -LiteralPath $taskKey -Name 'FriendlyTypeName' -Value 'TRIM Notes' -PropertyType String -Force | Out-Null
New-ItemProperty -LiteralPath (Join-Path $taskKey 'Application') -Name 'ApplicationName' -Value 'TRIM Notes' -PropertyType String -Force | Out-Null
New-ItemProperty -LiteralPath (Join-Path $taskKey 'Application') -Name 'ApplicationDescription' -Value 'Open TRIM Notes on this laptop' -PropertyType String -Force | Out-Null
Set-Item -LiteralPath (Join-Path $taskKey 'DefaultIcon') -Value ('"' + $taskExe + '",0')
Set-Item -LiteralPath $taskCommandKey -Value $taskCommand
if ((Get-Item -LiteralPath $taskCommandKey).GetValue('') -ne $taskCommand) { throw 'TRIM launcher registration did not verify.' }
# Keep an existing TRIM desktop shortcut usable with Windows PowerShell defaults.
$taskDesktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'TRIM.lnk'
if (Test-Path -LiteralPath $taskDesktopShortcut) {
    $taskShell = New-Object -ComObject WScript.Shell
    $taskShortcut = $taskShell.CreateShortcut($taskDesktopShortcut)
    $taskStartScript = Join-Path $PSScriptRoot 'Start-TRIM.ps1'
    if ($taskShortcut.TargetPath -eq $taskExe -or $taskShortcut.Arguments.Contains($taskStartScript)) {
        $taskShortcut.TargetPath = $taskExe
        $taskShortcut.Arguments = 'trim-notes://open'
        $taskShortcut.WorkingDirectory = $PSScriptRoot
        $taskShortcut.Description = 'Open TRIM Notes on demand.'
        $taskShortcut.IconLocation = $taskExe + ',0'
        $taskShortcut.Save()
    }
}
Write-Output 'TRIM Notes website launcher installed for this Windows user.'
