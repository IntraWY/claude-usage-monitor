import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
let available = process.platform === "linux";
try {
  await access("/usr/bin/chromium");
} catch {
  available = false;
}
test(
  "Minimal UI: quota settings, deletion/cancel/restore, Fable, safe errors and labels",
  { skip: !available, timeout: 30000 },
  async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({
      executablePath: "/usr/bin/chromium",
      headless: true,
    });
    try {
      const page = await browser.newPage({ viewport: {width: 470, height: 680} });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const root = fileURLToPath(new URL("../src/", import.meta.url));
      await page.route("https://app.test/**", async (route) => {
        const name = new URL(route.request().url()).pathname.slice(1);
        const file = path.resolve(root, name);
        assert.ok(file.startsWith(root));
        const mime = name.endsWith(".css")
          ? "text/css"
          : name.endsWith(".js")
            ? "text/javascript"
            : name.endsWith(".svg")
              ? "image/svg+xml"
              : "text/html";
        await route.fulfill({ body: await readFile(file), contentType: mime });
      });
      await page.addInitScript(() => {
        const snapshot = {
          settings: {
            mode: "detail",
            pin: false,
            remaining: false,
            interval: 5,
            alerts: {},
          },
          accounts: [
            {
              id: "test-user",
              provider: "Claude",
              email: "test@example.com",
              channels: ["เว็บ", "CLI"],
              state: "connected",
              observedAt: Date.now(),
              quotas: [
                { id: "five_hour", label: "5h", used: 12 },
                { id: "seven_day", label: "Weekly", used: 40 },
                {
                  id: "scoped:fable",
                  label: "Fable",
                  model: "Fable",
                  used: 35,
                },
              ],
              models: [
                { name: "Fable" },
                { name: "<img src=x onerror=alert(1)>" },
              ],
            },
          ],
          busy: false,
          removedAccounts: [],
        };
        window.usage = {
          read: async () => snapshot,
          save: async (settings) => {
            snapshot.settings = settings;
            return snapshot;
          },
          refresh: async () => snapshot,
          add: async () => snapshot,
          reconnect: async () => snapshot,
          remove: async (id) => {
            window.lastRemoved = id;
            const a = snapshot.accounts.find(a => a.id === id);
            snapshot.removedAccounts = [{id: a.id, provider: a.provider, email: a.email}];
            window.archivedAccount = a;
            snapshot.accounts = snapshot.accounts.filter(a => a.id !== id);
            return snapshot;
          },
          restore: async () => {
            snapshot.accounts = [window.archivedAccount];
            snapshot.removedAccounts = [];
            return snapshot;
          },
          copyCLILogin: async () => { window.copiedCLI = true; },
          close: () => {},
          onUpdate: () => {},
        };
      });
      await page.goto("https://app.test/index.html");
      await page.waitForSelector(".card");
      if (process.env.AI_USAGE_SCREENSHOT) await page.screenshot({ path: process.env.AI_USAGE_SCREENSHOT, fullPage: true });
      assert.equal(await page.locator(".quota").count(), 3);
      assert.equal(
        await page
          .locator(".brand img")
          .evaluate((img) => img.complete && img.naturalWidth > 0),
        true,
      );
      assert.equal(
        await page.locator("progress").last().getAttribute("value"),
        "35",
      );
      await page.click("#remaining");
      assert.equal(
        await page.locator("progress").last().getAttribute("value"),
        "65",
      );
      assert.equal(await page.locator("#detail").count(), 0);
      assert.equal(await page.locator("[data-field=threshold]:visible").count(), 0);
      await page.click("[data-settings]");
      assert.equal(
        await page.locator("[data-field=threshold]:visible").count(),
        3,
      );
      await page.locator("[data-field=threshold]").last().fill("95");
      await page
        .locator("[data-field=threshold]")
        .last()
        .dispatchEvent("change");
      await page.click("[data-close-dialog]");
      await page.click("#used");
      await page.click("[data-settings]");
      assert.equal(
        await page.locator("[data-field=threshold]").last().inputValue(),
        "95",
      );
      await page.locator(".catalogue summary").click();
      assert.equal(await page.locator(".model img[src=x]").count(), 0);
      await page.click("[data-close-dialog]");
      await page.click("[data-remove]");
      await page.click("[data-cancel-delete]");
      assert.equal(await page.locator(".card").count(), 1);
      assert.equal(await page.evaluate(() => window.lastRemoved), undefined);
      await page.evaluate(() => {
        window.originalRemove = window.usage.remove;
        window.usage.remove = async () => { throw new Error("save failed"); };
        return true;
      });
      await page.click("[data-remove]");
      await page.click("#confirm-delete");
      await page.waitForFunction(() => document.querySelector("#delete-notice").textContent !== "");
      assert.equal(await page.locator(".card").count(), 1);
      assert.equal(await page.locator("#delete-account").evaluate(el => el.open), true);
      await page.evaluate(() => { window.usage.remove = window.originalRemove; });
      await page.click("#confirm-delete");
      await page.waitForSelector(".empty");
      assert.equal(await page.locator(".card").count(), 0);
      await page.click("#settings");
      await page.click("[data-restore]");
      await page.waitForFunction(() => document.querySelectorAll(".card").length === 1);
      await page.click("[data-close-dialog]");
      await page.click("[data-settings]");
      assert.equal(await page.locator("[data-field=threshold]").last().inputValue(), "95");
      await page.click("[data-close-dialog]");
      await page.evaluate(() => {
        window.usage.add = async () => {
          throw new Error("Error invoking remote method 'add': Error: ใช้ claude auth login ใน terminal แล้วกดรีเฟรช; token=must-not-render");
        };
      });
      await page.click("#claude");
      await page.waitForFunction(() => document.querySelector("#notice").textContent === "ใช้ claude auth login ใน terminal แล้วกดรีเฟรช");
      assert.ok(!(await page.locator("#notice").textContent()).includes("must-not-render"));
      await page.evaluate(() => {
        window.usage.add = async () => { throw new Error("unknown transport failure; token=must-not-render"); };
      });
      await page.click("#claude");
      await page.waitForFunction(() => document.querySelector("#notice").textContent === "ทำรายการไม่ได้ — ตรวจการเชื่อมต่อและลองใหม่");
      await page.evaluate(async () => {
        const s = await window.usage.read();
        s.accounts[0].state = "unreadable";
        s.accounts[0].cliLoginRequired = true;
        s.accounts[0].message = "Claude CLI session หมดอายุ";
      });
      await page.click("#refresh");
      await page.click("[data-cli-login]");
      await page.waitForFunction(() => document.querySelector("#notice").textContent.startsWith("คัดลอกแล้ว"));
      assert.equal(await page.evaluate(() => window.copiedCLI), true);
      assert.equal(await page.locator("[data-reconnect]").count(), 0);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
