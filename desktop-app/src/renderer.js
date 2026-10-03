let state = {
  settings: { mode: "compact", interval: 5, alerts: {} },
  accounts: [],
  busy: false,
};
const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
function resetText(t) {
  if (!t) return "ไม่ทราบเวลารีเซ็ต";
  const min = Math.ceil((t - Date.now()) / 60000);
  return `${new Date(t).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })} · ${min > 0 ? `อีก ${Math.floor(min / 60)} ชม. ${min % 60} นาที` : "ถึงเวลาแล้ว — รอยืนยัน usage"}`;
}
function render() {
  const s = state.settings;
  document.body.classList.toggle("compact", s.mode === "compact");
  for (const id of ["compact", "detail"])
    $("#" + id).setAttribute("aria-pressed", s.mode === id);
  $("#used").setAttribute("aria-pressed", !s.remaining);
  $("#remaining").setAttribute("aria-pressed", !!s.remaining);
  $("#pin").setAttribute("aria-pressed", !!s.pin);
  $("#interval").value = s.interval;
  $("#refresh").disabled = state.busy;
  $("#cards").innerHTML = state.accounts.length
    ? state.accounts
        .map(
          (a) =>
            `<article class="card ${a.provider === "Claude" ? "claude" : ""}"><div class="account"><span class="brand" title="ภาพร่างแทนโลโก้">${a.provider === "Claude" ? "C" : "O"}</span><div class="identity"><b>${esc(a.provider)}</b><small>${esc(a.email || "ยังยืนยันอีเมลไม่ได้")}</small><small>${esc(a.channels.join(" · "))}${a.plan ? " · " + esc(a.plan) : ""}</small></div><span class="mascot">•ᴗ•</span></div>${
              a.state === "connected"
                ? a.quotas
                    .map((q) => {
                      const key = `${a.id}/${q.id}`,
                        cfg = s.alerts[key] || {
                          threshold: 80,
                          enabled: false,
                          reset: false,
                        },
                        pct =
                          q.used === null
                            ? null
                            : s.remaining
                              ? 100 - q.used
                              : q.used;
                      return `<section class="quota"><div class="quota-top"><span>${esc(q.label)}</span><b>${pct === null ? "ไม่ทราบ" : `${pct}% ${s.remaining ? "เหลือ" : "ใช้แล้ว"}`}</b></div>${pct === null ? "" : `<progress max="100" value="${pct}" aria-label="${esc(q.label)}"></progress>`}<div class="reset">${esc(resetText(q.resetAt))}</div><div class="details"><small>${esc(q.product)}${q.model ? " · " + esc(q.model) : " · โควตารวม/ไม่ระบุโมเดล"}</small><label><input type="checkbox" data-key="${esc(key)}" data-field="enabled" ${cfg.enabled ? "checked" : ""}> เตือนเมื่อใช้ถึง <input type="number" min="1" max="100" value="${cfg.threshold}" data-key="${esc(key)}" data-field="threshold"> %</label><label><input type="checkbox" data-key="${esc(key)}" data-field="reset" ${cfg.reset ? "checked" : ""}> เตือนเมื่อรีเซ็ต</label></div></section>`;
                    })
                    .join("")
                : `<div class="error">${a.state === "signed-out" ? "ยังไม่ได้เข้าสู่ระบบ" : "อ่านข้อมูลไม่ได้"}<br>${esc(a.message || "รอเชื่อมต่อใหม่")}<br><button data-reconnect="${esc(a.id)}">เชื่อมต่อใหม่</button></div>`
            }${a.provider === "Claude" && !a.quotas.some((q) => q.id.toLowerCase().includes("fable")) ? "<small>Fable: ยังไม่พบข้อมูลที่ยืนยันได้</small>" : ""}<div class="details">${a.models.length ? a.models.map((m) => `<span class="model">${esc(a.provider)} · ${esc(m.name)}</span>`).join("") : "รายชื่อโมเดล: ยังอ่านไม่ได้"}${a.message ? '<p class="note">' + esc(a.message) + "</p>" : ""}</div><small>${a.observedAt ? "อัปเดต " + esc(new Date(a.observedAt).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok" })) : "ยังไม่มีข้อมูล usage"}</small></article>`,
        )
        .join("")
    : '<div class="error">กำลังตรวจหาบัญชี…</div>';
}
async function action(fn) {
  try {
    const result = await fn();
    if (result) {
      state = result;
      render();
    }
    $("#notice").textContent = "";
  } catch {
    $("#notice").textContent = "ทำรายการไม่ได้ — ตรวจการเชื่อมต่อและลองใหม่";
  }
}
const save = () => action(() => window.usage.save(state.settings));
for (const id of ["compact", "detail"])
  $("#" + id).onclick = () => {
    state.settings.mode = id;
    save();
  };
$("#used").onclick = () => {
  state.settings.remaining = false;
  save();
};
$("#remaining").onclick = () => {
  state.settings.remaining = true;
  save();
};
$("#pin").onclick = () => {
  state.settings.pin = !state.settings.pin;
  save();
};
$("#close").onclick = () => window.usage.close();
$("#interval").onchange = (e) => {
  if (!e.target.checkValidity()) {
    e.target.reportValidity();
    return;
  }
  state.settings.interval = Number(e.target.value);
  save();
};
$("#refresh").onclick = () => action(() => window.usage.refresh());
for (const p of ["codex", "claude"])
  $("#" + p).onclick = () =>
    action(() => window.usage.add(p === "codex" ? "Codex" : "Claude"));
$("#cards").onclick = (e) => {
  if (e.target.dataset.reconnect)
    action(() => window.usage.reconnect(e.target.dataset.reconnect));
};
$("#cards").onchange = (e) => {
  const { key, field } = e.target.dataset;
  if (!key) return;
  if (!e.target.checkValidity()) {
    e.target.reportValidity();
    return;
  }
  const cfg = state.settings.alerts[key] || {
    threshold: 80,
    enabled: false,
    reset: false,
  };
  cfg[field] =
    field === "threshold" ? Number(e.target.value) : e.target.checked;
  state.settings.alerts[key] = cfg;
  save();
};
window.usage.onUpdate((s) => {
  state = s;
  render();
});
action(() => window.usage.read());
