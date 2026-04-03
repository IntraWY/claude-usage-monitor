(async () => {
  // Toggle: ถ้า overlay มีอยู่แล้วให้ปิด, ถ้าไม่มีให้แสดง
  const existing = document.getElementById('claude-usage-overlay');
  if (existing) { existing.remove(); return; }

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

  function buildRow(key, win) {
    const pct = Math.min(Math.max(win.utilization, 0), 100);
    const isSession = key === 'five_hour' || key === 'one_hour';
    const color = getColor(pct, isSession);
    // [H2] esc() ทุก string ที่มาจาก API
    const resetText = win.resets_at ? `resets ${esc(timeUntil(win.resets_at))}` : '';

    return `
      <div style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
          <span style="opacity:.6;font-size:12px">${esc(toLabel(key))}</span>
          <span style="font-weight:700;font-size:18px;color:${color}">${Math.round(pct)}%</span>
        </div>
        <div style="height:6px;background:rgba(255,255,255,.12);border-radius:3px">
          <div style="height:100%;width:${pct}%;background:${color};border-radius:3px"></div>
        </div>
        ${resetText ? `<div style="opacity:.4;font-size:11px;text-align:right;margin-top:3px">${resetText}</div>` : ''}
      </div>`;
  }

  try {
    // [H3] decodeURIComponent — cookie value อาจ URL-encoded
    const raw = document.cookie.match(/lastActiveOrg=([^;]+)/)?.[1];
    if (!raw) return;
    const org = decodeURIComponent(raw);
    // [M5] validate orgId (consistent กับ background.js)
    if (!/^[0-9a-f-]{8,}$/i.test(org)) return;

    const res = await fetch(`/api/organizations/${org}/usage`, { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();

    // แสดงทุก window — รองรับ Max plan ที่อาจมีมากกว่า 2 window
    const windows = Object.entries(data).filter(
      ([, v]) => v && typeof v === 'object' && 'utilization' in v
    );
    if (windows.length === 0) return;

    const el = document.createElement('div');
    el.id = 'claude-usage-overlay';
    el.style.cssText = `
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 999999;
      background: #1a1a1a;
      color: #fff;
      border-radius: 12px;
      padding: 16px 20px 8px;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      cursor: pointer;
      min-width: 230px;
      max-width: 280px;
      box-shadow: 0 8px 32px rgba(0,0,0,.45);
      user-select: none;
    `;
    el.innerHTML = windows.map(([key, win]) => buildRow(key, win)).join('');
    el.title = 'คลิกเพื่อปิด';
    el.onclick = () => el.remove();
    document.body.appendChild(el);

  } catch (e) {
    // [M4] log แทน silent swallow เพื่อช่วย debug
    console.warn('[Claude Usage Monitor]', e);
  }
})();
