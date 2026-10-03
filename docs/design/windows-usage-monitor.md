# Windows AI Usage Monitor — review draft

Status: design approved; an Electron development implementation now exists in `desktop-app`. See its README for connector evidence and remaining release gates. The design prototype below remains a mock.

## Confirmed requirements
- Windows desktop app, cute minimal white/grey UI with small colour accents.
- Compact and Detail modes. Compact shows every account and 5h, Weekly, plus Claude Fable separately.
- Brand logo beside model name and an additional mascot. Exact accent colours and mascot artwork await user choice. Prototype icons are labelled placeholders, not official logos.
- Switch used/remaining percentages; optional always-on-top.
- Multiple accounts identified by email. Merge web and CLI into one account card only after provider-issued identity is verified; email alone is not a sufficient identity key.
- Detect and add accounts automatically where supported, plus Add account/Sign in. List connected channels. Never sum a shared quota across channels.
- User-configurable refresh interval and manual refresh, subject to provider backoff/limits.
- Per-account/per-quota percentage alerts and reset alerts, configurable. Internal thresholds use percent used regardless of display mode. Deduplicate by account, quota and reset cycle.
- If usage cannot be read, show “อ่านข้อมูลไม่ได้”, retry/reconnect, and no manual substitute. Historical data must be explicitly marked stale and excluded from fresh alerts.
- Manual launch. Close exits the whole app immediately, cancels timers and stops alerts. No background tray residency or autostart.

## Evidence and feasibility
| Item | Evidence | Conclusion |
| --- | --- | --- |
| Claude 5h/weekly | Existing popup.js labels five_hour and seven_day; background.js calls /api/organizations/{orgId}/usage with browser-session cookies | Existing implementation evidence only, not proof of a supported public API or Windows connectivity |
| Other Claude quotas | popup.js accepts objects containing utilization and reads resets_at | Preserve unknown quota keys; do not hard-code a closed model list |
| Fable | User explicitly requested this separate Claude quota; no confirming schema in checkout | Keep the requested label in design. Verify actual provider field and reset cycle before mapping live data |
| Codex | No connector in checkout | Research provider documentation and supported authenticated interfaces before implementation |
| Current online research | Git and HTTPS failed to connect to configured proxy port 8080 during this task | Network blocker, not evidence of missing credentials or provider access denial |
| Windows sign-in/detection | Existing app is a Chrome extension, not a desktop app | Investigate supported local client interfaces. Do not promise importing arbitrary browser sessions |

No existing authenticated state or credential files were read or reused. Do not extract browser passwords/cookies to bypass an unsupported sign-in mechanism.

## Proposed data contract (review draft)
ProviderAccount: provider, providerAccountId, email, channels[], connectionState.
Quota: rawProviderKey, displayName, scope (account/product/model/shared), modelIds[], usedPercent nullable, resetAt nullable, windowMinutes nullable, observedAt, sourceChannel, readState.
ModelCatalogEntry: provider, productId, providerModelId, displayName, availability, sharedQuotaIds.
Model availability and quota visibility are separate: do not infer all available models from quota fields. Preserve response keys and distinguish unavailable, unsupported and unreadable.
Use UTC timestamps internally and Asia/Bangkok for display. A reset timestamp alone must not manufacture a zero-percent usage reading. A percentage bar is used only when an authoritative percentage exists.

## Phases and acceptance gates
1. Source discovery: verify Codex and Claude schemas, identity, model catalog, auth/session lifecycle and Fable mapping. Record supported/unsupported/unknown. No live connector implementation until this evidence exists.
2. UI review: static prototype with visible demo labels. Demonstrate both modes, every account, used/remaining switch, unreadable state, alert controls and reconnect affordance. User chooses final accents, mascot and brand assets.
3. Windows technical spike: choose desktop framework after auth constraints are known. Electron/TypeScript is a candidate, not a final decision. Verify native pinning, secure Windows credential storage and shutdown; keep renderer isolated from credentials.
4. Connectors and identity: implement supported sign-in/detection only; merge verified identities, preserve quota scopes and all supplied model/product metadata. Validate against the same account’s source UI.
5. Refresh/alerts: schedule per provider, honour retry-after, persist preferences without credentials, deduplicate alerts, disable alerts for stale/unreadable data.
6. Packaging: Windows installer and checks for multiple accounts, auth expiry, missing quota, offline mode, DPI scaling, keyboard navigation, actual always-on-top and close-to-exit. Current Linux prototype cannot establish these native capabilities.

## Decisions still requiring user input/evidence
- Final accent colours, mascot style and official brand-asset source.
- What interface currently shows the requested Fable quota and its source field.
- Supported sign-in/data paths for each service and Windows client; no guess is recorded as confirmed.
- Supported Windows version and installer/distribution choice, before packaging.

## Review prototype
Serve the checkout locally and open /desktop-prototype/index.html internally. This is a browser design mock, not a desktop app. Pin, sign-in, reconnect, close and refresh explicitly report prototype limitations. No real data is fetched or credentials accepted. Alert and refresh settings are editable mock preferences only.
