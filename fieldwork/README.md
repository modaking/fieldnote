# fieldnote. — farm management for Kenyan farms

Plain HTML/CSS/JavaScript, Supabase REST/Auth/Storage and Vercel `/api` functions.
No build step or added runtime libraries. Architecture, stored records and ISO
currency **minor units** are retained (KES 100 = KSh 1).

This is release preparation. **The three original database upgrades were applied to the
current Fieldnote project on 18 November 2026 at approximately 21:36 UTC, after
approval and successful rollback rehearsals. Original farm data was preserved;
live email/Google/MFA and other account HTTP flows still need verification.** Read
[Ian's handoff](docs/USABILITY-HANDOFF.md) for release checks and the
[feature inventory](docs/FEATURE-INVENTORY.md) for preservation mapping.
The fourth, Google-only owner-approval upgrade is also **applied**, after separate
qualification and approval. Its completion was observed at 23:49:35 UTC on 18 November.
Google is enabled in the provider settings. Email/password signup confirmation is
temporarily disabled at the owner's request; this is not mailbox-ownership proof.
Manual Google linking is enabled. Real OAuth sign-in/linking remain unverified.
The Google-first signup, hidden Forgot shortcut and Account ID/approval interface
are included in this release; production deployment is confirmed separately.

## Navigation and features

Five pages: **Overview · Operations · Finances · People · Reports**. All 16
sections and 14 business view functions remain; no features were merged or
retired. Settings is in the workspace menu, Account in the user menu, and old
module URLs remain valid. Mobile has bottom navigation, More and floating Add;
Ctrl/Cmd+K searches navigation and recent records.

Overview separates Summary/More insights, with database-computed KPIs, comparisons,
charts and reminders through its installed database RPC. Charts include keyboard/
tap exploration, record drills, exact data tables and PNG/CSV actions. Account
includes profile/photo, security/TOTP, own sessions, workspaces, invitations,
notifications, own-data export and guarded deletion. Theme/default farm/default
period are under **Account → Profile → More options → Display options**.

Tables/forms retain search, filters, sorting, columns, bulk actions, validation and
save/context guards. Phone rows become labeled cards. Reports offers ten scoped
statements with live preview, binary PDF and true XLSX section sheets, numeric
formats, frozen headers and SUM totals. PDF fonts transliterate accents and replace
unsupported characters; preview/XLSX preserve Unicode.

## Applied database upgrades

For a **fresh disposable project only**, initialize `db/schema.sql` once. Never
rerun it over the existing farm database. The original three files were applied
through one reviewed atomic bundle, followed by a separately approved forward
installation. **Do not rerun any of these four files on the current project**:

1. `db/migrations/20261118_members_roles.sql` — six roles/farm scope, invitations,
   audit restrictions, project budgets, vendor bills and enterprise financial links.
2. `db/migrations/20261118_dashboard.sql` — RLS-bound dashboard/finance aggregates
   and a checked, server-recomputed farm month close.
3. `db/migrations/20261118_account.sql` — own preferences/avatars/sessions,
   optional MFA enforcement, revoked-session rejection and checked invitation recovery.
4. `db/migrations/20261118224325_owner_approved_membership.sql` — checked owner
   approval of an eligible Google-only Account ID, retaining the existing role/farm model.

The three original SQL suites in `db/tests/` passed on the current project inside one
reviewed transaction with fixture-isolating savepoints and a final rollback.
The latest recovery-extended run passed all three suites on its first attempt,
including 1,005-row finance totals/server close, role/farm-scope rejections,
invitation proof and revoked-session checks. Worker finance/pay access
from the base schema is now restricted by the applied role migration. Owner/Admin
manage members; only Owner manages owners/admins. Manager manages operations/money,
Accountant money/pay, Worker field activity and Viewer operational reads.
Restricted farm scope and redaction require database enforcement. Invitations are
copyable email-bound links; this app does not send invitation email.

Before first using incoming invitations, recover the account through a fresh
PKCE email link, set a different password and end other sessions. The database
requires the completed Auth password-change audit event and the actual active
session before setting its own trusted app-metadata marker, bound to that email.
Later invitation access needs a fresh email magic link/recovery proof; changing
email requires recovery again. Editable user metadata is never verification.
Email links can open in another tab of the same browser; Google keeps a separate
tab-scoped PKCE verifier. Delivery and real callback flows still need verification.

The interface for the installed alternative is **Account → Profile → Account ID / Copy**, then
**People → Members → More → Add Google account**. A current owner independently
identifies the person, enters that exact ID, chooses manager/accountant/worker/viewer
and all/selected farms, then confirms approval. The installed RPC requires a fresh
primary sign-in, active own session and any enrolled MFA. The target must have
exactly one Google identity, a typed verified-email flag matching its current email,
and no password or other provider identity. This prevents approving a shared UID
whose older password could still belong to someone else. Existing memberships and
the email-invitation/recovery path stay unchanged.

[The forward migration](db/migrations/20261118224325_owner_approved_membership.sql)
is **applied**. [Its suite](db/tests/20261118224325_owner_approved_membership.test.sql)
passed on the current PostgreSQL project in the reviewed `16596ef9…` rollback batch,
including fresh whole-row preservation across 34 public/Auth/Storage tables. The
separate TEMP catalog/EOL probe also passed. Those rehearsals retained no function
or fixtures. The approved installation then passed fresh 34-table data/catalog
checks before its single commit and verified the stored function/security contract
afterward. Bundle SHA256:
`ef75a5ffc3ae15a2f081ad94778bf00025e45f61fba1794b77f31d1be846b57f`.
No CLI migration-history entry was created. Real OAuth and browser/REST flows remain
unverified. This release temporarily hides the public Forgot password shortcut at the
owner's request; reset code, APIs and callbacks are retained. Production deployment
is confirmed separately.

Use Vercel root `fieldwork/`, framework Other and no build command. Configure server
`SUPABASE_URL` and `SUPABASE_ANON_KEY`. Optional `SUPABASE_SERVICE_ROLE_KEY`
enables guarded deletion **server-side only**; never put it in browser code, public
configuration or source. Google provider enablement was verified after owner-entered
credentials; live callbacks/linking and mail delivery still need testing. Any remaining
provider configuration belongs directly in the provider consoles. Actual deployed
environment values and live account flows still need verification; checking variable
names alone does not verify wiring. Ordinary static hosting does not serve `/api/config`
or `/api/account`.

The original three-upgrade installation used bundle SHA256
`2c7bdf1673905e51a8e992aab74b8afb1710a52f8b8440083e6c585a6bd31993`.
Immediate fresh read-only checks preserved all **98 original rows across 24 public
tables** and the whole-row Auth/Storage digests; fixtures were removed before
commit. The catalog now has 28 public tables. The earlier 1,299-item baseline
applies to rollback rehearsals, not the installed schema. This manual SQL install
created no Supabase CLI migration-history entry; reconcile history before future
CLI deployment. See the handoff for source hashes and remaining checks.

## Local checks and sample preview

From `fieldwork/`, with Node 18+:

```sh
node --experimental-vm-modules tools/check.mjs
node --experimental-vm-modules --test tests/*.test.mjs db/tests/*.test.mjs
node tools/preview.mjs
```

The combined automated suite passes **261 tests**. Separately, **17 private installer
compiler/artifact tests pass**; these are not live OAuth tests. The new owner-approval
PostgreSQL rollback suite, TEMP catalog probe and approved installation checks passed.
Static checks resolve 22 browser modules, two APIs, 12 business routes, five pages,
16 sections and 12 assets; all 32 configured contrast pairs pass in each theme.
The loopback preview uses invented in-memory records,
simulated SQL/permissions and six role accounts (`ROLE@fieldwork.test` /
`sample123`). It never connects to Supabase; real email, Google and deletion
are disconnected. Never enter real credentials.

Local DOM checks found no horizontal overflow on the main pages at
360/768/1024/1440 px in either theme. Overview screenshots covered both themes;
final Overview touch-size and Profile/Search dirty-form rechecks passed. Sample
Budget Close, Copy feedback, Report and transaction Add/search worked; cancelling
Filters preserved later budget discard protection. Budgets had no overflow at all
four widths in both themes. Browser PDF/XLSX and chart PNG/CSV downloads
worked; PDF parse/render and openpyxl checks passed. Desktop Excel/PDF-reader,
live Auth, physical devices, screen readers and production wiring remain
unverified. SQL rehearsal coverage is distinct from real Auth and browser/REST
end-to-end checks. See the handoff before release.

Final release UI captures passed independent review at all four widths in light
and dark themes, plus four short-phone captures at 360×640. Save, identity
confirmation, Close and sticky-footer controls were checked. In the invented
sample, adding a scoped Viewer changed members from six to seven, unchecked
identity confirmation blocked submission, and role/farm display was correct.
Account ID Copy showed success feedback; its actual clipboard payload, physical
touch and screen-reader behavior remain unverified. Real OAuth/TOTP/deletion
remain pending.

## Money, sample records and theme

Budgets/closing cash use the workspace base currency and farm scope. Foreign
transactions retain recorded FX and their generated base amount. Dashboard cash
uses exact-month saved snapshots; missing snapshots remain unavailable. Bills are
separate from cash transactions; enterprise margin uses explicit links only.
Whole calendar periods compare with matching preceding months; arbitrary day
ranges use equal-day comparisons. Existing worker posting retains the labeled
four-week/26-day convention. No historical balances or allocations are invented.
Reads paginate beyond the REST page cap; incomplete financial reads fail visibly.
The installed finance RPCs calculate full filtered totals and recompute month
closing in PostgreSQL. SQL fixture coverage is separate from live browser/API checks.

Settings → Workspace retains a fictional-data loader for an empty KES workspace
with all-farm write access. Unlike the memory preview, it stores records in that
workspace; use a separate empty workspace. There is no one-click sample removal.

Colors stay in `css/tokens.css`; run `python tools/check-contrast.py` after palette
changes. Retain inline theme initialization and install metadata. The separate
ZIP's maps/offline sync are not transplanted: there is no service worker or offline
write queue here.
