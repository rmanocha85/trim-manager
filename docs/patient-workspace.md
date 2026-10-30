# Patient workspace update — October 30, 2026

The roster has a name/PHN/room search and shows “New patient” during the first 14 calendar days after a genuinely new panel addition. This is ordinary text for the browser's Find command. Returning retained patients keep their existing identity and do not become new admissions.

Roster, Billing and Notes group the patient's Last, First name, copy control and Ava chart link on the left, with PHN/copy, age and MOST nearby. Age is calculated from a recorded date of birth. MOST is projected from the Markdown in the individual PHN patient records. Ambiguous, conflicting or proposed statuses display “Review”; hover for the original source wording. Missing information stays blank. DOB can be recorded on the roster; a reported age is never used to invent a DOB.

The local service maintains `patient-display.json` as a disposable display projection in the existing Routine notes folder. It contains no independent clinical authority and can be rebuilt from the individual patient files. The cloud app reads the synced projection only when its dataset matches. Clinical data stays outside this repository.

Documents opens an upload dialog from the roster or patient box. It accepts PDF, PNG, JPG and WebP, including dropped files and pasted screenshots, up to six files and 10 MB total. It uploads originals to the existing private Routine notes/Incoming folder, verifies their SHA-256 hashes, then writes an intake manifest. Retries reuse the same filenames/Drive IDs. Sources are retained.

The local service scans only explicit app intake manifests, never arbitrary files in Incoming. It processes queued jobs through the existing ChatGPT connection when available. Cloud-only uploads remain queued until Drive sync and the local service are available. No AI credentials are shipped to GitHub Pages. AI failures are visible and retryable; a missing or mismatched source PHN blocks importing. Every attached document must identify the selected PHN.

Analysis is a proposal. “Use proposed patient summary” saves the proposed Markdown and source references for clinical review, only when the original patient context is unchanged. Existing structured medications/labs are preserved and require separate reconciliation; summary acceptance does not verify administration or sign a clinical review. It never creates a visit or billing. Open Notes drafts must be saved before applying a proposal. Originals are not deleted.

The Local changes dialog has less status text and closes after all session changes save successfully. Conflicts, failures and unfinished patient forms keep it open. Existing discard protections remain.

Validation uses synthetic records and a fake AI response. Browser tests cover upload and read-back locally and through a mocked Drive API, including interrupted upload retries. A live synthetic PDF plus screenshot also passed through the existing ChatGPT connection (gpt-6.1-sol), with both source PHNs extracted correctly. No real patient documents were sent as a deployment smoke test.
