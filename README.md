# TRIM

One maintained application for **TRIM Patients**, **TRIM Notes** and **TRIM Billing**, owned by Dr. Rahul Manocha. Local development: `C:\Users\rmano\Documents\Codex\trim-app`. Records and reusable workflows remain in the existing TRIM AI folders in Drive. Never commit patient data, auth material, browser profiles or backups.

The header order is **Patient → Billing → Notes**, with Settings alongside. The patient roster has no count cap; both roster print layouts add continuation pages for larger units and include custom units. Billing uses a Sunday-first calendar. Concern and Routine Billing show independent Ava chart links for valid stored chart IDs. Code 14077 offers an optional multiline note, retained in recovery, Drive, history and print reports through its existing `reason` field.

## Run and verify

Use `Start-TRIM.cmd` (or `Start-TRIM.ps1`). The app uses `http://127.0.0.1:4317/`, preserving the previous laptop origin and encrypted recovery keys. One laptop/profile edits the synced folder; other computers use verified Google Drive access. Closing or locking does not discard local changes.

The static cloud entry is `https://rmanocha85.github.io/trim-manager/`. Patients and Billing connect directly to Google Drive; no hosted backend is required. Notes is available only through the laptop service, including when Patients and Billing use the direct Google connection. Its AI credentials and working files stay with that service. The cloud Notes tab opens `http://127.0.0.1:4317/?connection=cloud&section=notes` after the session is saved. Start the desktop shortcut first.

Both Google origins must be registered on the existing OAuth client: `https://rmanocha85.github.io` and `http://127.0.0.1:4317`. No client secret belongs in browser code. Use the registered laptop address, including its port.

After a successful Google workspace connection, the browser remembers the account email locally. Subsequent connections supply Google's `login_hint` without forcing account selection; **Use another account** opens the chooser explicitly. Google can still require sign-in or consent. Account metadata uses the existing Drive scope, and a token renewal must match the current account before pending changes can be saved. Tokens are never stored with this preference.

- Install: `pnpm install --frozen-lockfile` (Node 22+).
- Unit, storage, security, retention and billing rules: `pnpm test`.
- Browser scenarios: `pnpm test:browser` (installed Chrome).
- Syntax: `pnpm check`.

Automated tests use synthetic temporary records and fake AI/Google responses. Their server fixture refuses production data paths. Browser logs and synthetic screenshots go to ignored `work/`. The handoff integration test also verifies the existing canonical TRIM routine-billing helper; it does not enter an EMR. The opt-in `tests/drive-live-check.*` acceptance page verifies the actual Drive APIs using a marked private folder containing synthetic records. The local server serves it only with `TRIM_VERIFICATION=1`; it refuses the production roster and billing IDs. Remove its staged preview after verification and move its synthetic folder to Trash.

## Application structure

`public/app.mjs` owns navigation and common save controls. `session.mjs` coordinates explicit saves in Patients, Notes, Billing order, stopping and reporting partial success on error. Each section retains its own selection and work; selecting a patient does not move another section's selection.

- Patients: `patients-ui.mjs`, `patients-core.mjs`, `patients.html`, `patients.css`, `roster-repository.mjs`. The familiar tables, Ava links, doctor assignments, document-upload checkboxes, removal/reactivation and both print layouts are retained. Print dates affect the legacy printable sheet only.
- Notes: `notes-ui.mjs`, `notes-core.mjs`, `notes-storage.mjs`. Review is local. Prepare dated Meditech handoff stages the exact reviewed text; **Save to Drive** writes it. Later edits invalidate a staged handoff. Generation and handoffs do not bill or enter an EMR.
- Billing: `billing-ui.mjs` with existing pure billing, report, merge, date, OCR and backup modules. Imports and marking a printed batch handed over remain local until **Save to Drive**. Historical starting dates are collapsed under Settings. First-time empty-file creation and confirmed full backup restoration are explicit recovery/setup operations.
- Local service: `server.mjs`, `storage.mjs`, `roster-storage.mjs`, `notes-local.mjs`, `backup-storage.mjs`, `notes-auth.mjs`. Loopback only, same-origin and session checks, restricted static files, conditional writes and verified readback. No patient data is served before local connection.

## Saving and data preservation

Clinical context uses `Routine notes/index.json` and `patients/<10-digit-PHN>.json`. The index holds identity/path references and dataset metadata; each patient document holds the existing context fields without dropping medication snapshots or review state. Names remain inside records for readable checks. The roster remains the panel authority. Dated visits, images and Meditech handoffs stay separate.

The laptop's `patient-context.json` API name is a compatibility view assembled from these files, not a second maintained file. `LocalNotesStore` conditionally writes only changed patients, commits the index last, and journals interrupted transactions. The first migration verifies an immutable `archive/patient-context-<hash>.json` backup before removing the old combined file. Missing patient files, PHN mismatches, stale browser revisions and a recreated legacy file stop saving rather than erase context.

New personal-panel admissions initialize an empty Notes context during the laptop app's shared save, after the roster succeeds and before Notes is saved. The shared `ensurePatientContexts` function validates PHNs, adds only missing contexts and never resets existing clinical fields. Reopening an established Notes workspace stages any missing panel contexts for the next shared save, including roster additions received from cloud/synced files. Cloud-only TRIM does not run Notes; initialization completes on the laptop. Manual upload indicators and imported/reviewed history remain unset for empty records.

The canonical TRIM list PowerShell helper invokes `scripts/ensure-roster-context.mjs` after a verified Add/reactivation. It reads the saved roster and existing billing dataset, initializes through the same Notes transaction, and returns a de-identified verification result. If it fails after roster save, run the initializer again rather than repeating Add. `-NotesRoot` and `-BillingPath` support isolated testing; noncanonical test rosters do not touch live Notes by default. The portable skill helper mirrors the tested source in `scripts/update_trim_roster.ps1`; clinical schema logic remains in the local app.

Authorized document imports use PHN matching against the complete roster. Prepare concise summaries plus dated medication snapshots, documented changes, labs and unresolved issues; never treat a pre-change list or planned change as confirmed current treatment. `scripts/import-patient-context.mjs` validates a prepared extraction batch (dry-run by default; `--commit` applies), preserves existing records, refuses to replace a nonempty summary without reconciliation, and retains hash-verified originals under `sources/` before deleting matched files from `Incoming/`. Unknown identities stay in Incoming. Future imports must reconcile existing context and preserve newer evidence; this helper deliberately refuses blind replacement. No patient data belongs in source control.

Notes displays imported context and outstanding review issues. Generation receives the selected patient's dated clinical fields without identity/path metadata, and refuses a visit earlier than the supplied source records. Import status does not imply physician review. The existing Patients upload checkboxes are manual document-upload indicators, separate from extraction and clinical review.

Normal edits automatically save an encrypted recovery draft in the current browser; **Save to Drive** saves the whole dirty session. A patient form must first be completed with Add or the row's Save button. The header distinguishes local pending work, conflicts, and completed saves. Local Drive-folder writes cannot verify cloud synchronization; the UI says so. A failed section leaves itself and subsequent sections pending. Lost acknowledgments can be retried without duplication. Roster conflicts require review and explicit reload/discard; an encrypted discarded copy remains on the device.

Use the header's cloud/laptop switch after saving. It blocks pending changes and requires a direct Google connection before leaving folder mode. Reconnecting from folder mode checks the complete roster and billing contents against Google Drive before adopting them; a mismatch preserves the existing session and asks for Drive sync to finish. Notes always saves to the designated laptop Drive folder and reports that desktop sync remains unverified. Browser drafts are specific to each origin and are never transferred by a link.

The original roster, billing ledger and Notes documents remain separate at their existing identities and paths. Patients saves the complete roster, including unknown fields, `otherPatients`, doctor assignments, upload flags, `removedPatients`, units and print dates. Billing's reduced roster view is never written as the complete roster. Returning retained patients preserve their IDs. Three-calendar-month removal retention uses Pacific dates and clamps month ends. Expiry occurs on an explicit roster save; it never deletes billing history.

Before-edit daily roster snapshots go to `TRIM AI/Backups/Roster`; older `TRIM Snapshots` remain readable. Every saved billing version enters a durable backup queue. Local-folder and direct Google connections support verified snapshots under `TRIM AI/Backups/Billing` (Google access can fall back to its existing private app-owned folder). Matching backups expire after three calendar months only after verifying the retained copy. Independent laptop backup remains optional. Full restore requires a reviewed selection, confirmation and verified safety copy. Clinical and billing history are not pruned by backup retention.

`scripts/update_trim_roster.ps1` remains an explicit transactional helper for the established physician-authorized roster workflows. It is not the app's autosave path. It verifies schema and file hashes and never infers clinical facts.

## Cutover and older code

This checkout inherits the published Manager repository's history and incorporates the full local Billing/Notes source and newer roster helper. The old standalone app implementations and superseded tests are removed from active source; prior versions remain in Git history and verified local source archives. Old laptop shortcut names delegate to this launcher. Root and `billing/` contain only compatibility redirects generated by `scripts/cloud-entry.mjs`; both load the single `public/` application while preserving URL parameters and the existing browser origin.

The cloud release retains the published website's origin and billing recovery keys. Browser storage cannot move automatically between the cloud and laptop origins; do not clear either during cutover. Before replacing the published app, run the automated suite and the real Drive cloud-to-laptop-to-cloud acceptance check on isolated records. Installing or launching TRIM does not submit billing or enter clinical notes. Future development belongs in this repository.

October 17, 2026 verification: 165 automated checks, all 17 browser scenarios and 76 JavaScript syntax checks passed. The staged cloud build and the laptop origin both saved isolated synthetic roster/billing records through the actual Google APIs, read them back, and rejected stale revisions. The final cloud read confirmed the laptop save. Production roster and billing file hashes remained unchanged. Temporary verification assets are removed from the released site.

October 19, 2026 verification: 170 automated checks, 18 browser scenarios and 80 JavaScript syntax checks passed, including a 151-patient save/reload/search/print check, optional-note recovery, responsive Ava links and simulated Google first/repeat/alternate-account connections. Live Google chooser behavior was not reverified for this update. The billing-mode fixture now uses relative visit dates so its recent patient does not become due as time passes.
