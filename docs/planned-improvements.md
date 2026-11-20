# Planned improvements

## Roster alignment and nursing drafts — November 20, 2026

The roster toolbar now uses caption-free clipboard, speech-bubble, person-plus and hamburger controls with accessible names and hover tips. Search is narrower. Name-copy sits left of each name; an aligned Active issue column after PHN holds the flag and resolve/Undo actions before Hospital status.

Nurse updates prepares editable messages from current active issues in the selected All/My/Other roster. It deduplicates patients and creates separate floor 1+3 and floor 2 drafts. Search filters do not restrict the list. Unknown or conflicting locations are displayed for review and excluded from both drafts. The confirmed mapping places Cedar/Cherry on 1, Fern/Hatzic/Dewdney/Deroche on 2, and Silver/Stave on 3. Default messages omit PHNs and clinical issue descriptions. Editing or deleting text changes only the draft. Copy and an optional Google Messages link support manual recipient selection, pasting and sending; no integration or automatic send is used.

Unit floors can be corrected through Units, staged locally and saved using the existing conditional roster-save flow. No automatic roster or billing migration runs on startup. Private release evidence records the authorized Hatzic correction separately.

## Verified billing export and roster actions — November 19, 2026

Implemented the authorized next build: compact roster menu and resolve/Undo control; compact editable batch dates defaulting to outstanding billing through Vancouver yesterday; envelope-only verified PDF download and addressed email draft; exact PDF text/charge verification; persistent export receipts and explicit manual send confirmation; separate corrections preserving sent originals; and retained billing history without automatic expiry. Removed the manual review attestation and tab-memory print prerequisite.

The envelope saves the exact export, verifies and downloads its PDF. The operator attaches it manually and sends using their email app, then chooses Mark sent to Suzy. Only unchanged entries in that frozen export are closed. No Gmail connection, mailbox access or automatic email is included, following Rahul's simplification request. Downloads follow the browser's configured download location. Sent confirmation does not imply claim submission or payment.

Private requirements and the audited existing-delivery record remain in the owner's TRIM Working records. Existing deliveries can be recorded without regenerating or resending their PDF. Live reconciliation uses current content matching and the usual conditional Drive save; no old ledger is restored wholesale.

Validation: 306 unit tests (including Windows atomic replacement and explicit send confirmation), syntax checks, actual PDF extraction and save/reload confirmation, dense 400-charge/17-page PDF, and browser regression coverage. Live deployment/setup evidence is maintained privately; no patient data or private recipient configuration is committed.

## Billing card cleanup — November 17, 2026

- Compact patient cards share the Roster billing-history icon and patient identity/flag controls.
- A left-arrow calendar labels the previous billing date on hover or keyboard focus. A right-arrow calendar labels the next routine billing date. Both retain the weekday, month, day and year.
- The existing qualifying-billing calculation and 14-day routine-review rules are unchanged.
- A green edge identifies the open patient. Charges entered, Needs information and Handed over describe billing for the selected service date independently of selection; the header continues to report save status.
- Removed the redundant search-scope sentence and repeated date. The list summary shows patients with billing and incomplete entries.
- Successful refresh feedback appears briefly beside the save status. Pending-work and error messages remain visible.
- The patient list retains its original narrower width beside the editor. The empty editor is smaller, and card fields wrap within the available card width.
- Synthetic regression coverage verifies history navigation, PHN copying, accessible date tooltips, selection without billing, live entry-status changes, unchanged stored records and responsive layout.

Release validation: 298 unit tests and syntax checks passed. The Billing card, billing search, billing diagnosis, review/history, roster/billing and mode browser scenarios passed. The older balanced-layout, patient-layout and session scenarios also failed at the same steps against unchanged production commit `4fb72bc`; those baseline failures are outside this UI change.

## Roster and Concern Billing fixes — built locally November 15, 2026

- [x] **Family contacts** shows the name, relationship and full number for each contact. Use **+ Add contact** or **Edit**, then **Save contact** and **Save to Drive**. **Copy number** copies the displayed number. **Call** opens the same phone handler as MAID (ZAC on a configured computer).
- [x] Unit labels such as **DEWDNEY** fit on one line above the room number.
- [x] **Open billing** on a roster row opens Concern Billing for that patient on the selected billing date. Selecting a billing code is a separate action.
- [x] A patient with an active issue and a palliative flag appears once in each section. Both rows use the same patient record.
- [x] Concern Billing gives the search results the available height. **+ Add patient** opens the existing screenshot and manual entry form.

## OAT FH clinic day and TRIM visit list — November 13, 2026

- Choose a clinic date on the calendar, or choose Upcoming Friday. Search the selected day by name, PHN or note. Each verified PHN has a copy button.
- Finished saves only that appointment to the private OAT roster. Show Completed reveals it; uncheck to return it to the active list. A conflicting edit requires a reload. Re-importing a schedule retains completion only for an unambiguous matching visit.
- Roster → Copy visit list previews Active issue and ADP patients, with unit, room and active issue description. Choose My Patients, Other Patients or All. Patients appear once and roster searches do not limit the list.
- Drive retries short interruptions on reads. Save and Refresh renew expired access in the user action and verify the account. An uncertain write is never automatically repeated. Tokens remain in memory; unattended renewal is not configured on GitHub Pages.


## PMHx import status and MOST display — implemented November 13, 2026

- PMHx uploaded is checked automatically from a completed, archived, patient- and workspace-matched history import receipt. Existing admission/history imports are recognized from their saved source descriptions; new analyses explicitly classify whether the attached sources supply patient history.
- The source date/name appear in the checkbox tooltip. An automatic check is read-only; manual completion remains available when no qualifying receipt exists. Lab-only, medication-only, queued, failed, held, or mismatched imports do not check it.
- Clinical review and medication reconciliation are independent and remain unchanged. The status is a display projection, so no duplicate roster completion field or clinical approval is written.
- MOST wording such as “M1 (changed from M2)” displays the current M1 designation while retaining M2 as historical evidence. Unresolved competing current designations remain blank for review.

## Active issue tracking — implemented November 11, 2026

Available in **My Patients**, **Other Patients**, and **All**.

- Open a patient's **⋯ → Active issue…**, enter a brief description (up to 500 characters), then choose **Add active issue**. The description appears beneath the patient name and can be searched.
- Active issues appear first, followed by outstanding medication reconciliation, palliative patients, and the usual unit groups. The November 15 update also lists active palliative patients in the Palliative patients section.
- Click the **Active issue** badge to edit the description or **Mark resolved**. Resolved patients return to their appropriate priority or unit group. Resolution retains the description and timestamp; starting another issue preserves previous resolved episodes.
- Changes follow the existing **Save to Drive** workflow. Unfinished descriptions and staged edits have encrypted local recovery; they do not upload automatically.
- The roster record owns `activeIssue`, including status, description, opening/update/resolution timestamps and resolved history. Concurrent changes to the same issue require one whole-record choice so that resolving an older issue cannot silently resolve newly edited follow-up instructions. Other patient fields still merge independently.
- Tests use synthetic rosters and cover both collections, reload recovery, explicit saves, priority, resolution/history, responsive layout and unchanged billing.
