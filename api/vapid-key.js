// GET /api/vapid-key — returns public VAPID key to client
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).end();

  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(500).json({ error: 'VAPID not configured' });

  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.json({ publicKey: key });
}
