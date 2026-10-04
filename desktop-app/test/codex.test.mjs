import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { CodexClient } from "../src/codex.mjs";
function fakeChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  return child;
}
test("Failed initialization closes stdin before retry; an old exit cannot clear a new connection", async () => {
  const children = [];
  const client = new CodexClient(null, () => {}, { timeout: 20, spawnProcess: () => {
    const child = fakeChild(); children.push(child); return child;
  }});
  await assert.rejects(client.start(), /ไม่ตอบกลับ/);
  assert.equal(children[0].stdin.destroyed, true);
  assert.equal(client.pending.size, 0);
  const retry = client.start();
  children[0].emit("exit", 1);
  assert.equal(client.process, children[1]);
  children[1].stdout.write(JSON.stringify({id: 2, result: {}}) + "\n");
  await retry;
  assert.equal(client.ready, true);
  client.stop();
});
