// POST /api/send-push — called by QStash at scheduled time → send Web Push
import webpush from 'web-push';
import { Redis } from '@upstash/redis';
import { verifySignature } from '@upstash/qstash/nextjs';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Validate VAPID config at cold-start — fail fast if misconfigured
if (!process.env.VAPID_SUBJECT?.startsWith('mailto:')) {
  throw new Error('VAPID_SUBJECT must start with mailto:');
}
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const TH_TZ = 'Asia/Bangkok';

function thFmt(ts) {
  return new Date(ts).toLocaleTimeString('th-TH', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TH_TZ,
  });
}

function buildPayload(body) {
  const { type, pingNum, pingTs, resetTs, mins } = body;
  if (type === 'warn') return {
    title: `⏰ เตรียม Ping ได้เลย! (อีก ${mins} นาที)`,
    body: `Ping ครั้งที่ ${pingNum} เวลา ${thFmt(pingTs)} — เปิด Claude iOS App ไว้รอ`,
    tag: `warn-${pingNum}`,
  };
  if (type === 'ping') return {
    title: '🔔 ถึงเวลา Ping Claude Haiku!',
    body: `Ping ครั้งที่ ${pingNum} — เวลา ${thFmt(pingTs)}\nเปิด Claude → เลือก Haiku → ส่งข้อความ`,
    tag: `ping-${pingNum}`,
  };
  if (type === 'reset') return {
    title: '🔄 Rate Limit Reset แล้ว!',
    body: `รีบเข้าใช้งาน Claude Sonnet/Opus ทันที — Rate limit เริ่มนับใหม่แล้ว ${thFmt(resetTs)}`,
    tag: 'reset',
  };
  return { title: 'Claude Session Optimizer', body: '', tag: 'generic' };
}

// Pages Router handler — receives (req, res) like all other api/* files
async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Upstash-Signature');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { endpointHash } = req.body;
  if (!endpointHash) return res.status(400).json({ error: 'Missing endpointHash' });

  const record = await redis.get(`sub:${endpointHash}`);
  if (!record?.subscription) return res.status(404).json({ error: 'Subscription not found' });

  const payload = buildPayload(req.body);

  try {
    await webpush.sendNotification(record.subscription, JSON.stringify(payload));
    return res.status(200).json({ ok: true });
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      await redis.del(`sub:${endpointHash}`);
      if (record.pairingCode) await redis.del(`pairing:${record.pairingCode}`);
      return res.status(200).json({ ok: true, note: 'subscription expired, removed' });
    }
    console.error('[send-push] webpush error:', err.statusCode, err.body);
    return res.status(500).json({ error: 'Push failed' });
  }
}

// QStash HMAC signature verification — Pages Router adapter
export default verifySignature(handler);
export const config = { api: { bodyParser: false } };
