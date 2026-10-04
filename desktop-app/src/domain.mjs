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
  const labels = {
    five_hour: "5h",
    seven_day: "Weekly",
    seven_day_sonnet: "Sonnet",
    seven_day_opus: "Opus",
    extra_usage: "Extra usage",
  };
  const flat = Object.entries(data || {}).flatMap(([key, v]) =>
    v && typeof v === "object" && Object.hasOwn(v, "utilization")
      ? [
          {
            id: key,
            label: labels[key] || key,
            product: "Claude",
            model:
              key === "seven_day_sonnet"
                ? "Sonnet"
                : key === "seven_day_opus"
                  ? "Opus"
                  : null,
            used: percent(v.utilization),
            active: v.is_enabled !== false,
            resetAt: Number.isFinite(Date.parse(v.resets_at))
              ? Date.parse(v.resets_at)
              : null,
          },
        ]
      : [],
  );
  const seen = new Set();
  const scoped = (Array.isArray(data?.limits) ? data.limits : []).flatMap(
    (v) => {
      const model = v?.scope?.model,
        name = typeof model?.display_name === "string" ? model.display_name.trim() : null;
      if (
        v?.group !== "weekly" ||
        v.kind !== "weekly_scoped" ||
        !name ||
        name.toLowerCase() === "all models" ||
        (typeof model?.id === "string" && model.id.endsWith("all-models"))
      )
        return [];
      const id = "scoped:" + String(model.id || name);
      if (seen.has(id)) return [];
      seen.add(id);
      return [
        {
          id,
          label: name,
          product: "Claude",
          model: name,
          used: percent(v.percent),
          active: v.is_active !== false,
          resetAt: Number.isFinite(Date.parse(v.resets_at))
            ? Date.parse(v.resets_at)
            : null,
        },
      ];
    },
  );
  return [
    ...flat.filter((q) => !q.model || !scoped.some((x) => x.model === q.model)),
    ...scoped,
  ];
}
export function validSettings(s) {
  s = s && typeof s === "object" ? s : {};
  return {
    mode: "compact",
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
      if (q.active === false) continue;
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

export function retryAt(value, now = Date.now()) {
  const seconds = typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return now + Math.max(60000, Number.isFinite(delay) ? delay : 300000);
}

// Same verified identity: union channels/catalogue, never add shared quota percentages.
export function mergeAccount(previous, current) {
  if (!previous) return current;
  const preferred = current.state === "connected" ? current : previous;
  const other = preferred === current ? previous : current;
  const union = (a, b) => [...new Map([...b, ...a].map((item) => [item.id, item])).values()];
  return {
    ...preferred,
    email: preferred.email || other.email,
    plan: preferred.plan || other.plan,
    channels: [...new Set([...previous.channels, ...current.channels])],
    sourceProfiles: [...new Set([...previous.sourceProfiles, ...current.sourceProfiles])],
    quotas: union(preferred.quotas, other.quotas),
    models: union(preferred.models, other.models),
  };
}
