// Demo workspace loader: 2 farms, 4 workers, 1 seed purchase, 4 checklists, plus enough records to fill every module.
// Runs as the signed-in owner/manager through normal RLS. Amounts assume a KES base currency (minor units = x100).
export async function loadDemo(X) {
  const { S, db } = X, ws = S.ws.id, k = (n) => n * 100, m = S.month, day = (d) => `${m}-${String(d).padStart(2, '0')}`;
  const farms = await db.insertMany('farms', [{ workspace_id: ws, name: 'Ol Kalou', county: 'Nyandarua', location_text: 'Ol Kalou, off the Nyahururu road' },
    { workspace_id: ws, name: 'Mashuru', county: 'Kajiado', location_text: 'Mashuru, near the Kajiado–Makueni boundary' }]);
  const [ok, ma] = farms.map((f) => f.id);
  let cats = await db.select('categories', 'select=id,name');
  if (!cats.length) cats = await db.insertMany('categories', [...['Milk sales', 'Crop sales', 'Livestock sales', 'Other income'].map((name) => ({ workspace_id: ws, kind: 'income', name })),
    ...['Feed', 'Seed', 'Fertiliser', 'Agrochemicals', 'Veterinary', 'Labour', 'Fuel', 'Repairs', 'Transport', 'Utilities', 'Other'].map((name) => ({ workspace_id: ws, kind: 'expense', name }))]);
  const cat = (n) => cats.find((c) => c.name === n)?.id ?? null;
  const [vend] = await db.insertMany('vendors', [{ workspace_id: ws, farm_id: ma, name: 'Demo Agro-Seeds Ltd', kind: 'Seed merchant', phone: '0700 000 000' }]);
  await db.insertMany('transactions', [
    { workspace_id: ws, farm_id: ma, txn_date: day(3), kind: 'expense', amount: k(38000), currency: S.ws.currency, category_id: cat('Seed'), vendor_id: vend.id, description: 'Hybrid maize seed, 10 × 25 kg' },
    { workspace_id: ws, farm_id: ok, txn_date: day(5), kind: 'income', amount: k(142000), currency: S.ws.currency, category_id: cat('Milk sales'), description: 'Milk delivery, first fortnight' },
    { workspace_id: ws, farm_id: ok, txn_date: day(8), kind: 'expense', amount: k(52000), currency: S.ws.currency, category_id: cat('Feed'), description: 'Dairy meal, 40 bags' },
    { workspace_id: ws, farm_id: ma, txn_date: day(10), kind: 'expense', amount: k(9500), currency: S.ws.currency, category_id: cat('Fuel'), description: 'Diesel for tractor' }]);
  await db.insertMany('workers', [
    { workspace_id: ws, farm_id: ok, full_name: 'Peter Mwangi', role: 'herdsman', pay_amount: k(18000), currency: S.ws.currency, start_date: '2024-03-01', phone: '0711 000 001' },
    { workspace_id: ws, farm_id: ok, full_name: 'Grace Wanjiku', role: 'milker', pay_amount: k(16000), currency: S.ws.currency, start_date: '2024-06-15' },
    { workspace_id: ws, farm_id: ma, full_name: 'Joseph Kiprono', role: 'farm_manager', pay_amount: k(28000), currency: S.ws.currency, start_date: '2023-09-01' },
    { workspace_id: ws, farm_id: ma, full_name: 'Mary Naserian', role: 'field_hand', pay_amount: k(14000), currency: S.ws.currency, start_date: '2025-01-10' }]);
  const lists = { 'Daily opening': ['Check water troughs', 'Inspect animals for signs of illness', 'Feed and milk on schedule', 'Record milk yield', 'Check fences and gates'],
    'Monthly close': ['Enter every receipt and M-Pesa payment', 'Reconcile cash with the bank and M-Pesa', 'Post worker pay', 'Compare budget with actual', 'Back up your records'],
    'Silage batch': ['Check crop moisture', 'Chop and compact the crop', 'Seal and cover the clamp', 'Label the batch with the date', 'Inspect the seal after 7 days'],
    'Funding application': ['Confirm you meet the eligibility rules', 'Gather ID, KRA PIN and land documents', 'Complete the application form', 'Get a second person to review it', 'Submit and note the reference number'] };
  const cl = await db.insertMany('checklists', Object.keys(lists).map((name) => ({ workspace_id: ws, name })));
  await db.insertMany('checklist_items', cl.flatMap((c) => lists[c.name].map((label, position) => ({ workspace_id: ws, checklist_id: c.id, label, position }))));
  await db.insertMany('tasks', [{ workspace_id: ws, farm_id: ok, title: 'Morning and evening milking', cadence: 'daily' }, { workspace_id: ws, farm_id: null, title: 'Submit monthly report to the owner', cadence: 'monthly', due_date: day(28) },
    { workspace_id: ws, farm_id: ma, title: 'Service the tractor', cadence: 'once', due_date: day(20) }]);
  const ent = await db.insertMany('enterprises', [{ workspace_id: ws, farm_id: ok, name: 'Dairy herd', type: 'livestock', notes: 'Friesian and Ayrshire cross' }, { workspace_id: ws, farm_id: ma, name: 'Maize, 4 acres', type: 'crop' }]);
  await db.insertMany('enterprise_records', [{ workspace_id: ws, enterprise_id: ent[0].id, record_date: day(5), record_type: 'milk yield', quantity: 186, unit: 'litres' },
    { workspace_id: ws, enterprise_id: ent[0].id, record_date: day(6), record_type: 'milk yield', quantity: 192, unit: 'litres' }, { workspace_id: ws, enterprise_id: ent[1].id, record_date: day(4), record_type: 'planting', quantity: 4, unit: 'acres', notes: 'Used the new seed lot' }]);
  await db.insertMany('projects', [{ workspace_id: ws, farm_id: ma, name: 'Borehole and water tank', status: 'active', cost: k(450000), currency: S.ws.currency, start_date: day(1) }]);
  await db.insertMany('funding_opportunities', [{ workspace_id: ws, name: 'Dairy cooperative equipment loan', source: 'Example SACCO', eligible: true, status: 'preparing', amount: k(500000), currency: S.ws.currency, eligibility_notes: 'Needs 6 months of milk delivery records' }]);
}
