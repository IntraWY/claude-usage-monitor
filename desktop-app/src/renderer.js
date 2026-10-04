let state = { settings: { interval: 5, alerts: {} }, accounts: [], removedAccounts: [], busy: false };
let pendingDelete = null, deleting = false;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const icon = (a) => a.provider === "Claude" ? "anthropic" : "openai";
function resetText(t) {
  if (!t) return "ไม่ทราบเวลารีเซ็ต";
  const minutes = Math.ceil((t - Date.now()) / 60000);
  return minutes > 0 ? `รีเซ็ตอีก ${Math.floor(minutes / 60)} ชม. ${minutes % 60} นาที` : "ถึงเวลารีเซ็ตแล้ว — รอรีเฟรชยืนยัน";
}
function quotaMarkup(a, q) {
  const pct = q.active === false || q.used === null ? null : state.settings.remaining ? 100 - q.used : q.used;
  return `<section class="quota"><div class="quota-top"><span class="quota-name">${q.model ? `<img src="assets/${icon(a)}.svg" alt="${esc(a.provider)}">` : ""}${esc(q.label)}</span><b>${q.active === false ? "ไม่พร้อมใช้" : pct === null ? "ไม่ทราบ" : `${pct}% ${state.settings.remaining ? "เหลือ" : "ใช้แล้ว"}`}</b></div>${pct === null ? "" : `<progress max="100" value="${pct}" aria-label="${esc(q.label)}"></progress>`}<div class="reset" title="${q.resetAt ? esc(new Date(q.resetAt).toLocaleString("th-TH")) : ""}">${esc(resetText(q.resetAt))}</div></section>`;
}
function render() {
  const s = state.settings;
  $("#used").setAttribute("aria-pressed", !s.remaining);
  $("#remaining").setAttribute("aria-pressed", !!s.remaining);
  $("#pin").setAttribute("aria-pressed", !!s.pin);
  $("#refresh").disabled = state.busy;
  $("#account-count").textContent = `${state.accounts.length} บัญชี${state.busy ? " · กำลังอัปเดต…" : ""}`;
  $("#cards").innerHTML = state.accounts.length ? state.accounts.map(a => `<article class="card ${a.provider === "Claude" ? "claude" : ""}"><div class="account"><span class="brand"><img src="assets/${icon(a)}.svg" alt="${esc(a.provider)}"></span><div class="identity"><b>${esc(a.provider)}</b><small>${esc(a.email || "ยังยืนยันอีเมลไม่ได้")}</small><small>${esc(a.channels.join(" · "))}</small></div><div class="account-actions"><button data-settings="${esc(a.id)}" aria-label="ตั้งค่าบัญชี ${esc(a.email || a.provider)}">⚙</button><button class="danger" data-remove="${esc(a.id)}" aria-label="ลบบัญชี ${esc(a.email || a.provider)}">ลบ</button></div></div>${a.state === "connected" ? a.quotas.map(q => quotaMarkup(a, q)).join("") : `<div class="error">${a.state === "signed-out" ? "ยังไม่ได้เข้าสู่ระบบ" : "อ่านข้อมูลไม่ได้"}<br>${esc(a.message || "รอเชื่อมต่อใหม่")}<br>${a.cliLoginRequired ? `<button data-cli-login>คัดลอกคำสั่งเข้าสู่ระบบ</button><small> เปิด PowerShell วางคำสั่ง แล้วกลับมากดรีเฟรช</small>` : `<button data-reconnect="${esc(a.id)}">เชื่อมต่อใหม่</button>`}</div>`}${a.provider === "Claude" && !a.quotas.some(q => (q.model || q.label || q.id).toLowerCase().includes("fable")) ? "<small>Fable: ยังไม่พบข้อมูลที่ยืนยันได้</small>" : ""}<div class="account-meta"><small class="${a.state === "connected" ? "status-dot" : ""}">${a.state === "connected" ? "● เชื่อมต่อแล้ว" : "○ รอเชื่อมต่อ"}</small><small>${a.observedAt ? "อัปเดต " + esc(new Date(a.observedAt).toLocaleTimeString("th-TH", {hour: "2-digit", minute: "2-digit"})) : "ยังไม่มีข้อมูล usage"}</small></div></article>`).join("") : `<div class="empty"><span class="mascot">•ᴗ•</span><b>เพิ่มบัญชีเพื่อเริ่มดูโควตา</b><p>เลือก + Codex หรือ + Claude ด้านล่าง${state.removedAccounts?.length ? " หรือคืนบัญชีจากตั้งค่า ⚙" : ""}</p></div>`;
}
function publicReason(error) {
  const reasons = ["ใช้ claude auth login ใน terminal แล้วกดรีเฟรช", "ไม่พบ Codex CLI — ติดตั้ง Codex และเพิ่มลง PATH", "Codex ไม่ตอบกลับภายในเวลาที่กำหนด", "Codex ปฏิเสธคำขอหรือยังไม่เชื่อมต่อ", "URL เข้าสู่ระบบไม่อยู่ในโดเมนที่อนุญาต", "ไม่พบบัญชี"];
  return typeof error?.message === "string" ? reasons.find(text => error.message.includes(text)) : null;
}
async function action(fn, notice = $("#notice")) {
  try {
    const result = await fn();
    if (result) { state = result; render(); }
    notice.textContent = "";
    return true;
  } catch (error) {
    notice.textContent = publicReason(error) || "ทำรายการไม่ได้ — ตรวจการเชื่อมต่อและลองใหม่";
    return false;
  }
}
const save = () => action(() => window.usage.save(state.settings), $("#preferences").open ? $("#preferences-notice") : $("#notice"));
function renderRemoved() {
  $("#removed-accounts").innerHTML = state.removedAccounts?.length ? `<small>บัญชีที่หยุดติดตาม</small>${state.removedAccounts.map(a => `<div class="restore-row"><small>${esc(a.provider)} · ${esc(a.email || "ยังยืนยันอีเมลไม่ได้")}</small><button data-restore="${esc(a.id)}">คืนบัญชี</button></div>`).join("")}` : "";
}
function openPreferences(id = null) {
  const a = state.accounts.find(a => a.id === id);
  $("#preferences-title").textContent = a ? `ตั้งค่า ${a.provider}` : "ตั้งค่าโปรแกรม";
  $("#global-preferences").hidden = !!a;
  $("#account-preferences").hidden = !a;
  $("#interval").value = state.settings.interval;
  renderRemoved();
  $("#preferences-notice").textContent = "";
  $("#account-preferences").innerHTML = a ? `<small>${esc(a.email || "ยังยืนยันอีเมลไม่ได้")}${a.plan ? " · " + esc(a.plan) : ""}</small>${a.quotas.length ? a.quotas.map(q => {
    const key = `${a.id}/${q.id}`, cfg = state.settings.alerts[key] || {threshold:80, enabled:false, reset:false};
    return `<div class="alert-setting"><strong>${esc(q.label)}</strong><label><input type="checkbox" data-key="${esc(key)}" data-field="enabled" ${cfg.enabled ? "checked" : ""}> เตือนเมื่อใช้ถึง <input type="number" min="1" max="100" value="${cfg.threshold}" data-key="${esc(key)}" data-field="threshold"> %</label><label><input type="checkbox" data-key="${esc(key)}" data-field="reset" ${cfg.reset ? "checked" : ""}> เตือนเมื่อรีเซ็ต</label></div>`;
  }).join("") : '<p class="note">เชื่อมต่อบัญชีเพื่ออ่านโควตาและตั้งการแจ้งเตือน</p>'}<details class="catalogue"><summary>โมเดล (${a.models.length})</summary>${a.models.map(m => `<span class="model"><img src="assets/${icon(a)}.svg" alt="${esc(a.provider)}">${esc(m.name)}</span>`).join("")}${a.message ? `<p class="note">${esc(a.message)}</p>` : ""}${a.catalogError ? '<p class="note">อ่านรายชื่อโมเดลได้ไม่ครบ — ลองรีเฟรชใหม่</p>' : ""}</details>` : "";
  if (!$("#preferences").open) $("#preferences").showModal();
}
$("#settings").onclick = () => openPreferences();
$("[data-close-dialog]").onclick = () => $("#preferences").close();
$("#used").onclick = () => { state.settings.remaining = false; save(); };
$("#remaining").onclick = () => { state.settings.remaining = true; save(); };
$("#pin").onclick = () => { state.settings.pin = !state.settings.pin; save(); };
$("#close").onclick = () => window.usage.close();
$("#interval").onchange = e => {
  if (!e.target.checkValidity()) { e.target.reportValidity(); return; }
  state.settings.interval = Number(e.target.value); save();
};
$("#refresh").onclick = () => action(() => window.usage.refresh());
for (const p of ["codex", "claude"]) $("#" + p).onclick = () => action(() => window.usage.add(p === "codex" ? "Codex" : "Claude"));
$("#cards").onclick = e => {
  const button = e.target.closest("button"); if (!button) return;
  if (button.dataset.settings) openPreferences(button.dataset.settings);
  if (button.dataset.reconnect) action(() => window.usage.reconnect(button.dataset.reconnect));
  if (button.hasAttribute("data-cli-login")) action(() => window.usage.copyCLILogin()).then(ok => { if (ok) $("#notice").textContent = "คัดลอกแล้ว — วางใน PowerShell เข้าสู่ระบบ แล้วกดรีเฟรช"; });
  if (button.dataset.remove) {
    const a = state.accounts.find(a => a.id === button.dataset.remove); if (!a) return;
    pendingDelete = a.id;
    $("#delete-name").textContent = `${a.provider} · ${a.email || "ยังยืนยันอีเมลไม่ได้"}`;
    $("#delete-description").textContent = "หยุดติดตามทุกช่องทางในบัญชีนี้ โดยเก็บการเข้าสู่ระบบไว้ สามารถคืนบัญชีจากตั้งค่าโปรแกรม";
    $("#delete-notice").textContent = "";
    $("#delete-account").showModal();
  }
};
$("[data-cancel-delete]").onclick = () => { pendingDelete = null; $("#delete-account").close(); };
$("#delete-account").addEventListener("cancel", e => { if (deleting) e.preventDefault(); else pendingDelete = null; });
$("#confirm-delete").onclick = async () => {
  if (!pendingDelete || deleting) return;
  deleting = true; $("#confirm-delete").disabled = true; $("[data-cancel-delete]").disabled = true;
  try {
    if (await action(() => window.usage.remove(pendingDelete), $("#delete-notice"))) { pendingDelete = null; $("#delete-account").close(); }
  } finally { deleting = false; $("#confirm-delete").disabled = false; $("[data-cancel-delete]").disabled = false; }
};
$("#removed-accounts").onclick = async e => {
  const id = e.target.closest("button")?.dataset.restore; if (!id) return;
  e.target.disabled = true;
  await action(() => window.usage.restore(id), $("#preferences-notice"));
  renderRemoved();
};
$("#account-preferences").onchange = e => {
  const {key, field} = e.target.dataset; if (!key || !["enabled","reset","threshold"].includes(field)) return;
  if (!e.target.checkValidity()) { e.target.reportValidity(); return; }
  const cfg = state.settings.alerts[key] || {threshold:80, enabled:false, reset:false};
  cfg[field] = field === "threshold" ? Number(e.target.value) : e.target.checked;
  state.settings.alerts[key] = cfg; save();
};
window.usage.onUpdate(s => { state = s; render(); });
action(() => window.usage.read());
