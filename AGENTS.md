# Work OS feature consistency

Work OS contains separate apps: TRIM Roster, TRIM Billing, Notes, OAT Fraser Health, OAT Purple, MAID, and facility rosters. When changing a shared interaction, inspect the existing implementation and review applicability across these apps before creating another version.

- Reuse shared components. Phone and Ava field controls/editors live in `public/patient-field-controls.mjs`; TRIM scoped persistence lives in `public/roster-field-save.mjs`. Keep app-specific persistence and clinical workflows in their owning adapters.
- Follow `docs/work-os-shared-controls.md` and the broader UI plan in `docs/work-os-ui-plan.md`. Record deliberate exceptions rather than silently changing the meaning of the same icon or Save button.
- Keep patient phones, family contacts, and care-team contacts distinct. Do not infer shared identity or copy data between clinic rosters from matching names.
- TRIM Billing references the TRIM roster for current contact/identity changes. Preserve billing history and unrelated pending work when saving a patient field.
- Symbol-only actions need hover labels, accessible names, keyboard access, and appropriate touch targets. Primary navigation retains text labels.
- Add/Edit Ava EMR number belongs only in the patient three-dot actions menu, including missing numbers. Keep patient-name chart links separate and preserve the shared guarded editor.
- Review a new shared behaviour with synthetic records across applicable apps, including empty values, cancellation, save failure, concurrent edits, and desktop/mobile layout. Never use production patient records for tests or screenshots.
- `docs/planned-improvements.md` is pending work only. Remove completed, cancelled, and superseded items; keep durable decisions in the shared plans and release evidence in commit/PR records.
- A design plan or mockup is not evidence that a feature is implemented or deployed. State these statuses separately.
