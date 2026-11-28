# Work OS — development handover

Updated Saturday, November 28, 2026. Keep this a short current-state handover, not a transcript. Update after each development task; replace stale status. Keep detailed release evidence in commits and only unfinished work in the pending list. No patient data here.

## Start here

- One Work OS development chat covers TRIM Roster, Billing, Notes, MAID, OAT Fraser Health/Purple and facility rosters. Keep the separate **TRIM Notes Dev** chat open for its ongoing work; coordinate before touching its files. **OAT FH APP** and **MAID App** are archived legacy references.
- Repository: `rmanocha85/trim-manager`. Production: https://rmanocha85.github.io/trim-manager/public/ . Current verified application release: `56061cb` (November 27).
- Current maintained checkout: `C:/Users/rmano/.codex/worktrees/trim-individual-message-template/trim-app`. The laptop checkout at `C:/Users/rmano/Documents/Codex/trim-app` can contain separate Notes work: inspect status; do not reset, overwrite or blindly synchronize it. Reuse a suitable checkout and verify origin/main before development.
- Read [shared controls](work-os-shared-controls.md) for behavior/ownership, [UI plan](work-os-ui-plan.md) for cross-app coverage, and [pending work](planned-improvements.md) for the backlog. Read AGENTS.md too. These are the maintained specifications; old mockups/chat preferences can be superseded.

## Features in place

- TRIM: hospital/return symbols and dates; return indicators expire two weeks after return. Active-issue descriptions toggle together and sit under each patient's name. Symbol-only patient menu has hover labels. Unit/Room fields align.
- Nurse and family icons copy messages directly for all current TRIM patients. No message popup; edit after pasting. Family messages name the patient; do not infer sex or family relationship from names.
- Shared phone/contact editors in TRIM/Billing and both OAT apps; Ava add/edit only in patient three-dot menus. Names open charts. Field saves preserve unrelated pending work and billing history. MAID/facility editor coverage remains pending where owner adapters are missing.
- Names display/copy as Last, First across apps, with capitalization, punctuation and accents preserved by `patient-names.mjs`. New-patient reminders stay prioritized until BOTH medication reconciliation and history upload are done, including beyond the 14-day badge. Verified history imports count. Billing History has its own scroll container.
- OAT: schedule, active/history lists and clinic-owned saves. MAID: lifecycle tracking and separate patient/family/team contacts. MAID workflow date/contact write-readback rules were updated; their next live clinical run still needs verification.
- Notes is a separate laptop workflow. Its retained chat reports incoming-batch progress and completion reopening without interrupting typing. Do not assume every laptop change is deployed to the hosted app. Known Notes 820px layout overflow is pending.

## Next task

Palliative-specific individual nurse text is **requested, not implemented**. See the first item in [pending work](planned-improvements.md). Start in `public/nurse-messages.mjs` and `public/roster-messages.mjs`; use the recorded palliative flag and verified unit/floor mapping. Preserve non-palliative and family behavior.

## Finish each task

Update this page's current features/status, remove completed pending items, and put lasting shared decisions in the appropriate plan. Distinguish planned, implemented, tested and deployed. Use synthetic records only; verify production separately when publishing. Last application release passed 351 unit tests and hosted synthetic name, onboarding and History-scroll checks; this is prior evidence, not a substitute for testing new changes.
