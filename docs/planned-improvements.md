# Planned improvements

## PMHx import status and MOST display — implemented November 13, 2026

- PMHx uploaded is checked automatically from a completed, archived, patient- and workspace-matched history import receipt. Existing admission/history imports are recognized from their saved source descriptions; new analyses explicitly classify whether the attached sources supply patient history.
- The source date/name appear in the checkbox tooltip. An automatic check is read-only; manual completion remains available when no qualifying receipt exists. Lab-only, medication-only, queued, failed, held, or mismatched imports do not check it.
- Clinical review and medication reconciliation are independent and remain unchanged. The status is a display projection, so no duplicate roster completion field or clinical approval is written.
- MOST wording such as “M1 (changed from M2)” displays the current M1 designation while retaining M2 as historical evidence. Unresolved competing current designations remain blank for review.

## Active issue tracking — implemented November 11, 2026

Available in **My Patients**, **Other Patients**, and **All**.

- Open a patient's **⋯ → Active issue…**, enter a brief description (up to 500 characters), then choose **Add active issue**. The description appears beneath the patient name and can be searched.
- Active issues appear first, followed by outstanding medication reconciliation, palliative patients, and the usual unit groups. Each patient appears once; existing palliative and other flags are preserved.
- Click the **Active issue** badge to edit the description or **Mark resolved**. Resolved patients return to their appropriate priority or unit group. Resolution retains the description and timestamp; starting another issue preserves previous resolved episodes.
- Changes follow the existing **Save to Drive** workflow. Unfinished descriptions and staged edits have encrypted local recovery; they do not upload automatically.
- The roster record owns `activeIssue`, including status, description, opening/update/resolution timestamps and resolved history. Concurrent changes to the same issue require one whole-record choice so that resolving an older issue cannot silently resolve newly edited follow-up instructions. Other patient fields still merge independently.
- Tests use synthetic rosters and cover both collections, reload recovery, explicit saves, priority, resolution/history, responsive layout and unchanged billing.
