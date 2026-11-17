# Theme parity checklist

Rule for every stage: nothing ships until each row is ticked in **both** Light and Dark.
Run `python3 tools/check-contrast.py` first (token-level AA), then eyeball each screen at 375px and 1280px.
Also test: theme set to **System**, then change the OS theme with the app open (must switch live).

| # | Screen / element | Light | Dark | Notes to verify |
|---|---|:-:|:-:|---|
| 0 | Hard reload, no flash of light theme | ☐ | ☐ | inline head script present on **every** html page |
| 1 | Login / sign-up / reset | ☐ | ☐ | inputs, error text, disabled button |
| 2 | Create workspace + add farm | ☐ | ☐ | focus rings, select menus |
| 3 | Shell: sidebar, breadcrumbs, farm tabs, month selector, top bar toggle | ☐ | ☐ | sage active state readable; toggle shows 3 states |
| 4 | Overview: KPI cards, farm cards, map, "Add a record" | ☐ | ☐ | negative cash flow red; map tiles filtered; pins visible |
| 5 | Daily operations + checklists | ☐ | ☐ | checkbox states, done strike-through contrast |
| 6 | Monthly finances: register, filters, budget vs actual | ☐ | ☐ | table header/row hover/zebra; chart series |
| 7 | Vendors + seed merchant reference | ☐ | ☐ | badges |
| 8 | Infrastructure | ☐ | ☐ | status badges |
| 9 | Livestock & crops | ☐ | ☐ | |
| 10 | Workers | ☐ | ☐ | |
| 11 | Funding tracker | ☐ | ☐ | deadline-soon warning badge |
| 12 | Empty states (every module) | ☐ | ☐ | illustration uses currentColor |
| 13 | Modals, toasts, "pending sync" indicator, offline banner | ☐ | ☐ | overlay opacity |
| 14 | Map: search, GPS, drag pin, Open in Google Maps | ☐ | ☐ | |
| 15 | Printable monthly report + CSV/PDF export | ☐ | — | **always light**, even when app is dark |
| 16 | PWA: theme-color meta + manifest | ☐ | ☐ | meta updates on toggle; manifest uses light value |
| 17 | Receipt upload preview | ☐ | ☐ | |
| 18 | `grep -rniE '#[0-9a-f]{3,8}\b|rgb\(|hsl\(' --include=*.css --include=*.js --include=*.html . ` | ☐ | | only tokens.css, theme-head snippet and PWA manifest may match |

## Multicurrency checks (each stage that touches money)
- Amount inputs show the currency's exponent (UGX/JPY/RWF 0 decimals, others 2) and format with `Intl.NumberFormat`.
- A non-base transaction asks for / pre-fills an fx rate; KPI cards, budgets and reports sum `amount_base` only.
- Currency codes and rates are readable in both themes (badge on non-base rows, rate field states).

## Stage 3 rows (both themes)
- Finances tabs: Transactions, Budget vs actual, Recurring, Categories (tab selected state, banner, filters).
- Budget table: inline budget inputs, "Over budget" and "% used" badges, red negative "Left", totals row.
- Closing cash card: "Month closed" (ok) and "Closed at …" (warn) badges.
