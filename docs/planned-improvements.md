# Planned improvements

## Active issue tracking — implemented November 11, 2026

Available in **My Patients**, **Other Patients**, and **All**.

- Open a patient's **⋯ → Active issue…**, enter a brief description (up to 500 characters), then choose **Add active issue**. The description appears beneath the patient name and can be searched.
- Active issues appear first, followed by outstanding medication reconciliation, palliative patients, and the usual unit groups. Each patient appears once; existing palliative and other flags are preserved.
- Click the **Active issue** badge to edit the description or **Mark resolved**. Resolved patients return to their appropriate priority or unit group. Resolution retains the description and timestamp; starting another issue preserves previous resolved episodes.
- Changes follow the existing **Save to Drive** workflow. Unfinished descriptions and staged edits have encrypted local recovery; they do not upload automatically.
- The roster record owns `activeIssue`, including status, description, opening/update/resolution timestamps and resolved history. Concurrent changes to the same issue require one whole-record choice so that resolving an older issue cannot silently resolve newly edited follow-up instructions. Other patient fields still merge independently.
- Tests use synthetic rosters and cover both collections, reload recovery, explicit saves, priority, resolution/history, responsive layout and unchanged billing.
