#!/usr/bin/env node
// kimi-rate.cjs — ดึงข้อมูล Kimi usage ผ่าน Playwright
// รันครั้งแรกจะเปิด Chrome ให้ login รออัตโนมัติ ไม่ต้องกด Enter

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = 'https://www.kimi.com/code/console';
const STATE_FILE = path.join(__dirname, 'kimi-auth.json');

(async () => {
  const hasState = fs.existsSync(STATE_FILE);

  if (!hasState) {
    console.log('🌙 ครั้งแรก: เปิด Chrome ให้ login Kimi...');
    console.log('   👉 Login ที่หน้าต่าง Chrome ที่เปิดขึ้นมา');
    console.log('   ⏱️  สคริปต์จะรอสูงสุด 120 วินาที แล้วบันทึก session อัตโนมัติ\n');

    const browser = await chromium.launch({
      headless: false,
      channel: 'chrome',
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 }
    });

    const page = await context.newPage();
    await page.goto(URL, { waitUntil: 'networkidle' });

    // รอจนกว่าจะเจอข้อมูล หรือครบ 120 วิ
    let found = false;
    try {
      await page.waitForFunction(() => {
        const text = document.body?.innerText || '';
        return text.includes('本周用量') || text.includes('额度使用') || text.includes('小时后重置');
      }, { timeout: 120000 });
      found = true;
      console.log('   ✅ เจอข้อมูลแล้ว กำลังบันทึก session...');
    } catch (e) {
      console.log('   ⚠️ รอ 120 วิแล้วยังไม่เจอข้อมูล');
    }

    // Debug: save screenshot + partial text
    try {
      await page.screenshot({ path: path.join(__dirname, 'kimi-debug.png'), fullPage: true });
      const snippet = await page.evaluate(() => document.body.innerText.slice(0, 500));
      fs.writeFileSync(path.join(__dirname, 'kimi-debug.txt'), snippet);
      if (!found) {
        console.log('   🖼️  บันทึก screenshot: kimi-debug.png');
        console.log('   📝 บันทึกข้อความหน้าเว็บ: kimi-debug.txt');
      }
    } catch (err) {
      // ignore
    }

    await context.storageState({ path: STATE_FILE });
    await browser.close();
    console.log('   ✅ บันทึก session แล้ว\n');
  }

  console.log('🌙 ดึงข้อมูลจาก Kimi Console...');

  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
  });

  const context = await browser.newContext({
    storageState: STATE_FILE,
    viewport: { width: 1280, height: 800 }
  });

  const page = await context.newPage();

  try {
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });

    await page.waitForFunction(() => {
      const text = document.body?.innerText || '';
      return text.includes('本周用量') || text.includes('额度使用') || text.includes('小时后重置');
    }, { timeout: 15000 });

    await page.waitForTimeout(2000);

    const data = await page.evaluate(() => {
      const findText = (keywords) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
          acceptNode: (node) => {
            const t = node.textContent?.trim() || '';
            return keywords.some(k => t.includes(k)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
          }
        });
        const nodes = [];
        let n;
        while ((n = walker.nextNode())) nodes.push(n);
        return nodes;
      };

      const getSiblingTexts = (textNode) => {
        let el = textNode.parentElement;
        let depth = 0;
        while (el && depth < 5) {
          const texts = [];
          const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
          let node;
          while ((node = w.nextNode())) {
            const t = node.textContent?.trim();
            if (t) texts.push(t);
          }
          if (texts.length > 1) return texts;
          el = el.parentElement;
          depth++;
        }
        return [];
      };

      const parseReset = (txt) => {
        const m = txt?.match(/(-?\d+)\s*[小时hชม\.]+\s*后重置/);
        if (m) return { hours: parseInt(m[1], 10) };
        return null;
      };

      const weeklyNodes = findText(['本周用量', '额度使用']);
      const rateNodes = findText(['频限明细']);

      let weeklyValue = null, weeklyReset = null;
      let rateValue = null, rateReset = null;

      for (const node of weeklyNodes) {
        const texts = getSiblingTexts(node);
        for (const t of texts) {
          const r = parseReset(t);
          if (r) { weeklyReset = r; continue; }
          if (/更多额度|查看/.test(t)) continue;
          if (!weeklyValue && t !== '-' && !/本周|额度/.test(t)) {
            const m = t.match(/(-?\d+(?:\.\d+)?)\s*(.*)/);
            weeklyValue = m ? { value: m[1], unit: m[2] } : { value: t, unit: '' };
          }
        }
      }

      for (const node of rateNodes) {
        const texts = getSiblingTexts(node);
        for (const t of texts) {
          const r = parseReset(t);
          if (r) { rateReset = r; continue; }
          if (/更多额度|查看/.test(t)) continue;
          if (!rateValue && t !== '-' && !/频限/.test(t)) {
            const m = t.match(/(-?\d+(?:\.\d+)?)\s*(.*)/);
            rateValue = m ? { value: m[1], unit: m[2] } : { value: t, unit: '' };
          }
        }
      }

      if (!weeklyReset || !rateReset) {
        const all = document.body.innerText || '';
        const matches = all.match(/(-?\d+)\s*小时后重置/g);
        if (matches) {
          if (!weeklyReset && matches[0]) weeklyReset = parseReset(matches[0]);
          if (!rateReset && matches[1]) rateReset = parseReset(matches[1]);
        }
      }

      return { weeklyValue, weeklyReset, rateValue, rateReset };
    });

    console.log('\n📊 ข้อมูลที่ดึงได้:\n');
    console.log(`  ใช้งานรายสัปดาห์: ${data.weeklyValue ? `${data.weeklyValue.value} ${data.weeklyValue.unit}`.trim() : 'ไม่พบ'}`);
    console.log(`  รีเซ็ต weekly: ${data.weeklyReset ? (data.weeklyReset.hours <= 0 ? 'รีเซ็ตแล้ว' : `อีก ${data.weeklyReset.hours} ชม.`) : 'ไม่พบ'}`);
    console.log(`  Rate Limit: ${data.rateValue ? `${data.rateValue.value} ${data.rateValue.unit}`.trim() : 'ไม่พบ'}`);
    console.log(`  รีเซ็ต rate: ${data.rateReset ? (data.rateReset.hours <= 0 ? 'รีเซ็ตแล้ว' : `อีก ${data.rateReset.hours} ชม.`) : 'ไม่พบ'}`);
    console.log('\n✅ เสร็จสิ้น');

  } catch (err) {
    console.error('\n❌ ผิดพลาด:', err.message);
    console.log('\n💡 ถ้า session หมดอายุ ให้ลบไฟล์ kimi-auth.json แล้วรันใหม่');
  }

  await browser.close();
})();
