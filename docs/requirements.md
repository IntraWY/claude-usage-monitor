# Product requirements

AI Usage Monitor is a Windows 11 desktop application for Codex and Claude subscription usage.

- White/grey minimal interface, small colour accents, brand logo beside model names and mascot artwork.
- Compact and Detail modes. Show every account with its email and connected channels.
- Show 5h, Weekly and Claude Fable scoped quota together when returned by the provider.
- Switch between used and remaining percentages. Optional always-on-top.
- Detect supported local CLI accounts automatically and add isolated web sign-in profiles.
- Combine verified user/workspace identities across channels without summing shared quotas. Email alone is insufficient for identity merging.
- Configurable refresh interval and manual refresh. Honour service backoff.
- Independently configurable threshold and reset alerts per account/quota.
- Display unreadable/unavailable states and reconnect; no manually substituted or invented usage.
- Manual launch; close exits immediately and stops all refresh/notification work.

See [implementation status](status.md) for what is implemented, verified and still unsupported. Claude quota-derived model names do not establish a complete available-model catalog. Web endpoints are undocumented and require live account validation.
