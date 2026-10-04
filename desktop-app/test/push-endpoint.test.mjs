import test from "node:test";
import assert from "node:assert/strict";
import { isValidPushEndpoint } from "../../lib/push-endpoint.js";
test("Push endpoints require HTTPS, approved hosts and no credentials/custom ports", () => {
  for (const endpoint of ["https://fcm.googleapis.com/send/123", "https://sub.web.push.apple.com/123"])
    assert.equal(isValidPushEndpoint(endpoint), true);
  for (const endpoint of ["http://sub.web.push.apple.com/123", "https://fcm.googleapis.com:8443/123",
    "https://user:password@fcm.googleapis.com/123", "https://fcm.googleapis.com.attacker.test/123", "http://127.0.0.1", null])
    assert.equal(isValidPushEndpoint(endpoint), false);
});
