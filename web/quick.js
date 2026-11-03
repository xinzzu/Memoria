// Same-origin: dilayani oleh HTTP engine itu sendiri — port tidak perlu di-hardcode.
const API = "";
const $ = (sel) => document.querySelector(sel);
const kind = $("#kind"), project = $("#project"), content = $("#content"), status = $("#status");

async function loadProjects() {
  try {
    const r = await fetch(`${API}/api/projects`);
    if (!r.ok) return;
    const data = await r.json();
    $("#projects").innerHTML = (data.projects || [])
      .map((p) => `<option value="${p.slug}">`)
      .join("");
  } catch { /* server belum jalan */ }
}

async function save() {
  const text = content.value.trim();
  if (!text) return;
  status.className = ""; status.textContent = "Menyimpan…";
  try {
    const r = await fetch(`${API}/api/remember`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: kind.value,
        project: project.value.trim() || "global",
        content: text,
        importance: 0.6,
      }),
    });
    const d = await r.json();
    if (d.ok) {
      status.className = "ok";
      status.textContent = "Tersimpan ✓";
      content.value = "";
      content.focus();
    } else {
      status.className = "err";
      status.textContent = d.error || "Gagal menyimpan";
    }
  } catch {
    status.className = "err";
    status.textContent = "Server tidak merespons";
  }
}

$("#save").addEventListener("click", save);
content.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.close();
});
loadProjects();
content.focus();
