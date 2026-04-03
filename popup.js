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
  content.innerHTML = windows.map(([key, win]) => {
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

  // resize หลัง render เสร็จ (ต้องรอ 1 frame ให้ DOM paint ก่อน)
  requestAnimationFrame(autoResize);
}

function setStatus(msg) {
  // msg มาจากโค้ดภายใน ไม่ใช่ API — esc ไว้เพื่อความปลอดภัย
  document.getElementById('content').innerHTML = `<div id="status">${esc(msg)}</div>`;
}

async function load() {
  setStatus('กำลังโหลด...');
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
    render(res.data);
  }
}

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

// โหลด interval จาก localStorage
try {
  const saved = localStorage.getItem('refreshInterval');
  if (saved !== null) intervalSelect.value = saved;
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

// initial load + start timer
load();
startAutoRefresh(getInterval());
