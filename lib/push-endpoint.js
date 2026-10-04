const hosts = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com", "push.apple.com"];
export function isValidPushEndpoint(endpoint) {
  if (typeof endpoint !== "string") return false;
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      hosts.some((host) => url.hostname === host || url.hostname.endsWith("." + host));
  } catch { return false; }
}
