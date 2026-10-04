import {
  app,
  BrowserWindow,
  ipcMain,
  Notification,
  shell,
  session,
  clipboard,
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
  retryAt,
} from "./domain.mjs";
import { archiveAccount, restoreAccount, defaultProfiles, archivedAccounts, aggregateAccounts } from "./profiles.mjs";
const dir = path.dirname(fileURLToPath(import.meta.url));
if (process.env.AI_USAGE_USER_DATA_DIR)
  app.setPath("userData", path.resolve(process.env.AI_USAGE_USER_DATA_DIR));
let win,
  timer,
  store,
  busy = false,
  refreshQueued = false,
  closing = false;
const clients = new Map(),
  accounts = new Map(),
  logins = new Set(),
  loginProfiles = new WeakMap(),
  alerts = new AlertEngine();
const retries = new Map();
let writes = Promise.resolve();
let settings = validSettings({}),
  profiles = [],
  removedProfiles = [];
const snapshot = () => ({ settings, accounts: [...accounts.values()], removedAccounts: archivedAccounts(removedProfiles), busy });
async function persist(change = () => ({})) {
  let committed;
  writes = writes.catch(() => {}).then(async () => {
    const plan = change();
    const next = {
      settings: plan.settings || settings,
      profiles: plan.profiles || profiles,
      removedProfiles: plan.removedProfiles || removedProfiles,
    };
    await writeFile(store + ".tmp", JSON.stringify(next, null, 2));
    await rename(store + ".tmp", store);
    // Apply only after disk commit: failures leave the live account list intact.
    settings = next.settings;
    profiles = next.profiles;
    removedProfiles = next.removedProfiles;
    committed = plan;
  });
  await writes;
  return committed;
}
function broadcast() {
  if (!closing) win?.webContents.send("updated", snapshot());
}
function schedule() {
  clearInterval(timer);
  timer = setInterval(() => refresh(), settings.interval * 60000);
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
    cliLoginRequired: p.provider === "Claude" && p.kind === "cli",
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
        retries.set(p.id, retryAt(response.headers.get("retry-after")));
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
      retries.set(p.id, retryAt(e.retryAfter));
    }
    a.state = "unreadable";
  }
  return a;
}
async function refresh() {
  if (closing) return snapshot();
  if (busy) { refreshQueued = true; return snapshot(); }
  busy = true;
  broadcast();
  try {
    const results = [];
    for (const p of [...profiles]) {
      if (closing) break;
      const a = await loadAccount(p);
      a.sourceProfiles = [p.id];
      results.push([p.id, a]);
    }
    // A deletion may happen while a provider request is in flight.
    // Aggregate only profiles that are still being monitored after all awaits.
    const next = aggregateAccounts(results, profiles);
    accounts.clear();
    for (const [id, a] of next) {
      accounts.set(id, a);
      if (!closing) for (const event of alerts.evaluate(a, settings))
        if (Notification.isSupported()) new Notification(event).show();
    }
  } finally {
    busy = false;
    broadcast();
    if (refreshQueued && !closing) { refreshQueued = false; setImmediate(() => refresh()); }
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
    loginProfiles.set(w, p.id);
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
      loginProfiles.set(child, p.id);
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
    const stored = (p) => p && ["Codex", "Claude"].includes(p.provider) && typeof p.id === "string";
    removedProfiles = (Array.isArray(s.removedProfiles) ? s.removedProfiles : []).filter(p => stored(p) && typeof p.removedAccountId === "string");
    profiles = (Array.isArray(s.profiles) ? s.profiles : []).filter(
      stored,
    );
  } catch {}
  profiles = defaultProfiles(profiles, removedProfiles);
  win = new BrowserWindow({
    icon: path.join(dir, "assets", "app.ico"),
    width: 470,
    height: 680,
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
    await persist(() => ({ settings: validSettings(s) }));
    win.setAlwaysOnTop(settings.pin);
    schedule();
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
    await persist(() => ({ profiles: [...profiles, p] }));
    try {
      await signIn(p);
    } finally {
      await refresh();
    }
    return snapshot();
  });
  ipcMain.handle("copy-cli-login", () => { clipboard.writeText("claude auth login"); });
  ipcMain.handle("remove", async (_, id) => {
    const plan = await persist(() => archiveAccount(profiles, removedProfiles, accounts.get(id)));
    accounts.delete(id);
    for (const p of plan.removed) {
      clients.get(p.id)?.stop();
      clients.delete(p.id);
      retries.delete(p.id);
      for (const w of logins) if (loginProfiles.get(w) === p.id && !w.isDestroyed()) w.destroy();
    }
    broadcast();
    return snapshot();
  });
  ipcMain.handle("restore", async (_, id) => {
    await persist(() => restoreAccount(profiles, removedProfiles, id));
    await refresh();
    broadcast();
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
