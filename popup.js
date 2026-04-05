const LABELS = {
  five_hour:  'Session (5h)',
  seven_day:  'Weekly (7d)',
  one_hour:   'Hourly (1h)',
  one_day:    'Daily (1d)',
  thirty_day: 'Monthly (30d)',
};

// [H2] escape HTML ก่อนแทรกลง innerHTML เสมอ
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toLabel(key) {
  return LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function timeUntil(iso) {
  const target = new Date(iso);
  if (isNaN(target)) return '?';
  if (target <= new Date()) return 'แล้ว';

  const fmt = (opts) => new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', ...opts }).format;
  const timeStr = fmt({ hour: '2-digit', minute: '2-digit', hour12: false })(target);

  // เปรียบเทียบวันในโซน Asia/Bangkok
  const dayFmt = fmt({ year: 'numeric', month: 'numeric', day: 'numeric' });
  const sameDay = dayFmt(target) === dayFmt(new Date());

  if (sameDay) return `${timeStr} น.`;

  const dateStr = fmt({ day: 'numeric', month: 'short' })(target);
  return `${dateStr} ${timeStr} น.`;
}

function getColor(pct, isSession) {
  if (pct > 80) return '#E24B4A';
  if (pct > 50) return '#EF9F27';
  return isSession ? '#5DCAA5' : '#378ADD';
}

async function autoResize() {
  try {
    const win = await chrome.windows.getCurrent();
    // วัด window chrome จริง (title bar + border) แทนการ hardcode
    const chrome_h = window.outerHeight - window.innerHeight;
    const h = document.body.scrollHeight + (chrome_h > 0 ? chrome_h : 38);
    chrome.windows.update(win.id, { height: Math.max(160, h) });
  } catch (_) {}
}

function render(data) {
  const windows = Object.entries(data).filter(
    ([, v]) => v && typeof v === 'object' && 'utilization' in v
  );

  if (windows.length === 0) {
    setStatus('ไม่พบข้อมูล usage');
    autoResize();
    return;
  }

  const content = document.getElementById('content');
  const usageHtml = windows.map(([key, win]) => {
    const pct = Math.min(Math.max(win.utilization, 0), 100);
    const isSession = key === 'five_hour' || key === 'one_hour';
    const color = getColor(pct, isSession);
    // [H2] esc() ทุก string ที่มาจาก API ก่อนแทรก innerHTML
    const resetText = win.resets_at ? `resets ${esc(timeUntil(win.resets_at))}` : '';

    return `
      <div class="row">
        <div class="row-header">
          <span class="label">${esc(toLabel(key))}</span>
          <span class="pct" style="color:${color}">${Math.round(pct)}%</span>
        </div>
        <div class="track">
          <div class="fill" style="width:${pct}%;background:${color}"></div>
        </div>
        ${resetText ? `<div class="reset-time">${resetText}</div>` : ''}
      </div>`;
  }).join('');

  const currentHour = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Bangkok', hour: 'numeric', hour12: false, hourCycle: 'h23'
    }).format(new Date()), 10
  );
  const utilizationPct = data.one_hour?.utilization ?? 0;
  const scores = getHourlyScores(utilizationPct);

  content.innerHTML = usageHtml + renderBestTimeSection(scores, currentHour);

  // resize หลัง render เสร็จ (ต้องรอ 1 frame ให้ DOM paint ก่อน)
  requestAnimationFrame(autoResize);
}

function setStatus(msg) {
  // msg มาจากโค้ดภายใน ไม่ใช่ API — esc ไว้เพื่อความปลอดภัย
  document.getElementById('content').innerHTML = `<div id="status">${esc(msg)}</div>`;
}

// === Best Time Section ===

function getIctToPtOffset() {
  const now = new Date();
  const hourIn = (tz) => parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: 'numeric', hour12: false, hourCycle: 'h23'
    }).format(now), 10
  );
  return (hourIn('Asia/Bangkok') - hourIn('America/Los_Angeles') + 24) % 24;
}

function getStaticScore(hour, isWeekend, ictToPtOffset) {
  if (isWeekend) return 10;

  // แปลง ICT → PT แบบ dynamic (รองรับ PDT/PST อัตโนมัติ)
  const ptHour = (hour - ictToPtOffset + 48) % 24;

  // Anthropic official peak: 5am–11am PT
  if (ptHour >= 5 && ptHour < 11) return 100;  // Official peak — session limits เร่ง
  if (ptHour >= 11 && ptHour < 17) return 65;   // US ยังทำงาน
  if (ptHour >= 17 && ptHour < 21) return 30;   // US เย็น — เริ่มว่าง
  if (ptHour >= 21) return 15;                   // US ดึก — ว่างมาก
  return 10;                                     // US นอน (0–5am PT) — ดีที่สุดสำหรับคนไทย
}

function saveResponseTime(ms) {
  try {
    const hour = parseInt(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Bangkok', hour: 'numeric', hour12: false, hourCycle: 'h23'
      }).format(new Date()), 10
    );
    const samples = JSON.parse(localStorage.getItem('responseTimeSamples') || '[]');
    samples.push({ hour, ms, ts: Date.now() });
    if (samples.length > 50) samples.shift();
    localStorage.setItem('responseTimeSamples', JSON.stringify(samples));
  } catch (_) {}
}

function getAvgResponseScore(hour, samples) {
  const relevant = samples.filter(s => s.hour === hour);
  if (relevant.length < 3) return null;
  const avg = relevant.reduce((sum, s) => sum + s.ms, 0) / relevant.length;
  return Math.min(100, Math.max(0, (avg - 1000) / 20));
}

function getHourlyScores(utilizationPct) {
  const bonus = utilizationPct > 80 ? 20 : 0;
  let samples = [];
  try { samples = JSON.parse(localStorage.getItem('responseTimeSamples') || '[]'); } catch (_) {}

  const usDayStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', weekday: 'short'
  }).format(new Date());
  const isWeekend = usDayStr === 'Sat' || usDayStr === 'Sun';
  const offset = getIctToPtOffset();

  return Array.from({ length: 24 }, (_, h) => {
    const staticS = getStaticScore(h, isWeekend, offset);
    const rtScore = getAvgResponseScore(h, samples);
    const base = rtScore !== null ? staticS * 0.5 + rtScore * 0.5 : staticS;
    return Math.min(100, base + bonus);
  });
}

function getNextGoodWindow(scores, currentHour) {
  // ถ้าตอนนี้ดีอยู่แล้ว → หา end ของช่วงดีปัจจุบัน
  if (scores[currentHour] < 34) {
    let len = 1;
    while (len < 24 && scores[(currentHour + len) % 24] < 34) len++;
    return { now: true, end: (currentHour + len) % 24 };
  }
  // ถ้าตอนนี้ยุ่ง → หาช่วงดีถัดไป
  for (let i = 1; i <= 24; i++) {
    const h = (currentHour + i) % 24;
    if (scores[h] < 34) {
      let len = 1;
      while (len < 12 && scores[(h + len) % 24] < 34) len++;
      return { now: false, start: h, end: (h + len) % 24 };
    }
  }
  return null; // ทุกชั่วโมงยุ่ง
}

function scoreToLevel(score) {
  if (score < 34) return { label: 'ดีมาก', color: '#5DCAA5' };
  if (score < 67) return { label: 'ปานกลาง', color: '#EF9F27' };
  return { label: 'ยุ่ง', color: '#E24B4A' };
}

function renderBestTimeSection(scores, currentHour) {
  const level = scoreToLevel(scores[currentHour]);
  const nextGood = getNextGoodWindow(scores, currentHour);
  let nextGoodText;
  if (!nextGood) {
    nextGoodText = 'ทุกช่วงค่อนข้างยุ่ง — ลองช่วงวันหยุด';
  } else if (nextGood.now) {
    nextGoodText = `ดีอยู่แล้ว — ดีถึง ${String(nextGood.end).padStart(2, '0')}:00 น.`;
  } else {
    nextGoodText = `${String(nextGood.start).padStart(2, '0')}:00 – ${String(nextGood.end).padStart(2, '0')}:00 น.`;
  }

  const blocks = scores.map((score, h) => {
    const { color, label } = scoreToLevel(score);
    const isCurrent = h === currentHour ? ' current' : '';
    return `<div class="timeline-block${isCurrent}" style="background:${color}" title="${h}:00 — ${label}"></div>`;
  }).join('');

  return `
    <div class="best-time-section">
      <div class="best-time-header">
        <span>⏰ เวลาแนะนำ</span>
        <span class="status-badge" style="background:${level.color}">${esc(level.label)}</span>
      </div>
      <div class="timeline-row">${blocks}</div>
      <div class="timeline-labels">
        <span>0</span><span>6</span><span>12</span><span>18</span><span>24</span>
      </div>
      <div class="next-good">${nextGood?.now ? '' : 'ช่วงดีถัดไป: '}${esc(nextGoodText)}</div>
    </div>`;
}

let loading = false;
async function load() {
  if (loading) return; // กัน concurrent fetch ซ้อนกัน
  loading = true;
  setStatus('กำลังโหลด...');
  try {
    const res = await chrome.runtime.sendMessage({ type: 'fetch_usage' });

    // [M2] guard กรณี service worker ไม่ตอบ (undefined)
    if (!res) {
      setStatus('ไม่สามารถเชื่อมต่อได้ — ลองปิดแล้วเปิด extension ใหม่');
      return;
    }

    if (res.error === 'not_logged_in') {
      setStatus('กรุณา login claude.ai ใน Chrome ก่อน');
    } else if (res.error) {
      setStatus(`Error: ${res.error}`);
    } else {
      if (typeof res.responseTimeMs === 'number') saveResponseTime(res.responseTimeMs);
      render(res.data);
    }
  } catch (_) {
    setStatus('ไม่สามารถเชื่อมต่อได้ — ลองปิดแล้วเปิด extension ใหม่');
  } finally {
    loading = false;
  }
}

// === Always on Top (Pin) toggle ===
const pinBtn = document.getElementById('pin-btn');

function applyPin(active) {
  pinBtn.classList.toggle('active', active);
  pinBtn.title = active ? 'Always on top: เปิดอยู่' : 'Always on top: ปิดอยู่';
  chrome.runtime.sendMessage({ type: 'set_always_on_top', value: active });
}

let pinActive = false;
try { pinActive = localStorage.getItem('pinActive') === 'true'; } catch (_) {}
applyPin(pinActive);

pinBtn.addEventListener('click', () => {
  pinActive = !pinActive;
  applyPin(pinActive);
  try { localStorage.setItem('pinActive', String(pinActive)); } catch (_) {}
});

// === Theme toggle ===
const themeBtn = document.getElementById('theme-btn');

function applyTheme(light) {
  document.body.classList.toggle('light', light);
  themeBtn.textContent = light ? '🌙' : '☀️';
}

// โหลด preference จาก localStorage — guard กรณี storage ถูก block
try {
  applyTheme(localStorage.getItem('theme') === 'light');
} catch (_) { applyTheme(false); }

themeBtn.addEventListener('click', () => {
  const isLight = !document.body.classList.contains('light');
  applyTheme(isLight); // [M3] ใช้ applyTheme เดียว ไม่ duplicate textContent
  try { localStorage.setItem('theme', isLight ? 'light' : 'dark'); } catch (_) {}
});

// === Auto-refresh ===
let refreshTimer = null;
const intervalSelect = document.getElementById('interval');

function startAutoRefresh(ms) {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  if (ms > 0) refreshTimer = setInterval(load, ms);
}

function getInterval() {
  return parseInt(intervalSelect.value, 10) || 0;
}

// โหลด interval จาก localStorage — validate ว่า value ยังมีอยู่ใน <select>
try {
  const saved = localStorage.getItem('refreshInterval');
  if (saved !== null && [...intervalSelect.options].some(o => o.value === saved)) {
    intervalSelect.value = saved;
  }
} catch (_) {}

intervalSelect.addEventListener('change', () => {
  const ms = getInterval();
  startAutoRefresh(ms);
  try { localStorage.setItem('refreshInterval', String(ms)); } catch (_) {}
});

document.getElementById('refresh').addEventListener('click', () => {
  load();
  startAutoRefresh(getInterval()); // reset timer หลังกด manual refresh
});

// cleanup timer เมื่อปิดหน้าต่าง
window.addEventListener('beforeunload', () => {
  if (refreshTimer) clearInterval(refreshTimer);
});

// initial load + start timer
load();
startAutoRefresh(getInterval());
