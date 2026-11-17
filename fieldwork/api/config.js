// Public values only (the anon key is designed to be public; RLS protects data).
// Service-role keys must NEVER be placed here. Later /api functions (geocoding) use server-only env vars.
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).json({ url: process.env.SUPABASE_URL || '', anonKey: process.env.SUPABASE_ANON_KEY || '' });
};
