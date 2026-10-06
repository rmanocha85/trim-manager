# TRIM Manager

The original roster app is `index.html` (green T favicon). `billing/` is a separate application. Never commit private patient data. Develop outside Google Drive.

## Roster retention contract

- `patients` remains the active panel. Active lists, counts and printed lists use only this array.
- `removedPatients` is optional on legacy input and an array on new writes. Each entry is the complete former patient record, including its existing `id` and unknown fields, plus `removedDate: "YYYY-MM-DD"`. Other root fields, `units` and `billingDates` survive saves.
- The removal date is the current **America/Los_Angeles** calendar date. No death date or reason is required. No deleted patients or dates are reconstructed.
- Expiry is the start of the date three calendar months after removal; clamp the day to the last day of that month. November 30, 2026 expires February 28, 2027; November 30, 2023 expires February 29, 2024.
- The app prunes on successful live load/sync and save. The PowerShell helper prunes during successful Add/Edit/Remove/Maintain operations; Verify is read-only. There is no unattended background deletion. Read-only Removed Patients display filters elapsed retention but does not itself save. Existing historical daily snapshots and Drive version history are not deleted.
- Adding a returning patient with the same PHN and Ava reuses the retained ID and preserves unknown fields. Conflicting identifiers require correction before reactivation. After expiry, the old roster ID is intentionally unavailable; adding again creates a new roster ID, while the unchanged PHN still matches the separate billing app's saved identity. Do not infer an expired patient's prior ID from memory.
- Retention expiry never reads, writes, deletes or rewrites the separate billing ledger. Coverage patients absent from both roster arrays remain eligible for physician-directed billing, without active panel membership or routine 14-day tracking. The separate billing app remains unchanged; it does not yet ingest the new `removedPatients` collection. Its saved patient identities remain independent of roster expiry.

## Saving and concurrency

The Manager uses the configured canonical roster file ID, a stable Drive v2 ETag read around content loading, conditional `If-Match` updates, serial saves and verified readback. It never creates a substitute roster on failed writes. A conflict locks editing until the user syncs. Sync discards the unverified local edit, which must be repeated after reconciliation. Reload old open Manager tabs before editing; older deployed JavaScript cannot enforce this new schema.

The helper validates both collections and checks the initial content hash immediately before replacement and checks the exact saved text afterward. These checks detect competing local edits; they cannot lock remote writers across Drive Desktop synchronization. Stop and reconcile any Drive synchronization conflict rather than forcing an overwrite.

## Helper and verification

`scripts/update_trim_roster.ps1` is the versioned implementation. The operational installed helper and canonical Drive copy must match it. Workflow instructions live in the canonical TRIM workflow, not in this repository.

Use `-Mode Remove -MatchPhn <PHN> -ConfirmRemove` only for an explicitly authorized target. `-ConfirmDelete` remains an alias with retention semantics. A repeated removal does not reset the date. `-Mode Maintain` only adds an empty retained collection to old schemas and expires elapsed retained entries; it never removes active patients. No removal-date override is offered.

Run `node --test tests/retention.test.cjs` with Node and PowerShell 7 available. Tests create synthetic temporary JSON files outside Drive, exercise both implementations and mocked conditional Drive saves, and never load operational patient data. Run `node tests/browser.cjs` with Playwright available for the synthetic browser smoke test.
