# AI Usage Monitor for Windows (development build)

This is a real Electron application, separate from the original extension/PWA. It never shows mock usage. Brand letters and mascot faces remain design placeholders; official artwork is not bundled.

## Windows development / packaging

Prerequisites: Node.js 22+ and the official Codex CLI on PATH for Codex accounts. Claude web profiles do not require the Codex CLI.

```powershell
cd desktop-app
npm ci
npm test
npm start
npm run package:win
```

The portable Windows ZIP is written to `dist`; extract it and run `AI Usage Monitor.exe`. To build an NSIS installer on Windows, run `npm run installer:win`. This development build is unsigned and uses Electron’s default executable icon. A Windows build must be tested on Windows before release. Closing the main window exits all app windows, stops refresh/alerts and terminates app-owned Codex processes. There is no tray background process or autostart.

## Connections

- On startup the app asks the installed Codex CLI's app-server to read its current account. It does not read/copy the CLI credential file. Additional Codex accounts get separate app-owned CODEX_HOME profiles; Sign in uses the CLI's account/login/start browser flow. CLI must be recent enough to expose account/read, account/rateLimits/read and model/list.
- Primary/secondary windows are labelled 5h/Weekly only when the provider supplies 300/10080 minutes. All metered buckets are preserved; the legacy aggregate is not counted twice. Model catalog pagination is supported. Accounts with matching provider account IDs merge; emails alone are never used to merge identities.
- Claude opens an app-owned, persistent Chromium session per added account. Close its login window when done to refresh. The connector uses the same organization usage path as the existing extension and its own session's lastActiveOrg cookie. This is an undocumented web route, not a guaranteed public API. Existing external Chrome/Claude CLI accounts cannot currently be auto-imported. No browser credential extraction is implemented.
- Claude's usage response does not establish the signed-in email or complete model catalog. Those fields show unavailable rather than an invented identity. Organization ID identifies the quota workspace, not the individual person; separate Claude profiles are intentionally not merged until a provider-issued user identity can be verified.
- Fable remains an unverified requirement. Unknown provider quota keys are shown verbatim. No other model is relabelled Fable, and no fictitious Fable percentage is shown.

## Settings and alerts

Preferences and non-secret profile descriptors live in Electron userData. Codex manages credentials in each profile; Claude browser sessions are managed by Electron. The app does not put credentials in preferences, renderer IPC or logs. Credentials retained by provider/Chromium storage have not yet undergone Windows security review; do not treat this build as production ready.

Compact/Detail, used/remaining, always-on-top and refresh minutes are persisted. Threshold/reset alert preferences are per verified account/quota. Alerts are off until enabled in Detail; thresholds use percent used even when the display shows remaining. Reset alerts require a fresh new provider reset cycle; elapsed time alone never fabricates usage. Unreadable data produces no alerts.

## Validation status

Domain tests cover multi-bucket quotas, absent/invalid data, per-account alerts, deduplication and reset confirmation. A real Codex app-server protocol check using an empty isolated profile verifies initialization and signed-out handling without using a personal account. Windows sign-in, live account quotas, Claude endpoint accessibility, native notifications/pinning and Windows credential storage require on-device validation.

## Remaining release gates

- Validate login/usage and native notifications on Windows with real accounts. The portable build is a development beta, not a verified release.
- Establish a supported Claude identity/model source, Fable mapping and external browser/CLI detection before claiming all requested integrations work.
- Replace clearly labelled brand/mascot placeholders with user-approved artwork.
- Review Windows credential retention and sign the distribution before public release.
