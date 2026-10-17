[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Add', 'Edit', 'Remove', 'Verify', 'Maintain', 'ImportOther')]
    [string]$Mode,

    [string]$JsonPath = 'C:\Users\rmano\My Drive\02. TRIM\TRIM AI\Data\Roster\trim-patients-data.json',

    [string]$MatchName,
    [string]$MatchPhn,
    [string]$MatchAva,

    [string]$Name,
    [string]$Phn,
    [string]$Unit,
    [string]$Room,
    [string]$Codes,
    [string]$Ava,

    [string]$ImportPath,

    [Alias('ConfirmDelete')]
    [switch]$ConfirmRemove
)

$ErrorActionPreference = 'Stop'

function Get-RosterToday {
    $zone = [TimeZoneInfo]::FindSystemTimeZoneById('Pacific Standard Time')
    return [TimeZoneInfo]::ConvertTime([DateTimeOffset]::UtcNow, $zone).ToString('yyyy-MM-dd')
}

function Get-ExpiryDate {
    param([string]$RemovedDate)
    if ($RemovedDate -notmatch '^\d{4}-\d{2}-\d{2}$') { throw 'Invalid removal calendar date.' }
    $date = [datetime]::ParseExact($RemovedDate, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
    if ($date.Year -lt 1000) { throw 'Invalid removal calendar date.' }
    return $date.AddMonths(3).ToString('yyyy-MM-dd')
}

function Normalize-Digits {
    param([AllowNull()][string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return '' }
    return ($Value -replace '\D', '')
}

function Get-TextHash {
    param([Parameter(Mandatory = $true)][string]$Text)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
        return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '')
    }
    finally {
        $sha.Dispose()
    }
}

function Assert-RosterSchema {
    param([Parameter(Mandatory = $true)]$Roster)
    if ($null -eq $Roster.patients -or $null -eq $Roster.units -or $null -eq $Roster.billingDates) {
        throw 'JSON schema check failed: patients, units, and billingDates are required.'
    }
    foreach ($key in @('patients', 'units', 'billingDates', 'removedPatients', 'otherPatients')) {
        if ($null -ne $Roster.PSObject.Properties[$key] -and $Roster.$key -isnot [array]) { throw "Invalid array: $key" }
    }
    $seenIds = @{}; $seenPhns = @{}; $seenAvas = @{}
    foreach ($patientRecord in (@($Roster.patients) + @($Roster.removedPatients | Where-Object { $null -ne $_ }) + @($Roster.otherPatients | Where-Object { $null -ne $_ }))) {
        foreach ($propertyName in @('id', 'name', 'phn', 'unit', 'room', 'codes', 'ava')) {
            if ($null -eq $patientRecord.PSObject.Properties[$propertyName]) {
                throw "JSON schema check failed: patient property '$propertyName' is missing."
            }
        }
        if ([string]::IsNullOrWhiteSpace([string]$patientRecord.id) -or [string]::IsNullOrWhiteSpace([string]$patientRecord.name)) { throw 'Incomplete roster identity.' }
        foreach ($key in @('id', 'phn', 'ava')) {
            $value = if ($key -eq 'id') { [string]$patientRecord.id } else { Normalize-Digits ([string]$patientRecord.$key) }
            if (-not $value) { continue }
            $seen = switch ($key) { 'id' { $seenIds }; 'phn' { $seenPhns }; 'ava' { $seenAvas } }
            if ($seen.ContainsKey($value)) { throw "Duplicate $key across roster collections." }
            $seen[$value] = $true
        }
    }
    foreach ($patientRecord in @($Roster.removedPatients | Where-Object { $null -ne $_ })) {
        $null = Get-ExpiryDate ([string]$patientRecord.removedDate)
    }
    foreach ($patientRecord in @($Roster.patients)) {
        if ($null -ne $patientRecord.PSObject.Properties['removedDate']) { throw 'Active patient has a removal date.' }
    }
    foreach ($patientRecord in @($Roster.otherPatients | Where-Object { $null -ne $_ })) {
        if ($patientRecord.phn -notmatch '^\d{10}$' -or $patientRecord.ava -notmatch '^\d{6,10}$') { throw 'Other patient has invalid PHN or Ava.' }
        if ($null -ne $patientRecord.PSObject.Properties['removedDate']) { throw 'Other patient has a removal date.' }
        if ($patientRecord.dob) {
            $null = [datetime]::ParseExact([string]$patientRecord.dob, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
        }
    }
}

function Find-Patients {
    param(
        [Parameter(Mandatory = $true)]$Roster,
        [AllowNull()][string]$SelectorName,
        [AllowNull()][string]$SelectorPhn,
        [AllowNull()][string]$SelectorAva
    )

    $hasName = -not [string]::IsNullOrWhiteSpace($SelectorName)
    $normalizedPhn = Normalize-Digits $SelectorPhn
    $normalizedAva = Normalize-Digits $SelectorAva
    $hasPhn = $normalizedPhn.Length -gt 0
    $hasAva = $normalizedAva.Length -gt 0

    if (-not ($hasName -or $hasPhn -or $hasAva)) {
        throw 'At least one exact match selector is required.'
    }

    return @($Roster.patients | Where-Object {
        $nameMatches = (-not $hasName) -or ($_.name -eq $SelectorName)
        $phnMatches = (-not $hasPhn) -or ((Normalize-Digits ([string]$_.phn)) -eq $normalizedPhn)
        $avaMatches = (-not $hasAva) -or ((Normalize-Digits ([string]$_.ava)) -eq $normalizedAva)
        $nameMatches -and $phnMatches -and $avaMatches
    })
}

$resolvedJsonPath = [System.IO.Path]::GetFullPath($JsonPath)
if (-not [System.IO.File]::Exists($resolvedJsonPath)) {
    throw "Roster JSON not found: $resolvedJsonPath"
}
if ([System.IO.Path]::GetExtension($resolvedJsonPath) -ne '.json') {
    throw 'The roster path must be a JSON file.'
}

$initialText = [System.IO.File]::ReadAllText($resolvedJsonPath)
$initialHash = Get-TextHash $initialText
$roster = $initialText | ConvertFrom-Json
Assert-RosterSchema $roster

$changed = $false
$today = Get-RosterToday
if ($null -eq $roster.PSObject.Properties['removedPatients']) {
    $roster | Add-Member -NotePropertyName removedPatients -NotePropertyValue @()
    if ($Mode -ne 'Verify') { $changed = $true }
}
$retainedBeforeExpiry = @($roster.removedPatients)
# Verification is read-only. Every successful mutation/Maintain prunes on the expiry date.
if ($Mode -notin @('Verify', 'ImportOther')) {
    $roster.removedPatients = @($roster.removedPatients | Where-Object { $today -lt (Get-ExpiryDate $_.removedDate) })
    if ($retainedBeforeExpiry.Count -ne $roster.removedPatients.Count) { $changed = $true }
}
$verificationMatchName = $MatchName
$verificationMatchPhn = $MatchPhn
$verificationMatchAva = $MatchAva

switch ($Mode) {
    'ImportOther' {
        if (-not $ImportPath) { throw 'ImportOther requires a reviewed JSON array in -ImportPath.' }
        $incoming = [IO.File]::ReadAllText([IO.Path]::GetFullPath($ImportPath)) | ConvertFrom-Json -NoEnumerate
        if ($incoming -isnot [array] -or $incoming.Count -eq 0) { throw 'Import must be a nonempty JSON array.' }
        # Validate the entire incoming set before touching the live roster.
        Assert-RosterSchema ([pscustomobject]@{patients=@(); units=$roster.units; billingDates=@(); removedPatients=@(); otherPatients=$incoming})
        $originalOther = @($roster.otherPatients | Where-Object { $null -ne $_ })
        $nextOther = @($originalOther)
        $importAdded = 0
        $importExisting = 0
        foreach ($p in $incoming) {
            $matches = @((@($roster.patients) + @($roster.removedPatients) + $nextOther) | Where-Object {
                ([string]$_.id -eq [string]$p.id) -or
                ((Normalize-Digits $_.phn) -eq $p.phn) -or
                ((Normalize-Digits $_.ava) -eq $p.ava)
            })
            if ($matches.Count -gt 0) {
                # An exact repeat is a no-op; any identity or content conflict stops the whole import.
                if ($matches.Count -ne 1 -or $originalOther -notcontains $matches[0]) { throw 'Import conflicts with another roster record.' }
                foreach ($field in $p.PSObject.Properties.Name) {
                    if ([string]$matches[0].$field -cne [string]$p.$field) { throw "Import differs from an existing other patient: $field. Review explicitly." }
                }
                $importExisting++
                continue
            }
            $nextOther += $p
            $importAdded++
        }
        $roster | Add-Member -NotePropertyName otherPatients -NotePropertyValue $nextOther -Force
        $changed = $changed -or ($importAdded -gt 0)
    }

    'Add' {
        if ([string]::IsNullOrWhiteSpace($Name)) { throw 'Name is required for Add.' }
        if ([string]::IsNullOrWhiteSpace($Unit)) { throw 'Unit is required for Add.' }
        if ([string]::IsNullOrWhiteSpace($Room)) { throw 'Room is required for Add.' }
        if ([string]::IsNullOrWhiteSpace($Codes)) { throw 'Codes are required for Add.' }

        $normalizedNewPhn = Normalize-Digits $Phn
        $normalizedNewAva = Normalize-Digits $Ava
        $normalizedUnit = $Unit.Trim().ToLowerInvariant()

        if ($normalizedNewPhn -notmatch '^\d{10}$') { throw 'PHN must contain exactly 10 digits.' }
        if ($normalizedNewAva -notmatch '^\d{6,10}$') { throw 'AVA number must contain 6 to 10 digits.' }

        $validUnits = @($roster.units | ForEach-Object { ([string]$_.id).ToLowerInvariant() })
        if ($validUnits -notcontains $normalizedUnit) { throw "Unknown unit: $Unit" }

        $duplicates = @($roster.patients | Where-Object {
            (Normalize-Digits ([string]$_.phn)) -eq $normalizedNewPhn -or
            (Normalize-Digits ([string]$_.ava)) -eq $normalizedNewAva
        })
        if ($duplicates.Count -gt 0) {
            throw 'Duplicate protection stopped the add: PHN or AVA already exists.'
        }

        $newIdNumber = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $returning = @($roster.removedPatients | Where-Object {
            (Normalize-Digits ([string]$_.phn)) -eq $normalizedNewPhn -or
            (Normalize-Digits ([string]$_.ava)) -eq $normalizedNewAva
        })
        if ($returning.Count -gt 1 -or @($returning | Where-Object {
            (Normalize-Digits ([string]$_.phn)) -ne $normalizedNewPhn -or
            (Normalize-Digits ([string]$_.ava)) -ne $normalizedNewAva
        }).Count -gt 0) { throw 'Returning patient identifiers conflict. Verify PHN and Ava before reactivation.' }
        $existingIds = @((@($roster.patients) + @($roster.removedPatients)) | ForEach-Object { [string]$_.id })
        while ($existingIds -contains [string]$newIdNumber) { $newIdNumber++ }

        $newPatient = [pscustomobject][ordered]@{
            id    = [string]$newIdNumber
            name  = $Name.Trim()
            phn   = $normalizedNewPhn
            unit  = $normalizedUnit
            room  = if ($null -eq $Room) { '' } else { $Room.Trim() }
            codes = if ($null -eq $Codes) { '' } else { $Codes.Trim() }
            ava   = $normalizedNewAva
            panelAddedDate = $today
            newPanelPatient = $true
        }
        if ($returning.Count -eq 1) {
            $preserved = $returning[0]
            foreach ($key in @('name', 'phn', 'unit', 'room', 'codes', 'ava')) { $preserved.$key = $newPatient.$key }
            $preserved.PSObject.Properties.Remove('removedDate')
            $preserved | Add-Member -NotePropertyName newPanelPatient -NotePropertyValue $false -Force
            $newPatient = $preserved
            $roster.removedPatients = @($roster.removedPatients | Where-Object { $_.id -ne $preserved.id })
        }
        $roster.patients = @($roster.patients) + $newPatient
        $verificationMatchName = $null
        $verificationMatchPhn = $normalizedNewPhn
        $verificationMatchAva = $normalizedNewAva
        $changed = $true
    }

    'Edit' {
        $matches = Find-Patients $roster $MatchName $MatchPhn $MatchAva
        if ($matches.Count -ne 1) { throw "Edit requires exactly one match; found $($matches.Count)." }
        $patientRecord = $matches[0]
        $editableFields = @('Name', 'Phn', 'Unit', 'Room', 'Codes', 'Ava')
        $hasEdit = @($editableFields | Where-Object { $PSBoundParameters.ContainsKey($_) }).Count -gt 0
        if (-not $hasEdit) { throw 'Edit requires at least one field to change.' }

        if ($PSBoundParameters.ContainsKey('Name')) {
            if ([string]::IsNullOrWhiteSpace($Name)) { throw 'Name cannot be blank.' }
            $patientRecord.name = $Name.Trim()
        }
        if ($PSBoundParameters.ContainsKey('Phn')) {
            $normalizedEditedPhn = Normalize-Digits $Phn
            if ($normalizedEditedPhn -notmatch '^\d{10}$') { throw 'PHN must contain exactly 10 digits.' }
            $phnDuplicates = @($roster.patients | Where-Object {
                $_.id -ne $patientRecord.id -and
                (Normalize-Digits ([string]$_.phn)) -eq $normalizedEditedPhn
            })
            if ($phnDuplicates.Count -gt 0) { throw 'Duplicate protection stopped the edit: PHN already exists.' }
            $patientRecord.phn = $normalizedEditedPhn
        }
        if ($PSBoundParameters.ContainsKey('Ava')) {
            $normalizedEditedAva = Normalize-Digits $Ava
            if ($normalizedEditedAva -notmatch '^\d{6,10}$') { throw 'AVA number must contain 6 to 10 digits.' }
            $avaDuplicates = @($roster.patients | Where-Object {
                $_.id -ne $patientRecord.id -and
                (Normalize-Digits ([string]$_.ava)) -eq $normalizedEditedAva
            })
            if ($avaDuplicates.Count -gt 0) { throw 'Duplicate protection stopped the edit: AVA already exists.' }
            $patientRecord.ava = $normalizedEditedAva
        }
        if ($PSBoundParameters.ContainsKey('Unit')) {
            if ([string]::IsNullOrWhiteSpace($Unit)) { throw 'Unit cannot be blank.' }
            $normalizedEditedUnit = $Unit.Trim().ToLowerInvariant()
            $validUnits = @($roster.units | ForEach-Object { ([string]$_.id).ToLowerInvariant() })
            if ($validUnits -notcontains $normalizedEditedUnit) { throw "Unknown unit: $Unit" }
            $patientRecord.unit = $normalizedEditedUnit
        }
        if ($PSBoundParameters.ContainsKey('Room')) {
            $patientRecord.room = if ($null -eq $Room) { '' } else { $Room.Trim() }
        }
        if ($PSBoundParameters.ContainsKey('Codes')) {
            $patientRecord.codes = if ($null -eq $Codes) { '' } else { $Codes.Trim() }
        }

        $verificationMatchName = $null
        $verificationMatchPhn = [string]$patientRecord.phn
        $verificationMatchAva = [string]$patientRecord.ava
        $changed = $true
    }

    'Remove' {
        if (-not $ConfirmRemove) {
            throw 'Remove requires -ConfirmRemove after explicit user authorization.'
        }
        $matches = @(Find-Patients $roster $MatchName $MatchPhn $MatchAva)
        if ($matches.Count -eq 0) {
            $previous = @(Find-Patients ([pscustomobject]@{patients=$retainedBeforeExpiry}) $MatchName $MatchPhn $MatchAva)
            if ($previous.Count -ne 1) { throw "Remove requires exactly one active or retained match; found $($previous.Count)." }
            $removeId = [string]$previous[0].id
            $removedDate = [string]$previous[0].removedDate
            break # Idempotent: never reset a retained patient's removal date.
        }
        if ($matches.Count -ne 1) { throw "Remove requires exactly one match; found $($matches.Count)." }
        $removeId = [string]$matches[0].id
        $removedDate = $today
        $removedRecord = $matches[0]
        $removedRecord | Add-Member -NotePropertyName removedDate -NotePropertyValue $removedDate
        $roster.removedPatients = @($roster.removedPatients) + $removedRecord
        $roster.patients = @($roster.patients | Where-Object { [string]$_.id -ne $removeId })
        $changed = $true
    }

    'Verify' {
        $matches = Find-Patients $roster $MatchName $MatchPhn $MatchAva
        if ($matches.Count -ne 1) { throw "Verify requires exactly one match; found $($matches.Count)." }
    }
    'Maintain' { } # Migrate old schema / expire retained records; never remove active patients.
}

if ($changed) {
    Assert-RosterSchema $roster
    $latestText = [System.IO.File]::ReadAllText($resolvedJsonPath)
    if ((Get-TextHash $latestText) -ne $initialHash) {
        throw 'The roster changed during this operation. No update was written; re-read and retry.'
    }

    $updatedText = $roster | ConvertTo-Json -Depth 100 -Compress
    $temporaryPath = Join-Path ([System.IO.Path]::GetDirectoryName($resolvedJsonPath)) (
        '.trim-manager-' + [System.Guid]::NewGuid().ToString() + '.tmp'
    )

    try {
        [System.IO.File]::WriteAllText(
            $temporaryPath,
            $updatedText,
            [System.Text.UTF8Encoding]::new($false)
        )
        $roundTrip = [System.IO.File]::ReadAllText($temporaryPath) | ConvertFrom-Json
        Assert-RosterSchema $roundTrip
        if ((Get-TextHash ([System.IO.File]::ReadAllText($resolvedJsonPath))) -ne $initialHash) {
            throw 'The roster changed before replacement. No update was written; re-read and retry.'
        }
        Move-Item -LiteralPath $temporaryPath -Destination $resolvedJsonPath -Force
    }
    finally {
        if ([System.IO.File]::Exists($temporaryPath)) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}

$verifiedText = [System.IO.File]::ReadAllText($resolvedJsonPath)
if ($changed -and (Get-TextHash $verifiedText) -ne (Get-TextHash $updatedText)) {
    throw 'Readback failed: roster changed after saving. Re-read before any further operation.'
}
$verifiedRoster = $verifiedText | ConvertFrom-Json
Assert-RosterSchema $verifiedRoster

if ($Mode -eq 'Remove') {
    $afterMatches = Find-Patients $verifiedRoster $MatchName $MatchPhn $MatchAva
    if ($afterMatches.Count -ne 0) { throw 'Readback failed: the removed record is still present.' }
    $retainedMatches = @($verifiedRoster.removedPatients | Where-Object { [string]$_.id -eq $removeId })
    $shouldRetain = $today -lt (Get-ExpiryDate $removedDate)
    if (($shouldRetain -and ($retainedMatches.Count -ne 1 -or $retainedMatches[0].removedDate -ne $removedDate)) -or
        (-not $shouldRetain -and $retainedMatches.Count -ne 0)) { throw 'Readback failed: retained record/date mismatch.' }
    $result = [ordered]@{
        Mode          = $Mode
        Changed       = $changed
        MatchCount    = 0
        TotalPatients = @($verifiedRoster.patients).Count
        RetainedPatients = @($verifiedRoster.removedPatients).Count
        RemovedDate = $removedDate
        ExpiresOn = Get-ExpiryDate $removedDate
    }
}
elseif ($Mode -eq 'ImportOther') {
    foreach ($p in $incoming) {
        $matches = @($verifiedRoster.otherPatients | Where-Object { $_.id -eq $p.id })
        if ($matches.Count -ne 1) { throw 'Import readback count mismatch.' }
        foreach ($field in $p.PSObject.Properties.Name) {
            if ([string]$matches[0].$field -cne [string]$p.$field) { throw "Import readback differs: $field." }
        }
    }
    $beforeRoster = $initialText | ConvertFrom-Json
    foreach ($field in $beforeRoster.PSObject.Properties.Name | Where-Object { $_ -ne 'otherPatients' }) {
        if (($beforeRoster.$field | ConvertTo-Json -Depth 100 -Compress) -cne ($verifiedRoster.$field | ConvertTo-Json -Depth 100 -Compress)) {
            throw "Import altered an unrelated roster field: $field."
        }
    }
    $result = [ordered]@{Mode=$Mode; Changed=$changed; Added=$importAdded; AlreadyPresent=$importExisting; TotalPatients=@($verifiedRoster.patients).Count; RetainedPatients=@($verifiedRoster.removedPatients).Count; OtherPatients=@($verifiedRoster.otherPatients).Count}
}
elseif ($Mode -eq 'Maintain') {
    $result = [ordered]@{ Mode=$Mode; Changed=$changed; TotalPatients=@($verifiedRoster.patients).Count; RetainedPatients=@($verifiedRoster.removedPatients).Count }
}
else {
    $afterMatches = Find-Patients $verifiedRoster $verificationMatchName $verificationMatchPhn $verificationMatchAva
    if ($afterMatches.Count -ne 1) { throw "Readback failed: expected one match, found $($afterMatches.Count)." }
    $verifiedPatient = $afterMatches[0]
    $result = [ordered]@{
        Mode          = $Mode
        Changed       = $changed
        MatchCount    = 1
        Unit          = [string]$verifiedPatient.unit
        RoomBlank     = [string]::IsNullOrWhiteSpace([string]$verifiedPatient.room)
        Codes         = [string]$verifiedPatient.codes
        TotalPatients = @($verifiedRoster.patients).Count
    }
}

$result | ConvertTo-Json -Compress
