import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
test(
  "Windows native window, pin, preferences restart and close-to-exit",
  { skip: process.platform !== "win32", timeout: 90000 },
  async () => {
    const { _electron } = await import("playwright");
    const electron = (await import("electron")).default;
    const dir = await mkdtemp(path.join(os.tmpdir(), "ai-usage-test-"));
    const root = fileURLToPath(new URL("..", import.meta.url));
    const options = {
      executablePath: electron,
      args: [root],
      env: {
        ...process.env,
        AI_USAGE_USER_DATA_DIR: dir,
        CODEX_HOME: path.join(dir, "codex"),
        CLAUDE_CONFIG_DIR: path.join(dir, "claude"),
      },
    };
    let app;
    try {
      app = await _electron.launch(options);
      let page = await app.firstWindow();
      await page.waitForSelector("#pin");
      await page.click("#pin");
      await page.waitForFunction(
        () =>
          document.querySelector("#pin").getAttribute("aria-pressed") ===
          "true",
      );
      assert.equal(
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].isAlwaysOnTop(),
        ),
        true,
      );
      await page.click("#detail");
      await page.waitForFunction(
        () => !document.body.classList.contains("compact"),
      );
      const closed = app.waitForEvent("close");
      await page.click("#close");
      await closed;
      app = await _electron.launch(options);
      page = await app.firstWindow();
      await page.waitForFunction(
        () =>
          document.querySelector("#pin").getAttribute("aria-pressed") ===
          "true",
      );
      assert.equal(
        await page
          .locator("body")
          .evaluate((el) => el.classList.contains("compact")),
        false,
      );
    } finally {
      if (app) await app.close().catch(() => {});
      await rm(dir, { recursive: true, force: true });
    }
  },
);
