# Claude Session Optimizer — Essential Redesign

**Date:** 2026-04-22  
**Scope:** UX simplification (both web page + extension) + bug fixes found in code review

---

## Goal

Reduce both implementations from bloated multi-section layouts to clean minimal UIs.  
Users need: Countdown, Reset Calc, Schedule, Notifications — nothing else.

---

## Web Page (`index.html`)

### Before → After

| Before (7 sections) | After (2 cards) |
|---|---|
| Large header + logo | Mini header: title + live clock |
| Notification Banner | Removed (handled by settings inline) |
| Reset Calculator card | → Merged into Card 1 as sub-tab |
| Settings card | → Merged into Card 1 |
| Countdown card | → Top of Card 2 "Live" |
| Schedule List card | → Bottom of Card 2 "Live" |
| Ping Message card | → Small copy icon button only |
| Footer | Removed |

### Card 1 — ตั้งค่า

Three sub-tabs in one card:
- **⏳ เหลืออีก** — hours + minutes remaining until reset
- **🕐 Reset เวลา** — exact reset time picker (24h)
- **📅 เริ่ม Session** — session start time + duration picker

Common fields visible regardless of sub-tab:
- Interval selector (1–6h, default 4h)
- Alert Before selector (5/10/15/20 min)
- "✨ คำนวณ" button (full width, purple gradient)

### Card 2 — Live

Top section:
- Status badge (ok / warn / alert) — right aligned
- `NEXT PING IN` label
- Big countdown digits (60px gradient)
- Sub-line: "Ping ถัดไป HH:MM • #N"

Middle section:
- Progress bar (session start → end) with dots for each ping

Schedule section:
- Compact rows: `[time chip] [thin bar] [tag]` — no descriptions
- Show all pings; if interval is small (e.g. 1h × 24h = 25 items), list scrolls with `max-height: 240px; overflow-y: auto`

Bottom section (shown only after calcReset()):
- Divider line
- Inline reset banner: "Session Reset HH:MM" ↔ "Countdown HH:MM:SS"

### Removed Elements

- `logo-wrap` (72px icon)
- `.header .sub` description text
- `.notif-banner` (replaces with inline notif status in settings area)
- `.tips-box` (how-to instructions)
- `#pingMsg` copy message card (kept as small `📋` icon button at bottom of Card 2)
- `.footer`
- All `.section-title` decorative labels

---

## Extension (`claude-extension/`)

### Before → After

| Before (3 tabs) | After (2 tabs) |
|---|---|
| 🔄 Reset Calc | 🔄 Reset + Live (combined) |
| 📅 Schedule | 📅 Schedule (unchanged structure) |
| ⚙️ ตั้งค่า | ⚙️ gear icon → inline settings panel |

### Tab 1 — Reset + Live

- Sub-tabs: ⏳ เหลืออีก / 🕐 Reset เวลา (same as before)
- Reset form + Calculate button
- Result panel (shown after calc): reset banner + countdown + plan list
- Below result: mini countdown strip (cd-digits + next ping time)

### Tab 2 — Schedule

- Mini countdown card (unchanged)
- Schedule list (unchanged)
- Copy message card (unchanged, stays here)

### Settings (gear icon)

- Gear icon `⚙️` placed in top-right of the extension header bar (next to the clock)
- Click toggles inline settings panel that appears below the header, above the tabs
- Only one panel open at a time; clicking gear again collapses it
- Contains: Start time, Interval, Duration, Alert Before, Save button, Notification status
- Saves to `chrome.storage.local` (unchanged behavior)

---

## Bug Fixes (from code review)

These are included as part of this work:

1. **Timezone bug in `buildThaiDate()`** (`index.html`) — replace `new Date(y,m,d,h,m)` with explicit `+07:00` ISO string (same as `thaiTimeToDate()` in popup.js)
2. **Buddhist Era double-add** in `thDateLabel()` (`index.html`) — use `en-US` locale for year, then `+543`
3. **`refreshAlarms()` silent failure** (`background.js`) — wrap with try/catch and `console.error`
4. **Alert modal no keyboard close** (`index.html`) — add `keydown` listener for Escape key
5. **Schedule list rebuilt every second** (`popup.js`) — split `tickCountdown()`: update digits separately from full list re-render

---

## What Does NOT Change

- Color scheme (purple gradient — kept as-is)
- Core logic: `thaiTimeToDate()`, alarm registration, `chrome.storage`, notification flow
- Extension manifest
- `background.js` alarm/notification behavior (only adds error handling)

---

## Implementation Order

1. Fix bugs in `index.html` (timezone, Buddhist Era)
2. Redesign `index.html` layout (2 cards)
3. Fix `background.js` (error handling)
4. Fix `popup.js` (countdown split, reduce DOM rebuilds)
5. Redesign `popup.html` + `popup.css` (2 tabs + gear settings)
6. Verify both versions work correctly end-to-end
