// POST /api/subscribe — save push subscription + schedule QStash messages
// DELETE /api/subscribe — remove subscription + cancel pending messages
import { Redis } from '@upstash/redis';
import { Client as QStash } from '@upstash/qstash';
import crypto from 'crypto';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const qstash = new QStash({ token: process.env.QSTASH_TOKEN });

const TTL_SEC = 90 * 24 * 60 * 60; // 90 days

function hashEndpoint(endpoint) {
  return crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 16);
}

function generatePairingCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// Validate push endpoint origin — prevent SSRF via webpush.sendNotification
const ALLOWED_PUSH_ORIGINS = [
  'https://fcm.googleapis.com',
  'https://updates.push.services.mozilla.com',
  'https://web.push.apple.com',
  'https://push.apple.com',
];

function isValidPushEndpoint(endpoint) {
  try {
    const { origin } = new URL(endpoint);
    return ALLOWED_PUSH_ORIGINS.some(o => origin === o || origin.endsWith('.' + new URL(o).hostname));
  } catch { return false; }
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'DELETE') return handleUnsubscribe(req, res);
  if (req.method === 'POST')   return handleSubscribe(req, res);
  res.status(405).end();
}

async function handleSubscribe(req, res) {
  const { subscription, pingTimes = [], resetTime, alertBeforeMin = 10 } = req.body;

  // Input validation
  if (!subscription?.endpoint) return res.status(400).json({ error: 'Missing subscription endpoint' });
  if (!isValidPushEndpoint(subscription.endpoint)) return res.status(400).json({ error: 'Invalid push endpoint origin' });
  if (!Array.isArray(pingTimes)) return res.status(400).json({ error: 'pingTimes must be an array' });
  if (pingTimes.length > 50) return res.status(400).json({ error: 'Too many ping times (max 50)' });
  const alertMin = typeof alertBeforeMin === 'number' && alertBeforeMin >= 1 && alertBeforeMin <= 60
    ? alertBeforeMin : 10;

  const endpointHash = hashEndpoint(subscription.endpoint);
  const siteUrl = process.env.SITE_URL;

  // 1. Cancel existing QStash messages
  const existing = await redis.get(`sub:${endpointHash}`);
  if (existing?.qstashIds?.length) {
    const cancelResults = await Promise.allSettled(
      existing.qstashIds.map(id => qstash.messages.delete(id))
    );
    const failed = cancelResults.filter(r => r.status === 'rejected').length;
    if (failed > 0) console.warn(`[subscribe] Failed to cancel ${failed} QStash messages`);
  }

  const pairingCode = existing?.pairingCode || generatePairingCode();
  const now = Date.now();
  const alertMs = alertMin * 60000;
  const newIds = [];

  // 2. Queue new messages — rollback on partial failure
  try {
    for (let i = 0; i < pingTimes.length; i++) {
      const ts = pingTimes[i];
      if (typeof ts !== 'number' || ts <= now) continue;

      const warnTs = ts - alertMs;
      if (warnTs > now) {
        const r = await qstash.publishJSON({
          url: `${siteUrl}/api/send-push`,
          delay: Math.floor((warnTs - now) / 1000),
          body: { endpointHash, type: 'warn', mins: alertMin, pingNum: i + 1, pingTs: ts },
        });
        newIds.push(r.messageId);
      }
      const r = await qstash.publishJSON({
        url: `${siteUrl}/api/send-push`,
        delay: Math.floor((ts - now) / 1000),
        body: { endpointHash, type: 'ping', pingNum: i + 1, pingTs: ts },
      });
      newIds.push(r.messageId);
    }

    if (resetTime && typeof resetTime === 'number' && resetTime > now) {
      const r = await qstash.publishJSON({
        url: `${siteUrl}/api/send-push`,
        delay: Math.floor((resetTime - now) / 1000),
        body: { endpointHash, type: 'reset', resetTs: resetTime },
      });
      newIds.push(r.messageId);
    }
  } catch (err) {
    // Rollback any published messages on failure
    await Promise.allSettled(newIds.map(id => qstash.messages.delete(id).catch(() => {})));
    console.error('[subscribe] QStash publish failed, rolled back:', err.message);
    return res.status(500).json({ error: 'Failed to schedule notifications' });
  }

  // 3. Save to Redis with TTL
  await redis.set(`sub:${endpointHash}`, { subscription, qstashIds: newIds, pairingCode, updatedAt: now }, { ex: TTL_SEC });
  await redis.set(`pairing:${pairingCode}`, endpointHash, { ex: TTL_SEC });

  res.json({ ok: true, pairingCode, queued: newIds.length });
}

async function handleUnsubscribe(req, res) {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });

  const endpointHash = hashEndpoint(endpoint);
  const existing = await redis.get(`sub:${endpointHash}`);

  if (existing) {
    if (existing.qstashIds?.length) {
      await Promise.allSettled(existing.qstashIds.map(id => qstash.messages.delete(id).catch(() => {})));
    }
    if (existing.pairingCode) await redis.del(`pairing:${existing.pairingCode}`);
    await redis.del(`sub:${endpointHash}`);
  }

  res.json({ ok: true });
}
