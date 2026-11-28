# Work OS shared controls

Status: phone/contact and Ava controls published for TRIM Roster/Billing and both OAT apps, November 27, 2026, in release 03c3051. Deployed public assets matched the release and synthetic hosted browser checks passed. Broader app coverage and presentation work is tracked in [the Work OS UI plan](work-os-ui-plan.md).

## One product, several apps

Treat TRIM Roster, TRIM Billing, Notes, OAT Fraser Health, OAT Purple and MAID as apps within Work OS. Shared actions use one maintained component and behaviour contract. Each app supplies its record adapter and applicable capabilities. A feature requested in one app must trigger a review of the other applicable apps; it must not trigger unrequested clinical or financial actions.

The goal is consistent placement, symbols, hover labels, keyboard behaviour, validation, save meaning and feedback. Similar controls must not perform different actions without a clear distinction.

## Patient names

Patient-name presentation across the apps uses `public/patient-names.mjs`: Last, First, converting uniformly uppercase/lowercase words to normal capitalization while preserving established mixed case, accents and punctuation. Use structured last/first fields when available; never guess name order from an ambiguous unstructured string. Name copy actions use the same display value. Formatting does not mutate existing source records, patient keys or billing history. New-input helpers reuse this formatter. Conversational family-message text retains the approved given-name-first wording.

## Phone controls

- Adopt the current OAT phone interaction as the starting point. A missing number has a phone-plus button in the phone/contact cell. An existing number has the same phone-edit button and adjacent Copy button. Clicking phone-edit opens the editor; Call is an explicit action inside it. Use this interaction consistently instead of making the same handset dial in one app and edit in another.
- Keep buttons symbol-only with hover/focus labels and accessible names. Support keyboard activation and touch targets.
- The editor identifies the patient and the number's owner. Patient phone and family/contact phone remain distinct. A family contact includes name, relationship, number and optional extension. Preserve multiple contacts and retain an Add contact action even when one already exists.
- Do not invent a primary contact designation. Import a user-specified contact as instructed; automatic extraction honours the source's checked primary row and contact notes.
- Reuse the current number parsing, extension handling, copy and call utilities. Do not create separate TRIM/OAT/MAID copies of these rules.

## Ava EMR number controls

- Use the same Add/Edit Ava EMR number action and editor across applicable apps, exclusively in the patient's three-dot actions menu. Do not place an Ava edit button beside the patient name. A missing number shows Add Ava EMR number in the same menu; an existing number shows Edit Ava EMR number. This applies to TRIM My/Other Patients, Billing, and OAT FH/Purple schedules, active lists and history.
- The patient name opens the chart when an Ava number is present. The menu action changes the identifier; chart navigation must not unexpectedly edit it. New-patient intake can collect the number in its form; editing existing identifiers uses the menu and the scoped editor.
- The editor displays the selected patient's identity, validates the existing 6–10 digit format, checks duplicate assignment, and verifies the previous identifier before saving. Preserve identifier history where supported.
- Label the field Ava EMR number. It is not the PHN. Do not create a second editable Ava field in Billing when the TRIM roster already owns it.

## Shared save contract

Recommended default for these compact editors: follow the existing OAT meaning of Save phone / Save Ava number — commit that specific field and verify the saved result. Show success only after readback; show failures in the same editor and retain entered text for retry. Distinguish a verified Drive save from a laptop-folder save whose cloud sync is unverified.

The TRIM adapter must not save unrelated pending roster edits or billing as a side effect. It must check the saved field's expected value, apply only the requested change, update its saved baseline, and preserve unrelated local pending work. A conflict on the same field stops for review. If targeted saving cannot safely coexist with an unfinished form, explain that the form must be finished or cancelled first.

The scoped TRIM adapter is implemented in `public/roster-field-save.mjs` and connected through `patients-ui.mjs`. The global Save to Drive control remains responsible for other staged session changes. Existing unsaved edits to the same field must be saved or discarded before using the compact editor. Do not silently change the global save contract while adding field controls.

## Record ownership and app coverage

| App | Phone source | Ava source | Intended integration |
| --- | --- | --- | --- |
| TRIM Roster, My/Other Patients | Contact list on the selected roster record | Roster record | Contact add/edit in the phone cell; Ava add/edit only in the three-dot menu |
| TRIM Billing | Referenced TRIM roster record where matched | Referenced TRIM roster record | Same roster adapter and three-dot Ava menu; no separate contact master or historical billing identity rewrite |
| OAT Fraser Health | OAT patient phone | OAT patient Ava field/history | Replace OAT-specific presentation with shared components, preserving current verified actions |
| OAT Purple | Purple patient phone | Purple patient Ava field/history | Same controls and contract as OAT Fraser Health |
| MAID | Patient/contact records with their documented roles | Matched MAID patient identifier | Share controls while preserving contact roles and its own record ownership |
| Notes | Relevant roster identity | Relevant roster identity | Reuse display and chart-link controls; expose editing only where supported by its owner adapter |

Shared controls do not mean automatically copying numbers between every roster. Different clinical records can have different contacts and scope. Cross-app data linking requires an explicit identity/ownership policy; match by verified identifiers, never name alone.

## Implementation sequence

1. Extract the OAT phone controls and phone/Ava dialogs into neutral shared modules. Keep existing OAT behaviour passing while changing its implementation.
2. Add the TRIM field adapter and apply the controls to both My Patients and Other Patients. Preserve all contacts and existing Ava data. Confirm the control is present at an empty phone or chart-number location.
3. Connect Billing to the roster-owned identity/contact actions. Audit MAID and Notes for applicable controls and explicitly document any exceptions.
4. Add a capability matrix in code: which apps support patient phones, family contacts, Ava editing and chart navigation. Unsupported actions are omitted intentionally rather than disappearing through copied layouts.
5. Test the shared contract once, then test each adapter for persistence and conflicts. Check add/edit/cancel, copy/call, extension handling, patient-versus-family identity, duplicate Ava rejection, keyboard/mobile, pending-change preservation, save failure/retry and no changes to billing history.
6. Publish the shared components and applicable app integrations together. Verify deployed assets and synthetic browser behaviour. Remove completed items from planned-improvements.md.

## Rule for future features

Before adding an app-specific control, check whether Work OS already has an equivalent. Reuse or extend the shared component first. Every feature change identifies applicable apps, record ownership, save behaviour and validation coverage. Keep one canonical contract here and one pending list; do not maintain competing app-specific specifications for the same action.
