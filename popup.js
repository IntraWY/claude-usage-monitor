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
  const diff = new Date(iso) - new Date();
  if (diff <= 0) return 'now';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${m}m`;
}

function getColor(pct, isSession) {
  if (pct > 80) return '#E24B4A';
  if (pct > 50) return '#EF9F27';
  return isSession ? '#5DCAA5' : '#378ADD';
}

function render(data) {
  const windows = Object.entries(data).filter(
    ([, v]) => v && typeof v === 'object' && 'utilization' in v
  );

  if (windows.length === 0) {
    setStatus('ไม่พบข้อมูล usage');
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

document.getElementById('refresh').addEventListener('click', load);
load();
