import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
export class CodexClient {
  constructor(home, onEvent = () => {}, { spawnProcess = spawn, timeout = 20000 } = {}) {
    this.spawnProcess = spawnProcess;
    this.timeout = timeout;
    this.home = home;
    this.onEvent = onEvent;
    this.seq = 0;
    this.pending = new Map();
  }
  async start() {
    if (this.ready) return;
    if (this.starting) return this.starting;
    this.starting = this.connect()
      .then(() => {
        this.ready = true;
      })
      .catch((error) => {
        this.stop();
        throw error;
      })
      .finally(() => {
        this.starting = null;
      });
    return this.starting;
  }
  async connect() {
    const windows = process.platform === "win32";
    // The official npm installation supplies codex.cmd on Windows.
    // This shell command is constant; no user data is interpolated.
    const child = this.process = this.spawnProcess(
      windows ? "cmd.exe" : "codex",
      windows ? ["/d", "/s", "/c", "codex app-server"] : ["app-server"],
      {
        env: {
          ...process.env,
          ...(this.home ? { CODEX_HOME: this.home } : {}),
        },
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.process.stderr.on("data", () => {});
    child.stdin.on("error", () => {
      if (this.process === child) this.fail("การเชื่อมต่อ Codex หยุดทำงาน");
    });
    child.on("error", () => {
      if (this.process === child) this.fail("ไม่พบ Codex CLI — ติดตั้ง Codex และเพิ่มลง PATH");
    });
    child.on("exit", () => {
      if (this.process !== child) return;
      this.ready = false;
      this.process = null;
      this.fail("Codex app-server หยุดทำงาน");
    });
    createInterface({ input: this.process.stdout }).on("line", (line) => {
      if (this.process !== child) return;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.id !== undefined) {
        const item = this.pending.get(msg.id);
        if (item) {
          clearTimeout(item.timer);
          this.pending.delete(msg.id);
          msg.error
            ? item.reject(new Error("Codex ปฏิเสธคำขอหรือยังไม่เชื่อมต่อ"))
            : item.resolve(msg.result);
        }
      } else if (msg.method) this.onEvent(msg);
    });
    await this.request("initialize", {
      clientInfo: { name: "ai_usage_monitor", version: "0.3.0" },
    });
    this.process.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
  }
  request(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Codex ไม่ตอบกลับภายในเวลาที่กำหนด"));
      }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      if (!this.process?.stdin?.writable) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error("Codex ยังไม่เริ่มทำงาน"));
        return;
      }
      this.process.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  fail(message) {
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error(message));
    }
    this.pending.clear();
  }
  stop() {
    this.ready = false;
    this.fail("โปรแกรมปิดแล้ว");
    const child = this.process;
    this.process = null;
    if (child) {
      child.stdin.destroy();
      if (!Number.isInteger(child.pid)) return;
      if (process.platform === "win32") {
        spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        }).on("error", () => child.kill());
      } else {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill();
        }
      }
    }
  }
}
