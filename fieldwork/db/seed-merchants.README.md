# Loading the KEPHIS seed merchant list

`seed_merchants` is a global reference table (readable by every signed-in user, writable only with the service role).
KEPHIS publishes its register of licensed seed merchants; I have not bundled names because they must come from the current official list.

1. Get the current register from KEPHIS (kephis.go.ke) and save it as CSV with the headers: `name,county,phone,licence_no,source_url`.
2. Supabase → Table editor → `seed_merchants` → Insert → Import data from CSV.
3. Refresh the Vendors → "Seed merchants (KEPHIS)" tab. Merchants appear with "Add to my vendors".
