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
  "Actual CSP/assets with Compact/Detail, Fable scoped row, percent conversion and safe labels",
  { skip: !available, timeout: 30000 },
  async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({
      executablePath: "/usr/bin/chromium",
      headless: true,
    });
    try {
      const page = await browser.newPage();
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
            mode: "compact",
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
          close: () => {},
          onUpdate: () => {},
        };
      });
      await page.goto("https://app.test/index.html");
      await page.waitForSelector(".card");
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
      await page.click("#detail");
      assert.equal(
        await page.locator("[data-field=threshold]:visible").count(),
        3,
      );
      await page.locator("[data-field=threshold]").last().fill("95");
      await page
        .locator("[data-field=threshold]")
        .last()
        .dispatchEvent("change");
      await page.click("#used");
      assert.equal(
        await page.locator("[data-field=threshold]").last().inputValue(),
        "95",
      );
      assert.equal(await page.locator(".model img[src=x]").count(), 0);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
