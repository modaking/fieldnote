# Fieldnote handoff for Ian

Updated 18 November 2026 for the existing `modaking/fieldnote` repository, baseline
`c2de1a45eaad97d76228e007917aa3bd8cd0587e`. This is a reviewable working draft.
**All three migrations remain uninstalled. All three SQL suites passed
in an authorized rollback-only rehearsal on the current project; no schema, RLS
or fixture rows were retained, including after the finance-extended run.**

## Preservation and navigation

The `fieldwork/` structure, plain JavaScript, Supabase REST/Auth and Vercel
architecture remain. There is no build step, SDK, framework or added runtime
library. Money stays in ISO currency **minor units** (KES 100 = KSh 1); statements
convert once for presentation. Do not copy the separate ZIP over this repository:
its later schema, map and offline architecture are different.

There are now five pages: **Overview, Operations, Finances, People, Reports**.
All 16 sections remain, through 14 business view functions and the Members/
Invitations interface. No feature, form or data model was merged or retired.
Settings is in the workspace menu; Account is in the user menu. Old module URLs
remain aliases. [FEATURE-INVENTORY.md](FEATURE-INVENTORY.md) gives the complete
before → after mapping.

Desktop has a collapsible sidebar, workspace switcher, farm/period controls and
Ctrl/Cmd+K search. Mobile has bottom navigation, More and floating Add. Optional
fields, filters and less frequent actions use More options/actions. Section URLs,
browser history and context guards preserve the selected section and scope.

## Main files

| Files | Responsibility |
| --- | --- |
| `js/app.js`, `js/navigation.js`, `js/navigation-ui.js` | Context, five-page registry, sections, search, Settings and onboarding |
| `js/modules.js`, `js/finance.js`, `js/crud.js`, `js/read-all.js` | Existing records, 14 business views, tables/forms, complete paged reads and money workflows |
| `js/components.js`, `js/feedback.js`, `css/*.css` | Shared controls, themes, responsive layout, validation and unsaved/save guards |
| `js/auth-ui.js`, `js/supabase.js` | Password/email/Google flows, PKCE, refresh and checked RPC requests |
| `js/permissions.js`, `js/members.js` | Interface permissions and checked team actions |
| `js/dashboard.js`, `js/charts.js` | Overview, SVG charts and consumption of database dashboard figures |
| `js/account.js`, `js/account-client.js`, `api/account.js` | Personal account UI, Auth/Storage client and guarded server actions |
| `js/reports.js`, `js/statements.js` | Ten scoped statements, preview, binary PDF and real OOXML XLSX |

## Expanded working draft

- Overview separates Summary and More insights. The proposed read-only
  `fw_dashboard` computes KPIs, previous comparisons/sparklines, monthly cash
  movement, saved cash snapshots, categories, expense budgets, income targets,
  farm/enterprise/vendor/payroll comparisons, tasks and actionable reminders.
  Whole month-based periods compare with matching preceding calendar months;
  arbitrary day ranges use the preceding equal number of days. Missing RPCs show
  upgrade guidance. Charts have tap/keyboard exploration, legends, record drills,
  exact data tables and PNG/CSV actions.
- Account includes Profile, Security, Workspaces, Notifications, Invitations and
  Data & privacy. Theme/default farm/default period are under **Profile → More
  options → Display options**. Formatting language/time zone do not reinterpret
  the farm accounting calendar. Private photos/preferences, own sessions and
  invitations depend on the Account migration.
- Security includes recent sign-in checks for email/password changes, Google
  linking/removal, optional TOTP and other-device sign-out. The server verifies the
  bearer against the configured project, subject, fresh primary authentication,
  MFA and live own session before sensitive actions; delegated OAuth client tokens
  are rejected. Deletion also requires no
  owned workspaces/business files, explicit confirmation and a server-only service
  credential. Issued access tokens can remain valid until expiry after sign-out.
- Tables retain search, filters/chips, columns, sorting, selection, bulk actions,
  CSV and pagination; phone rows become labeled cards. Forms retain field errors,
  dirty/save guards and context-safe retries. Delete waits six seconds for Undo
  before the request; Undo cannot restore deleted records or reverse cascades.
  Table loads visibly cap at 10,000 rows; statements paginate separately.
  Farm/reference/financial reads cross the REST page cap, with explicit errors
  rather than partial complete totals. The proposed finance RPCs compute filtered
  totals, preserve uncategorised/category-kind mismatch amounts and recompute a
  selected farm's month close in PostgreSQL before saving it.
- Ten statements cover Overview, Operations, Finances, Vendors, Infrastructure,
  Livestock & crops, Workers, Funding, Members and Audit. PDF has letterhead,
  sections/totals, repeated headings and page counts. XLSX has section sheets,
  numeric formats, frozen headers and SUM totals. PDF fonts transliterate accents
  and replace unsupported characters with `?`; preview/XLSX retain Unicode.

## Database proposals and completed rehearsal

Do not rerun `db/schema.sql` over the existing project. These additive proposals
and suites were exercised in the reviewed rollback batch; permanent installation
remains a separate decision:

| Migration | Purpose | SQL suite |
| --- | --- | --- |
| `db/migrations/20261118_members_roles.sql` | Six roles/farm scope, checked invites/members, audit scope, project budgets, bills and enterprise links | `db/tests/20261118_members_roles.test.sql` |
| `db/migrations/20261118_dashboard.sql` | RLS-bound security-invoker dashboard/finance aggregates, exact-month saved cash and checked farm month close | `db/tests/20261118_dashboard.test.sql` |
| `db/migrations/20261118_account.sql` | Own preferences/private avatars/sessions/invites, opt-in MFA and leave/delete safeguards | `db/tests/20261118_account.test.sql` |

**None is installed.** The members/roles, dashboard/finance and Account suites
passed against the actual current project in one reviewed transaction, using
savepoints to isolate each suite's fixtures, then a final rollback. The catalog
returned to all **1,299 baseline items / MD5
`992fc360118daa1d8f2398d90ba4f75b`**, and the scan of 25 fixture prefixes found no
remaining IDs. The latest run also passed complete 1,005-row finance aggregates,
server-recomputed month close and role/farm-scope rejections. Normal logs and
audit identity sequence gaps can survive rollback; no sequence was reset.
This single-connection rehearsal does not prove
concurrent-session behavior or real Auth/HTTP flows. Existing live policies remain
unchanged.

Review the behavior changes: Worker loses legacy finance/pay/audit reads and
transaction writes. Owner/Admin manage access (only Owner manages owners/admins);
Manager operates/manages money; Accountant manages money/pay; Worker records field
activity; Viewer reads operations. Restricted scope excludes sensitive shared/null
farm rows; operational worker/project RPCs omit pay/contact/cost/budget.
Receipt access is limited to all-farm financial members until independent file
provenance exists; files are preserved. Verified opt-in MFA adds an `aal2` gate.
Owner departure/deletion requires transfer; owned business files block deletion.
Future non-owner deletion clears nullable business auth references while retaining
business records and audit history.

Bills are separate obligations: changing paid amount does not post cash. Balances
are current recorded amounts, not settlement history. Project cost is a recorded
value; enterprise margin uses explicit links only. Dashboard cash sums saved
snapshots for that exact month, with coverage; missing snapshots stay null. Tasks
store only the latest completion, not a full past history. Existing pay posting
retains its labeled four-week/26-day convention. No historical amounts are backfilled.

## Verification snapshot

From `fieldwork/`, with Node 18+:

```sh
node --experimental-vm-modules tools/check.mjs
node --experimental-vm-modules --test tests/*.test.mjs db/tests/*.test.mjs
node tools/preview.mjs
```

Latest full JavaScript run: **214 tests pass**. Static checks pass for **22 browser
modules, two API handlers, 12 business routes, five pages, 16 sections and 12
assets**. These JavaScript checks are separate from the rollback-only SQL results
above and do not prove real Auth or browser/REST end-to-end enforcement.
Configured contrast checks pass all 32 pairs in each theme with zero failures.

The local preview uses invented in-memory data and simulated SQL/permissions.
Six role accounts use `ROLE@fieldwork.test` / `sample123`. It has no Supabase
connection; email/Google/deletion are disconnected and TOTP code `000000` is
deliberately fake. Never enter real credentials there.

Local DOM checks at **360, 768, 1024 and 1440 px** found no horizontal overflow in
both themes for Overview, Tasks, Transactions, Workers, Reports, Account Profile
and Settings. Overview screenshots covered both themes/all four widths. The 360 px
dark task drawer's sticky save, inline validation and discard prompt were inspected;
sample Mark done updated immediately with a success toast. The final Overview
check found no visible HTML buttons/inputs/selects/disclosures below 44 px. The
Profile → Search → close → edit → leave regression now prompts correctly; Cancel
retains the form and Save shows confirmation. Farm filtering, income drill-through,
row-detail drawers, mobile More/filters sheets and Account tab back navigation
were checked. These are sample-preview checks, not physical-device verification.

The final sample Budget check recorded Close month with a saved balance and toast,
Copy showed the no-prior-budget feedback, and Report opened its finance statement.
Transaction Add/search worked. Opening/cancelling Filters preserved an invalid
budget edit and the later discard prompt; Cancel kept the value. Budgets had no
horizontal overflow at all four widths in both themes. Module headers retain
their original event/query scope through rerenders, including legacy tab views.

Browser PDF/true-XLSX downloads succeeded; the downloaded files were parsed with
pypdf/openpyxl, including numeric cells, frozen headers and SUM formulas. PDF was
also rendered with Poppler. Chart PNG/CSV downloaded; PNG was viewed and valid.
Chart table mode showed exact amounts in mobile cards. Desktop Excel/PDF-reader
opening remains unverified.

The current project's 44 anonymous/nonmember read-only checks passed separately
from the fixture-based SQL rehearsal. Original schema, policies and fixture-row
absence were verified after rollback; no proposed migration remains installed.
Detailed project configuration checks are retained privately outside this public
handoff.

## Ian's remaining release checks

1. Review the proposals and deployment plan before any permanent installation;
   verify direct REST/browser flows for six roles, two workspaces and restricted farms.
   The successful current-project rollback rehearsal did not install the upgrades.
   Reconcile dashboard/report figures, source posting, budgets and saved cash.
2. Verify real email/verification/recovery/magic links, Google redirects/linking/
   removal, TOTP enrollment/challenge/removal, session revocation, invitation
   acceptance and guarded deletion. Configure providers and redirect allowlists.
3. Verify Vercel project root `fieldwork/` and server environment
   `SUPABASE_URL` / `SUPABASE_ANON_KEY`. Optional `SUPABASE_SERVICE_ROLE_KEY`
   is server-only for deletion; never expose it in `/api/config` or browser code.
   Production environment wiring remains unverified.
4. Broaden section/form coverage; test physical devices, keyboard flows and a
   screen reader, including chart touch targets and large-text layout.
   Physical-device and screen-reader checks remain unverified.
5. Open exports in desktop Excel and a PDF reader. Native-reader opening remains
   unverified despite parser/render checks. Check long/wide statements and non-Latin
   text.
6. Review the draft changes and preview before merging/releasing. This handoff
   does not authorize or imply a production deployment or database change.

Install metadata remains, but there is **no service worker or offline write queue**.
Offline changes are not queued/synced. Stored map/receipt-path columns do not imply
map or receipt-upload UI exists in this repository.
