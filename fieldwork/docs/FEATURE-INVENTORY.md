# Feature preservation checklist

Inventory taken before simplification and updated 18 November 2026 against the
expanded working draft. **No feature was merged or retired.** All 16 sections and
14 business view functions remain, with Members/Invitations served by the checked
team interface. "Draft" records implementation history, not live-provider
verification. All three SQL migrations were applied to the current Fieldnote project on
18 November 2026 at approximately 21:36 UTC. All three SQL
role/two-workspace/farm-scope suites passed on the current project inside a
reviewed rollback-only transaction; no schema, RLS or fixture rows were retained.
The latest recovery-extended run passed on its first attempt, including the
complete finance aggregate/server-close and invitation/session checks.
The final approved atomic install also passed immediate original-column and
Auth/Storage preservation checks. Provider/account HTTP verification is pending.

## Navigation before → after

Before: Overview; Daily operations (Tasks, Checklists); Monthly finances
(Transactions, Budget vs actual, Recurring, Categories); Vendors (My vendors,
Bills & balances, Seed merchants); Infrastructure; Livestock & crops (Enterprises,
Records); Workers; Funding; Members; Reports; Settings; Account (in progress).

After: **Overview · Operations · Finances · People · Reports**. Settings and
Account move to the workspace/user menus. Operations, Finances and People expose
the existing functions as distinct URL-addressable sections. Old module URLs remain
valid aliases. This groups navigation; it does not combine records or retire a
function. No feature merger or retirement was made. Any later proposal to do so
requires the user's approval before implementation.

| Before | After, preserving distinct functions |
| --- | --- |
| Overview | Overview → Summary / More insights; report under More actions |
| Daily operations: Tasks, Checklists | Operations → Tasks / Checklists |
| Infrastructure | Operations → Infrastructure |
| Livestock & crops: Enterprises, Records | Operations → Enterprises / Livestock & crops (Records) |
| Monthly finances: Transactions, Budget vs actual, Recurring, Categories | Finances → Transactions / Budgets / Recurring payments / Categories |
| Vendors: directory, bills, seed merchants | Finances → Vendors / Bills & balances / Seed merchants |
| Funding | Finances → Funding |
| Workers | People → Workers |
| Members and team invitations | People → Members / Invitations |
| Reports | Reports; all ten statements and export formats retained |
| Settings: farms/workspace/profile | Workspace menu → Settings; personal profile controls move to Account |
| Expanded Account request | User menu → Account: Profile, Security, Workspaces; Notifications, Invitations and Data & privacy under More |

Mobile: Overview, Operations, Finances, People and More in the bottom navigation;
More exposes Reports, Settings and Account. Workspace actions remain in the
workspace menu and Account → Workspaces. Global Add and
Ctrl/Cmd+K provide shortcuts without adding more sidebar destinations.

## Existing modules, forms and settings

Every row remains a preservation requirement. Locations describe the working
branch; an entry is not a claim that every flow passed live verification.
The Before column describes the pre-upgrade baseline; current database status is
recorded in the dashboard/account and verification sections below.

| ID | Feature and controls to preserve | Before | Target location |
| --- | --- | --- | --- |
| A01 | Password sign-in, signup, name/email/password validation | Sign-in | Sign-in |
| A02 | Show/hide password, clear errors, busy/disabled states | Draft sign-in | Sign-in |
| A03 | Verification/resend, cross-tab email PKCE, Google tab-scoped PKCE callback | Draft sign-in | Sign-in / Account security |
| A04 | Forgot password, reset/confirmation, expired callback handling | Sign-in | Sign-in / reset |
| A05 | Shared refresh/retry, revoked-session sign-out, blocked-storage fallback | Auth client | Auth client + connection feedback |
| A06 | Workspace creation, currency selection, automatic owner | First use | First-use setup / workspace menu |
| A07 | First farm and optional team invitation step | Draft first use | First-use setup |
| A08 | Invite-link capture/accept, correct-email binding, expiry/reuse feedback | Draft auth | Sign-in / Account invitations |
| W01 | Workspace switch, role and currency context | Sidebar/account | Workspace switcher/menu |
| W02 | Farm selection and month/period selection | Top bar | Compact top bar |
| W03 | Farm create/view/edit/duplicate/delete | Settings/Farms | Workspace menu → Settings → Farms |
| W04 | Farm name, county, location notes; preserve stored coordinates/boundary | Farm drawer/database | Same drawer and stored records |
| W05 | Optional fictional KES sample-data loader for an empty workspace | Settings/Workspace | Settings → Workspace (conditional) |
| W06 | Theme light/dark/system, name and profile preferences | Settings/Profile + draft Account | User menu → Account; theme shortcut |
| O01 | Tasks: farm/shared, title, daily/monthly/once, due date, status, notes | Daily/Tasks | Operations → Tasks |
| O02 | Mark done/reopen; Nairobi recurrence; latest completion timestamp | Tasks | Operations → Tasks |
| O03 | Checklist definitions and item drawers, item position | Daily/Checklists | Operations → Checklists |
| O04 | Daily per-farm/shared checklist ticks and completion counts | Checklists | Operations → Checklists |
| O05 | Checklist deletion confirmation and six-second Undo | Draft checklists | Checklist More actions |
| O06 | Enterprise directory: livestock/crop, farm, name, notes | Livestock/Enterprises | Operations → Enterprises |
| O07 | Records: enterprise/date/type/quantity/unit/notes | Livestock/Records | Operations → Livestock & crops (Records) |
| O08 | Record types: milk, feeding, breeding, health, weight, planting, fertiliser, spraying, harvest, other | Records | Same record drawer/options |
| O09 | Projects: farm, name, status, dates, notes, cost/currency | Infrastructure | Operations → Infrastructure |
| O10 | Nullable project budget/remaining, redacted operational project view | Draft before SQL upgrade | Same project view/drawer |
| F01 | Transaction register, income/expense, selected period and farm | Monthly finances | Finances → Transactions |
| F02 | Date, kind, amount, currency, FX, category, vendor, description | Transaction drawer | Same drawer; optional fields under More options |
| F03 | Exact minor units, precision/rate checks, remembered FX | Finance client | Unchanged finance model/workflow |
| F04 | Optional enterprise link for recorded profitability | Draft before SQL upgrade | Transaction More options |
| F05 | Income targets and expense budgets, actuals, remaining/ahead, totals | Budget vs actual | Finances → Budgets |
| F06 | Inline budget save, copy last month, opening/net/closing cash, close month | Budgets | Budgets + More actions |
| F07 | Recurring definitions: farm, name, kind, money, category/vendor, day 1–28, active | Recurring | Finances → More → Recurring |
| F08 | Post selected month's recurring entries, skip already-posted sources | Recurring banner | Recurring → More actions |
| F09 | Category create/view/edit/duplicate/delete, income/expense; standard category setup | Categories | Finances → More → Categories |
| F10 | Vendors: farm/shared, name, supplies, phone, email, notes | My vendors | Finances → Vendors |
| F11 | Seed merchant search, county/licence, add to my vendors, duplicate prevention | Seed merchants | Finances → More → Seed merchants |
| F12 | Bills: vendor/farm, issued/due dates, reference, description, amount/paid/currency; outstanding balance | Draft before SQL upgrade | Finances → More → Bills & balances |
| F13 | Funding: source, eligibility/notes, owner metadata, deadline/status, amount/currency/link | Funding | Finances → Funding |
| P01 | Worker directory: name, farm, job role, phone, active/start/end | Workers | People → Workers |
| P02 | Worker rate/currency/frequency, monthly posting, source deduplication | Workers | Workers → Pay actions / statement |
| P03 | Existing weekly = four weeks / daily = 26 days posting convention | Worker posting | Preserve and label; no silent formula change |
| P04 | Financial redaction for worker/viewer roles | Draft before SQL upgrade | Same permission-bound People view |
| P05 | Members search/filter/sort/pagination; roles, farm scopes, join dates | Draft Members | People → Members |
| P06 | Invite, change role/scope, remove; owner/admin rules and last-owner guard | Draft before SQL upgrade | Member drawer / row More menu |
| P07 | Invitation list, expiry/status, revoke, copy link (no automatic email send) | Draft Members/Invitations | People → Invitations |
| R01 | Overview performance statement | Draft Reports | Reports → Overview; Overview More |
| R02 | Task completion/overdue/checklist statement | Draft Reports | Reports → Operations; Tasks/Checklists More |
| R03 | Income/expense, cash movement/snapshots, targets/budgets, ledger | Draft Reports | Reports → Finances; Finances More |
| R04 | Vendor spend and separate outstanding bills | Draft Reports | Reports → Vendors; Vendors More |
| R05 | Project status/budget/cost/dates | Draft Reports | Reports → Infrastructure; project More |
| R06 | Enterprises, activity, quantities by type/unit, linked profitability | Draft Reports | Reports → Livestock & crops |
| R07 | Worker directory, per-worker/farm recorded payroll and rate schedules | Draft Reports | Reports → Workers |
| R08 | Funding pipeline/deadlines/status | Draft Reports | Reports → Funding |
| R09 | Member access and audit history (two distinct statements) | Draft Reports | Reports → Members / Audit |
| R10 | Farm/date/status/category/worker filters, live preview | Draft Reports | Reports → Advanced filters |
| R11 | PDF and real XLSX, letterhead/author/date/sections/totals/footer/pages | Draft exporters | Report preview → Download PDF / More actions → Excel |
| R12 | XLSX numeric formats, frozen rows, SUM formulas, section sheets | Draft exporter | Unchanged shared exporter |
| R13 | PDF font caveat, current-balance/latest-task history caveats | Draft statements | Contextual export notes/details |
| U01 | Global Add record shortcuts to task/transaction/vendor/worker/project/record/funding/farm | Overview Add | Global Add / mobile floating Add |
| U02 | Skip link, keyboard menus/tabs, mobile navigation/focus, Escape | Shell/components | Same shared shell/components |
| U03 | Search, filters/chips, visible columns, sorting, sticky headers, row hover | Draft tables | Shared table toolbar; advanced options |
| U04 | View/edit/duplicate/delete drawer/menu, stable UUID retry | Draft resource engine | Same shared resource engine |
| U05 | Selection, bulk export/delete, CSV, pagination and page size | Draft tables | Table selection bar / More actions |
| U06 | Loading/empty/error/retry, inline validation, progress/busy, toasts | Components | Shared controls/feedback |
| U07 | Delete confirmation and six-second deferred Undo, context guards | Draft resource engine | Same shared engine |
| U08 | Dirty-form warning, save-in-progress guard, optimistic task rollback | Draft feedback | Same shared feedback |
| U09 | Manifest, install metadata, icon, OS theme/reduced-motion | Baseline PWA | Preserved |
| U10 | Online/offline/in-flight request status | Draft client/shell | Compact connection indicator |

## Additional dashboard/account work already requested

These remain in the checklist even when hidden behind progressive disclosure.

| ID | Required feature | Current status | Target |
| --- | --- | --- | --- |
| D01 | Database-computed KPI values, previous-period change and sparklines | SQL applied and fixture-tested; real browser/API verification pending | Overview → Summary |
| D02 | Income/expense/net monthly, cash trend, category spend | Implemented; local sample browser checks | Overview → Summary / More insights |
| D03 | Budget/actual and income targets, farm comparison, enterprise margin | SQL applied; live browser/API verification pending | Overview → More insights |
| D04 | Payroll share, top vendors, current task progress/latest-only calendar | Implemented SQL/UI; history caveat retained | Overview → Summary / More insights |
| D05 | Overdue tasks, unpaid bills, missing scheduled postings, funding deadlines, near-limit budgets | SQL applied; live browser/API verification pending | Overview → Needs attention; Account notifications |
| D06 | Grouped bars/line overlay, line/area, donut, horizontal bars, progress, sparkline, heatmap | Shared renderer implemented | Reused by Overview |
| D07 | Tooltip/tap/keyboard, legend toggles, drill filters, table view, PNG/CSV | Implemented; sample PNG rendered and CSV downloaded | Chart data-table toggle / More actions |
| C01 | Name/photo/contact phone, formatting language/timezone | Schema/private bucket applied; real photo flow unverified | Account → Profile |
| C02 | Theme/default farm/default period | Database defaults applied; live account verification pending | Account → Profile → More options → Display options |
| C03 | Reauthenticated password/email changes, verification, connected methods | Implemented; live email/Google flows unverified | Account → Security |
| C04 | Own session inventory, sign out other devices | SQL active-session/context guards applied and fixture-tested; real revocation unverified | Account → Security |
| C05 | Optional TOTP enroll/challenge/verify/remove; enforce aal2 after opt-in | SQL guards applied and fixture-tested; real TOTP flows unverified | Account → Security |
| C06 | Alert/channel choices and in-app alerts; honest email-channel capability | Preferences/dashboard RPCs applied; no email delivery claim | Account → More → Notifications |
| C07 | Workspace list/role/switch/create/leave; transfer before owner departure | Checked RPCs applied; live account verification pending | Account → Workspaces |
| C08 | Own-data JSON export, guarded account deletion, business-record retention | SQL applied; server credential and live checks still required | Account → More → Data & privacy |
| C09 | Email-bound pending personal invites, accept/decline | Recovery/password-audit and fresh-proof gates applied and fixture-tested; real email flow unverified | Account → More → Invitations |
| C10 | Unverified email, wrong method, expired/reused links, removed membership, expiry mid-action | Guards implemented; live edge flows unverified | Contextual feedback / sign-in |

## Verification status

- Latest full run: **250 JavaScript tests pass**.
  Static checks pass: 22 browser modules, two APIs, 12 business routes, five pages,
  16 sections and 12 assets. All 32 configured contrast pairs pass per theme.
  JavaScript checks are separate from the SQL rehearsal results below.
- Invented local data only: DOM checks found no horizontal overflow at 360, 768,
  1024 and 1440 px in both themes for Overview, Tasks, Transactions, Workers,
  Reports, Account Profile and Settings. Overview screenshots covered all four
  widths in both themes. Final Overview HTML control touch-size and Profile/Search
  dirty-form browser rechecks passed. Broader form and physical-device QA remains
  separate from source-level preservation of the checklist.
- The 360 px dark task drawer's sticky save, inline validation and discard prompt
  were inspected; sample task completion updated immediately with a success toast.
  Final sample checks passed Budget Close/saved feedback, Copy's missing-budget
  feedback, Report, transaction Add/search, and Filters cancel/later budget discard
  protection. Budgets had no overflow at all four widths in both themes.
  Browser PDF/XLSX and chart PNG/CSV downloads worked; PNG was rendered, PDF
  parsed/rendered and XLSX loaded with openpyxl. Desktop Excel/PDF-reader opening,
  physical devices and screen readers remain unverified.
- The current project's 44 anonymous/nonmember read-only checks passed. The
  members/roles, dashboard/finance and Account suites then passed in a separately
  reviewed recovery-extended rollback rehearsal, which passed on its first attempt.
  All 98 original rows in 24 public tables matched their original-column digests.
  All 1,299 catalog items matched baseline MD5
  `992fc360118daa1d8f2398d90ba4f75b`, with no fixture IDs across 25 reserved prefixes.
  The latest run included complete 1,005-row totals/server close, role/farm-scope
  rejections, same-call attestation, proof/audit/email/session rejection cases and
  revoked-session/MFA access-context gates. These rollback runs retained no upgrades
  or fixture rows; normal logs and audit identity
  sequence gaps can survive rollback, and sequences were not reset. Real Auth/HTTP and
  concurrent-session behavior are separate checks.
- All three upgrades were then applied through one approved manual SQL transaction
  (bundle SHA256 `2c7bdf1673905e51a8e992aab74b8afb1710a52f8b8440083e6c585a6bd31993`).
  Immediate fresh checks preserved all 98 original rows/24 tables and whole-row
  Auth/Storage digests. Fixtures were removed before commit; the installed catalog
  has 28 public tables. The old 1,299-item catalog applies only to rollback cleanup.
  No CLI migration-history entry was created. Do not rerun the original files;
  see the [applied source record](USABILITY-HANDOFF.md) for hashes and future work.
- First incoming-invite use requires fresh PKCE email recovery, a different
  password, completed Auth password-change evidence and ending other sessions.
  The server sets trusted app metadata bound to that email. Later invitation
  access requires fresh email magic-link/recovery proof; email changes require
  recovery again. User metadata is never proof. Email callbacks support another
  tab in the same browser and preserve invitation intent; Google stays tab-scoped.
- Real Auth email/OAuth/TOTP/deletion and actual deployed environment values remain
  unverified. Owner-provided mail/Google credentials and provider setup are still
  required. See [USABILITY-HANDOFF.md](USABILITY-HANDOFF.md) for Ian's release checks.

## Limits to preserve honestly

- This repository has install metadata but **no service worker or offline write
  queue**. Offline saves must not be presented as queued/synced. The separate ZIP's
  later offline/map architecture has not been transplanted into this repository.
- Map coordinates/boundaries and receipt-path columns exist in the database, but
  this baseline has no farm-map or transaction-receipt-upload UI to retire.
- Database upgrades for new roles, report fields, dashboard figures, avatars and
  account sessions are applied. Real browser/provider flows and server-configured
  account deletion still need verification; installed does not mean release-ready.
- No functionality is merged or retired by this navigation plan. Final sign-off
  requires checking each ID above, four viewport widths, both themes, and naming
  every unverified dependency/flow.
