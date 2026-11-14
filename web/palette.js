// Same-origin: dilayani oleh HTTP engine itu sendiri — port tidak perlu di-hardcode.
const API = "";
const $ = (sel) => document.querySelector(sel);
const input = $("#q");
const list = $("#list");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const KIND_LABEL = { fact: t("Fact"), decision: t("Decision"), task_done: t("Done"), task_pending: t(t("Pending")), error_fixed: t(t("Error Fixed")), preference: t("Preference"), context: t("Context") };
const KIND_COLOR = { fact: "#6e8dff", decision: "#d9a05b", task_done: "#4cc38a", task_pending: "#e5686b", error_fixed: "#e08a5c", preference: "#9d8cff", context: "#8b93a2" };
let hits = [];
let active = -1;

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function fmtRel(ts) {
  const diff = Date.now() - ts, m = Math.floor(diff / 60000);
  if (m < 1) return t("just now");
  if (m < 60) return m + t("m ago");
  const h = Math.floor(m / 60);
  if (h < 24) return h + t("h ago");
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

let searchSeq = 0; // M10 (audit): query cepat — respons lama tidak menimpa

async function search(q) {
  const mark = ++searchSeq;
  if (!q) { hits = []; active = -1; list.innerHTML = '<div class="empty">' + t("Type to search memories across all AI tools.") + '</div>'; return; }
  try {
    const r = await fetch(`${API}/api/search?q=${encodeURIComponent(q)}&limit=10`);
    const d = await r.json();
    if (mark !== searchSeq) return; // ketikan lebih baru sudah berjalan
    hits = d.hits || [];
    active = hits.length ? 0 : -1;
    render();
  } catch {
    if (mark !== searchSeq) return;
    list.innerHTML = '<div class="empty">' + t("Server not responding") + '</div>';
  }
}

function render() {
  if (!hits.length) { list.innerHTML = '<div class="empty">No results.</div>'; return; }
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

I18N.apply();
input.focus();