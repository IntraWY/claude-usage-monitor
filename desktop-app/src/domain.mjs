export function percent(value) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
    ? value
    : null;
}
export function windowLabel(mins) {
  return mins === 300
    ? "5h"
    : mins === 10080
      ? "Weekly"
      : mins
        ? `${mins} นาที`
        : "รอบไม่ระบุ";
}
export function codexQuotas(response) {
  const buckets =
    response.rateLimitsByLimitId &&
    Object.keys(response.rateLimitsByLimitId).length
      ? response.rateLimitsByLimitId
      : { codex: response.rateLimits };
  return Object.entries(buckets).flatMap(([key, b]) =>
    ["primary", "secondary"].flatMap((slot) => {
      const w = b?.[slot];
      return w
        ? [
            {
              id: `${key}:${slot}`,
              label: windowLabel(w.windowDurationMins),
              product: b.limitName || key,
              model: b.normalModelSlug || null,
              used: percent(w.usedPercent),
              resetAt: Number.isFinite(w.resetsAt) ? w.resetsAt * 1000 : null,
            },
          ]
        : [];
    }),
  );
}
export function claudeQuotas(data) {
  return Object.entries(data).flatMap(([key, v]) =>
    v && typeof v === "object" && Object.hasOwn(v, "utilization")
      ? [
          {
            id: key,
            label:
              key === "five_hour" ? "5h" : key === "seven_day" ? "Weekly" : key,
            product: "Claude",
            model: null,
            used: percent(v.utilization),
            resetAt: Number.isFinite(Date.parse(v.resets_at))
              ? Date.parse(v.resets_at)
              : null,
          },
        ]
      : [],
  );
}
export function validSettings(s) {
  return {
    mode: s.mode === "detail" ? "detail" : "compact",
    remaining: s.remaining === true,
    pin: s.pin === true,
    interval: Number.isFinite(s.interval)
      ? Math.max(1, Math.min(1440, s.interval))
      : 5,
    alerts: Object.fromEntries(
      Object.entries(s.alerts || {})
        .filter(
          ([k, v]) =>
            k.length < 300 &&
            v &&
            Number.isFinite(v.threshold) &&
            v.threshold >= 1 &&
            v.threshold <= 100,
        )
        .map(([k, v]) => [
          k,
          {
            threshold: v.threshold,
            enabled: v.enabled === true,
            reset: v.reset === true,
          },
        ]),
    ),
  };
}
export class AlertEngine {
  constructor() {
    this.sent = new Set();
    this.previous = new Map();
  }
  evaluate(account, settings, now = Date.now()) {
    if (account.state !== "connected") return [];
    const events = [];
    for (const q of account.quotas) {
      const key = `${account.id}/${q.id}`,
        cfg = settings.alerts[key],
        prev = this.previous.get(key);
      if (cfg && q.used !== null) {
        const cycle = `${key}:${q.resetAt ?? "unknown"}`;
        if (cfg.enabled && q.used >= cfg.threshold) {
          const id = `${cycle}:high:${cfg.threshold}`;
          if (!this.sent.has(id)) {
            events.push({
              title: `${account.provider} ใกล้หมด`,
              body: `${account.email || "บัญชีไม่ระบุอีเมล"} · ${q.label} ใช้แล้ว ${q.used}%`,
            });
            this.sent.add(id);
          }
        }
        if (
          cfg.reset &&
          prev?.resetAt &&
          prev.resetAt <= now &&
          q.resetAt &&
          q.resetAt > prev.resetAt
        ) {
          const id = `${key}:${prev.resetAt}:reset`;
          if (!this.sent.has(id)) {
            events.push({
              title: `${account.provider} รีเซ็ตแล้ว`,
              body: `${account.email || "บัญชีไม่ระบุอีเมล"} · ${q.label}`,
            });
            this.sent.add(id);
          }
        }
      }
      this.previous.set(key, { resetAt: q.resetAt });
    }
    return events;
  }
}
