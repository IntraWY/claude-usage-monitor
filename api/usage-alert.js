// POST /api/usage-alert — called by claude-usage-ext when utilization crosses threshold
import webpush from 'web-push';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const ALLOWED_TYPES = ['session_high', 'session_full', 'good_time'];
const COOLDOWN_SEC = 15 * 60; // 15 minutes

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export default async function handler(req, res) {
  // CORS — allow Chrome extension and same-origin PWA
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { pairingCode, type, pct } = req.body;

  // Validate pairingCode — must be exactly 6 uppercase hex chars
  if (typeof pairingCode !== 'string' || !/^[0-9A-F]{6}$/.test(pairingCode)) {
    return res.status(400).json({ error: 'Invalid pairingCode' });
  }

  // Validate type
  if (!ALLOWED_TYPES.includes(type)) {
    return res.status(400).json({ error: 'Invalid alert type' });
  }

  // Validate pct
  const pctNum = Math.round(Number(pct));
  if (!Number.isFinite(pctNum) || pctNum < 0 || pctNum > 100) {
    return res.status(400).json({ error: 'Invalid pct value' });
  }

  // Lookup subscription
  const endpointHash = await redis.get(`pairing:${pairingCode}`);
  if (!endpointHash) return res.status(404).json({ error: 'Pairing code not found' });

  const record = await redis.get(`sub:${endpointHash}`);
  if (!record?.subscription) return res.status(404).json({ error: 'Subscription not found' });

  // Atomic rate limiting — SET NX prevents TOCTOU race condition
  const lastAlertKey = `lastalert:${endpointHash}:${type}`;
  const set = await redis.set(lastAlertKey, '1', { nx: true, ex: COOLDOWN_SEC });
  if (set === null) {
    return res.json({ ok: true, skipped: 'rate_limited' });
  }

  const payloadMap = {
    session_high: {
      title: '⚠️ Session ใกล้เต็ม!',
      body: `Session 5h เหลือ ${100 - pctNum}% — รีบ Ping Claude Haiku ก่อนหมด`,
      tag: 'session-high',
    },
    session_full: {
      title: '🚨 Session เต็มแล้ว!',
      body: 'หยุดใช้ Claude Sonnet/Opus ชั่วคราว — รอ session reset',
      tag: 'session-full',
    },
    good_time: {
      title: '✅ เวลาดี — เข้าใช้ Claude ได้เลย',
      body: 'Server load ต่ำตอนนี้ — เหมาะสำหรับใช้งาน Claude',
      tag: 'good-time',
    },
  };

  try {
    await webpush.sendNotification(record.subscription, JSON.stringify(payloadMap[type]));
    res.json({ ok: true });
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      await Promise.allSettled([
        redis.del(`sub:${endpointHash}`),
        redis.del(`pairing:${pairingCode}`),
      ]);
    }
    res.status(500).json({ error: 'Push failed' });
  }
}
