# fieldnote. — farm management for Kenyan farms

Plain HTML/CSS/JavaScript, Supabase REST/Auth/Storage and Vercel `/api` functions.
No build step or added runtime libraries. Architecture, stored records and ISO
currency **minor units** are retained (KES 100 = KSh 1).

This is a reviewable usability draft. **All three migrations are unapplied; no
production schema, RLS or data writes were made.** Read
[Ian's handoff](docs/USABILITY-HANDOFF.md) for release checks and the
[feature inventory](docs/FEATURE-INVENTORY.md) for preservation mapping.

## Navigation and features

Five pages: **Overview · Operations · Finances · People · Reports**. All 16
sections and 14 business view functions remain; no features were merged or
retired. Settings is in the workspace menu, Account in the user menu, and old
module URLs remain valid. Mobile has bottom navigation, More and floating Add;
Ctrl/Cmd+K searches navigation and recent records.

Overview separates Summary/More insights, with database-computed KPIs, comparisons,
charts and reminders once its reviewed RPC is installed. Charts include keyboard/
tap exploration, record drills, exact data tables and PNG/CSV actions. Account
includes profile/photo, security/TOTP, own sessions, workspaces, invitations,
notifications, own-data export and guarded deletion. Theme/default farm/default
period are under **Account → Profile → More options → Display options**.

Tables/forms retain search, filters, sorting, columns, bulk actions, validation and
save/context guards. Phone rows become labeled cards. Reports offers ten scoped
statements with live preview, binary PDF and true XLSX section sheets, numeric
formats, frozen headers and SUM totals. PDF fonts transliterate accents and replace
unsupported characters; preview/XLSX preserve Unicode.

## Setup and database review

For a **fresh staging project only**, initialize `db/schema.sql` once. Never rerun
it over the existing farm database. Review these proposals and their rollback-only
tests on isolated staging before any production decision:

1. `db/migrations/20261118_members_roles.sql` — six roles/farm scope, invitations,
   audit restrictions, project budgets, vendor bills and enterprise financial links.
2. `db/migrations/20261118_dashboard.sql` — read-only, RLS-bound aggregates.
3. `db/migrations/20261118_account.sql` — own preferences/avatars/sessions,
   optional MFA enforcement and guarded membership/account deletion behavior.

The SQL suites in `db/tests/` are **unexecuted**. Worker finance/pay access from the
base schema changes only if the reviewed role migration is applied. Owner/Admin
manage members; only Owner manages owners/admins. Manager manages operations/money,
Accountant money/pay, Worker field activity and Viewer operational reads.
Restricted farm scope and redaction require database enforcement. Invitations are
copyable email-bound links; this app does not send invitation email.

Use Vercel root `fieldwork/`, framework Other and no build command. Configure server
`SUPABASE_URL` and `SUPABASE_ANON_KEY`. Optional `SUPABASE_SERVICE_ROLE_KEY`
enables guarded deletion **server-side only**; never put it in browser code, public
configuration or source. Provider/email, redirect and Vercel environment wiring
still need live verification. Ordinary static hosting does not serve `/api/config`
or `/api/account`.

Browser metadata verified account `kirubiianmwangi-crypto` / Fieldnote
(`nwuyizxxtfrncigorfji`): 24 original public tables and six inspected core RLS
flags enabled. The connected tool's older `pollwave` account is different.
This read-only inspection did not apply or prove the proposed policies.

## Local checks and sample preview

From `fieldwork/`, with Node 18+:

```sh
node --experimental-vm-modules tools/check.mjs
node --experimental-vm-modules --test tests/*.test.mjs db/tests/*.test.mjs
node tools/preview.mjs
```

Latest full run: **178 JavaScript tests pass**.
Static checks resolve 21 browser modules, two APIs, 12 business routes, five pages,
16 sections and 12 assets; all 32 configured contrast pairs pass in each theme.
The loopback preview uses invented in-memory records,
simulated SQL/permissions and six role accounts (`ROLE@fieldwork.test` /
`sample123`). It never connects to Supabase; real email, Google and deletion
are disconnected. Never enter real credentials.

Local DOM checks found no horizontal overflow on the main pages at
360/768/1024/1440 px in either theme. Overview screenshots covered both themes;
final Overview touch-size and Profile/Search dirty-form rechecks passed. Browser PDF/XLSX and chart PNG/CSV downloads
worked; PDF parse/render and openpyxl checks passed. Desktop Excel/PDF-reader,
live Auth, SQL/RLS suites, physical devices, screen readers and production wiring
remain unverified. See the handoff before release.

## Money, sample records and theme

Budgets/closing cash use the workspace base currency and farm scope. Foreign
transactions retain recorded FX and their generated base amount. Dashboard cash
uses exact-month saved snapshots; missing snapshots remain unavailable. Bills are
separate from cash transactions; enterprise margin uses explicit links only.
Whole calendar periods compare with matching preceding months; arbitrary day
ranges use equal-day comparisons. Existing worker posting retains the labeled
four-week/26-day convention. No historical balances or allocations are invented.

Settings → Workspace retains a fictional-data loader for an empty KES workspace
with all-farm write access. Unlike the memory preview, it stores records in that
workspace; use a separate empty workspace. There is no one-click sample removal.

Colors stay in `css/tokens.css`; run `python tools/check-contrast.py` after palette
changes. Retain inline theme initialization and install metadata. The separate
ZIP's maps/offline sync are not transplanted: there is no service worker or offline
write queue here.
