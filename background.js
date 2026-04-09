let popupWindowId = null;
let alwaysOnTop = false;

// [H5] restore state หลัง service worker restart — ใช้ storage.session
// (หายเมื่อปิด browser ซึ่งตรงกับ onRemoved semantics)
chrome.storage.session.get(['popupWindowId', 'alwaysOnTop']).then((s) => {
  if (typeof s.popupWindowId === 'number') popupWindowId = s.popupWindowId;
  if (typeof s.alwaysOnTop === 'boolean') alwaysOnTop = s.alwaysOnTop;
}).catch(() => {});

function persistState() {
  chrome.storage.session.set({ popupWindowId, alwaysOnTop }).catch(() => {});
}

// คลิกไอคอน → เปิด floating window (ไม่ปิดเมื่อคลิกที่อื่น)
chrome.action.onClicked.addListener(async () => {
  // ถ้ามี popup เปิดอยู่แล้ว → toggle ปิด (ไม่ใช้ chrome.tabs เพื่อไม่ต้องขอ "tabs" permission)
  if (popupWindowId !== null) {
    try {
      await chrome.windows.get(popupWindowId);
      // window ยังอยู่ → ปิด (onRemoved จะเคลียร์ state ให้เอง)
      await chrome.windows.remove(popupWindowId);
      return;
    } catch (_) {
      // window ไม่อยู่แล้ว (closed externally) → เคลียร์ state ค้างและสร้างใหม่
      popupWindowId = null;
      alwaysOnTop = false;
      persistState();
    }
  }

  // คำนวณ position จาก focused window (screen ไม่มีใน service worker)
  let left = 1200;
  try {
    const fw = await chrome.windows.getLastFocused();
    left = Math.max(0, (fw.left || 0) + (fw.width || 1280) - 340);
  } catch (_) {}

  const win = await chrome.windows.create({
    url: chrome.runtime.getURL('popup.html'),
    type: 'popup',
    width: 320,
    height: 160, // initial loading height — auto-resize หลัง content โหลด
    top: 60,
    left,
  });
  popupWindowId = win.id;
  persistState();
});

// ดึง focus กลับเมื่อ Chrome window อื่นได้รับ focus (ถ้าเปิด alwaysOnTop)
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (!alwaysOnTop || popupWindowId === null) return;
  // WINDOW_ID_NONE = user ออกจาก Chrome ไป app อื่น — ไม่ดึงกลับ
  if (windowId !== chrome.windows.WINDOW_ID_NONE && windowId !== popupWindowId) {
    chrome.windows.update(popupWindowId, { focused: true });
  }
});

// reset state เมื่อปิด popup window
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === popupWindowId) {
    popupWindowId = null;
    alwaysOnTop = false;
    persistState();
  }
});

// รับ message จาก popup แล้ว fetch จาก claude.ai
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'set_always_on_top') {
    alwaysOnTop = msg.value;
    // restore popupWindowId หลัง service worker restart (sender มี windowId ของ popup window)
    if (_sender.tab && _sender.tab.windowId != null) {
      popupWindowId = _sender.tab.windowId;
    }
    persistState();
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type !== 'fetch_usage') return false;

  (async () => {
    try {
      const allCookies = await chrome.cookies.getAll({ domain: '.claude.ai' });
      const orgCookie = allCookies.find(c => c.name === 'lastActiveOrg');
      if (!orgCookie) { sendResponse({ error: 'not_logged_in' }); return; }

      // [H1] validate orgId ว่าเป็น UUID ก่อน interpolate ลง URL
      const orgId = orgCookie.value;
      if (!/^[0-9a-f-]{8,}$/i.test(orgId)) {
        sendResponse({ error: 'invalid_org_id' });
        return;
      }

      const cookieHeader = allCookies.map(c => `${c.name}=${c.value}`).join('; ');

      // [H1] fetch timeout 15s กัน popup ค้าง "กำลังโหลด..." ถ้า claude.ai ไม่ตอบ
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const t0 = Date.now();
      try {
        const res = await fetch(`https://claude.ai/api/organizations/${orgId}/usage`, {
          signal: controller.signal,
          headers: {
            'Cookie': cookieHeader,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://claude.ai/',
            'Origin': 'https://claude.ai',
          }
        });
        const responseTimeMs = Date.now() - t0;

        if (!res.ok) { sendResponse({ error: `HTTP ${res.status}` }); return; }
        // [M4] validate content-type ก่อน parse — ถ้าเป็น HTML error page จะได้ error ชัดเจน
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          sendResponse({ error: 'unexpected_response' });
          return;
        }
        const data = await res.json();
        sendResponse({ data, responseTimeMs });
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (e) {
      // [H1] แยก timeout ออกจาก error อื่นเพื่อให้ UI แสดงข้อความที่ถูก
      if (e.name === 'AbortError') {
        sendResponse({ error: 'timeout' });
      } else {
        sendResponse({ error: e.message });
      }
    }
  })();

  return true; // keep message channel open for async response
});
