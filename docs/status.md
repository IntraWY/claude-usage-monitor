# Desktop implementation status — 0.2.0

## Implemented

Windows Electron application: Compact/Detail, per-account email/channel cards, used/remaining, native pinning, refresh interval, per-quota threshold/reset alerts, immediate close-to-exit and portable EXE packaging.

Codex CLI account discovery, isolated additional login profiles, account/rateLimits/read and paginated model/list are implemented. Only provider-issued identities merge accounts; legacy aggregates are not counted twice.

Claude app-owned web-session login opens the user's exact usage URL: https://claude.ai/chats#settings/usage. Account email is read from /api/account when exposed. Local Claude CLI detection reads its existing credential file only within the main process and requests OAuth usage/profile with redirects disabled. No tokens are stored in preferences, sent to renderer IPC or printed. Expired credentials request CLI re-login; absent profile permission does not discard valid usage.

Fable and other scoped model windows are supported from limits entries: weekly_scoped + weekly + scope.model.display_name. Their percentages, active state and reset timestamps remain separate from Weekly. Unknown data is not replaced with zero. Model list is quota-derived for Claude, not an asserted complete catalog.

Brand SVG assets are included with Simple Icons attribution. Mascot app icon and faces are original UI artwork. Portable build script and a Windows Actions workflow are included.

## Evidence

Ten domain/connector tests pass. A real-CSP Chromium renderer test passes with loaded brand assets, Fable row, percentage switch, retained alert preferences and safe model labels. One native Windows test is skipped on Linux and is configured to run on the Windows CI runner; it checks native pinning, persisted preferences after restart and immediate exit.

Public reference code verified the Fable display-name example and schemas: CodexBar ClaudeOAuthUsageFetcher, ClaudeScopedWeeklyLimitMapper and ClaudeWebAPIFetcher. Implemented from schema evidence; no third-party credential refresh/storage logic was copied. This is evidence of existing undocumented interfaces, not provider stability guarantees.

## Remaining external validation / limitations

- Real account Sign in and live usage comparison on Windows 11.
- Native Windows notifications and credential retention review.
- GitHub Actions run result cannot currently be read through the available GitHub API route (Forbidden); do not claim native tests passed.
- Existing external Chrome sessions cannot be auto-imported; the app supports its own web sessions and locally detected CLI accounts. No encrypted browser cookie extraction is attempted.
- Claude complete model catalogue is not established; only models named by quota data are shown.
- Distribution remains unsigned. No signing credential has been requested or invented.
