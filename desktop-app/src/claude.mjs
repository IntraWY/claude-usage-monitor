import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
export const CLAUDE_USAGE_PAGE = "https://claude.ai/chats#settings/usage";
export function profileMetadata(data, orgId) {
  const nested = data?.account || data || {};
  const membership = (data?.memberships || []).find(
    (m) => m.organization?.uuid === orgId,
  );
  return {
    email: nested.email_address || nested.emailAddress || nested.email || null,
    userId: nested.uuid || data?.account_uuid || null,
    orgId: data?.organization?.uuid || data?.organization_uuid || orgId || null,
    plan: membership?.organization?.rate_limit_tier || null,
  };
}
export async function readCLIAccount({
  read = readFile,
  fetcher = fetch,
  configDir = process.env.CLAUDE_CONFIG_DIR ||
    path.join(os.homedir(), ".claude"),
} = {}) {
  let auth;
  try {
    auth = JSON.parse(
      await read(path.join(configDir, ".credentials.json"), "utf8"),
    ).claudeAiOauth;
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw new Error("อ่านข้อมูลเข้าสู่ระบบ Claude CLI ไม่ได้");
  }
  if (!auth?.accessToken) return null;
  if (Number.isFinite(auth.expiresAt) && auth.expiresAt <= Date.now())
    throw new Error(
      "Claude CLI session หมดอายุ — เข้าสู่ระบบใหม่ด้วย claude auth login",
    );
  const headers = {
    Authorization: `Bearer ${auth.accessToken}`,
    Accept: "application/json",
    "anthropic-beta": "oauth-2025-04-20",
  };
  const request = async (endpoint) => {
    let response;
    try {
      response = await fetcher(
        `https://api.anthropic.com/api/oauth/${endpoint}`,
        { headers, redirect: "error", signal: AbortSignal.timeout(20000) },
      );
    } catch {
      throw new Error("เชื่อมต่อ Claude CLI usage ไม่ได้");
    }
    if (!response.ok) {
      const e = new Error(
        response.status === 429
          ? "Claude จำกัดคำขอ — รอรอบถัดไป"
          : response.status === 401
            ? "Claude CLI session หมดอายุ — เข้าสู่ระบบใหม่"
            : "อ่านข้อมูล Claude CLI ไม่ได้",
      );
      e.retryAfter = response.headers.get("retry-after");
      e.status = response.status;
      throw e;
    }
    return response.json();
  };
  const usage = await request("usage");
  // Older credentials can expose usage without the user:profile scope.
  // An unavailable identity must not discard a valid usage snapshot.
  let metadata = profileMetadata({});
  try {
    metadata = profileMetadata(await request("profile"));
  } catch {}
  return { metadata, usage };
}
