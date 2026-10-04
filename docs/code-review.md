# Code review and bug audit — 2026-10-04

Scope: desktop connectors, account aggregation, notifications/settings, Electron isolation/IPC, relocated extension manifests, legacy usage extension and push endpoint validation. Dependency audit covers both lockfiles. This is source review with regression tests; no live provider accounts or deployed push services were used.

## Confirmed findings and fixes

| Priority | Trigger / previous result | Fix and evidence |
| --- | --- | --- |
| P1 | A failed Codex initialize leaves the subprocess open; a late old-process exit can clear a replacement connection | Stop the failed connection and ignore stale process events/responses; fake subprocess timeout/retry regression |
| P1 | A second channel for the same verified identity replaces the first channel's distinct quotas and models | Union by quota/model ID; prefer the latest readable channel for shared quota values, preserve email, evaluate alerts after aggregation; merge regression |
| P1 | Legacy push allowlist admits HTTP subdomains of approved providers, and accepts custom ports/URL credentials | Require HTTPS, approved host, default port and no credentials; endpoint rejection regression |
| P2 | Claude limits contain null or non-string model fields and parsing discards otherwise valid usage | Guard optional fields and keep valid 5h/scoped limits; malformed-schema regression |
| P2 | CLI Retry-After is an HTTP date or absent and backoff becomes only one minute | Common parser for CLI/web accepting seconds/date and a five-minute fallback; clock-controlled regression |
| P2 | Legacy usage extension supplies a forbidden Cookie header without credentials inclusion | Browser-managed credentials: include, no manual cookie header, reject redirects; mocked service-worker fetch regression |
| P2 | Legacy extension reports Pin success although Chrome windows.update does not accept alwaysOnTop | Disable the UI control, return unsupported from the old message endpoint and remove invalid window updates; message regression |

`validSettings(null)` now safely returns defaults. No usage values or shared quota percentages are fabricated or added together.

## Dependency audit

Desktop build tools contained high-severity GHSA-ch52-4w7c-c8xp in http-cache-semantics 4.2.0. Updated only that lockfile dependency to 4.3.0 with install scripts disabled. It is a development dependency, excluded from the packaged source file list. After the update both npm audits report zero known vulnerabilities; this does not establish absence of unreported vulnerabilities.

## Verification and remaining limits

- Full desktop test suite: 17 passed, one native Windows test skipped on Linux. Includes real-CSP Chromium rendering and six added regression cases.
- Syntax checks on edited JavaScript and git diff whitespace validation pass.
- Relocated extension manifest entry points/assets remain valid; Windows workflow paths now include shared validation and the legacy extension exercised by tests.
- Live Codex/Claude sign-in, provider schema stability, Windows notifications/native process cleanup and deployed Redis/QStash/Web Push remain unverified in this environment.
- Existing downloaded 0.2.0 executables predate these source fixes; obtain a new build from the updated Windows workflow after it succeeds. Native CI success has not been verified here.
- Legacy Chrome pinning is unavailable; native pinning remains implemented in the desktop app.
