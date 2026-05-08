# Claude Session Optimizer — Essential Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify both the web page and Chrome extension from cluttered multi-section layouts into clean 2-card / 2-tab interfaces, fixing all bugs found in code review.

**Architecture:** Each file is a self-contained implementation. `index.html` gets a full rewrite (same single-file approach). The extension gets targeted edits to `background.js` and `popup.js`, plus full rewrites of `popup.html` and `popup.css`.

**Tech Stack:** Vanilla HTML/CSS/JS, Chrome Extension MV3, Web Notifications API, Web Audio API

---

## File Map

| File | Change |
|---|---|
| `index.html` | Full rewrite — 2 cards, bug fixes, new JS |
| `claude-extension/background.js` | Edit — add try/catch to `refreshAlarms` |
| `claude-extension/popup.js` | Edit — fix `tickCountdown` perf + add gear toggle |
| `claude-extension/popup.html` | Full rewrite — 2 tabs + gear icon + settings panel |
| `claude-extension/popup.css` | Edit — add gear button + settings panel styles |

---

## Task 1: Fix `background.js` — silent failure in `refreshAlarms`

**Files:**
- Modify: `claude-extension/background.js:52-90`

- [ ] **Step 1: Wrap `refreshAlarms` body in try/catch**

Replace the current `refreshAlarms` function with:

```javascript
async function refreshAlarms() {
    try {
        const { pingTimes, resetTime, alertBeforeMin } = await chrome.storage.local.get([
            'pingTimes', 'resetTime', 'alertBeforeMin'
        ]);

        await chrome.alarms.clearAll();

        const now = Date.now();
        const alertMs = (alertBeforeMin || 10) * 60000;

        if (Array.isArray(pingTimes)) {
            pingTimes.forEach((ts, i) => {
                if (ts <= now) return;
                const timeStr = thFmt(ts);
                const num = i + 1;
                const warnTs = ts - alertMs;
                if (warnTs > now) {
                    chrome.alarms.create(
                        JSON.stringify({ type: 'warn', mins: alertBeforeMin || 10, time: timeStr, num }),
                        { when: warnTs }
                    );
                }
                chrome.alarms.create(
                    JSON.stringify({ type: 'ping', time: timeStr, num }),
                    { when: ts }
                );
            });
        }

        if (resetTime && resetTime > now) {
            chrome.alarms.create(
                JSON.stringify({ type: 'reset', time: thFmt(resetTime) }),
                { when: resetTime }
            );
        }
    } catch (err) {
        console.error('[refreshAlarms] failed:', err);
    }
}
```

- [ ] **Step 2: Verify file looks correct**

Open `claude-extension/background.js` and confirm the function starts with `try {` and ends with `} catch (err) { console.error(...) }`.

- [ ] **Step 3: Commit**

```bash
git add "claude-extension/background.js"
git commit -m "fix: add error handling to refreshAlarms in background.js"
```

---

## Task 2: Fix `popup.js` — `tickCountdown` rebuilds DOM every second

**Files:**
- Modify: `claude-extension/popup.js:14-18` (add `lastNextIdx` state variable)
- Modify: `claude-extension/popup.js:272-313` (the `tickCountdown` function)

- [ ] **Step 1: Add `lastNextIdx` state variable**

In `popup.js`, at the top of the STATE section (after line 15 `let resetTimer = null;`), add:

```javascript
let lastNextIdx = -2;   // tracks previous nextIdx to avoid redundant list re-renders
```

- [ ] **Step 2: Replace `tickCountdown` to skip `renderScheduleTab` when `nextIdx` unchanged**

Replace the entire `tickCountdown` function (lines 272–313) with:

```javascript
function tickCountdown() {
    if (!pings.length) return;
    const now = Date.now();
    const alertMin = parseInt(document.getElementById('alertBefore').value);
    const nextIdx  = pings.findIndex(ts => ts > now);

    // Update progress bar
    const total   = sessionEnd - sessionBase;
    const elapsed = now - sessionBase;
    const pct = total > 0 ? Math.min(100, Math.max(0, (elapsed / total) * 100)) : 0;
    document.getElementById('prog-fill').style.width = pct + '%';

    // Update dot classes
    document.querySelectorAll('.prog-dot').forEach((dot, i) => {
        dot.className = 'prog-dot' +
            (pings[i] < now ? ' done' : i === nextIdx ? ' next' : '');
    });

    // Re-render schedule list only when the active ping changes (not every second)
    if (nextIdx !== lastNextIdx) {
        lastNextIdx = nextIdx;
        renderScheduleTab();
    }

    if (nextIdx === -1) {
        document.getElementById('cd-digits').textContent    = '00:00:00';
        document.getElementById('cd-label').textContent     = 'Session เสร็จสิ้นแล้ว';
        document.getElementById('cd-next-time').textContent = '--';
        return;
    }

    const diff = pings[nextIdx] - now;
    const mins = diff / 60000;

    document.getElementById('cd-digits').textContent    = msFmtCd(diff);
    document.getElementById('cd-next-time').textContent = thFmt(new Date(pings[nextIdx]));
    document.getElementById('cd-next-num').textContent  = '#' + (nextIdx + 1);

    if (mins <= 1) {
        document.getElementById('cd-label').textContent = '⚡ ถึงเวลา Ping เดี๋ยวนี้!';
    } else if (mins <= alertMin) {
        document.getElementById('cd-label').textContent = `⏰ เตรียม Ping — อีก ${Math.ceil(mins)} นาที`;
    } else {
        document.getElementById('cd-label').textContent = 'เวลาที่เหลือก่อน Ping ถัดไป';
    }
}
```

- [ ] **Step 3: Reset `lastNextIdx` whenever `saveAndCalc` runs**

In `saveAndCalc()` (around line 185), before calling `startCountdown()`, add:

```javascript
lastNextIdx = -2; // force re-render on next tick
```

- [ ] **Step 4: Add gear toggle function**

Add this function anywhere in `popup.js` before the `DOMContentLoaded` listener:

```javascript
function toggleSettings() {
    const panel = document.getElementById('settings-panel');
    const btn   = document.getElementById('gear-btn');
    const open  = panel.classList.toggle('hidden');
    btn.classList.toggle('active', !open);
}
```

- [ ] **Step 5: Wire gear button in `DOMContentLoaded`**

Inside the `DOMContentLoaded` listener, add:

```javascript
document.getElementById('gear-btn').addEventListener('click', toggleSettings);
```

- [ ] **Step 6: Commit**

```bash
git add "claude-extension/popup.js"
git commit -m "perf: skip DOM re-render in tickCountdown when nextIdx unchanged; add gear toggle"
```

---

## Task 3: Rewrite `popup.html` — 2 tabs + gear icon + inline settings panel

**Files:**
- Rewrite: `claude-extension/popup.html`

- [ ] **Step 1: Replace `popup.html` with the new 2-tab structure**

```html
<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Claude Session Optimizer</title>
    <link rel="stylesheet" href="popup.css">
</head>
<body>

<!-- Header -->
<div class="header">
    <div class="logo">🤖</div>
    <div class="header-center">
        <div class="clock" id="clock">--:--:--</div>
        <div class="date-str" id="dateStr">--</div>
    </div>
    <button class="gear-btn" id="gear-btn" title="ตั้งค่า / Settings">⚙️</button>
</div>

<!-- Settings Panel (hidden by default, toggled by gear button) -->
<div id="settings-panel" class="settings-panel hidden">
    <div class="field">
        <label>🕐 เริ่ม Session เวลา (24h)</label>
        <div class="time-row">
            <select id="startH"></select>
            <span class="colon">:</span>
            <select id="startMin"></select>
        </div>
    </div>
    <div class="row2">
        <div class="field">
            <label>⏱ Interval</label>
            <select id="pingInterval">
                <option value="1">1 ชม.</option>
                <option value="2">2 ชม.</option>
                <option value="3">3 ชม.</option>
                <option value="4" selected>4 ชม. ✓</option>
                <option value="5">5 ชม.</option>
                <option value="6">6 ชม.</option>
            </select>
        </div>
        <div class="field">
            <label>📅 Duration</label>
            <select id="sessionDuration">
                <option value="12">12h</option>
                <option value="24" selected>24h ✓</option>
                <option value="48">48h</option>
            </select>
        </div>
    </div>
    <div class="field">
        <label>⚡ แจ้งล่วงหน้า</label>
        <select id="alertBefore">
            <option value="5">5 นาที</option>
            <option value="10" selected>10 นาที ✓</option>
            <option value="15">15 นาที</option>
            <option value="20">20 นาที</option>
        </select>
    </div>
    <button class="btn-primary" id="btn-save">💾 บันทึก &amp; คำนวณ</button>
    <div class="notif-status" id="notif-status">
        <span id="notif-icon">🔔</span>
        <span id="notif-text">กำลังตรวจสอบ Notifications...</span>
        <button class="btn-notif" id="btn-notif">เปิดใช้</button>
    </div>
</div>

<!-- Tabs -->
<div class="tabs">
    <button class="tab active" data-tab="reset">🔄 Reset Calc</button>
    <button class="tab" data-tab="schedule">📅 Schedule</button>
</div>

<!-- ───────── TAB: RESET CALC ───────── -->
<div class="tab-panel active" id="panel-reset">

    <p class="hint">เห็น <strong>"resets in X hours"</strong> ใน Claude? กรอกได้เลย</p>

    <div class="sub-tabs">
        <button class="stab active" id="stab-remain">⏳ เหลืออีก</button>
        <button class="stab" id="stab-exact">🕐 Reset เวลา</button>
    </div>

    <div id="mode-remain">
        <div class="row2">
            <div class="field">
                <label>ชั่วโมง</label>
                <select id="remH"></select>
            </div>
            <div class="field">
                <label>นาที</label>
                <select id="remM"></select>
            </div>
        </div>
    </div>

    <div id="mode-exact" class="hidden">
        <div class="field">
            <label>🕐 Reset เวลา (24h)</label>
            <div class="time-row">
                <select id="resetH"></select>
                <span class="colon">:</span>
                <select id="resetMin"></select>
            </div>
        </div>
    </div>

    <button class="btn-primary" id="btn-calc-reset">🔄 คำนวณ Reset Schedule</button>

    <div id="reset-result" class="hidden">
        <div class="divider"></div>
        <div class="reset-banner">
            <div>
                <div class="rb-lbl">Reset เวลา</div>
                <div class="rb-time" id="rb-time">--:--</div>
            </div>
            <div style="text-align:right">
                <div class="rb-lbl">นับถอยหลัง</div>
                <div class="rb-cd" id="rb-cd">--:--:--</div>
            </div>
        </div>
        <div class="plan-list" id="plan-list"></div>
    </div>
</div>

<!-- ───────── TAB: SCHEDULE ───────── -->
<div class="tab-panel hidden" id="panel-schedule">

    <div class="mini-cd-card">
        <div class="mini-cd-label" id="cd-label">เวลาที่เหลือ / Next ping in</div>
        <div class="mini-cd" id="cd-digits">--:--:--</div>
        <div class="mini-next">ถัดไป: <span id="cd-next-time" class="purple-text">--:--</span>
            &nbsp;Ping <span id="cd-next-num" class="purple-text">#-</span></div>
        <div class="prog-bar">
            <div class="prog-fill" id="prog-fill" style="width:0%"></div>
            <div id="prog-dots"></div>
        </div>
        <div class="prog-ends">
            <span id="prog-start">--:--</span>
            <span id="prog-end">--:--</span>
        </div>
    </div>

    <div id="sched-list">
        <div class="empty-hint">ตั้งค่าใน ⚙️ แล้วกดบันทึกก่อนครับ</div>
    </div>

    <div class="copy-card">
        <div class="copy-msg" id="copy-msg">สวัสดีครับ ช่วย ping เพื่อรักษา session ไว้หน่อยนะครับ (Hi Claude! Quick check-in to keep my session active. Using Haiku.)</div>
        <button class="btn-copy" id="btn-copy">📋 คัดลอก / Copy</button>
    </div>
</div>

<script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Verify the file saved correctly**

Confirm `popup.html` has exactly 2 `.tab` buttons (`reset`, `schedule`) and a `#settings-panel` div with `class="settings-panel hidden"`.

- [ ] **Step 3: Commit**

```bash
git add "claude-extension/popup.html"
git commit -m "feat: redesign extension popup to 2 tabs + gear settings panel"
```

---

## Task 4: Update `popup.css` — add gear button + settings panel styles

**Files:**
- Modify: `claude-extension/popup.css`

- [ ] **Step 1: Update `.header` to accommodate center + gear layout**

Replace the existing `.header` block and add `.header-center` + `.gear-btn`:

```css
.header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px 10px;
    background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%);
}
.logo { font-size: 22px; flex-shrink: 0; }
.header-center { flex: 1; }
.clock {
    font-size: 17px;
    font-weight: 800;
    color: #fff;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.5px;
}
.date-str { font-size: 11px; color: rgba(255,255,255,0.75); margin-top: 1px; }

.gear-btn {
    background: rgba(255,255,255,0.15);
    border: 1.5px solid rgba(255,255,255,0.3);
    border-radius: 9px;
    font-size: 16px;
    width: 34px; height: 34px;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.15s;
    flex-shrink: 0;
}
.gear-btn:hover  { background: rgba(255,255,255,0.25); }
.gear-btn.active { background: rgba(255,255,255,0.35); }
```

- [ ] **Step 2: Add `.settings-panel` styles**

Append to `popup.css`:

```css
/* ── Settings Panel ── */
.settings-panel {
    padding: 12px 14px;
    background: #faf5ff;
    border-bottom: 1.5px solid #e9d5ff;
}
.settings-panel .field { margin-bottom: 10px; }
.settings-panel .btn-primary { margin-top: 2px; }
```

- [ ] **Step 3: Remove the now-unused `.header-right` rule**

Delete the line:

```css
.header-right { text-align: right; }
```

- [ ] **Step 4: Verify visually**

Load the extension in Chrome (`chrome://extensions` → Load unpacked). Open the popup. Confirm:
- Header shows logo | clock+date | gear icon
- Gear icon click shows/hides the settings panel
- Two tabs: "🔄 Reset Calc" and "📅 Schedule"

- [ ] **Step 5: Commit**

```bash
git add "claude-extension/popup.css"
git commit -m "feat: add gear button and settings panel styles to extension popup"
```

---

## Task 5: Rewrite `index.html` — 2-card layout + all bug fixes

**Files:**
- Rewrite: `index.html`

This task rewrites the entire file. The new version:
- Fixes timezone bug (`thaiTimeToDate` with explicit `+07:00`)
- Fixes Buddhist Era double-add (uses `en-US` locale for year)
- Adds Escape key + ARIA to alert modal
- Adds clipboard fallback in `copyMsg`
- Combines Reset Calc + Settings into Card 1 (3 sub-tabs)
- Combines Countdown + Schedule + Reset strip into Card 2

- [ ] **Step 1: Replace `index.html` with the new version**

```html
<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Claude Session Optimizer</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }

        :root {
            --purple: #7c3aed;
            --purple-light: #a855f7;
            --pink: #ec4899;
            --text: #1e1b4b;
            --muted: #6b7280;
            --dim: #9ca3af;
            --green: #059669;
            --yellow: #d97706;
            --red: #dc2626;
            --bg: #f4f4f8;
            --card: #ffffff;
        }

        body {
            font-family: -apple-system, 'Segoe UI', 'Noto Sans Thai', sans-serif;
            background: var(--bg);
            color: var(--text);
            min-height: 100vh;
        }

        body::before {
            content: '';
            display: block;
            height: 4px;
            background: linear-gradient(90deg, var(--purple), var(--purple-light), var(--pink));
            position: fixed;
            top: 0; left: 0; right: 0;
            z-index: 100;
        }

        .container { max-width: 680px; margin: 0 auto; padding: 16px 14px 40px; }

        /* ── Mini Header ── */
        .mini-header {
            display: flex; align-items: center; justify-content: space-between;
            padding: 18px 0 14px;
        }
        .mini-title { font-size: 14px; font-weight: 800; color: var(--purple); }
        .mini-clock {
            font-size: 14px; font-weight: 700; color: var(--muted);
            font-variant-numeric: tabular-nums;
            background: var(--card); border: 1px solid #e5e7eb;
            border-radius: 8px; padding: 4px 10px;
        }

        /* ── Card ── */
        .card {
            background: var(--card);
            border: 1px solid rgba(124,58,237,0.12);
            border-radius: 18px; padding: 16px 18px; margin-bottom: 12px;
            box-shadow: 0 2px 12px rgba(124,58,237,0.07);
        }

        /* ── Setup Card ── */
        .subtab-row { display: flex; gap: 6px; margin-bottom: 14px; }
        .stab {
            flex: 1; padding: 8px 4px;
            border: 1.5px solid #e5e7eb; border-radius: 10px;
            background: #f9fafb; color: var(--dim);
            font-size: 11px; font-weight: 600; cursor: pointer; transition: all 0.15s;
        }
        .stab.active { background: #f3e8ff; border-color: #d8b4fe; color: var(--purple); }
        .stab:hover:not(.active) { background: #f3f4f6; color: var(--muted); }

        .mode-hidden { display: none; }

        .field-row { display: flex; gap: 10px; }
        .field { flex: 1; margin-bottom: 10px; }
        label { display: block; font-size: 11px; color: var(--dim); font-weight: 600; margin-bottom: 4px; }

        select {
            width: 100%; background: #f9f9fc;
            border: 1.5px solid #e5e7eb; border-radius: 10px;
            padding: 9px 12px; color: var(--text); font-size: 13px;
            outline: none; transition: border-color 0.2s; appearance: auto;
        }
        select:focus { border-color: var(--purple); box-shadow: 0 0 0 3px rgba(124,58,237,0.1); }

        .time-row { display: flex; align-items: center; gap: 6px; }
        .time-row select { flex: 1; text-align: center; font-weight: 700; font-variant-numeric: tabular-nums; }
        .colon { font-size: 18px; font-weight: 800; color: var(--purple); padding-bottom: 1px; }

        .btn-primary {
            width: 100%; padding: 12px;
            background: linear-gradient(135deg, var(--purple), var(--purple-light));
            color: #fff; border: none; border-radius: 12px;
            font-size: 14px; font-weight: 700; cursor: pointer;
            box-shadow: 0 4px 14px rgba(124,58,237,0.25);
            transition: all 0.2s; margin-top: 4px;
        }
        .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(124,58,237,0.35); }
        .btn-primary:active { transform: translateY(0); }

        /* ── Live Card ── */
        .live-top {
            display: flex; justify-content: space-between;
            align-items: center; margin-bottom: 12px;
        }
        .cd-label { font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: var(--dim); }

        .status-badge {
            display: inline-flex; align-items: center; gap: 6px;
            padding: 5px 12px; border-radius: 100px;
            font-size: 11.5px; font-weight: 600;
        }
        .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
        .s-ok    { background: #ecfdf5; color: var(--green); border: 1.5px solid #a7f3d0; }
        .s-warn  { background: #fffbeb; color: var(--yellow); border: 1.5px solid #fde68a; }
        .s-alert { background: #fef2f2; color: var(--red); border: 1.5px solid #fecaca; animation: pulseBadge 1.2s ease-in-out infinite; }
        @keyframes pulseBadge { 0%,100%{opacity:1} 50%{opacity:0.6} }

        .cd-digits {
            font-size: 58px; font-weight: 900; line-height: 1;
            letter-spacing: -2px; font-variant-numeric: tabular-nums;
            background: linear-gradient(135deg, var(--purple), var(--purple-light), var(--pink));
            -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
            text-align: center; margin-bottom: 8px;
        }
        @media (max-width: 500px) { .cd-digits { font-size: 42px; } }

        .cd-sub { text-align: center; font-size: 13px; color: var(--muted); margin-bottom: 16px; }
        .purple { color: var(--purple); font-weight: 700; font-size: 15px; }

        .prog-bar {
            height: 6px; background: #f3f4f6; border-radius: 100px;
            border: 1px solid #e5e7eb; position: relative; overflow: visible; margin-bottom: 4px;
        }
        .prog-fill {
            position: absolute; left: 0; top: 0; bottom: 0;
            background: linear-gradient(90deg, var(--purple), var(--purple-light));
            border-radius: 100px; transition: width 1s linear;
        }
        .prog-dot {
            position: absolute; top: 50%; transform: translate(-50%, -50%);
            width: 10px; height: 10px; border-radius: 50%;
            border: 2px solid var(--bg); background: #c4b5fd; transition: background 0.3s;
        }
        .prog-dot.done { background: #d1d5db; }
        .prog-dot.next { background: var(--purple); box-shadow: 0 0 8px rgba(124,58,237,0.6); animation: dotPulse 1.5s ease-in-out infinite; }
        @keyframes dotPulse { 0%,100%{box-shadow:0 0 5px rgba(124,58,237,0.4)} 50%{box-shadow:0 0 14px rgba(124,58,237,0.8)} }

        .prog-ends { display: flex; justify-content: space-between; font-size: 10px; color: var(--dim); margin-bottom: 14px; }

        .sched-list { max-height: 240px; overflow-y: auto; }
        .sched-list::-webkit-scrollbar { width: 3px; }
        .sched-list::-webkit-scrollbar-thumb { background: #d8b4fe; border-radius: 3px; }

        .sched-item {
            display: flex; align-items: center; gap: 10px;
            padding: 8px 0; border-bottom: 1px solid #f3f4f6;
        }
        .sched-item:last-child { border-bottom: none; }
        .sched-item.is-next {
            background: #faf5ff; border-radius: 10px; padding: 8px 10px;
            margin: 0 -10px; border-bottom: none; border: 1px solid #e9d5ff;
        }
        .s-chip {
            min-width: 52px; padding: 4px 8px; border-radius: 8px;
            font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; text-align: center;
        }
        .chip-past   { background: #f9fafb; color: #d1d5db; }
        .chip-next   { background: #f3e8ff; color: var(--purple); border: 1px solid #d8b4fe; }
        .chip-future { background: #f9fafb; color: var(--muted); }

        .sched-body { flex: 1; }
        .sched-num  { font-size: 12.5px; font-weight: 600; }
        .sched-desc { font-size: 11px; color: var(--dim); margin-top: 1px; }

        .sched-tag { font-size: 10.5px; padding: 3px 8px; border-radius: 100px; font-weight: 700; white-space: nowrap; }
        .tag-done  { background: #ecfdf5; color: var(--green); }
        .tag-next  { background: #f3e8ff; color: var(--purple); }
        .tag-soon  { background: #fffbeb; color: var(--yellow); }
        .tag-later { background: #f9fafb; color: var(--dim); }

        .empty-hint { text-align: center; color: var(--dim); padding: 20px; font-size: 13px; }

        /* Plan items (reset mode) */
        .plan-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px 0; border-bottom: 1px solid #f3f4f6; }
        .plan-item:last-child { border-bottom: none; }
        .plan-icon { width: 30px; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 15px; flex-shrink: 0; }
        .icon-ping  { background: #f3e8ff; }
        .icon-reset { background: #ecfdf5; }
        .icon-work  { background: #eff6ff; }
        .icon-warn  { background: #fffbeb; }
        .plan-body { flex: 1; }
        .plan-time  { font-size: 14px; font-weight: 800; font-variant-numeric: tabular-nums; }
        .plan-title { font-size: 12px; font-weight: 600; color: var(--text); margin-top: 1px; }
        .plan-badge { font-size: 10.5px; padding: 3px 8px; border-radius: 100px; font-weight: 700; white-space: nowrap; align-self: center; flex-shrink: 0; }
        .pb-ping  { background: #f3e8ff; color: var(--purple); }
        .pb-reset { background: #ecfdf5; color: var(--green); }
        .pb-work  { background: #eff6ff; color: #3b82f6; }
        .pb-warn  { background: #fffbeb; color: var(--yellow); }

        /* Reset strip */
        .divider { height: 1px; background: #f3f4f6; margin: 14px 0; }
        .reset-strip {
            display: flex; justify-content: space-between; align-items: center;
            background: linear-gradient(135deg, #f3e8ff, #fdf4ff);
            border: 1.5px solid #d8b4fe; border-radius: 14px; padding: 14px 16px;
        }
        .rb-label { font-size: 10px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px; }
        .rb-time { font-size: 26px; font-weight: 900; color: var(--purple); font-variant-numeric: tabular-nums; }
        .rb-cd {
            font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums;
            background: linear-gradient(135deg, var(--purple), var(--pink));
            -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
        }

        /* Copy button */
        .copy-icon-btn {
            padding: 6px 14px; background: #f3e8ff;
            border: 1.5px solid #d8b4fe; border-radius: 9px;
            color: var(--purple); font-size: 12px; font-weight: 700;
            cursor: pointer; transition: background 0.2s;
        }
        .copy-icon-btn:hover { background: #e9d5ff; }

        /* Alert overlay */
        #alertOverlay {
            display: none; position: fixed; inset: 0;
            background: rgba(109,40,217,0.15); backdrop-filter: blur(6px);
            z-index: 9999; align-items: center; justify-content: center;
        }
        #alertOverlay.show { display: flex; }
        .alert-modal {
            background: #fff; border: 2px solid #d8b4fe; border-radius: 24px;
            padding: 32px 28px; text-align: center; max-width: 360px; width: 90%;
            animation: popIn 0.3s cubic-bezier(0.34,1.56,0.64,1);
            box-shadow: 0 24px 60px rgba(124,58,237,0.25);
        }
        @keyframes popIn { from{transform:scale(0.7);opacity:0} to{transform:scale(1);opacity:1} }
        .alert-icon { font-size: 52px; margin-bottom: 10px; display: block; animation: ringBell 0.6s ease infinite; }
        @keyframes ringBell { 0%,100%{transform:rotate(0)} 15%{transform:rotate(15deg)} 30%{transform:rotate(-12deg)} 45%{transform:rotate(8deg)} 60%{transform:rotate(-5deg)} }
        .alert-title { font-size: 20px; font-weight: 800; color: var(--text); margin-bottom: 6px; }
        .alert-body  { font-size: 13px; color: var(--muted); line-height: 1.6; margin-bottom: 22px; }
        .alert-close {
            padding: 12px 28px; background: linear-gradient(135deg, var(--purple), var(--purple-light));
            color: #fff; border: none; border-radius: 12px;
            font-size: 14px; font-weight: 700; cursor: pointer; width: 100%;
            box-shadow: 0 4px 16px rgba(124,58,237,0.3);
        }
    </style>
</head>
<body>

<!-- Alert Overlay -->
<div id="alertOverlay" role="dialog" aria-modal="true" aria-labelledby="alertTitle">
    <div class="alert-modal">
        <span class="alert-icon" id="alertIcon">🔔</span>
        <div class="alert-title" id="alertTitle">ถึงเวลา Ping แล้ว!</div>
        <div class="alert-body"  id="alertBody">เปิด Claude iOS App → เลือก Haiku → ส่งข้อความ</div>
        <button class="alert-close" id="alertCloseBtn">✅ รับทราบ / Got it!</button>
    </div>
</div>

<div class="container">

    <!-- Mini Header -->
    <div class="mini-header">
        <div class="mini-title">🤖 Claude Session Optimizer</div>
        <div class="mini-clock" id="clock">--:--:--</div>
    </div>

    <!-- CARD 1: SETUP -->
    <div class="card">
        <div class="subtab-row">
            <button class="stab active" id="stab-remain"  onclick="switchMode('remain')">⏳ เหลืออีก</button>
            <button class="stab"        id="stab-exact"   onclick="switchMode('exact')">🕐 Reset เวลา</button>
            <button class="stab"        id="stab-session" onclick="switchMode('session')">📅 Session</button>
        </div>

        <!-- Mode: Remaining until reset -->
        <div id="mode-remain">
            <div class="field-row">
                <div class="field">
                    <label>ชั่วโมง</label>
                    <select id="remH"></select>
                </div>
                <div class="field">
                    <label>นาที</label>
                    <select id="remM"></select>
                </div>
            </div>
        </div>

        <!-- Mode: Exact reset time -->
        <div id="mode-exact" class="mode-hidden">
            <div class="field">
                <label>Reset เวลา (24h)</label>
                <div class="time-row">
                    <select id="resetHour"></select>
                    <span class="colon">:</span>
                    <select id="resetMinute"></select>
                </div>
            </div>
        </div>

        <!-- Mode: Session start -->
        <div id="mode-session" class="mode-hidden">
            <div class="field">
                <label>เริ่ม Session เวลา (24h)</label>
                <div class="time-row">
                    <select id="startHour"></select>
                    <span class="colon">:</span>
                    <select id="startMinute"></select>
                </div>
            </div>
            <div class="field">
                <label>ระยะเวลา Session</label>
                <select id="sessionDuration">
                    <option value="12">12 ชั่วโมง</option>
                    <option value="24" selected>24 ชั่วโมง (1 วัน)</option>
                    <option value="48">48 ชั่วโมง (2 วัน)</option>
                </select>
            </div>
        </div>

        <!-- Common settings -->
        <div class="field-row">
            <div class="field">
                <label>Interval</label>
                <select id="pingInterval">
                    <option value="1">ทุก 1 ชม.</option>
                    <option value="2">ทุก 2 ชม.</option>
                    <option value="3">ทุก 3 ชม.</option>
                    <option value="4" selected>ทุก 4 ชม. ✓</option>
                    <option value="5">ทุก 5 ชม.</option>
                    <option value="6">ทุก 6 ชม.</option>
                </select>
            </div>
            <div class="field">
                <label>แจ้งล่วงหน้า</label>
                <select id="alertBefore">
                    <option value="5">5 นาที</option>
                    <option value="10" selected>10 นาที ✓</option>
                    <option value="15">15 นาที</option>
                    <option value="20">20 นาที</option>
                </select>
            </div>
        </div>
        <button class="btn-primary" onclick="doCalc()">✨ คำนวณ</button>
    </div>

    <!-- CARD 2: LIVE -->
    <div class="card">
        <div class="live-top">
            <div class="cd-label" id="cdLabel">NEXT PING IN</div>
            <div class="status-badge s-ok" id="statusBadge">
                <div class="dot"></div>
                <span id="statusText">Session Active</span>
            </div>
        </div>

        <div class="cd-digits" id="cdDigits">--:--:--</div>
        <div class="cd-sub">
            Ping ถัดไป <span class="purple" id="nextPingVal">--:--</span>
            &nbsp;•&nbsp; Ping <span class="purple" id="nextPingNum">#-</span>
        </div>

        <div class="prog-bar" id="progBar">
            <div class="prog-fill" id="progFill" style="width:0%"></div>
        </div>
        <div class="prog-ends">
            <span id="barStart">เริ่ม</span>
            <span id="barEnd">สิ้นสุด</span>
        </div>

        <div id="schedList" class="sched-list">
            <div class="empty-hint">⬆️ กด "คำนวณ" เพื่อเริ่มต้น</div>
        </div>

        <!-- Reset strip (hidden until reset mode calculated) -->
        <div id="resetInline" class="mode-hidden">
            <div class="divider"></div>
            <div class="reset-strip">
                <div>
                    <div class="rb-label">Session Reset</div>
                    <div class="rb-time" id="rbTime">--:--</div>
                </div>
                <div style="text-align:right">
                    <div class="rb-label">นับถอยหลัง</div>
                    <div class="rb-cd" id="rbCountdown">--:--:--</div>
                </div>
            </div>
        </div>

        <div style="text-align:right;margin-top:12px">
            <button class="copy-icon-btn" id="copyBtn" onclick="copyMsg()" title="คัดลอกข้อความ Ping">📋 Copy</button>
        </div>
    </div>

</div>

<script>
    const TH_TZ = 'Asia/Bangkok';

    let pings            = [];
    let sessionBase      = null;
    let sessionEnd       = null;
    let resetTime        = null;
    let currentMode      = 'remain';
    let tickInterval     = null;
    let resetTickInterval = null;
    let alerted          = new Set();

    // ─── Time Helpers ──────────────────────────────────────────────

    function thaiTimeToDate(h, m) {
        const fmt = new Intl.DateTimeFormat('en-US', {
            year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TH_TZ
        });
        const [mo, dy, yr] = fmt.format(new Date()).split('/');
        return new Date(`${yr}-${mo}-${dy}T${pad(h)}:${pad(m)}:00+07:00`);
    }

    function thFmt(d) {
        return d.toLocaleTimeString('th-TH', {
            hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TH_TZ
        });
    }

    function thFmtSec(d) {
        return d.toLocaleTimeString('th-TH', {
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: TH_TZ
        });
    }

    function thDateStr(d) {
        const gregorianYear = parseInt(
            new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: TH_TZ }).format(d)
        );
        const parts = new Intl.DateTimeFormat('th-TH', {
            weekday: 'short', day: 'numeric', month: 'short', timeZone: TH_TZ
        }).formatToParts(d);
        const get = t => (parts.find(p => p.type === t) || {}).value || '';
        return `${get('weekday')} ${get('day')} ${get('month')} ${gregorianYear + 543}`;
    }

    function pad(n) { return String(n).padStart(2, '0'); }

    function msFmtCd(ms) {
        if (ms <= 0) return '00:00:00';
        const s = Math.floor(ms / 1000);
        return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
    }

    function diffLabel(ms) {
        const mins = Math.floor(ms / 60000);
        if (mins < 1)  return 'ถึงเวลาแล้ว!';
        if (mins < 60) return `อีก ${mins} นาที / in ${mins}m`;
        const h = Math.floor(mins / 60), m = mins % 60;
        return m > 0 ? `อีก ${h}h ${m}m` : `อีก ${h}h`;
    }

    // ─── Clock ─────────────────────────────────────────────────────
    function tickClock() {
        document.getElementById('clock').textContent = thFmtSec(new Date());
    }

    // ─── Sound ─────────────────────────────────────────────────────
    function playSound(urgent) {
        try {
            const ctx   = new (window.AudioContext || window.webkitAudioContext)();
            const notes = urgent ? [523.25, 783.99, 1046.5, 783.99, 1046.5] : [523.25, 659.25, 783.99, 1046.5];
            const step  = urgent ? 0.18 : 0.22;
            notes.forEach((freq, i) => {
                const osc = ctx.createOscillator(), gain = ctx.createGain();
                osc.connect(gain); gain.connect(ctx.destination);
                osc.frequency.value = freq; osc.type = 'sine';
                const t = ctx.currentTime + i * step;
                gain.gain.setValueAtTime(0, t);
                gain.gain.linearRampToValueAtTime(0.35, t + 0.03);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
                osc.start(t); osc.stop(t + 0.5);
            });
        } catch (e) { console.warn('playSound failed', e); }
    }

    // ─── Notifications ─────────────────────────────────────────────
    async function requestNotif() { await Notification.requestPermission(); }

    function pushNotif(title, body) {
        if (Notification.permission === 'granted')
            new Notification(title, { body, requireInteraction: true });
    }

    // ─── Alert Modal ───────────────────────────────────────────────
    function showAlert(icon, title, body, urgent) {
        document.getElementById('alertIcon').textContent  = icon;
        document.getElementById('alertTitle').textContent = title;
        document.getElementById('alertBody').textContent  = body;
        document.getElementById('alertOverlay').classList.add('show');
        document.getElementById('alertCloseBtn').focus();
        playSound(urgent);
        pushNotif(title, body);
    }
    function closeAlert() {
        document.getElementById('alertOverlay').classList.remove('show');
    }

    function setStatus(type, text) {
        const b = document.getElementById('statusBadge');
        b.className = `status-badge s-${type}`;
        b.innerHTML = `<div class="dot"></div><span>${text}</span>`;
    }

    // ─── Dropdown Builders ─────────────────────────────────────────
    function buildTimePicker(hourId, minId) {
        const hSel = document.getElementById(hourId);
        const mSel = document.getElementById(minId);
        if (hSel.options.length) return;
        for (let h = 0; h < 24; h++) hSel.appendChild(new Option(pad(h), h));
        for (let m = 0; m < 60; m++) mSel.appendChild(new Option(pad(m), m));
    }

    function buildRemainPicker() {
        const hSel = document.getElementById('remH');
        const mSel = document.getElementById('remM');
        if (hSel.options.length) return;
        for (let h = 0; h <= 5; h++) hSel.appendChild(new Option(`${h} ชม.`, h));
        [0,5,10,15,20,25,30,35,40,45,50,55].forEach(m => mSel.appendChild(new Option(`${m} นาที`, m)));
        hSel.value = 1; mSel.value = 30;
    }

    function initDefaultTime() {
        const fmt = new Intl.DateTimeFormat('en-US', {
            hour: 'numeric', minute: 'numeric', hour12: false, timeZone: TH_TZ
        });
        const parts = fmt.formatToParts(new Date());
        const h = parseInt((parts.find(p => p.type === 'hour')   || {}).value || 0);
        const m = parseInt((parts.find(p => p.type === 'minute') || {}).value || 0);
        document.getElementById('startHour').value   = h;
        document.getElementById('startMinute').value = m;
        document.getElementById('resetHour').value   = (h + 1) % 24;
        document.getElementById('resetMinute').value = m;
    }

    // ─── Mode Switch ───────────────────────────────────────────────
    function switchMode(mode) {
        currentMode = mode;
        ['remain','exact','session'].forEach(m => {
            document.getElementById(`mode-${m}`).classList.toggle('mode-hidden', m !== mode);
            document.getElementById(`stab-${m}`).classList.toggle('active', m === mode);
        });
    }

    // ─── Unified Calculate ─────────────────────────────────────────
    function doCalc() {
        if (currentMode === 'remain' || currentMode === 'exact') {
            calcReset();
        } else {
            calcSession();
        }
    }

    function calcReset() {
        const now      = new Date();
        const alertMin = parseInt(document.getElementById('alertBefore').value);
        if (currentMode === 'remain') {
            const h = parseInt(document.getElementById('remH').value);
            const m = parseInt(document.getElementById('remM').value);
            if (h === 0 && m === 0) { alert('กรุณากรอกเวลาที่เหลือ'); return; }
            resetTime = new Date(now.getTime() + (h * 60 + m) * 60000);
        } else {
            const rh = parseInt(document.getElementById('resetHour').value);
            const rm = parseInt(document.getElementById('resetMinute').value);
            resetTime = thaiTimeToDate(rh, rm);
            if (resetTime <= now) resetTime = new Date(resetTime.getTime() + 86400000);
        }
        document.getElementById('rbTime').textContent = thFmt(resetTime);
        document.getElementById('resetInline').classList.remove('mode-hidden');
        renderResetPlan();
        alerted.clear();
        clearInterval(resetTickInterval);
        resetTickInterval = setInterval(tickReset, 1000);
        tickReset();
    }

    function calcSession() {
        const h         = parseInt(document.getElementById('startHour').value);
        const m         = parseInt(document.getElementById('startMinute').value);
        const intervalH = parseInt(document.getElementById('pingInterval').value);
        const durationH = parseInt(document.getElementById('sessionDuration').value);
        sessionBase = thaiTimeToDate(h, m);
        sessionEnd  = new Date(sessionBase.getTime() + durationH * 3600000);
        pings = [];
        for (let t = sessionBase.getTime(); t <= sessionEnd.getTime(); t += intervalH * 3600000) {
            pings.push(new Date(t));
        }
        document.getElementById('barStart').textContent = thFmt(sessionBase);
        document.getElementById('barEnd').textContent   = thFmt(sessionEnd);
        rebuildDots();
        alerted.clear();
        clearInterval(tickInterval);
        tickInterval = setInterval(tickCountdown, 1000);
        tickCountdown();
    }

    // ─── Progress Bar Dots ─────────────────────────────────────────
    function rebuildDots() {
        document.getElementById('progBar').querySelectorAll('.prog-dot').forEach(el => el.remove());
        if (!sessionBase || !sessionEnd) return;
        const total = sessionEnd.getTime() - sessionBase.getTime();
        const fill  = document.getElementById('progFill');
        pings.forEach((p, i) => {
            const pct = Math.min(100, Math.max(0, ((p.getTime() - sessionBase.getTime()) / total) * 100));
            const dot = document.createElement('div');
            dot.className = 'prog-dot'; dot.id = `dot-${i}`;
            dot.style.left = `${pct}%`; dot.title = thFmt(p);
            fill.insertAdjacentElement('afterend', dot);
        });
    }

    // ─── Session Countdown ─────────────────────────────────────────
    function tickCountdown() {
        if (!pings.length || !sessionBase || !sessionEnd) return;
        const now      = new Date();
        const alertMin = parseInt(document.getElementById('alertBefore').value);
        const total    = sessionEnd.getTime() - sessionBase.getTime();
        const elapsed  = now.getTime() - sessionBase.getTime();

        document.getElementById('progFill').style.width =
            Math.min(100, Math.max(0, (elapsed / total) * 100)) + '%';

        let nextIdx = -1;
        for (let i = 0; i < pings.length; i++) {
            if (pings[i] > now) { nextIdx = i; break; }
        }

        pings.forEach((p, i) => {
            const dot = document.getElementById(`dot-${i}`);
            if (dot) dot.className = 'prog-dot' + (p < now ? ' done' : i === nextIdx ? ' next' : '');
        });

        renderSchedule(nextIdx);

        if (nextIdx === -1) {
            document.getElementById('cdDigits').textContent   = '00:00:00';
            document.getElementById('nextPingVal').textContent = 'เสร็จสิ้น!';
            document.getElementById('cdLabel').textContent    = 'SESSION สิ้นสุดแล้ว';
            setStatus('ok', '✅ เสร็จสิ้น');
            return;
        }

        const diff     = pings[nextIdx].getTime() - now.getTime();
        const minsLeft = diff / 60000;

        document.getElementById('cdDigits').textContent    = msFmtCd(diff);
        document.getElementById('nextPingVal').textContent = thFmt(pings[nextIdx]);
        document.getElementById('nextPingNum').textContent = `#${nextIdx + 1}`;

        if (minsLeft <= 1 && !alerted.has(`urg-${nextIdx}`)) {
            alerted.add(`urg-${nextIdx}`);
            showAlert('🔔', '⚡ ถึงเวลา Ping เดี๋ยวนี้!',
                `เปิด Claude iOS → Haiku → เวลา ${thFmt(pings[nextIdx])}`, true);
        } else if (minsLeft <= alertMin && !alerted.has(`warn-${nextIdx}`)) {
            alerted.add(`warn-${nextIdx}`);
            showAlert('⏰', `เตรียม Ping ได้เลย! (อีก ${Math.ceil(minsLeft)} นาที)`,
                `Ping ครั้งที่ ${nextIdx + 1} เวลา ${thFmt(pings[nextIdx])}`, false);
        }

        if (minsLeft <= 1) {
            setStatus('alert', '🔔 Ping ตอนนี้เลย!');
            document.getElementById('cdLabel').textContent = '⚡ ถึงเวลาแล้ว!';
        } else if (minsLeft <= alertMin) {
            setStatus('warn', `⏰ อีก ${Math.ceil(minsLeft)} นาที`);
            document.getElementById('cdLabel').textContent = 'เตรียม Ping ได้เลย';
        } else {
            setStatus('ok', '✅ Session กำลังทำงาน');
            document.getElementById('cdLabel').textContent = 'NEXT PING IN';
        }
    }

    // ─── Render Schedule List ──────────────────────────────────────
    function renderSchedule(nextIdx) {
        const now  = new Date();
        const list = document.getElementById('schedList');
        if (!pings.length) return;
        let html = '';
        pings.forEach((p, i) => {
            const isPast = p < now, isNext = i === nextIdx;
            const diff   = p.getTime() - now.getTime();
            const isSoon = !isPast && !isNext && diff < 2 * 3600000;
            const chipClass = isPast ? 'chip-past' : isNext ? 'chip-next' : 'chip-future';
            let tagClass, tagText;
            if (isPast)    { tagClass = 'tag-done';  tagText = '✓'; }
            else if(isNext){ tagClass = 'tag-next';  tagText = '→ ถัดไป'; }
            else if(isSoon){ tagClass = 'tag-soon';  tagText = '⏰'; }
            else           { tagClass = 'tag-later'; tagText = '○'; }
            const desc = isPast ? 'ส่งแล้ว' : isNext ? 'ถัดไป — เตรียมตัว!' : diffLabel(diff);
            html += `<div class="sched-item${isNext ? ' is-next' : ''}">
                <div class="s-chip ${chipClass}">${thFmt(p)}</div>
                <div class="sched-body">
                    <div class="sched-num" style="${isPast ? 'color:#d1d5db' : ''}">Ping #${i + 1}</div>
                    <div class="sched-desc">${desc}</div>
                </div>
                <span class="sched-tag ${tagClass}">${tagText}</span>
            </div>`;
        });
        list.innerHTML = html;
    }

    // ─── Reset Countdown ───────────────────────────────────────────
    function tickReset() {
        if (!resetTime) return;
        const diff = resetTime.getTime() - Date.now();
        document.getElementById('rbCountdown').textContent = diff > 0 ? msFmtCd(diff) : '✅ Reset!';
        if (diff <= 0) clearInterval(resetTickInterval);
        renderResetPlan();
    }

    function renderResetPlan() {
        const now       = new Date();
        const alertMin  = parseInt(document.getElementById('alertBefore').value);
        const intervalH = parseInt(document.getElementById('pingInterval').value);
        const diffMs    = resetTime.getTime() - now.getTime();
        const diffMin   = Math.floor(diffMs / 60000);
        let items = [];
        if (diffMs <= 0) {
            items.push({ icon:'✅', iconClass:'icon-reset', time:thFmt(resetTime),
                title:'Session Reset แล้ว! 🚀 รีบเข้าใช้งาน Claude Sonnet/Opus ทันที',
                badge:'✅ Reset', bCls:'pb-reset' });
        } else {
            if (diffMin >= 30) {
                items.push({ icon:'💼', iconClass:'icon-work', time:thFmt(now),
                    title:`ทำงานต่อได้เลย — ${diffLabel(diffMs)} ก่อน Reset`,
                    badge:'ทำงานได้', bCls:'pb-work' });
            }
            if (diffMin >= alertMin + 5) {
                items.push({ icon:'⏰', iconClass:'icon-warn',
                    time:thFmt(new Date(resetTime.getTime() - alertMin * 60000)),
                    title:`เตรียมตัว — อีก ${alertMin} นาทีจะ Reset`,
                    badge:`-${alertMin}m`, bCls:'pb-warn' });
            }
            items.push({ icon:'🔄', iconClass:'icon-reset', time:thFmt(resetTime),
                title:'SESSION RESET! 🚀 Rate limit เริ่มนับใหม่',
                badge:'🔄 Reset', bCls:'pb-reset' });
        }
        for (let i = 1; i <= 3; i++) {
            items.push({ icon:'🤖', iconClass:'icon-ping',
                time:thFmt(new Date(resetTime.getTime() + i * intervalH * 3600000)),
                title:`Haiku Ping #${i} หลัง Reset`,
                badge:'Haiku Ping', bCls:'pb-ping' });
        }
        document.getElementById('schedList').innerHTML = items.map(it => `
            <div class="plan-item">
                <div class="plan-icon ${it.iconClass}">${it.icon}</div>
                <div class="plan-body">
                    <div class="plan-time">${it.time}</div>
                    <div class="plan-title">${it.title}</div>
                </div>
                <span class="plan-badge ${it.bCls}">${it.badge}</span>
            </div>`).join('');
    }

    // ─── Copy Message ──────────────────────────────────────────────
    function copyMsg() {
        const msg = 'สวัสดีครับ ช่วย ping เพื่อรักษา session ไว้หน่อยนะครับ\n\n(Hi Claude! Quick check-in to keep my session active.\nUsing Haiku model for this ping. Thanks!)';
        const btn = document.getElementById('copyBtn');
        const done = () => {
            btn.textContent = '✅ Copied!';
            btn.style.cssText = 'background:#ecfdf5;border-color:#a7f3d0;color:var(--green)';
            setTimeout(() => { btn.textContent = '📋 Copy'; btn.style.cssText = ''; }, 2000);
        };
        navigator.clipboard.writeText(msg).then(done).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = msg; ta.style.cssText = 'position:fixed;opacity:0';
            document.body.appendChild(ta); ta.select(); document.execCommand('copy');
            document.body.removeChild(ta); done();
        });
    }

    // ─── Init ──────────────────────────────────────────────────────
    tickClock();
    setInterval(tickClock, 1000);

    buildTimePicker('startHour', 'startMinute');
    buildTimePicker('resetHour', 'resetMinute');
    buildRemainPicker();
    initDefaultTime();

    if (Notification.permission === 'default') requestNotif();

    document.getElementById('alertCloseBtn').addEventListener('click', closeAlert);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAlert(); });

    doCalc();
</script>
</body>
</html>
```

- [ ] **Step 2: Open `index.html` in browser and verify**

Check:
1. Only 2 cards visible — no header logo, no footer, no tips box
2. Card 1 has 3 sub-tabs: ⏳ เหลืออีก / 🕐 Reset เวลา / 📅 Session
3. Clicking "คำนวณ" in reset mode shows countdown in Card 2 with reset strip at bottom
4. Clicking "คำนวณ" in session mode shows ping schedule + progress bar
5. Alert modal closes on Escape key

- [ ] **Step 3: Commit**

```bash
git add "index.html"
git commit -m "feat: redesign web page to 2-card layout; fix timezone, Buddhist Era, alert modal"
```

---

## Task 6: Final verification

- [ ] **Step 1: Load extension and run end-to-end check**

In Chrome go to `chrome://extensions` → Load unpacked → select `claude-extension/` folder.

Verify extension:
1. Popup opens — header shows logo | clock | gear icon ⚙️
2. Gear click toggles settings panel (shows Interval, Duration, Alert Before, Save button)
3. Gear click again hides settings panel
4. Tab "🔄 Reset Calc" — enter 1h 30m remaining, click คำนวณ → shows reset banner + plan list
5. Tab "📅 Schedule" — settings saved → shows countdown + schedule list

- [ ] **Step 2: Verify web page in browser**

Open `index.html` directly in browser. Enter reset time in "เหลืออีก" mode → Calculate → confirm reset strip and plan appear in Card 2. Switch to "📅 Session" mode → Calculate → confirm countdown + schedule appear.

- [ ] **Step 3: Final commit**

```bash
git add .
git commit -m "chore: complete essential redesign — 2-card web page, 2-tab extension, all bug fixes"
```
