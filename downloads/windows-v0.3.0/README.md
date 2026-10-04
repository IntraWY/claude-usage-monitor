# AI Usage Monitor 0.3.0 — Windows Portable

[ดาวน์โหลด .exe](https://github.com/IntraWY/claude-usage-monitor/raw/refs/heads/master/downloads/windows-v0.3.0/AI%20Usage%20Monitor%200.3.0.exe)

ปิดรุ่นเก่า แล้วดับเบิลคลิกไฟล์ใหม่บน Windows 11 x64 ไม่ต้องติดตั้ง Node.js หรือแตก ZIP

- ไม่มีโหมด Detail: ตั้งการแจ้งเตือน/ดูโมเดลจาก ⚙ ในการ์ด
- ลบบัญชีเพื่อหยุดติดตาม โดยเก็บการเข้าสู่ระบบและการตั้งค่าเดิมไว้
- คืนบัญชีจาก ⚙ ด้านบน > บัญชีที่หยุดติดตาม
- แสดงสถานะและเวลาอัปเดตล่าสุด; Claude CLI มีปุ่มคัดลอกคำสั่งเข้าสู่ระบบ

Codex ต้องมี official Codex CLI ใน PATH; Claude web sign-in ใช้ได้โดยไม่ต้องมี CLI
ไฟล์ยังไม่ได้เซ็นรับรอง; ยังต้องตรวจบัญชีจริงและ native Windows behavior

ทดสอบผ่าน 20 รายการ ข้ามเฉพาะ Windows 1 รายการ ตรวจซอร์สในแพ็กเกจและ SHA256 แล้ว
Source revision: 05d1d5689b68c4029b3cc7ae2b08d6787f874493
คำแนะนำภาษาไทยและ SHA256 อยู่ข้างไฟล์ .exe
