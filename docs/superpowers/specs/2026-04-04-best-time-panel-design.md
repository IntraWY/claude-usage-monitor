# Best Time Panel — Design Spec
**Date:** 2026-04-04  
**Project:** Claude Usage Monitor (Chrome Extension)  
**Feature:** หน้าต่างแสดงเวลาที่แนะนำให้ใช้ Claude เมื่อไม่ใช่ Peak time

---

## Context

ผู้ใช้อยู่ในประเทศไทย (UTC+7 / Asia/Bangkok) และต้องการทราบว่า **ควรใช้ Claude ช่วงไหน** เพื่อหลีกเลี่ยงทั้ง:
1. ช่วงที่ server Claude ยุ่ง (global peak — ส่วนใหญ่ตามเวลาทำงานในสหรัฐฯ)
2. ช่วงที่ usage limit ของตัวเองสูง (own utilization ใกล้ 100%)

---

## Goals

- แสดง status ปัจจุบัน (ดี / ปานกลาง / ยุ่ง)
- แสดง timeline 24 ชั่วโมงแบบย่อ (heatmap สี)
- บอก "ช่วงดีถัดไป" ที่ใกล้ที่สุด
- ปรับตัวตาม response time จริงของผู้ใช้โดยอัตโนมัติ

---

## Architecture

ไม่สร้างไฟล์ใหม่ — แก้ไข 3 ไฟล์เดิม:

| ไฟล์ | การเปลี่ยนแปลง |
|------|----------------|
| `background.js` | วัด response time ก่อน/หลัง fetch แล้วรวมไว้ใน response `{ usage, responseTimeMs }` |
| `popup.js` | เพิ่ม (1) บันทึก response time ใน localStorage (2) คำนวณ composite score (3) render section ใหม่ |
| `popup.html` | เพิ่ม CSS สำหรับ timeline blocks และ status badge |

Section ใหม่ต่อท้าย popup เดิม — `autoResize()` ที่มีอยู่แล้วจัดการ popup size ให้อัตโนมัติ

---

## Scoring Logic

### Static Pattern (baseline)

อิงจาก US Pacific Time (UTC-8 standard):

| ช่วงเวลา ICT | Global Load | Static Score |
|---|---|---|
| 00:00–09:00 | Peak (US 9am–6pm PT) | 100 |
| 09:00–13:00 | Moderate (US evening) | 50 |
| 13:00–00:00 | Low (US night) | 0 |

### Response Time Score

- วัดทุกครั้งที่ `fetch_usage` ใน `background.js`
- เก็บใน `localStorage` key `responseTimeSamples`: `[{hour, ms, ts}]` max 50 entries (FIFO)
- Normalize: `ms <= 1000` → score 0, `ms >= 3000` → score 100, linear interpolation ระหว่างนั้น
- ใช้ค่าเฉลี่ยของ entries ที่ตรง `hour` เดียวกัน (ถ้ามี >= 3 samples)

### Own Utilization Bonus

- ดึงจาก `one_hour.utilization` ใน API response
- ถ้า utilization > 80% → เพิ่ม composite score อีก +20 (capped ที่ 100)

### Composite Score

```
composite = clamp(static_score * 0.5 + rt_score * 0.5 + utilization_bonus, 0, 100)
```

ถ้า response time samples < 3 entries: `composite = static_score + utilization_bonus`

### Level Labels

| Score | ระดับ | สี |
|---|---|---|
| 0–33 | ดีมาก | #5DCAA5 (teal — consistent กับ getColor() เดิม) |
| 34–66 | ปานกลาง | #EF9F27 (orange) |
| 67–100 | ยุ่ง | #E24B4A (red) |

---

## UI Layout

ต่อท้ายใต้ usage windows เดิม ใน `popup.html`:

```
─────────────────────────────
⏰ เวลาแนะนำ (เวลาไทย)
─────────────────────────────
ตอนนี้  [🟢 ดีมาก]   22:30 น.

[■][■][■][■][■][■][■][■][■][□][□][□][□][□][□][□][□][□][□][□][□][□][■][■]
 0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23

ช่วงดีถัดไป: 09:00 – 17:00 น.
```

- **Timeline blocks:** 24 blocks (1hr/block), width ~10px each, gap 1px
- **Current hour block:** border highlight เพิ่ม 1px white border
- **"ช่วงดีถัดไป":** หา consecutive range ที่ score < 34 ที่ใกล้ที่สุดหลังเวลาปัจจุบัน
- **Label แกน X:** แสดง 0, 6, 12, 18 (ทุก 6 ชั่วโมง) เพื่อไม่ให้แน่น
- Section มี divider line คั่นจาก usage section เดิม

---

## Storage

```javascript
// key: 'responseTimeSamples'
// value: JSON array of {hour: 0-23, ms: number, ts: unixTimestampMs}
// max 50 entries — เมื่อเต็มลบ entry เก่าสุดออก (FIFO)
```

---

## Files to Modify

1. **`background.js`** — บริเวณ `fetch()` call ใน message handler `fetch_usage`
   - เพิ่ม `const t0 = Date.now()` ก่อน fetch
   - เพิ่ม `responseTimeMs: Date.now() - t0` ใน response object

2. **`popup.js`** — เพิ่มฟังก์ชันใหม่ต่อท้าย:
   - `saveResponseTime(ms)` — บันทึกใน localStorage
   - `getHourlyScores()` — คืน array 24 ค่า (composite score แต่ละชั่วโมง)
   - `getStaticScore(hour)` — lookup static pattern
   - `getAvgResponseScore(hour)` — คำนวณจาก samples
   - `getNextGoodWindow(scores, currentHour)` — หาช่วงดีถัดไป
   - `renderBestTimeSection(scores, utilizationPct)` — สร้าง HTML section

3. **`popup.html`** — เพิ่ม CSS class:
   - `.best-time-section` — container
   - `.timeline-block` — แต่ละ hour block (10×16px)
   - `.timeline-block.current` — border highlight
   - `.status-badge` — current status pill

---

## Verification

1. โหลด extension ใน Chrome (`chrome://extensions/` → Load unpacked)
2. เปิด popup — ตรวจสอบว่า section "เวลาแนะนำ" แสดงด้านล่าง usage
3. ตรวจสอบสี timeline blocks ตรงกับช่วงเวลา ICT ปัจจุบัน
4. กด refresh หลายครั้ง → ตรวจสอบ `localStorage.getItem('responseTimeSamples')` ใน DevTools ว่า entries เพิ่มขึ้น
5. ทดสอบ dark/light theme — สีต้องใช้ได้ทั้ง 2 mode
6. ตรวจสอบ popup ไม่ตัดขอบเมื่อ section ใหม่ถูก render (`autoResize()` ทำงานถูกต้อง)
