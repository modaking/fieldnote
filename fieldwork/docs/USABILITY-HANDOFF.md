# Fieldnote handoff for Ian

Updated 18 November 2026 for the existing `modaking/fieldnote` repository, baseline
`c2de1a45eaad97d76228e007917aa3bd8cd0587e`. This handoff describes the included release changes.
**The three original migrations were applied to the current Fieldnote project on 18 November
2026 at approximately 21:36 UTC, after approval and successful rollback rehearsals.
Immediate preservation checks passed. Live provider/account HTTP verification is
still pending; this is not a claim that the app is ready.**
The fourth, Google-only owner-approval migration is now **applied**, following
separate qualification and fresh approval. Completion was observed at 23:49:35 UTC.
Google provider and manual-linking enablement are verified; real OAuth sign-in and
linking remain untested.
Email/password signup confirmation is temporarily disabled at the owner's request.
This does not verify an email address; incoming email-invite recovery safeguards
remain in place. The Google-first signup, hidden Forgot shortcut and Account ID/
approval interface are included in this release; production deployment is confirmed separately.

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

## Included features

- Overview separates Summary and More insights. The installed read-only
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
  invitations use the applied Account migration.
- Security includes recent sign-in checks for email/password changes, Google
  linking/removal, optional TOTP and other-device sign-out. The server verifies the
  bearer against the configured project, subject, fresh primary authentication,
  MFA and live own session before sensitive actions; delegated OAuth client tokens
  are rejected. Deletion also requires no
  owned workspaces/business files, explicit confirmation and a server-only service
  credential. Auth JWTs can outlive logout; the installed database access guard now
  also requires the exact active own session and rejects revoked sessions. Access
  context uses the same session/MFA gate. Server errors distinguish ended sign-ins
  from missing migrations and unavailable upstream services.
- Incoming invitations are read only after server verification. First use requires
  fresh PKCE email recovery, a different password and ending other sessions. The
  completion RPC checks signed recovery AMR, matching JWT/current email, the active
  session and the completed Auth `user_updated_password` event after that proof
  and session creation. It preserves other app-metadata keys while setting its own
  trusted timestamp/email marker. Later list/accept/decline and token acceptance
  require that marker plus fresh signed email magic-link/recovery proof; an email
  change invalidates the marker. Editable user metadata and password-hash rewrites
  are not proof. The status RPC returns only `needs_recovery`/`proof_recent`.
  Account export remains available while omitting inaccessible incoming invites.
  Recovery completion can retry without saving the password twice. Email PKCE
  supports another tab in the same browser and preserves the invitation/return
  intent; Google remains tab-scoped. Another browser/device needs its own link.
- The interface for the installed alternative is **Account → Profile → Account ID /
  Copy**, then **People → Members → More → Add Google account**. Only a current
  owner can approve an independently identified person, choosing manager,
  accountant, worker or viewer and all/selected farms. The installed RPC requires
  recent primary authentication, an active own session and enrolled MFA, and
  rejects banned/deleted actors or targets. A target must have exactly one Google
  Auth identity, a typed boolean verified-email flag with normalized email matching
  its current Auth email, and no password or other identity. A UID shared with an
  older password is rejected. Existing memberships and email-invite/recovery rules
  remain unchanged. This release temporarily hides the public Forgot password
  shortcut at the owner's request; reset forms, APIs and callbacks are retained.
- Tables retain search, filters/chips, columns, sorting, selection, bulk actions,
  CSV and pagination; phone rows become labeled cards. Forms retain field errors,
  dirty/save guards and context-safe retries. Delete waits six seconds for Undo
  before the request; Undo cannot restore deleted records or reverse cascades.
  Table loads visibly cap at 10,000 rows; statements paginate separately.
  Farm/reference/financial reads cross the REST page cap, with explicit errors
  rather than partial complete totals. The installed finance RPCs compute filtered
  totals, preserve uncategorised/category-kind mismatch amounts and recompute a
  selected farm's month close in PostgreSQL before saving it.
- Ten statements cover Overview, Operations, Finances, Vendors, Infrastructure,
  Livestock & crops, Workers, Funding, Members and Audit. PDF has letterhead,
  sections/totals, repeated headings and page counts. XLSX has section sheets,
  numeric formats, frozen headers and SUM totals. PDF fonts transliterate accents
  and replace unsupported characters with `?`; preview/XLSX retain Unicode.

## Applied database record and completed rehearsal

Do not rerun `db/schema.sql` or these original migration files over the current
project. The original three were applied in one approved, atomic manual SQL bundle;
the fourth was installed through a separately approved atomic forward batch:

| Migration | Purpose | SQL suite |
| --- | --- | --- |
| [Members/roles](../db/migrations/20261118_members_roles.sql) | Six roles/farm scope, checked invites/members, audit scope, project budgets, bills and enterprise links | [SQL suite](../db/tests/20261118_members_roles.test.sql) |
| [Dashboard/finance](../db/migrations/20261118_dashboard.sql) | RLS-bound security-invoker dashboard/finance aggregates, exact-month saved cash and checked farm month close | [SQL suite](../db/tests/20261118_dashboard.test.sql) |
| [Account](../db/migrations/20261118_account.sql) | Own preferences/private avatars, active-session/MFA gates, trusted invitation recovery and leave/delete safeguards | [SQL suite](../db/tests/20261118_account.test.sql) |
| [Google-only approval](../db/migrations/20261118224325_owner_approved_membership.sql) | Fresh authenticated owner approves an exact eligible Google-only UID with a lower role and farm scope | [SQL suite](../db/tests/20261118224325_owner_approved_membership.test.sql) |

Applied source SHA256 values:

- Members/roles: `fdac1a40ec3f7b7962a323d36925b94dfbdf1cc687c6caf7802f94ec04fa9101`
- Dashboard/finance: `4f9e5068ffa1747efeb2a0955f53a8aed6275d929a905576e276b501981a3d3b`
- Account: `d7e618192ffeee7835ba999c0b3ad3bd598b18a42f84fc6b742827b17311e2ed`
- Google-only approval: `8e4cc17d75f03df971c471db4802ffcb0f39620c3a465e201c25b88080319cf1`

The original three-upgrade installation bundle SHA256 was
`2c7bdf1673905e51a8e992aab74b8afb1710a52f8b8440083e6c585a6bd31993`.
It rolled back each suite's fixtures before its single final commit. A fresh
read-only postflight preserved every original column of all **98 rows in the
24 original public tables**, plus whole-row Auth/Storage digests and the original
receipts bucket configuration. The installed catalog has **28 public tables**.
This was manual SQL, with **no Supabase CLI migration-history entry**. Reconcile
that history before future CLI deployment; use reviewed forward migrations,
not a replay of this bundle or a destructive schema rollback.

Before installation, the members/roles, dashboard/finance and Account suites
passed against the actual current project in the latest recovery-extended batch
on its first attempt, using one reviewed transaction and
savepoints to isolate each suite's fixtures, then a final rollback. The catalog
returned to all **1,299 baseline items / MD5
`992fc360118daa1d8f2398d90ba4f75b`**, and the scan of 25 fixture prefixes found no
remaining IDs. Original-column preservation checks matched all **98 original
rows across 24 public tables**. The latest run passed complete 1,005-row finance
aggregates/server close, role/farm-scope rejections, same-call recovery attestation,
proof/audit/email/session rejection cases and revoked-session/MFA gates. Normal logs and
audit identity sequence gaps can survive rollback; no sequence was reset.
The 1,299-item catalog fingerprint records successful rollback cleanup only;
the applied schema is expected to differ. This single-connection rehearsal does
not prove concurrent-session behavior or real Auth/HTTP flows.

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

The new forward change is
[`20261118224325_owner_approved_membership.sql`](../db/migrations/20261118224325_owner_approved_membership.sql),
with [rollback-only tests](../db/tests/20261118224325_owner_approved_membership.test.sql).
It is **applied**. Its suite passed on the current project in rollback batch
`16596ef914896d5bac30db6e374bdb06cc221c9b2699dbffad1d290119b0bff3`, including
34-table fresh whole-row preservation, and the separate TEMP catalog/EOL probe
also passed. No proposed function or fixtures were retained. Source hashes and the bounded
private rehearsal design are recorded in the [database test notes](../db/tests/README.md).
After fresh approval, batch
`ef75a5ffc3ae15a2f081ad94778bf00025e45f61fba1794b77f31d1be846b57f`
passed and committed on its first attempt. Completion was observed at 23:49:35 UTC
on 18 November; the exact commit timestamp was not captured. Fresh 34-table data
and existing catalog/access checks passed immediately before commit; afterward,
the guard verified stored body, signature, owner, grants and all 28 public RLS
tables. No fixture data was retained. This was manual SQL without a CLI history
entry; do not rerun the applied source. Preparation-time source headers are kept
unchanged, with current execution status recorded here.
These SQL checks do not prove real Google sign-in, linking or browser/REST flows.

From `fieldwork/`, with Node 18+:

```sh
node --experimental-vm-modules tools/check.mjs
node --experimental-vm-modules --test tests/*.test.mjs db/tests/*.test.mjs
node tools/preview.mjs
```

The combined automated run passes **267 tests**. Separately, **17 private installer
compiler/artifact tests pass**. Static checks pass for **22 browser
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

Final release captures at all four widths in both light and dark themes passed
independent visual review. Four additional 360×640 phone captures checked Save,
identity confirmation, Close and sticky-footer controls. In Chrome using invented
sample records, a scoped Viewer approval increased members from six to seven;
the required identity checkbox blocked submission when unchecked, and the new
role/farm display was correct. Account ID Copy showed a success toast, but the
clipboard payload was not independently read. Physical touch and screen-reader
behavior remain unverified; these checks do not establish real Google OAuth.

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

The current project's 44 anonymous/nonmember read-only checks passed before the
upgrade, separately from the fixture-based SQL rehearsals and the final applied
installation. Original-column and Auth/Storage preservation passed after commit.
Detailed project configuration checks are retained privately outside this public
handoff.

## Live account checks

Production initial Google signup/callback and returning Google sign-in passed.
A separate clearly named test workspace and farm completed onboarding without
sending invitations or editing original farms; those test records are retained.
The Google profile/account ID and current session loaded. A display preference
saved, survived reload, and was restored to its original value. Own-account JSON
downloaded and parsed with one own membership and no password/token/secret fields.
Removing the only Google identity was disabled; owner Leave returned the required
transfer message and account deletion was blocked while owning the test workspace.
Sign-out gave feedback; returning sign-in restored Overview. Refresh verifies
session restoration, not actual token refresh/expiry or cross-device revocation.

The owner saved the existing server credential directly in Vercel as a
Production-only Secret named `SERVICE_ROLE_KEY`. The server accepts that alias,
preferring `SUPABASE_SERVICE_ROLE_KEY` if both are set. No secret was read or
published. Presence/name/scope do not establish successful privileged deletion.

For empty dashboards, zero-task and zero-cash summaries retain their actual rows
for table/CSV; zero totals do not claim that no transactions exist. These changes
do not change database figures, permissions or report data.

## Ian's remaining release checks

1. Do not rerun the applied bundle. Verify direct REST/browser flows for six roles,
   two workspaces and restricted farms against the installed upgrades.
   Reconcile dashboard/report figures, source posting, budgets and saved cash.
2. Google provider and manual-linking enablement are verified after owner-entered
   credentials; initial and returning sign-in callbacks also passed. Verify
   mail delivery within the chosen sender's limits,
   and make completed Auth audit events available. Then verify real
   email/verification/recovery/magic links, Google linking/
   removal, TOTP enrollment/challenge/removal, session revocation, invitation
   acceptance and guarded deletion. Live mail delivery remains unverified.
3. Verify Vercel project root `fieldwork/` and server environment
   `SUPABASE_URL` / `SUPABASE_ANON_KEY`. Optional `SUPABASE_SERVICE_ROLE_KEY`
   (or server alias `SERVICE_ROLE_KEY`; the canonical name takes precedence)
   is server-only for deletion; never expose it in `/api/config` or browser code.
   Verify the actual deployed values privately; environment names alone do not
   verify wiring. The key-backed deletion path remains unverified.
4. Broaden section/form coverage; test physical devices, keyboard flows and a
   screen reader, including chart touch targets and large-text layout.
   Physical-device and screen-reader checks remain unverified.
5. Open exports in desktop Excel and a PDF reader. Native-reader opening remains
   unverified despite parser/render checks. Check long/wide statements and non-Latin
   text.
6. Verify the final production deployment and complete Google-only
   joining workflow against the installed fourth upgrade. These interface changes
   are included in this release. All four database
   upgrades are applied; do not replay their SQL. The unverified live flows above
   still prevent a complete production-readiness claim.

Install metadata remains, but there is **no service worker or offline write queue**.
Offline changes are not queued/synced. Stored map/receipt-path columns do not imply
map or receipt-upload UI exists in this repository.
