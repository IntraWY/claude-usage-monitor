import {
  app,
  BrowserWindow,
  ipcMain,
  Notification,
  shell,
  session,
} from "electron";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  readCLIAccount,
  profileMetadata,
  CLAUDE_USAGE_PAGE,
} from "./claude.mjs";
import { CodexClient } from "./codex.mjs";
import {
  codexQuotas,
  claudeQuotas,
  validSettings,
  AlertEngine,
} from "./domain.mjs";
const dir = path.dirname(fileURLToPath(import.meta.url));
if (process.env.AI_USAGE_USER_DATA_DIR)
  app.setPath("userData", path.resolve(process.env.AI_USAGE_USER_DATA_DIR));
let win,
  timer,
  store,
  busy = false,
  closing = false;
const clients = new Map(),
  accounts = new Map(),
  logins = new Set(),
  alerts = new AlertEngine();
const retries = new Map();
let writes = Promise.resolve();
let settings = validSettings({}),
  profiles = [];
const snapshot = () => ({ settings, accounts: [...accounts.values()], busy });
async function persist() {
  const contents = JSON.stringify({ settings, profiles }, null, 2);
  writes = writes
    .catch(() => {})
    .then(async () => {
      await writeFile(store + ".tmp", contents);
      await rename(store + ".tmp", store);
    });
  await writes;
}
function broadcast() {
  if (!closing) win?.webContents.send("updated", snapshot());
}
function schedule() {
  clearInterval(timer);
  timer = setInterval(() => refresh(), settings.interval * 60000);
}
function dimensions() {
  win?.setMinimumSize(settings.mode === "compact" ? 430 : 720, 400);
  win?.setSize(settings.mode === "compact" ? 470 : 800, 800);
}
async function codex(profile) {
  let client = clients.get(profile.id);
  if (!client) {
    client = new CodexClient(profile.home, (event) => {
      if (
        !closing &&
        [
          "account/login/completed",
          "account/updated",
          "account/rateLimits/updated",
        ].includes(event.method)
      )
        setTimeout(() => refresh(), 500);
    });
    clients.set(profile.id, client);
  }
  await client.start();
  return client;
}
async function loadAccount(p) {
  const a = {
    id: p.id,
    provider: p.provider,
    channels: p.home
      ? ["Sign in ผ่านเว็บ (โปรไฟล์แอป)"]
      : p.provider === "Codex" || p.kind === "cli"
        ? ["CLI"]
        : ["เว็บ (โปรไฟล์แอป)"],
    state: "unreadable",
    email: null,
    quotas: [],
    models: [],
    observedAt: null,
  };
  try {
    if ((retries.get(p.id) || 0) > Date.now())
      throw new Error("บริการจำกัดคำขอ — รอช่วงเวลาที่กำหนดก่อนลองใหม่");
    if (p.provider === "Codex") {
      const c = await codex(p);
      const result = await c.request("account/read", { refreshToken: false });
      if (!result.account) {
        a.state = "signed-out";
        a.message = "ยังไม่ได้เข้าสู่ระบบ";
        return a;
      }
      a.email = result.account.email;
      a.plan = result.account.planType;
      const usage = await c.request("account/rateLimits/read");
      a.identity = usage.accountId;
      a.quotas = codexQuotas(usage);
      try {
        let cursor = null;
        const cursors = new Set();
        do {
          if (cursors.has(cursor))
            throw new Error("รายการโมเดลแบ่งหน้าไม่ถูกต้อง");
          cursors.add(cursor);
          const list = await c.request("model/list", {
            cursor,
            includeHidden: true,
          });
          a.models.push(
            ...(list.data || []).map((m) => ({
              id: m.id,
              name: m.displayName || m.model || m.id,
            })),
          );
          cursor = list.nextCursor || null;
        } while (cursor);
      } catch {
        a.catalogError = true;
      }
    } else if (p.kind === "cli") {
      const cli = await readCLIAccount();
      if (!cli) {
        a.state = "signed-out";
        a.message = "ยังไม่พบบัญชี Claude CLI — ใช้ claude auth login";
        return a;
      }
      a.email = cli.metadata.email;
      a.identity = cli.metadata.userId;
      a.workspace = cli.metadata.orgId;
      a.quotas = claudeQuotas(cli.usage);
      a.models = [...new Set(a.quotas.map((q) => q.model).filter(Boolean))].map(
        (name) => ({ id: name, name }),
      );
      a.message = "โมเดลที่แสดงมาจากข้อมูลโควตา ไม่ใช่ catalogue ทั้งหมด";
    } else {
      const s = session.fromPartition(p.partition);
      const cookies = await s.cookies.get({ url: "https://claude.ai" });
      const org = cookies.find((c) => c.name === "lastActiveOrg");
      if (!org) {
        a.state = "signed-out";
        a.message = "เข้าสู่ระบบ Claude ในหน้าต่างของแอป";
        return a;
      }
      if (!/^[0-9a-f-]{8,}$/i.test(org.value))
        throw new Error("ข้อมูลบัญชี Claude ไม่ถูกต้อง");
      const response = await s.fetch(
        `https://claude.ai/api/organizations/${encodeURIComponent(org.value)}/usage`,
        { signal: AbortSignal.timeout(20000), credentials: "include" },
      );
      if (response.status === 429) {
        const value = response.headers.get("retry-after");
        const delay =
          value && Number.isFinite(Number(value))
            ? Number(value) * 1000
            : Date.parse(value) - Date.now();
        retries.set(
          p.id,
          Date.now() + Math.max(60000, Number.isFinite(delay) ? delay : 300000),
        );
      }
      if (!response.ok)
        throw new Error(
          response.status === 429
            ? "บริการจำกัดคำขอ — รอรอบถัดไป"
            : "Claude ไม่อนุญาตให้อ่านข้อมูล — เชื่อมต่อใหม่",
        );
      a.quotas = claudeQuotas(await response.json());
      a.workspace = org.value;
      try {
        const r = await s.fetch("https://claude.ai/api/account", {
          credentials: "include",
          signal: AbortSignal.timeout(15000),
        });
        if (r.ok) {
          const meta = profileMetadata(await r.json(), org.value);
          a.email = meta.email;
          a.identity = meta.userId;
          a.plan = meta.plan;
        }
      } catch {}
      a.models = [...new Set(a.quotas.map((q) => q.model).filter(Boolean))].map(
        (name) => ({ id: name, name }),
      );
      a.message = "โมเดลที่แสดงมาจากข้อมูลโควตา ไม่ใช่ catalogue ทั้งหมด";
    }
    a.state = a.quotas.length ? "connected" : "unreadable";
    a.observedAt = Date.now();
    if (!a.quotas.length) a.message = "อ่านข้อมูลไม่ได้ — ไม่พบโควตาที่รองรับ";
  } catch (e) {
    a.message = e.message;
    if (e.status === 429) {
      const wait = Number(e.retryAfter);
      retries.set(
        p.id,
        Date.now() +
          Math.max(60000, Number.isFinite(wait) ? wait * 1000 : 300000),
      );
    }
    a.state = "unreadable";
  }
  return a;
}
async function refresh() {
  if (busy || closing) return snapshot();
  busy = true;
  broadcast();
  try {
    const next = new Map();
    for (const p of profiles) {
      if (closing) break;
      const a = await loadAccount(p);
      a.sourceProfiles = [p.id];
      if (a.identity) {
        a.id =
          a.provider === "Codex"
            ? `${a.provider}:${a.identity}`
            : `${a.provider}:${a.identity}:${a.workspace || ""}`;
        const previous = next.get(a.id);
        if (previous) {
          a.channels = [...new Set([...previous.channels, ...a.channels])];
          a.sourceProfiles = [...previous.sourceProfiles, p.id];
        }
      }
      next.set(a.id, a);
      for (const event of alerts.evaluate(a, settings))
        if (Notification.isSupported()) new Notification(event).show();
    }
    accounts.clear();
    for (const [id, a] of next) accounts.set(id, a);
  } finally {
    busy = false;
    broadcast();
  }
  return snapshot();
}
async function signIn(p) {
  if (p.provider === "Codex") {
    const c = await codex(p);
    const r = await c.request("account/login/start", { type: "chatgpt" });
    const u = new URL(r.authUrl);
    if (u.protocol !== "https:" || u.hostname !== "auth.openai.com")
      throw new Error("URL เข้าสู่ระบบไม่อยู่ในโดเมนที่อนุญาต");
    await shell.openExternal(u.href);
  } else {
    if (p.kind === "cli")
      throw new Error("ใช้ claude auth login ใน terminal แล้วกดรีเฟรช");
    const w = new BrowserWindow({
      width: 1000,
      height: 800,
      webPreferences: {
        partition: p.partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    logins.add(w);
    w.webContents.setWindowOpenHandler(({ url }) => {
      try {
        if (new URL(url).protocol !== "https:") return { action: "deny" };
      } catch {
        return { action: "deny" };
      }
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          webPreferences: {
            partition: p.partition,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
          },
        },
      };
    });
    w.webContents.on("did-create-window", (child) => {
      logins.add(child);
      child.on("closed", () => {
        logins.delete(child);
        refresh();
      });
      child.webContents.on("will-navigate", (event, url) => {
        try {
          if (new URL(url).protocol !== "https:") event.preventDefault();
        } catch {
          event.preventDefault();
        }
      });
    });
    w.webContents.on("will-navigate", (event, url) => {
      try {
        if (new URL(url).protocol !== "https:") event.preventDefault();
      } catch {
        event.preventDefault();
      }
    });
    w.on("closed", () => {
      logins.delete(w);
      refresh();
    });
    await w.loadURL(CLAUDE_USAGE_PAGE);
  }
}
app.whenReady().then(async () => {
  if (process.platform === "win32")
    app.setAppUserModelId("com.intrawy.aiusagemonitor");
  store = path.join(app.getPath("userData"), "preferences.json");
  try {
    const s = JSON.parse(await readFile(store, "utf8"));
    settings = validSettings(s.settings || {});
    profiles = (s.profiles || []).filter(
      (p) =>
        ["Codex", "Claude"].includes(p.provider) && typeof p.id === "string",
    );
  } catch {}
  if (!profiles.some((p) => p.id === "codex-local"))
    profiles.unshift({ id: "codex-local", provider: "Codex" });
  if (!profiles.some((p) => p.id === "claude-local"))
    profiles.unshift({ id: "claude-local", provider: "Claude", kind: "cli" });
  win = new BrowserWindow({
    icon: path.join(dir, "assets", "app.ico"),
    width: settings.mode === "compact" ? 470 : 800,
    height: 800,
    minWidth: 430,
    minHeight: 400,
    backgroundColor: "#fafbfc",
    webPreferences: {
      preload: path.join(dir, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.setAlwaysOnTop(settings.pin);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.on("closed", () => app.quit());
  ipcMain.handle("read", () => snapshot());
  ipcMain.handle("refresh", () => refresh());
  ipcMain.handle("save", async (_, s) => {
    settings = validSettings(s);
    win.setAlwaysOnTop(settings.pin);
    dimensions();
    schedule();
    await persist();
    return snapshot();
  });
  ipcMain.handle("add", async (_, provider) => {
    if (!["Codex", "Claude"].includes(provider))
      throw new Error("บริการไม่ถูกต้อง");
    const id = randomUUID(),
      p = { id, provider };
    if (provider === "Codex") {
      p.home = path.join(app.getPath("userData"), "codex-profiles", id);
      await mkdir(p.home, { recursive: true });
    } else p.partition = `persist:claude-${id}`;
    profiles.push(p);
    await persist();
    try {
      await signIn(p);
    } finally {
      await refresh();
    }
    return snapshot();
  });
  ipcMain.handle("reconnect", async (_, id) => {
    const source = accounts.get(id)?.sourceProfiles?.[0] || id;
    const p = profiles.find((p) => p.id === source);
    if (!p) throw new Error("ไม่พบบัญชี");
    await signIn(p);
    return snapshot();
  });
  ipcMain.on("close", () => app.quit());
  await win.loadFile(path.join(dir, "index.html"));
  schedule();
  await refresh();
});
app.on("before-quit", () => {
  closing = true;
  clearInterval(timer);
  for (const c of clients.values()) c.stop();
  for (const w of logins) if (!w.isDestroyed()) w.destroy();
});
app.on("window-all-closed", () => app.quit());
