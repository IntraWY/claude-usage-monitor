# AI Usage Monitor — Windows 11 development beta

Electron application with Compact/Detail, multiple account cards, brand logos and mascots, used/remaining switch, configurable refresh and per-quota alerts. Closing exits immediately; no background tray service or autostart.

## Run / build

```powershell
cd desktop-app
npm ci
npm test
npm start
npm run portable:win
```

The single-file executable is `dist/AI Usage Monitor 0.2.0.exe`. For an installer built on Windows use `npm run installer:win`; ZIP packaging remains available with `npm run package:win`. The development executable is unsigned. Codex accounts require a current official Codex CLI in PATH. Claude web profiles work independently of that CLI.

## Accounts and quotas

- Codex: detect the CLI account with app-server; add separate app-owned login profiles; read all metered buckets and paginated model catalog. 5h/Weekly labels are used only for provider-reported 300/10080-minute windows. Shared legacy aggregates are not counted twice.
- Claude web: each added account has its own app-owned session; open https://claude.ai/chats#settings/usage for login and source comparison. Read usage via the organization route and email/user metadata via `/api/account`. If metadata is unavailable, display unknown; the organization ID is never used as a person ID.
- Claude CLI: detect the standard `.claude/.credentials.json` (or `CLAUDE_CONFIG_DIR`) and use its existing OAuth access token only for `https://api.anthropic.com/api/oauth/usage` and `/profile`. No refresh token is copied or written, no credentials are sent to the renderer, and redirects are disabled. If expired, instruct the user to run `claude auth login`. Profile-scope failure does not discard a valid usage response.
- Claude scoped models: preserve `limits` with `kind: weekly_scoped`, `group: weekly`, and `scope.model.display_name`, including Fable when returned. Fable has a separate card row and alert setting from Weekly. Deduplicate repeated model IDs; preserve invalid percentages as unknown and inactive limits as unavailable. Older Sonnet/Opus fields are supported without relabelling them Fable.
- Merge web/CLI only when provider user ID and workspace identity are verified. Email alone never establishes identity. No quota summing across sources.
- Claude models displayed are those exposed in quota scope data; this is not a guarantee of a complete model catalog. Existing external Chrome sessions cannot currently be imported automatically; no browser credential decryption is attempted.

## Validation

Ten domain/connector tests pass on the cloud machine. Renderer checks pass for both modes, percentage conversion, per-quota preferences, escaped labels and pin/exit IPC. OAuth tests use artificial credentials and injected transports, never personal accounts. An isolated real Codex app-server startup/account-read check passed.

`.github/workflows/windows-desktop.yml` runs on Windows: dependency install, domain tests, native Electron window/pin/preferences-restart/exit test, portable build and artifact upload. Native Windows and real account sign-in checks cannot be claimed as passed until the runner/user reports results.

## Source evidence and remaining limits

Claude schema evidence: public CodexBar `ClaudeOAuthUsageFetcher`, `ClaudeScopedWeeklyLimitMapper` and `ClaudeWebAPIFetcher` sources, including the Fable model display-name example. These are implementation evidence, not a promise that Claude's undocumented routes remain stable. Keep HTTP 429 backoff and show unreadable state on failures.

Brand icons are Simple Icons CC0 assets with attribution in `src/assets/ATTRIBUTION.txt`; brand marks remain trademarks. Mascot icon/face artwork is original.

Remaining validation: live sign-in/quotas, Windows notifications and credential retention. Missing data is never replaced with fake numbers. Complete Claude model catalog, arbitrary external-browser auto-detection and a signed public distribution remain unsupported.
