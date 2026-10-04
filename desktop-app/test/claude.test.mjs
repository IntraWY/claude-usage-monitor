import test from "node:test";
import assert from "node:assert/strict";
import { claudeQuotas, AlertEngine } from "../src/domain.mjs";
import { readCLIAccount, profileMetadata } from "../src/claude.mjs";
test("Fable scoped window remains separate from Weekly, preserves its exact name and deduplicates IDs", () => {
  const scoped = {
    kind: "weekly_scoped",
    group: "weekly",
    percent: 35,
    resets_at: "2026-10-10T00:00:00Z",
    is_active: true,
    scope: { model: { id: "fable-promotional", display_name: "Fable" } },
  };
  const q = claudeQuotas({
    five_hour: { utilization: 12 },
    seven_day: { utilization: 40 },
    limits: [
      scoped,
      scoped,
      {
        ...scoped,
        scope: { model: { id: "all-models", display_name: "All models" } },
      },
    ],
  });
  assert.deepEqual(
    q.map((x) => x.label),
    ["5h", "Weekly", "Fable"],
  );
  assert.equal(q[2].used, 35);
  assert.equal(q[2].model, "Fable");
});
test("Inactive and malformed scoped quotas never trigger threshold notifications", () => {
  const q = claudeQuotas({
    limits: [
      {
        kind: "weekly_scoped",
        group: "weekly",
        percent: 95,
        is_active: false,
        scope: { model: { id: "fable", display_name: "Fable" } },
      },
    ],
  });
  const a = { id: "a", provider: "Claude", state: "connected", quotas: q };
  assert.equal(q[0].active, false);
  assert.deepEqual(
    new AlertEngine().evaluate(a, {
      alerts: { "a/scoped:fable": { threshold: 80, enabled: true } },
    }),
    [],
  );
});
test("Claude profile email and user identity are distinct from organization identity", () => {
  const meta = profileMetadata({
    account: { uuid: "user-1", email_address: "person@example.com" },
    organization: { uuid: "org-1" },
  });
  assert.equal(meta.userId, "user-1");
  assert.equal(meta.orgId, "org-1");
  assert.equal(meta.email, "person@example.com");
  assert.equal(
    profileMetadata({ email_address: "person@example.com" }, "org-1").userId,
    null,
  );
});
test("CLI token remains in fetch headers only, destination cannot redirect, metadata is returned without credentials", async () => {
  const calls = [];
  const result = await readCLIAccount({
    configDir: "/test",
    read: async () =>
      JSON.stringify({ claudeAiOauth: { accessToken: "test-fixture-token" } }),
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () =>
          url.endsWith("/profile")
            ? {
                account: { uuid: "user", email_address: "person@example.com" },
                organization: { uuid: "org" },
              }
            : { five_hour: { utilization: 12 } },
      };
    },
  });
  assert.equal(calls.length, 2);
  assert.ok(
    calls.every(
      (x) =>
        x.url.startsWith("https://api.anthropic.com/api/oauth/") &&
        x.options.redirect === "error",
    ),
  );
  assert.equal(result.metadata.email, "person@example.com");
  assert.ok(!JSON.stringify(result).includes("test-fixture-token"));
});
test("Missing CLI credentials returns no account and expired credentials never make a request", async () => {
  assert.equal(
    await readCLIAccount({
      read: async () => {
        const e = new Error();
        e.code = "ENOENT";
        throw e;
      },
    }),
    null,
  );
  await assert.rejects(
    readCLIAccount({
      read: async () =>
        JSON.stringify({
          claudeAiOauth: { accessToken: "fixture", expiresAt: 1 },
        }),
      fetcher: () => {
        throw new Error("must not fetch");
      },
    }),
    /หมดอายุ/,
  );
});

test("Profile scope failure preserves readable usage without manufacturing an identity", async () => {
  const result = await readCLIAccount({
    read: async () =>
      JSON.stringify({ claudeAiOauth: { accessToken: "fixture" } }),
    fetcher: async (url) =>
      url.endsWith("/usage")
        ? { ok: true, json: async () => ({ five_hour: { utilization: 22 } }) }
        : { ok: false, status: 403, headers: { get: () => null } },
  });
  assert.equal(result.usage.five_hour.utilization, 22);
  assert.equal(result.metadata.userId, null);
});
