# Work OS UI unification

Reviewed November 27, 2026 against the current checkout. This is the maintained cross-app design plan. The pending list links here rather than duplicating specifications. See [shared patient controls](work-os-shared-controls.md) for field ownership and save semantics.

## Direction

One Work OS shell, one interaction library, several purpose-specific apps. Reuse the existing green, warm-neutral palette and compact patient rows. Unification means consistent action meanings, placement, accessibility, and feedback; it does not mean making clinical schedules, billing, and notes use the same screen or merging their records.

Published and verified November 27, 2026: shared phone/contact and Ava editors in TRIM Roster, TRIM Billing, OAT FH and OAT Purple, plus direct nurse/family message copying and matching Unit/Room fields in TRIM. All 14 changed public assets matched release 03c3051. Synthetic browser tests using deployed assets passed for TRIM messages, Unit/Room editing and both OAT Ava workflows; local validation passed 347 unit tests and syntax checks for 225 modules. Other changes below remain planned.

## App coverage and ownership

| App | Current integration | Next appropriate change |
| --- | --- | --- |
| TRIM Roster, My/Other Patients | Shared phone/contact add/edit in contact cell; Ava add/edit in three-dot menu only; scoped verified save | Bring legacy general-edit validation and terminology into the shared contract without changing its staged-save semantics invisibly |
| TRIM Billing | Same roster-owned editors in the selected patient header; no separate contact master | Consistent symbol treatment for Documents and History; retain labelled billing codes and financial decisions |
| OAT FH / OAT Purple | Same phone and Ava field components across schedule, active list and history; same editors and conditional saves | Share remaining row/menu/search presentation; preserve status review and appointment workflows |
| MAID | Shared chart links, phone/copy presentation and contact grouping; current owner supports lifecycle/planning actions, not contact/Ava mutation | Add guarded contact/Ava actions to its repository first, preserving roles, primary flags, source metadata and identifier history; then expose shared editors |
| Notes | Shared identity display and chart access; Notes uses current roster identity | Link appropriate identity actions to the roster owner; preserve unfinished note text and note lifecycle; do not create demographic fields in note JSON |
| Facilities: Carrington, Cedarbrooke, The Cedars, Pleasantview | Shared identity display and chart access; facility-owned add/remove workflows | Define phone/contact fields and conditional update operations before exposing editors; retain facility/group placement and existing identifiers |

MAID and facility editing must not be exposed as nonfunctional buttons. Until their scoped persistence exists, use the distinct call handset for callable numbers, and phone-plus/phone-pencil only for supported editing actions.

## Shared interaction rules

Patient names share `public/patient-names.mjs` across TRIM Roster/Billing, Notes, MAID, OAT FH/Purple, and facilities. Display and copy use Last, First with consistent capitalization; source identities and clinical narrative text remain intact. Preserve mixed-case spelling, accents and punctuation; do not infer surname boundaries.

TRIM new-patient reminders remain in **New patient tasks outstanding** until both medication reconciliation and history upload are complete. History completion includes a manual PMHx check or a verified imported history document. An active issue can keep the patient in the higher Active issues section. Pending tasks remain editable beyond the 14-day New patient badge; completing one task alone never removes the outstanding-task priority. This applies to My Patients and Other Patients. Profile refresh updates grouping while preserving open forms. Other apps do not acquire TRIM onboarding tasks implicitly.

Billing History uses the same viewport-sized Work OS scroll container as roster views, so long history remains reachable when the surrounding host page does not scroll. Keep bottom content clear of the fixed utility bar.

| Area | Rule | Work remaining |
| --- | --- | --- |
| Navigation | App names remain labelled. Show the active app consistently. Keep app-level navigation separate from local views such as Active, History and Schedule. | App bar selected in mockup review. Retain this direction when improving responsive spacing. |
| Patient identity | Surname, Given name; name opens chart when available. Copy name/PHN remains separate. Add/Edit Ava EMR number lives only in the patient's three-dot menu, including when missing. | Reuse shared header composition in Notes and remaining roster views after owner adapters exist. |
| Search | One magnifying-glass field with an accessible name. Match the same normalized name/PHN/Ava inputs where available. Distinguish an empty result from unavailable data. | Remove redundant “Find a patient” labels, preserve selection/caret while typing, and converge search helpers across apps. |
| Row actions | Phone in phone cell; Ava only in three-dot menu; message before billing/history actions. Overflow actions have predictable ordering. Destructive removal is separated and clearly named. | Extract one menu primitive that supports TRIM's symbol rail and OAT's status-specific actions; retain safe destructive confirmation. |
| Tooltips and accessibility | Symbol-only row actions show hover/focus labels, work with keyboard, and have 44px effective touch targets. Essential decisions use text. | Converge native titles, top-layer roster hints and clinic tooltip styles into one primitive, with focus return on close and touch accessibility. |
| Editors | Same field spacing, title, patient identity, error location, Cancel and Save placement. Save only on explicit submit. Errors retain entered text. Escape/cancel is blocked during a write. | Phone/Ava shared now; migrate other small editors incrementally. Larger clinical forms keep appropriate structure. |
| Save feedback | Immediate field Save commits only that change and verifies it. Other staged work remains visible through Changes pending. Distinguish saved locally, cloud sync unverified, saved to Drive, and failed. | Reuse one feedback component everywhere. Review each legacy staged form explicitly before changing its save semantics. |
| Issue descriptions | Global eye toggle; description directly under the matching name, inside the same patient grouping. No permanent description clutter. | Carry the same grouping/toggle pattern to any other app that introduces active-issue descriptions; do not invent issue records in unrelated apps. |
| Messages | TRIM nurse and family buttons copy directly in one click with no editor. Users edit after pasting into Messages. State who the message concerns. | OAT retains its separate care-confirmation editor; batch nurse preparation retains its existing editing flow. Do not change these separate workflows implicitly. |
| Responsive layout | Compact on desktop; generous targets on touch. Tables may scroll within a labelled region. Dialogs fit narrow screens. Avoid clipped menus and controls. | Test each shared primitive at 390px and wide desktop; redesign navigation independently from field editors. |
| Visual tokens | Shared colours, spacing, icon sizing, focus rings, dialog dimensions and typography. Amber is pending/review, red is error/removal, green is normal action/selection. | Extract neutral design tokens without reusing the same variable for a surface and text. Migrate incrementally; avoid a global CSS sweep. |

## Delivery sequence

1. **Shared patient controls (released):** phone/Ava integration for TRIM and both OAT apps, including Billing's roster-owned access. Keep legacy global Save to Drive for unrelated staged work.
2. **Complete owner coverage:** implement guarded MAID/facility contact and Ava actions and Notes links, each with explicit scope and metadata preservation. Do not automatically cross-copy contact data.
3. **Shared presentation primitives:** migrate tooltips, search, menus, feedback and small dialogs one at a time. Update all applicable apps in the same release; document exceptions in the coverage table.
4. **Shell and density:** retain the selected App bar layout. Improve responsive spacing with current app selection and drafts preserved.

## TRIM direct messages and location fields

Every current patient row in My Patients and Other Patients has nurse and family symbols before billing/history, including ordinary, active-issue and palliative groups. Hover labels identify the action. A click copies and gives brief feedback; right-click does not open an editor. Historical roster snapshots remain read-only. Copying never changes patient records or billing.

Option 1 is the selected icon pair: medical-cross speech bubble for nurse messages, two people for family messages. Family messages use the single primary family contact, otherwise the only eligible family contact. Multiple ambiguous contacts use a neutral greeting instead of choosing a recipient. Care-team, witness and guardian/trustee entries are excluded. Always name the patient in the message; relationship wording is deferred until confirmed sex and relationship data are available. Never infer sex from names. The family text is "This is Dr Manocha from TRIM. I’d like to speak with you urgently about [patient name]. Could you please let me know when you’re available for a call?" followed by "Dr Rahul Manocha". Nurse messages retain "Could you please let me know how the patient is doing?"

Unit and Room use equal-width, equal-height fields with shared borders, spacing and focus styling in both patient editors. The compact location editor aligns Save/Cancel on desktop and wraps them below the paired fields on mobile. Its existing staged-save semantics remain unchanged.

## Definition of done for future features

Identify the owning record, applicable apps, existing shared component, save meaning, concurrency guard and empty/error states before implementation. Test the common component and each changed adapter. Verify no unrelated data or billing history changes, label local/cloud save status accurately, inspect synthetic desktop/mobile screenshots, and separately verify production deployment before calling a feature live. Remove completed tasks from the pending list.
