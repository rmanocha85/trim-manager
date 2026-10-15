# TRIM Manager

The original roster app is `index.html` (green T favicon). `billing/` is a separate application. Never commit private patient data. Develop outside Google Drive.

## Other patients

The Other patients tab reads `otherPatients` from the same private roster JSON, with the existing table styling, unit grouping, PHN copy controls and Ava chart links. Search by name, PHN or Ava number, or filter by doctor. Missing units appear under Unit not recorded; no locations or physician assignments are inferred. These patients never enter the active panel, its counts, or printed active lists.

The optional `otherPatients[].doctor` string stores a selected physician name; an empty/missing value means Unassigned. Changes use the existing conditional Drive save and conflict protection. Failed saves remain visibly unsaved and cannot overwrite a newer roster. Unknown previously recorded doctors remain visible. `OTHER_DOCTORS` contains the other physicians documented in the private TRIM Management physician-group reference, reviewed October 13, 2026; the onboarding status remains explicit. Update those options when the maintained physician-group record changes. This does not transfer patients into or out of the active panel or create billing entries.

Run `node tests/other-patients.browser.cjs` with Playwright available for synthetic chart-link, search, filter, assignment, reload and conflict coverage.

## TRIM Notes upload tracking

Both patient lists have a manual checkbox immediately before each patient's name and a separate uploaded count. Tick after adding source documents to the private Routine notes Incoming folder. This records document upload only, not extraction, clinical review or note completion. Nothing is inferred from existing records or automatically checked.

The same private roster stores optional patient fields `notesDataUploaded` (boolean) and `notesDataUploadedAt` (UTC ISO timestamp for the latest sign-off; null when cleared). Missing fields mean unchecked. Conditional Drive saving, verified readback, offline/history restrictions and conflict recovery apply. Pending and failed changes show Saving or Not saved beside the checkbox. These fields survive normal edits, removal and reactivation and do not affect billing, chart links or printed lists. TRIM Notes patient summaries stay in their separate existing store.

Run `node tests/notes-upload.browser.cjs` with Playwright available for synthetic placement, persistence, clearing, history/offline and conflict checks.

## Roster retention contract

- `patients` remains the active panel. Active lists, counts and printed lists use only this array.
- `removedPatients` is optional on legacy input and an array on new writes. Each entry is the complete former patient record, including its existing `id` and unknown fields, plus `removedDate: "YYYY-MM-DD"`. Other root fields, `units` and `billingDates` survive saves.
- The removal date is the current **America/Los_Angeles** calendar date. No death date or reason is required. No deleted patients or dates are reconstructed.
- Expiry is the start of the date three calendar months after removal; clamp the day to the last day of that month. November 30, 2026 expires February 28, 2027; November 30, 2023 expires February 29, 2024.
- The app filters expired records on connection/refresh and persists pruning on a roster save. The PowerShell helper prunes during successful Add/Edit/Remove/Maintain operations; Verify is read-only. There is no unattended background deletion. Read-only Removed Patients display filters elapsed retention but does not itself save. Existing historical daily snapshots and Drive version history are not deleted.
- Adding a returning patient with the same PHN and Ava reuses the retained ID and preserves unknown fields. Conflicting identifiers require correction before reactivation. After expiry, the old roster ID is intentionally unavailable; adding again creates a new roster ID, while the unchanged PHN still matches the separate billing app's saved identity. Do not infer an expired patient's prior ID from memory.
- Retention expiry never reads, writes, deletes or rewrites the separate billing ledger. Coverage patients absent from both roster arrays remain eligible for physician-directed billing, without active panel membership or routine 14-day tracking. The separate billing app remains unchanged; it does not yet ingest the new `removedPatients` collection. Its saved patient identities remain independent of roster expiry.

## Saving and concurrency

The single header Drive button connects and loads the latest roster. It shows `Connect to Drive` initially, `Drive connected` after verified access, `Reconnect Drive` when access needs attention, and `Checking Drive…` while loading. Clicking the connected button refreshes the list and accepts the verified revision. If local roster changes or an unfinished patient form would be replaced, a confirmation lets the user keep them or explicitly discard them. Saves in progress disable the button. The adjacent save-status message remains independent.

Offline events and token expiry revoke the green state. Returning online, returning to the tab and minute checks verify access without authentication popups or replacing the roster. Remote changes lock editing until the user clicks the Drive button to reload. Connection/refresh performs no writes; daily snapshots are deferred until the next roster save, using the pre-edit loaded roster.

The Manager uses the configured canonical roster file ID, a stable Drive v2 ETag read around content loading, conditional `If-Match` updates, serial saves and verified readback. It never creates a substitute roster on failed writes. A conflict locks editing until the user reloads with the Drive button. Cancelling the discard confirmation preserves local edits and the conflict lock; accepting it loads the current Drive version, after which discarded edits can be repeated. Reload old open Manager tabs before editing; older deployed JavaScript cannot enforce this new schema.

The helper validates both collections and checks the initial content hash immediately before replacement and checks the exact saved text afterward. These checks detect competing local edits; they cannot lock remote writers across Drive Desktop synchronization. Stop and reconcile any Drive synchronization conflict rather than forcing an overwrite.

## Helper and verification

`scripts/update_trim_roster.ps1` is the versioned implementation. The operational installed helper and canonical Drive copy must match it. Workflow instructions live in the canonical TRIM workflow, not in this repository.

Use `-Mode Remove -MatchPhn <PHN> -ConfirmRemove` only for an explicitly authorized target. `-ConfirmDelete` remains an alias with retention semantics. A repeated removal does not reset the date. `-Mode Maintain` only adds an empty retained collection to old schemas and expires elapsed retained entries; it never removes active patients. No removal-date override is offered.

Run `node --test tests/retention.test.cjs` with Node and PowerShell 7 available. Tests create synthetic temporary JSON files outside Drive, exercise both implementations and mocked conditional Drive saves, and never load operational patient data. Run `node tests/browser.cjs` with Playwright available for the synthetic browser smoke test.
