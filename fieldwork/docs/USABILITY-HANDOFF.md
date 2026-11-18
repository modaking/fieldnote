# Usability pilot handoff

Prepared 18 November 2026 from `modaking/fieldnote` main commit
`c2de1a45eaad97d76228e007917aa3bd8cd0587e`.

## Source and architecture

This branch updates the repository's existing **fieldwork** app in place. Its
`js/`, `css/`, `db/`, `api/`, `docs/` and `tools/` layout is retained. No framework,
runtime dependency, database migration or change to stored currency units is introduced.

The separately supplied `fieldnote.zip` contains a different, later architecture
and schema. Its files should not be copied over this repository: its whole-unit
money model and role rules are different. This branch adapts the applicable
usability fixes to the actual repository instead.

## Changes for review

- Workspace-specific reads and dashboard totals use the active workspace. Global
  currencies and seed-merchant reference data remain shared. Accounts with multiple
  memberships can switch workspace from the account menu.
- Projects and enterprises use order columns that exist in the current schema.
- Money entry keeps ISO currency minor units and rejects precision loss, unsafe
  amounts and invalid exchange rates. Currency changes refresh the rate rather
  than reusing a different currency's rate.
- Forms and posting actions prevent repeated submissions. A lost create response
  can be reconciled by the form's client-generated record ID before another save.
- Category/type and selected-farm relationships are checked before saving.
- The Add a record menu opens implemented sections. Farm View refreshes its totals.
  Superseded async views cannot replace the page the user has since selected.
- Startup has retryable errors. Sign-in refreshes are shared across concurrent
  requests and connection failures preserve the saved session. Empty update
  responses are reported as failed saves. Browser-storage failures are handled.
- Confirmation/recovery callback tokens are consumed and removed from the address.
  The password-reset flow has a new-password confirmation screen.
- Farm dates use Africa/Nairobi. Daily/monthly tasks use their latest completion
  timestamp to determine whether the current period is complete.
- Mobile navigation, focus, skip navigation, form fit and button sizes are improved.
  Generic record tables become labeled cards on phones, keeping task names and
  completion actions visible together. Existing themes and branding remain in place.
- The optional demo loader is confined to KES, as its sample amounts assume KES.

Existing schema permissions are retained: owner is an administrator, manager has
operations write access, and workers can read workspace data and write the
schema-authorized task/checklist/transaction records. This branch does not change
database policies or hide data that the schema currently permits workers to read.

## Checks

From the `fieldwork` folder, with Node 18 or newer:

```sh
node --experimental-vm-modules tools/check.mjs
node --experimental-vm-modules --test
node tools/preview.mjs
```

The checker links browser modules without executing them, parses the CommonJS
Vercel API handler, validates navigation exports and checks local assets. The
current hosting configuration has no CSP; this revision does not invent one.
Tests use controlled network and DOM boundaries rather than production accounts.

The preview helper serves only synthetic in-memory data and has a visible sample
banner. Use its printed sample account and a dummy password. It does not connect
to Supabase and does not establish that production policies or migrations work.

Verification on this revision: **38 tests passed** (23 client, 9 data-workflow and
6 navigation cases), along with the source checks and `git diff --check`.
Browser checks using the synthetic server passed for projects/enterprises loading,
Add a record opening a transaction directly, saving KES 100.25 without rounding,
task completion, switching between KES and USD workspaces with separate totals,
and phone layout without horizontal page overflow. Budget reconciliation, email
delivery and actual Supabase authorization remain staging acceptance checks.

## Before merging and releasing

1. Review the draft pull request in Ian's existing repository. Use Vercel's existing
   project/root-directory setting (`fieldwork`) and existing environment variables.
2. These JavaScript/CSS fixes require no SQL migration. Do not rerun `db/schema.sql`
   against an existing project to apply this branch.
3. In a staging workspace, verify confirmed sign-in, password recovery, first-farm
   creation, tasks/checklists, expenses, currency switching, budget/closing totals,
   recurring posting and worker-pay posting against the real database.
4. With an account belonging to two workspaces, confirm that records, lookups,
   totals and posted payments stay within the selected workspace.
5. Check owner, manager and worker operations against actual Supabase policies,
   then check the app on a physical phone in both themes.

## Deliberate limits

This repository has no offline write queue, full task-completion history, receipt
upload flow, invitations UI or farm-map implementation. Daily/monthly tasks retain
their latest completion only; complete historical reporting needs a separate
schema design. Those later capabilities from the ZIP were not transplanted into
the older app. No private farm chat, credentials or production records are part of
this branch or its sample data.
