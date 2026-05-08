'use strict';

// ═══════════════════════════════════════════════════════════
//  CONSTANTS & STATE
// ═══════════════════════════════════════════════════════════

function getIntervalMs() {
    const h = parseInt(document.getElementById('pingIntervalH').value) || 0;
    const m = parseInt(document.getElementById('pingIntervalM').value) || 0;
    const ms = (h * 60 + m) * 60000;
    return ms > 0 ? ms : 300000;
}

const TH_TZ = 'Asia/Bangkok';

let pings       = [];     // Array of UTC timestamps (ms)
let sessionBase = 0;      // UTC ms of session start
let sessionEnd  = 0;      // UTC ms of session end
let resetTs     = 0;      // UTC ms of reset time (0 = not set)

let cdTimer     = null;   // countdown interval
let resetTimer  = null;   // reset countdown interval
let activeTab   = 'reset';
let lastNextIdx = -2;     // tracks previous nextIdx to avoid redundant list re-renders
let resetMode   = 'remain'; // 'remain' | 'exact'

// ═══════════════════════════════════════════════════════════
//  TIME UTILITIES  (all timezone-safe)
// ═══════════════════════════════════════════════════════════

/** Current time string HH:MM:SS in Thai TZ */
function thFmtSec(d) {
    return d.toLocaleTimeString('th-TH', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false, timeZone: TH_TZ
    });
}

/** HH:MM in Thai TZ */
function thFmt(d) {
    return d.toLocaleTimeString('th-TH', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TH_TZ
    });
}

/**
 * Thai date string — Buddhist Era year, weekday, day, month.
 * FIX: use 'en-US' for Gregorian year then +543 to avoid
 *      th-TH already returning Buddhist Era → double offset bug.
 */
function thDateStr(d) {
    const gregorianYear = parseInt(
        new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: TH_TZ }).format(d)
    );
    const beYear = gregorianYear + 543;

    const parts = new Intl.DateTimeFormat('th-TH', {
        weekday: 'short', day: 'numeric', month: 'short', timeZone: TH_TZ
    }).formatToParts(d);
    const get = type => (parts.find(p => p.type === type) || {}).value || '';

    return `${get('weekday')} ${get('day')} ${get('month')} ${beYear}`;
}

/** Pad single digit number with leading zero */
function pad(n) { return String(n).padStart(2, '0'); }

/**
 * Convert HH:MM (Thai local time) to a UTC Date for TODAY in Thai TZ.
 * FIX: use explicit +07:00 ISO string so the UTC offset is always correct
 *      regardless of the browser/OS timezone.
 */
function thaiTimeToDate(h, m) {
    // Get today's date IN Thai TZ using 'en-US' to avoid locale issues
    const fmt = new Intl.DateTimeFormat('en-US', {
        year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TH_TZ
    });
    const [mo, dy, yr] = fmt.format(new Date()).split('/');
    // Build ISO string with explicit +07:00 offset
    const iso = `${yr}-${mo}-${dy}T${pad(h)}:${pad(m)}:00+07:00`;
    return new Date(iso);
}

/** Format millisecond duration as HH:MM:SS */
function msFmtCd(ms) {
    if (ms <= 0) return '00:00:00';
    const s = Math.floor(ms / 1000);
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** Human-readable "time from now" label (Thai + English) */
function diffLabel(ms) {
    const mins = Math.floor(ms / 60000);
    if (mins < 1)  return 'ถึงเวลาแล้ว!';
    if (mins < 60) return `อีก ${mins} นาที / in ${mins}m`;
    const h = Math.floor(mins / 60), m = mins % 60;
    return m > 0 ? `อีก ${h}h ${m}m` : `อีก ${h}h`;
}

// ═══════════════════════════════════════════════════════════
//  BUILD DROPDOWN OPTIONS
// ═══════════════════════════════════════════════════════════

function buildTimePicker(hourId, minId) {
    const hSel = document.getElementById(hourId);
    const mSel = document.getElementById(minId);
    if (hSel.options.length) return; // already built

    for (let h = 0; h < 24; h++) {
        const o = new Option(pad(h), h);
        hSel.appendChild(o);
    }
    for (let m = 0; m < 60; m++) {
        const o = new Option(pad(m), m);
        mSel.appendChild(o);
    }
}

function buildRemainPickers() {
    const hSel = document.getElementById('remH');
    const mSel = document.getElementById('remM');
    if (hSel.options.length) return;

    for (let h = 0; h <= 5; h++) hSel.appendChild(new Option(`${h} ชม.`, h));
    [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].forEach(m => {
        mSel.appendChild(new Option(`${m} นาที`, m));
    });
    hSel.value = 1;
    mSel.value = 0;
}

function initDefaultTime() {
    // Set start-time pickers to current Thai local time
    const fmt = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric', minute: 'numeric', hour12: false, timeZone: TH_TZ
    });
    const parts = fmt.formatToParts(new Date());
    const h = parseInt((parts.find(p => p.type === 'hour') || {}).value || 0);
    const m = parseInt((parts.find(p => p.type === 'minute') || {}).value || 0);
    document.getElementById('startH').value   = h;
    document.getElementById('startMin').value = m;

    // Set reset exact-time pickers to now + 1h
    const rh = (h + 1) % 24;
    document.getElementById('resetH').value   = rh;
    document.getElementById('resetMin').value = m;
}

// ═══════════════════════════════════════════════════════════
//  CLOCK
// ═══════════════════════════════════════════════════════════

function tickClock() {
    const now = new Date();
    document.getElementById('clock').textContent   = thFmtSec(now);
    document.getElementById('dateStr').textContent = thDateStr(now);
}

// ═══════════════════════════════════════════════════════════
//  SETTINGS — save & calculate ping schedule
// ═══════════════════════════════════════════════════════════

function saveAndCalc() {
    const h         = parseInt(document.getElementById('startH').value);
    const m         = parseInt(document.getElementById('startMin').value);
    const intervalH = parseInt(document.getElementById('pingIntervalH').value) || 0;
    const intervalM = parseInt(document.getElementById('pingIntervalM').value) || 0;
    const intervalMs = getIntervalMs();
    const durationH = parseInt(document.getElementById('sessionDuration').value);
    const alertMin  = parseInt(document.getElementById('alertBefore').value);

    // FIX: build UTC-correct date using explicit +07:00 offset
    const base = thaiTimeToDate(h, m);
    const end  = new Date(base.getTime() + durationH * 3600000);

    sessionBase = base.getTime();
    sessionEnd  = end.getTime();

    pings = [];
    for (let t = base.getTime(); t <= end.getTime(); t += intervalMs) {
        pings.push(t);
    }

    // Persist to chrome.storage for background service worker
    chrome.storage.local.set({
        pingTimes:     pings,
        sessionBase:   sessionBase,
        sessionEnd:    sessionEnd,
        alertBeforeMin: alertMin,
        intervalH,
        intervalM,
        durationH,
        startH: h,
        startMin: m
    });

    lastNextIdx = -2; // force re-render on next tick
    renderScheduleTab();
    startCountdown();

    // Feedback
    const btn = document.getElementById('btn-save');
    btn.textContent = '✅ บันทึกแล้ว!';
    setTimeout(() => { btn.textContent = '💾 บันทึก & คำนวณ'; }, 2000);
}

// ═══════════════════════════════════════════════════════════
//  SCHEDULE TAB — render & countdown
// ═══════════════════════════════════════════════════════════

function renderScheduleTab() {
    const now = Date.now();
    const list = document.getElementById('sched-list');

    if (!pings.length) {
        list.innerHTML = '<div class="empty-hint">ตั้งค่าใน ⚙️ แล้วกดบันทึกก่อนครับ</div>';
        return;
    }

    let nextIdx = pings.findIndex(ts => ts > now);

    // Progress bar dots
    const dotsEl = document.getElementById('prog-dots');
    dotsEl.innerHTML = '';
    const total = sessionEnd - sessionBase;
    pings.forEach((ts, i) => {
        const pct = total > 0
            ? Math.min(100, Math.max(0, ((ts - sessionBase) / total) * 100))
            : 0;
        const dot = document.createElement('div');
        dot.className = 'prog-dot' +
            (ts < now ? ' done' : i === nextIdx ? ' next' : '');
        dot.style.left = pct + '%';
        dot.title = thFmt(new Date(ts));
        dotsEl.appendChild(dot);
    });

    // Progress fill
    const elapsed = now - sessionBase;
    const pct = total > 0 ? Math.min(100, Math.max(0, (elapsed / total) * 100)) : 0;
    document.getElementById('prog-fill').style.width = pct + '%';

    // Start/end labels
    document.getElementById('prog-start').textContent = sessionBase ? thFmt(new Date(sessionBase)) : '--';
    document.getElementById('prog-end').textContent   = sessionEnd  ? thFmt(new Date(sessionEnd))  : '--';

    // List
    let html = '';
    pings.forEach((ts, i) => {
        const isPast = ts < now;
        const isNext = i === nextIdx;
        const isSoon = !isPast && !isNext && (ts - now) < 2 * 3600000;
        const diff   = ts - now;

        const chipClass = isPast ? 'chip-past' : isNext ? 'chip-next' : 'chip-future';
        let tagClass, tagText;
        if (isPast)    { tagClass = 'st-done';  tagText = '✓ ส่งแล้ว'; }
        else if(isNext){ tagClass = 'st-next';  tagText = '→ ถัดไป';   }
        else if(isSoon){ tagClass = 'st-soon';  tagText = '⏰ เร็วๆนี้';}
        else           { tagClass = 'st-later'; tagText = '○ กำลังมา'; }

        const desc = isPast  ? 'ส่งแล้ว'
                   : isNext  ? 'ถัดไป — เตรียมตัว!'
                   : diffLabel(diff);

        html += `
        <div class="sched-item${isNext ? ' is-next' : ''}">
            <div class="s-chip ${chipClass}">${thFmt(new Date(ts))}</div>
            <div class="sched-body">
                <div class="sched-title" style="${isPast ? 'color:#d1d5db' : ''}">Ping #${i + 1}</div>
                <div class="sched-desc">${desc}</div>
            </div>
            <span class="sched-tag ${tagClass}">${tagText}</span>
        </div>`;
    });
    list.innerHTML = html;
}

function startCountdown() {
    if (cdTimer) clearInterval(cdTimer);
    cdTimer = setInterval(tickCountdown, 1000);
    tickCountdown();
}

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
        document.getElementById('cd-digits').textContent = '00:00:00';
        document.getElementById('cd-label').textContent  = 'Session เสร็จสิ้นแล้ว';
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

// ═══════════════════════════════════════════════════════════
//  RESET CALCULATOR
// ═══════════════════════════════════════════════════════════

function calcReset() {
    const now      = Date.now();
    const alertMin = parseInt(document.getElementById('alertBefore').value);

    if (resetMode === 'remain') {
        const h = parseInt(document.getElementById('remH').value);
        const m = parseInt(document.getElementById('remM').value);
        const totalMin = h * 60 + m;
        if (totalMin <= 0) { alert('กรุณากรอกเวลาที่เหลือ'); return; }
        resetTs = now + totalMin * 60000;
    } else {
        const rh = parseInt(document.getElementById('resetH').value);
        const rm = parseInt(document.getElementById('resetMin').value);
        let resetDate = thaiTimeToDate(rh, rm).getTime();
        // If already past, push to tomorrow
        if (resetDate <= now) resetDate += 86400000;
        resetTs = resetDate;
    }

    // Save reset time for background alarms
    chrome.storage.local.set({ resetTime: resetTs, alertBeforeMin: alertMin });

    document.getElementById('reset-result').classList.remove('hidden');
    document.getElementById('rb-time').textContent = thFmt(new Date(resetTs));

    renderResetPlan();

    if (resetTimer) clearInterval(resetTimer);
    resetTimer = setInterval(tickReset, 1000);
    tickReset();
}

function tickReset() {
    if (!resetTs) return;
    const diff = resetTs - Date.now();
    document.getElementById('rb-cd').textContent = diff > 0 ? msFmtCd(diff) : '✅ Reset!';
    if (diff <= 0) clearInterval(resetTimer);
    renderResetPlan(); // re-render to update "ทำงานได้" timer
}

function renderResetPlan() {
    const now      = Date.now();
    const alertMin = parseInt(document.getElementById('alertBefore').value);
    const intervalMs = getIntervalMs();
    const diffMs   = resetTs - now;
    const diffMin  = Math.floor(diffMs / 60000);

    let items = [];

    if (diffMs <= 0) {
        // Already reset
        items.push({
            icon: '✅', cls: 'pi-reset',
            time: thFmt(new Date(resetTs)),
            title: 'Session Reset แล้ว!',
            desc: '🚀 รีบเข้าใช้งาน Claude Sonnet/Opus ทันที!',
            badge: '✅ Reset', bCls: 'pb-reset'
        });
    } else {
        // Still before reset
        if (diffMin >= 30) {
            items.push({
                icon: '💼', cls: 'pi-work',
                time: thFmt(new Date(now)),
                title: 'ทำงานต่อได้เลยตอนนี้',
                desc: `มีเวลาอีก ${diffLabel(diffMs)} ก่อน Reset — ใช้เวลานี้ให้คุ้มค่า!`,
                badge: 'ทำงานได้', bCls: 'pb-work'
            });
        }
        if (diffMin >= alertMin + 5) {
            const warnTs = resetTs - alertMin * 60000;
            items.push({
                icon: '⏰', cls: 'pi-warn',
                time: thFmt(new Date(warnTs)),
                title: `เตรียมตัว — อีก ${alertMin} นาทีจะ Reset`,
                desc: 'บันทึกงานค้าง แล้วเตรียม Haiku Ping',
                badge: `-${alertMin}m`, bCls: 'pb-warn'
            });
        }
        items.push({
            icon: '🔄', cls: 'pi-reset',
            time: thFmt(new Date(resetTs)),
            title: 'SESSION RESET!',
            desc: '🚀 รีบเข้าใช้งาน Claude Sonnet/Opus ทันที — Rate limit เริ่มใหม่!',
            badge: '🔄 Reset', bCls: 'pb-reset'
        });
    }

    // Post-reset Haiku pings
    for (let i = 1; i <= 3; i++) {
        const ts = resetTs + i * intervalMs;
        items.push({
            icon: '🤖', cls: 'pi-ping',
            time: thFmt(new Date(ts)),
            title: `Haiku Ping #${i} หลัง Reset`,
            desc: 'ส่ง Haiku Ping เพื่อรักษา session ไว้ต่อเนื่อง',
            badge: 'Haiku Ping', bCls: 'pb-ping'
        });
    }

    document.getElementById('plan-list').innerHTML = items.map(it => `
        <div class="plan-item">
            <div class="plan-icon ${it.cls}">${it.icon}</div>
            <div class="plan-body">
                <div class="plan-time">${it.time}</div>
                <div class="plan-title">${it.title}</div>
                <div class="plan-desc">${it.desc}</div>
            </div>
            <span class="plan-badge ${it.bCls}">${it.badge}</span>
        </div>
    `).join('');
}

// ═══════════════════════════════════════════════════════════
//  SETTINGS PANEL TOGGLE
// ═══════════════════════════════════════════════════════════

function toggleSettings() {
    const panel = document.getElementById('settings-panel');
    const btn   = document.getElementById('gear-btn');
    const open  = panel.classList.toggle('hidden');
    btn.classList.toggle('active', !open);
}

// ═══════════════════════════════════════════════════════════
//  TAB SWITCHING
// ═══════════════════════════════════════════════════════════

function switchTab(tabId) {
    activeTab = tabId;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
    document.querySelectorAll('.tab-panel').forEach(p => {
        p.classList.toggle('hidden', p.id !== 'panel-' + tabId);
        p.classList.toggle('active', p.id === 'panel-' + tabId);
    });
    if (tabId === 'schedule') renderScheduleTab();
}

function switchResetMode(mode) {
    resetMode = mode;
    document.getElementById('stab-remain').classList.toggle('active', mode === 'remain');
    document.getElementById('stab-exact').classList.toggle('active',  mode === 'exact');
    document.getElementById('mode-remain').classList.toggle('hidden', mode !== 'remain');
    document.getElementById('mode-exact').classList.toggle('hidden',  mode !== 'exact');
    document.getElementById('reset-result').classList.add('hidden');
}

// ═══════════════════════════════════════════════════════════
//  COPY MESSAGE
// ═══════════════════════════════════════════════════════════

function copyMessage() {
    const text = document.getElementById('copy-msg').textContent.trim();
    navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('btn-copy');
        btn.textContent = '✅ คัดลอกแล้ว!';
        btn.style.background = '#ecfdf5';
        btn.style.borderColor = '#a7f3d0';
        btn.style.color = '#059669';
        setTimeout(() => {
            btn.textContent = '📋 คัดลอก / Copy';
            btn.style.cssText = '';
        }, 2000);
    });
}

// ═══════════════════════════════════════════════════════════
//  NOTIFICATIONS
// ═══════════════════════════════════════════════════════════

function updateNotifStatus() {
    const status = document.getElementById('notif-status');
    const icon   = document.getElementById('notif-icon');
    const text   = document.getElementById('notif-text');
    const btn    = document.getElementById('btn-notif');

    if (Notification.permission === 'granted') {
        status.className = 'notif-status ok';
        icon.textContent = '✅';
        text.textContent = 'Chrome Notifications เปิดใช้งานแล้ว';
        btn.style.display = 'none';
    } else if (Notification.permission === 'denied') {
        icon.textContent = '❌';
        text.textContent = 'Notifications ถูกบล็อก — เปิดใน Chrome Settings';
        btn.style.display = 'none';
    } else {
        icon.textContent = '🔔';
        text.textContent = 'เปิดใช้ Notifications เพื่อรับการแจ้งเตือน';
    }
}

async function requestNotifications() {
    const result = await Notification.requestPermission();
    updateNotifStatus();
    if (result === 'granted') {
        chrome.storage.local.set({ alertBeforeMin: parseInt(document.getElementById('alertBefore').value) });
    }
}

// ═══════════════════════════════════════════════════════════
//  LOAD FROM STORAGE
// ═══════════════════════════════════════════════════════════

async function loadFromStorage() {
    const data = await chrome.storage.local.get([
        'pingTimes', 'sessionBase', 'sessionEnd', 'resetTime',
        'alertBeforeMin', 'intervalH', 'intervalM', 'durationH', 'startH', 'startMin'
    ]);

    if (data.pingTimes)    pings       = data.pingTimes;
    if (data.sessionBase)  sessionBase = data.sessionBase;
    if (data.sessionEnd)   sessionEnd  = data.sessionEnd;
    if (data.resetTime)    resetTs     = data.resetTime;

    if (data.intervalH !== undefined) document.getElementById('pingIntervalH').value = data.intervalH;
    if (data.intervalM !== undefined) document.getElementById('pingIntervalM').value = data.intervalM;
    if (data.durationH)    document.getElementById('sessionDuration').value = data.durationH;
    if (data.alertBeforeMin) document.getElementById('alertBefore').value  = data.alertBeforeMin;

    if (data.startH !== undefined) {
        document.getElementById('startH').value   = data.startH;
        document.getElementById('startMin').value = data.startMin || 0;
    }

    if (pings.length) {
        renderScheduleTab();
        startCountdown();
    }

    if (resetTs && resetTs > Date.now()) {
        document.getElementById('reset-result').classList.remove('hidden');
        document.getElementById('rb-time').textContent = thFmt(new Date(resetTs));
        renderResetPlan();
        if (resetTimer) clearInterval(resetTimer);
        resetTimer = setInterval(tickReset, 1000);
        tickReset();
    }
}

// ═══════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {

    // Build all dropdown pickers
    buildTimePicker('startH',   'startMin');
    buildTimePicker('resetH',   'resetMin');
    buildRemainPickers();
    initDefaultTime();

    // Clock
    tickClock();
    setInterval(tickClock, 1000);

    // Notification status
    updateNotifStatus();

    // Load persisted state
    loadFromStorage();

    // ── Tab buttons ──
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // ── Reset mode sub-tabs ──
    document.getElementById('stab-remain').addEventListener('click', () => switchResetMode('remain'));
    document.getElementById('stab-exact').addEventListener('click',  () => switchResetMode('exact'));

    // ── Gear button ──
    document.getElementById('gear-btn').addEventListener('click', toggleSettings);

    // ── Main buttons ──
    document.getElementById('btn-calc-reset').addEventListener('click', calcReset);
    document.getElementById('btn-save').addEventListener('click', saveAndCalc);
    document.getElementById('btn-copy').addEventListener('click', copyMessage);
    document.getElementById('btn-notif').addEventListener('click', requestNotifications);
});
