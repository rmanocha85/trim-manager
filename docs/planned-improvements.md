# Planned improvements

Keep this file limited to pending changes. Remove completed, published, cancelled or superseded items when reviewing the list or finishing a release. Keep release history and validation notes out of this file.

## Work OS unification — November 27, 2026

- [ ] TRIM individual nurse copy: when the recorded palliative protocol flag is enabled, retain the patient/location header and signature and use “Patient is currently palliative. Could you please give me an update on how they’re doing?” Include the verified floor with the unit where available. Keep one-click copy, non-palliative messages and family messages unchanged; cover both My/Other Patients and palliative patients with/without an active issue.
- [ ] Complete the private patient sex review, then save only explicitly confirmed values using verified patient identifiers. Keep family messages using patient names until reviewed demographic and relationship data are available.
- [ ] Implement guarded MAID and facility contact/Ava owner actions and wire supported Notes identity edits to the TRIM owner, preserving roles, provenance and unfinished clinical work.
- [ ] Standardize search, menus, hover/focus labels, feedback, visual tokens and remaining small editors using [the cross-app UI plan](work-os-ui-plan.md).
- [ ] Correct the Notes layout overflow at 820px tablet width; retain note editing, review and handoff behavior while making the existing layout fit.
