import test from "node:test";
import assert from "node:assert/strict";
import {
  codexQuotas,
  claudeQuotas,
  AlertEngine,
  validSettings,
} from "../src/domain.mjs";
test("Codex multi-bucket preserves model aliases and does not double-count legacy view", () => {
  const q = codexQuotas({
    rateLimits: { primary: { usedPercent: 99 } },
    rateLimitsByLimitId: {
      codex: {
        normalModelSlug: "actual-model",
        primary: { usedPercent: 28, windowDurationMins: 300, resetsAt: 100 },
        secondary: { usedPercent: 62, windowDurationMins: 10080 },
      },
    },
  });
  assert.equal(q.length, 2);
  assert.equal(q[0].used, 28);
  assert.equal(q[0].model, "actual-model");
  assert.equal(q[0].resetAt, 100000);
  assert.equal(q[1].label, "Weekly");
});
test("Claude preserves unknown quota keys and invalid values do not become zero", () => {
  const q = claudeQuotas({
    five_hour: { utilization: 40, resets_at: "bad" },
    new_model: { utilization: "20" },
    seven_day: { utilization: 0 },
    extra_usage: { enabled: true },
  });
  assert.equal(q.length, 3);
  assert.equal(q[1].label, "new_model");
  assert.equal(q[1].used, null);
  assert.equal(q[0].resetAt, null);
  assert.equal(q[2].used, 0);
});
test("Alerts separate accounts/quotas, deduplicate, ignore unreadable data, confirm resets from a fresh next cycle", () => {
  const e = new AlertEngine(),
    a = {
      id: "a",
      provider: "Codex",
      email: "a@example.com",
      state: "connected",
      quotas: [{ id: "5h", label: "5h", used: 85, resetAt: 1000 }],
    },
    s = { alerts: { "a/5h": { enabled: true, threshold: 80, reset: true } } };
  assert.equal(e.evaluate(a, s, 500).length, 1);
  assert.equal(e.evaluate(a, s, 600).length, 0);
  assert.equal(e.evaluate({ ...a, state: "unreadable" }, s, 1200).length, 0);
  assert.equal(e.evaluate(a, s, 1200).length, 0);
  assert.equal(
    e.evaluate(
      { ...a, quotas: [{ ...a.quotas[0], used: 2, resetAt: 5000 }] },
      s,
      1200,
    ).length,
    1,
  );
  assert.equal(e.evaluate({ ...a, id: "b" }, s, 1200).length, 0);
});
test("settings reject malformed thresholds and clamp intervals", () => {
  const s = validSettings({
    interval: 0,
    alerts: { bad: { threshold: 101 }, ok: { threshold: 95, enabled: true } },
  });
  assert.equal(s.interval, 1);
  assert.equal(Object.keys(s.alerts).length, 1);
});
