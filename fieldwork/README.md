# fieldwork. — farm management for Kenyan farms

Plain HTML/CSS/vanilla JS. No build step. Supabase (Postgres, Auth, Storage) + Vercel static hosting with `/api` functions.
Status: **Stage 3** complete (budgets, closing cash, recurring payments, categories, linked filters). Next: map (stage 4).

## 1. Supabase
1. Create a project at supabase.com (pick the region closest to Nairobi, e.g. eu-west or ap-south).
2. SQL Editor → paste all of `db/schema.sql` → Run. Run it once, on a fresh project.
3. Authentication → Providers → Email. For development turn **Confirm email** off; for production leave it on.
4. Authentication → URL Configuration → set **Site URL** to your Vercel URL (and add `http://localhost:3000` for local testing).
5. Project Settings → API → copy the **Project URL** and the **anon public** key. Never use the service_role key in this app.

## 2. Vercel
1. Push this folder to a Git repo and import it in Vercel (Framework preset: **Other**, no build command, output directory blank).
2. Environment variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`. Redeploy.
3. Open the site, create an account, name your workspace, add farms.

Local: `npm i -g vercel && vercel dev` (serves `/api/config` with a `.env` file containing the two variables). Plain static servers won't serve `/api`.

## Roles
owner = full admin · manager = full operations write · worker = tasks, checklist runs, transactions.
The first user to create a workspace becomes its owner. Inviting members arrives in stage 5.

## Theming rules
Colors live only in `css/tokens.css`. Run `python3 tools/check-contrast.py` after any palette change.
Every page needs the inline head script from `docs/theme-head-snippet.html`. See `docs/PARITY-CHECKLIST.md`.

## Demo data
On an empty workspace, Overview shows **Load demo data** (owner/manager). It adds 2 farms (Ol Kalou, Mashuru), 4 workers, 1 seed purchase,
the 4 checklists and sample records in every module. Names of people, vendors and funders are fictional. Use a fresh workspace for it:
there is no one-click "remove demo data" yet.

## Finance notes
- Budgets and closing cash are per farm, in the workspace base currency. "All farms" shows combined totals; pick one farm to edit or close a month.
- Closing a month stores that farm's closing cash; next month's opening cash is that stored balance (0 if the previous month was never closed).
- Saving a transaction in a foreign currency remembers its exchange rate (per day) and pre-fills it next time. Recurring and worker pay use the latest saved rate.
