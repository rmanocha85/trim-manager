[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('carrington','cedarbrook','the-cedars')][string]$Site,
    [Parameter(Mandatory)][string]$Csv,
    [Parameter(Mandatory)][int]$ExpectedCount,
    [string]$Roster = (Join-Path $env:USERPROFILE 'My Drive/01. Active List/01 Assisted living/il-rosters.json')
)
$ErrorActionPreference = 'Stop'
$siteNames = @{carrington='Carrington'; cedarbrook='Cedarbrook'; 'the-cedars'='The Cedars'}
$filename = Split-Path $Csv -Leaf
if (!$filename.StartsWith($siteNames[$Site] + '_')) { throw 'Export filename does not match the site.' }
$rows = @(Import-Csv -LiteralPath $Csv)
if (!$rows.Count -or $rows.Count -ne $ExpectedCount) { throw 'Export row count does not match the verified Ava list size.' }
foreach ($field in 'Ava ID','Name','ID','DOB') {
    if ($field -notin $rows[0].PSObject.Properties.Name) { throw "Missing CSV column $field" }
}
$ids = @{}
$phns = @{}
$missingPhns = 0
$patients = @(foreach ($row in $rows) {
    $ava = $row.'Ava ID'
    if ($ava -notmatch '^\d{6,10}$' -or $ids.ContainsKey($ava) -or [string]::IsNullOrWhiteSpace($row.Name)) { throw 'Invalid chart identity.' }
    $ids[$ava] = $true
    $phn = $row.ID
    if ($phn -notmatch '^\d{10}$') { $phn = $null; $missingPhns++ }
    elseif ($phns.ContainsKey($phn)) { throw 'Duplicate PHN within site.' }
    else { $phns[$phn] = $true }
    if ($row.DOB) { $null = [datetime]::ParseExact($row.DOB,'yyyy-MM-dd',[cultureinfo]::InvariantCulture) }
    [ordered]@{name=$row.Name; ava=$ava; phn=$phn; dob=$row.DOB}
})
# Serialize imports so a concurrent refresh of a different site cannot lose records.
$lockPath = "$Roster.import-lock"
$guard = [IO.File]::Open($lockPath, 'CreateNew', 'ReadWrite', 'None')
try {
    $data = if (Test-Path -LiteralPath $Roster) {
        Get-Content -LiteralPath $Roster -Raw | ConvertFrom-Json -AsHashtable
    } else { [ordered]@{schemaVersion=1; sites=[ordered]@{}} }
    if ($data.schemaVersion -ne 1 -or $data.sites -isnot [Collections.IDictionary]) { throw 'Unrecognized roster format.' }
    $previous = $data.sites[$Site]
    $byChart = @{}
    foreach ($p in $patients) { $byChart[$p.ava] = $p }
    foreach ($manual in @($previous.patients | Where-Object { $_.source -eq 'manual' })) {
        $match = $byChart[$manual.ava]
        if ($match) {
            if ($manual.phn -and $match.phn -and $manual.phn -ne $match.phn) { throw 'Manual record conflicts with the exported PHN.' }
            if ($manual.dob -and $match.dob -and $manual.dob -ne $match.dob) { throw 'Manual record conflicts with the exported DOB.' }
            if (!$match.phn -and $manual.phn) {
                if ($phns.ContainsKey($manual.phn)) { throw 'Manual PHN belongs to another chart in the export.' }
                $match.phn = $manual.phn
                $phns[$manual.phn] = $true
            }
            if (!$match.dob) { $match.dob = $manual.dob }
        } else {
            if ($manual.phn -and $phns.ContainsKey($manual.phn)) { throw 'Manual PHN belongs to another chart in the export.' }
            $patients += $manual
        }
    }
    $removed = @($previous.removedPatients)
    $patients = @($patients | Where-Object { $_.ava -notin $removed.ava })
    $data.sites[$Site] = [ordered]@{source=$filename; patients=$patients; removedPatients=$removed}
    $temp = "$Roster.$([guid]::NewGuid()).tmp"
    try {
        [IO.File]::WriteAllText($temp, ($data | ConvertTo-Json -Depth 7))
        [IO.File]::Move($temp,$Roster,$true)
    } finally { if (Test-Path -LiteralPath $temp) { [IO.File]::Delete($temp) } }
} finally {
    $guard.Dispose()
    [IO.File]::Delete($lockPath)
}
Write-Output "$Site imported $($patients.Count) patients. Unavailable PHNs: $missingPhns."
