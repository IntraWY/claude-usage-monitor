// คลิกไอคอน → เปิด floating window (ไม่ปิดเมื่อคลิกที่อื่น)
chrome.action.onClicked.addListener(async () => {
  const existingWindows = await chrome.windows.getAll({ windowTypes: ['popup'] });
  // ถ้าเปิดอยู่แล้วให้ปิดแทน (toggle)
  for (const w of existingWindows) {
    const tabs = await chrome.tabs.query({ windowId: w.id });
    if (tabs.some(t => t.url === chrome.runtime.getURL('popup.html'))) {
      chrome.windows.remove(w.id);
      return;
    }
  }
  // คำนวณ position จาก focused window (screen ไม่มีใน service worker)
  let left = 1200;
  try {
    const fw = await chrome.windows.getLastFocused();
    left = Math.max(0, (fw.left || 0) + (fw.width || 1280) - 340);
  } catch (_) {}

  chrome.windows.create({
    url: chrome.runtime.getURL('popup.html'),
    type: 'popup',
    width: 320,
    height: 160, // initial loading height — auto-resize หลัง content โหลด
    top: 60,
    left,
  });
});

// รับ message จาก popup แล้ว fetch จาก claude.ai
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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

      const res = await fetch(`https://claude.ai/api/organizations/${orgId}/usage`, {
        headers: {
          'Cookie': cookieHeader,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://claude.ai/',
          'Origin': 'https://claude.ai',
        }
      });

      if (!res.ok) { sendResponse({ error: `HTTP ${res.status}` }); return; }
      const data = await res.json();
      sendResponse({ data });
    } catch (e) {
      sendResponse({ error: e.message });
    }
  })();

  return true; // keep message channel open for async response
});
