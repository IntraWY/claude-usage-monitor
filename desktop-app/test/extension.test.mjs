import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
test("Legacy usage extension includes browser cookies and does not claim unsupported native pinning", async () => {
  let listener, request;
  const event = { addListener() {} };
  const chrome = {
    storage: { session: {get: async () => ({}), set: async () => {}} },
    windows: {onRemoved: event}, action: {onClicked: event},
    cookies: { getAll: async () => [{ name: "lastActiveOrg", value: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }] },
    runtime: { onMessage: {addListener(fn) {listener = fn;}} }
  };
  vm.runInNewContext(await readFile(new URL("../../extensions/usage-monitor/background.js", import.meta.url), "utf8"), {
    chrome, AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      request = {url, options};
      return {ok: true, headers: {get: () => "application/json"}, json: async () => ({five_hour: {utilization: 12}})};
    }
  });
  const result = await new Promise(resolve => listener({type: "fetch_usage"}, {}, resolve));
  assert.equal(result.data.five_hour.utilization, 12);
  assert.equal(request.options.credentials, "include");
  assert.equal(request.options.headers, undefined);
  assert.equal(request.options.redirect, "error");
  let pinResult;
  listener({type: "set_always_on_top", value: true}, {}, r => { pinResult = r; });
  assert.equal(pinResult.ok, false);
  assert.equal(pinResult.error, "unsupported_always_on_top");
});
