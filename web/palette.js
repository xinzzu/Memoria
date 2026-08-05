const API = "http://localhost:48210";
const $ = (sel) => document.querySelector(sel);
const input = $("#q");
const list = $("#list");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const KIND_LABEL = { fact: "Fakta", decision: "Keputusan", task_done: "Selesai", task_pending: "Pending", error_fixed: "Error Fixed", preference: "Preferensi", context: "Konteks" };
const KIND_COLOR = { fact: "#6e8dff", decision: "#d9a05b", task_done: "#4cc38a", task_pending: "#e5686b", error_fixed: "#e08a5c", preference: "#9d8cff", context: "#8b93a2" };
let hits = [];
let active = -1;

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function fmtRel(ts) {
  const diff = Date.now() - ts, m = Math.floor(diff / 60000);
  if (m < 1) return "baru saja";
  if (m < 60) return m + " mnt lalu";
  const h = Math.floor(m / 60);
  if (h < 24) return h + " jam lalu";
  return new Date(ts).getDate() + " " + MONTHS[new Date(ts).getMonth()] + " " + new Date(ts).getFullYear();
}
function fmtTime(ms) {
  const d = new Date(ms);
  return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
}

let deb = null;
input.addEventListener("input", () => {
  clearTimeout(deb);
  const q = input.value.trim();
  deb = setTimeout(() => search(q), 220);
});

async function search(q) {
  if (!q) { hits = []; active = -1; list.innerHTML = '<div class="empty">Ketik untuk mencari memori di semua tool AI.</div>'; return; }
  try {
    const r = await fetch(`${API}/api/search?q=${encodeURIComponent(q)}&limit=10`);
    const d = await r.json();
    hits = d.hits || [];
    active = hits.length ? 0 : -1;
    render();
  } catch {
    list.innerHTML = '<div class="empty">Server tidak merespons.</div>';
  }
}

function render() {
  if (!hits.length) { list.innerHTML = '<div class="empty">Tidak ada hasil.</div>'; return; }
  list.innerHTML = hits.map((h, i) => `
    <div class="item ${i === active ? "active" : ""}" data-i="${i}">
      <div class="t">${esc(h.content)}</div>
      <div class="meta"><b style="color:${KIND_COLOR[h.kind] || "#8b93a2"}">${KIND_LABEL[h.kind] || h.kind}</b> · ${esc(h.projectSlug || "global")} · ${fmtRel(h.createdAt)} · ${fmtTime(h.createdAt)}</div>
    </div>`).join("");
  document.querySelectorAll(".item").forEach((el) => {
    el.addEventListener("mousemove", () => { active = Number(el.dataset.i); setActive(); });
    el.addEventListener("click", () => copyAndClose(Number(el.dataset.i)));
  });
  const act = list.querySelector(".active");
  if (act) act.scrollIntoView({ block: "nearest" });
}

function setActive() {
  document.querySelectorAll(".item").forEach((el, i) => el.classList.toggle("active", i === active));
  const act = list.querySelector(".active");
  if (act) act.scrollIntoView({ block: "nearest" });
}

async function copyAndClose(i) {
  const h = hits[i];
  if (!h) return;
  try { await navigator.clipboard.writeText(h.content); } catch {}
  window.close();
}

input.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); if (hits.length) { active = (active + 1) % hits.length; setActive(); } }
  else if (e.key === "ArrowUp") { e.preventDefault(); if (hits.length) { active = (active - 1 + hits.length) % hits.length; setActive(); } }
  else if (e.key === "Enter") { e.preventDefault(); copyAndClose(active); }
  else if (e.key === "Escape") { window.close(); }
});

input.focus();