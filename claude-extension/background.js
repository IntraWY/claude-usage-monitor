'use strict';

const TH_TZ = 'Asia/Bangkok';

function thFmt(ts) {
    return new Date(ts).toLocaleTimeString('th-TH', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TH_TZ
    });
}

// ── Alarm fired → show notification ──────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
    let data;
    try { data = JSON.parse(alarm.name); } catch { return; }

    const iconUrl = 'icons/icon128.png';

    if (data.type === 'ping') {
        chrome.notifications.create('ping_' + Date.now(), {
            type: 'basic',
            iconUrl,
            title: '🔔 ถึงเวลา Ping Claude Haiku!',
            message: `Ping ครั้งที่ ${data.num} — เวลา ${data.time}\nเปิด Claude iOS App → เลือก Haiku → ส่งข้อความ`,
            priority: 2,
            requireInteraction: true
        });
    } else if (data.type === 'warn') {
        chrome.notifications.create('warn_' + Date.now(), {
            type: 'basic',
            iconUrl,
            title: `⏰ เตรียม Ping ได้เลย! (อีก ${data.mins} นาที)`,
            message: `Ping ถัดไปเวลา ${data.time} — เตรียม Claude iOS App ไว้ได้เลย`,
            priority: 1
        });
    } else if (data.type === 'reset') {
        chrome.notifications.create('reset_' + Date.now(), {
            type: 'basic',
            iconUrl,
            title: '🔄 Session Reset แล้ว!',
            message: 'รีบเข้าใช้งาน Claude Sonnet/Opus ทันที — Rate limit เริ่มนับใหม่แล้ว!',
            priority: 2,
            requireInteraction: true
        });
    }
});

// Clear notification on click
chrome.notifications.onClicked.addListener((id) => chrome.notifications.clear(id));
chrome.notifications.onButtonClicked.addListener((id) => chrome.notifications.clear(id));

// ── Re-register alarms after storage update ───────────────────────
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

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.pingTimes || changes.resetTime || changes.alertBeforeMin)) {
        refreshAlarms();
    }
});

// On service worker install/startup
chrome.runtime.onInstalled.addListener(refreshAlarms);
chrome.runtime.onStartup.addListener(refreshAlarms);
