// Same-origin: dashboard dilayani oleh HTTP engine itu sendiri — port tidak perlu di-hardcode.
const API = "";
const $ = (sel) => document.querySelector(sel);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const KIND_LABEL = {
  fact: "Fakta", decision: "Keputusan", task_done: "Selesai", task_pending: "Pending",
  error_fixed: "Error Fixed", preference: "Preferensi", context: "Konteks",
};
const TOOL_LABEL = {
  claude: "Claude Code", codex: "Codex CLI", opencode: "OpenCode",
  gemini: "Gemini CLI", copilot: "Copilot", antigravity: "Antigravity", mcp: "MCP", dashboard: "Dashboard",
};

let state = {
  stats: null,
  projects: [],
  view: "overview",
  search: "",
  filterKind: "",
  filterProject: "",
  memTab: "active",
  filterTag: "",
};

/* ---------- Helpers ---------- */

async function api(path, opts = {}) {
  const res = await fetch(API + path, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function fmtRel(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m} mnt lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days} hari lalu`;
  return fmtDate(ts);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function toast(msg, type = "ok") {
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.innerHTML = `<span class="dot"></span>${esc(msg)}`;
  $("#toast-wrap").appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function memoRowRenderer(renderId) {
  const isDraft = state.memTab === "draft";
  const isArchived = state.memTab === "archived";
  return (h, i) => `
    <div class="mem" data-id="${h.id}">
      <div class="mem-rail"><span class="kind-dot kind-${h.kind}"></span></div>
      <div class="mem-body">
        <div class="mem-meta">
          <span class="mem-kind kind-${h.kind}">${KIND_LABEL[h.kind] || h.kind}</span>
          ${h.status === "draft" ? '<span class="mem-kind" style="opacity:.7">Draft</span>' : ""}
          <span class="sep">·</span>
          <span>${esc(h.projectSlug || "global")}</span>
          <span class="sep">·</span>
          <span>${esc(TOOL_LABEL[h.sourceTool] || h.sourceTool)}</span>
          <span class="sep">·</span>
          <span>${fmtRel(h.createdAt)}</span>
        </div>
        <div class="mem-content">${esc(h.content)}</div>
        ${h.entities && h.entities.length ? `<div class="mem-chips">${h.entities.slice(0, 8).map((e) => `<span class="chip ent" data-ent="${esc(e.text)}">${esc(e.text)}</span>`).join("")}</div>` : ""}
        ${h.tags && h.tags.length ? `<div class="mem-chips">${h.tags.map((t) => `<span class="chip tag" data-tag="${esc(t)}">#${esc(t)}</span>`).join("")}</div>` : ""}
      </div>
      <div class="mem-actions">
        ${isDraft ? `<button class="mem-approve" title="Setujui memori" data-appr="${h.id}">Setujui ✓</button>` : ""}
        ${isArchived ? `<button class="mem-approve" title="Kembalikan memori" data-rs="${h.id}">Pulihkan</button>` : ""}
        <button class="icon-btn" title="Lihat hubungan" data-rel="${h.id}">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="3.5" cy="4" r="1.6"/><circle cx="12.5" cy="3" r="1.6"/><circle cx="10" cy="11" r="1.6"/><path d="M5 4.8l5.8-1.2M3.7 5.6l1 4.3M9.2 10l1-7.4"/></svg>
        </button>
        ${isArchived ? "" : `<button class="icon-btn" title="Arsipkan" data-arch="${h.id}">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5h12M4 4.5V14h8V4.5M5.5 8h5"/><path d="M2 2.5h12"/></svg>
        </button>`}
        <button class="icon-btn" title="Edit" data-edit="${h.id}">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2.5l2.5 2.5L6 12.5l-3 .5.5-3L11 2.5z"/></svg>
        </button>
        <button class="icon-btn danger" title="Hapus" data-del="${h.id}">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h10M6 4V3h4v1M5.5 4l.6 9h3.8l.6-9"/></svg>
        </button>
      </div>
    </div>`;
}

function emptyState(title, sub, btn = null) {
  return `<div class="empty">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2h16v20l-3.5-2-3.5 2-3-2-3 2V2z"/></svg>
    <h4>${title}</h4>
    <p>${sub}</p>
    ${btn || ""}
  </div>`;
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ---------- Views ---------- */

function setView(name) {
  state.view = name;
  document.querySelectorAll(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.view === name));
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  $("#view-" + name).classList.add("active");
  const meta = {
    overview: ["Overview", "Ringkasan memori lintas semua AI tools"],
    memories: ["Memori", "Cari dan kelola memori tersimpan"],
    projects: ["Proyek", "Aktivitas berdasarkan proyek"],
    timeline: ["Timeline", "Jejak aktivitas per proyek"],
    handoff: ["Handoff", "Ringkasan konteks untuk sesi AI berikutnya"],
    graph: ["Graph", "Peta koneksi antar memori"],
    integrations: ["Integrasi", "Daftarkan Memoria ke tool AI"],
    settings: ["Pengaturan", "Sumber data dan integrasi"],
  }[name];
  $("#pageTitle").textContent = meta[0];
  $("#pageSub").textContent = meta[1];
  if (name !== "graph") graph.running = false;
}

async function loadStats() {
  try {
    state.stats = await api("/api/stats");
    $("#sTranscripts").textContent = state.stats.transcripts.toLocaleString("id-ID");
    $("#sMemories").textContent = state.stats.memories.toLocaleString("id-ID");
    $("#sPending").textContent = state.stats.pending.toLocaleString("id-ID");
    $("#navMemCount").textContent = state.stats.memories > 0 ? state.stats.memories.toLocaleString("id-ID") : "";
    const ollama = state.stats.ollamaOnline;
    $("#ollamaDot").className = "dot " + (ollama ? "on" : "off");
    $("#ollamaText").textContent = ollama ? "Ollama: online" : "Ollama: offline";
    $("#sOllama").textContent = "Ollama: " + (ollama ? "online" : "offline");
    if (state.view === "overview") renderOverview();
    if (state.view === "settings") renderSettings();
  } catch (e) {
    $("#ollamaDot").className = "dot off";
    $("#ollamaText").textContent = "API tidak terhubung";
  }
}

async function loadProjects() {
  try {
    const d = await api("/api/projects");
    state.projects = d.projects || [];
    const sel = $("#filterProject");
    sel.innerHTML = '<option value="">Semua proyek</option>';
    const hf = $("#hfProject");
    hf.innerHTML = '<option value="">Pilih proyek…</option>';
    const tl = $("#tlProject");
    tl.innerHTML = '<option value="">Pilih proyek…</option>';
    const gr = $("#grProject");
    gr.innerHTML = '<option value="">Semua proyek</option>';
    for (const p of state.projects) {
      const o = document.createElement("option");
      o.value = p.slug;
      o.textContent = p.name;
      sel.appendChild(o);
      hf.appendChild(o.cloneNode(true));
      tl.appendChild(o.cloneNode(true));
      gr.appendChild(o.cloneNode(true));
    }
    $("#sProjects").textContent = state.projects.length;
    if (state.view === "overview") renderOverview();
    if (state.view === "projects") renderProjects();
  } catch {}
}

function renderOverview() {
  const recent = (state.stats && state.stats.recent) || [];
  const rl = $("#recentList");
  if (!recent.length) {
    rl.innerHTML = emptyState("Belum ada memori", "Scan sedang berjalan atau belum ada aktivitas AI tools yang terekam.", `<button class="btn primary" id="emptyScan">Scan sekarang</button>`);
    const b = rl.querySelector("#emptyScan");
    if (b) b.addEventListener("click", doScan);
  } else {
    rl.innerHTML = recent.map(memoRowRenderer()).join("");
    bindRowActions(rl);
  }

  const pl = $("#recentProjects");
  const projs = state.projects.slice(0, 6);
  if (!projs.length) {
    pl.innerHTML = emptyState("Belum ada proyek", "Proyek muncul otomatis saat ada transkrip baru.");
  } else {
    pl.innerHTML = projs.map(projectRow).join("");
  }
}

function projectRow(p) {
  return `<div class="project-row">
    <div class="project-icon"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5l6-3 6 3M2 5l6 3 6-3M2 5v6l6 3 6-3V5"/><path d="M8 8v6"/></svg></div>
    <div>
      <div class="project-name">${esc(p.name)}</div>
      <div class="project-slug">${esc(p.slug)}</div>
    </div>
    <div class="project-meta">
      <div>${(p.transcripts || 0).toLocaleString("id-ID")} transkrip</div>
      <div class="sub">${fmtRel(p.last_seen)}</div>
    </div>
  </div>`;
}

let memPagination = null; // { offset, hasMore } untuk tab aktif tanpa filter

async function renderMemories(append = false) {
  const q = state.search.trim();
  const box = $("#memoriesList");
  try {
    if (state.filterTag && state.memTab === "active") {
      memPagination = null;
      const d = await api("/api/memories/tag?tag=" + encodeURIComponent(state.filterTag));
      renderMemoryList(box, (d.memories || []).map((m) => ({ ...m, score: 1 })));
      return;
    }
    if (state.memTab !== "active") {
      memPagination = null;
      const d = await api("/api/memories/list?status=" + state.memTab);
      let items = d.memories || [];
      if (state.filterKind) items = items.filter((m) => m.kind === state.filterKind);
      if (state.filterProject) items = items.filter((m) => m.projectSlug === state.filterProject);
      if (q) items = items.filter((m) => m.content.toLowerCase().includes(q.toLowerCase()));
      renderMemoryList(box, items.map((m) => ({ ...m, score: 1 })));
      return;
    }
    const params = new URLSearchParams({ limit: "50" });
    if (state.filterKind) params.set("kind", state.filterKind);
    if (state.filterProject) params.set("project", state.filterProject);
    if (!q && !state.filterKind && !state.filterProject) {
      const offset = append && memPagination ? memPagination.offset : 0;
      const d = await api(`/api/memories?status=${state.memTab}&limit=50&offset=${offset}`);
      const items = (d.memories || []).map((m) => ({ ...m, score: 1 }));
      memPagination = { offset: offset + items.length, hasMore: !!d.hasMore };
      if (append) appendMemoryList(box, items);
      else renderMemoryList(box, items);
      renderLoadMore(box);
      return;
    }
    memPagination = null;
    if (!q) { renderMemoryList(box, []); return; }
    params.set("q", q);
    const d = await api("/api/search?" + params.toString());
    renderMemoryList(box, d.hits);
  } catch (e) {
    box.innerHTML = emptyState("Gagal memuat memori", esc(e.message) + " — pastikan engine Memoria berjalan, lalu coba lagi.");
  }
}

function appendMemoryList(box, items) {
  state.lastMemories = [...(state.lastMemories || []), ...items];
  let list = box.querySelector(".list");
  if (!list) {
    box.innerHTML = '<div class="list"></div>';
    list = box.querySelector(".list");
  }
  list.insertAdjacentHTML("beforeend", items.map(memoRowRenderer()).join(""));
  bindRowActions(box);
}

function renderLoadMore(box) {
  box.querySelector("#memLoadMore")?.remove();
  if (!memPagination || !memPagination.hasMore) return;
  const btn = document.createElement("button");
  btn.id = "memLoadMore";
  btn.className = "btn";
  btn.style.cssText = "margin:14px auto; display:block";
  btn.textContent = "Muat selengkapnya";
  btn.addEventListener("click", () => {
    btn.disabled = true;
    btn.textContent = "Memuat…";
    renderMemories(true);
  });
  box.appendChild(btn);
}

function renderMemoryList(box, items) {
  state.lastMemories = items || [];
  if (!items || !items.length) {
    box.innerHTML = emptyState("Tidak ada memori yang cocok", "Coba kata kunci lain, atau tambahkan memori secara manual.");
    return;
  }
  box.innerHTML = `<div class="list">${items.map(memoRowRenderer()).join("")}</div>`;
  bindRowActions(box);
}

function bindRowActions(root) {
  root.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.del;
      if (!confirm("Hapus memori ini? Tindakan ini tidak bisa dibatalkan.")) return;
      try {
        await api("/api/memories?id=" + id, { method: "DELETE" });
        toast("Memori dihapus");
        const row = btn.closest(".mem");
        if (row) row.remove();
        loadStats();
      } catch (err) {
        toast("Gagal menghapus: " + err.message, "err");
      }
    });
  });
  root.querySelectorAll("[data-rel]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.rel);
      const row = btn.closest(".mem");
      if (!row) return;
      let panel = row.querySelector(".rel-panel");
      if (panel) { panel.remove(); return; }
      panel = document.createElement("div");
      panel.className = "rel-panel";
      panel.innerHTML = '<div class="rel-title">Memuat hubungan…</div>';
      row.appendChild(panel);
      try {
        const d = await api("/api/related?id=" + id);
        const rel = d.related || [];
        if (!rel.length) { panel.innerHTML = '<div class="rel-title">Tidak ada koneksi terkait</div>'; return; }
        panel.innerHTML = '<div class="rel-title">Terhubung dengan (' + rel.length + ')</div>' + rel.map((r) => `
          <div class="rel-item" data-goto="${r.id}">
            <span class="rel-k">${r.linkKind}</span>
            <span class="rel-t">${esc(r.content)}</span>
          </div>`).join("");
        panel.querySelectorAll("[data-goto]").forEach((it) => {
          it.addEventListener("click", (ev) => {
            ev.stopPropagation();
            openEditModal(Number(it.dataset.goto));
          });
        });
      } catch (err) {
        panel.innerHTML = '<div class="rel-title">Gagal: ' + esc(err.message) + '</div>';
      }
    });
  });
  root.querySelectorAll("[data-ent]").forEach((chip) => {
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      state.memTab = "active";
      document.querySelectorAll(".mem-tabs .seg").forEach((x) => x.classList.toggle("active", x.dataset.memtab === "active"));
      state.filterTag = "";
      state.search = chip.dataset.ent;
      $("#search").value = chip.dataset.ent;
      renderMemories();
    });
  });
  root.querySelectorAll("[data-tag]").forEach((chip) => {
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      state.filterTag = chip.dataset.tag;
      $("#filterTag").value = chip.dataset.tag;
      renderMemories();
    });
  });
  root.querySelectorAll("[data-appr]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.appr);
      try {
        await api("/api/memories/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
        toast("Memori disetujui");
        const row = btn.closest(".mem");
        if (row) row.remove();
        loadStats();
      } catch (err) {
        toast("Gagal menyetujui: " + err.message, "err");
      }
    });
  });
  root.querySelectorAll("[data-rs]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.rs);
      try {
        await api("/api/memories/archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, archived: false }) });
        toast("Memori dipulihkan");
        const row = btn.closest(".mem");
        if (row) row.remove();
        loadStats();
      } catch (err) {
        toast("Gagal memulihkan: " + err.message, "err");
      }
    });
  });
  root.querySelectorAll("[data-arch]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.arch;
      try {
        await api("/api/memories/archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: Number(id), archived: true }) });
        toast("Memori diarsipkan");
        const row = btn.closest(".mem");
        if (row) row.remove();
        loadStats();
      } catch (err) {
        toast("Gagal arsip: " + err.message, "err");
      }
    });
  });
  root.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openEditModal(Number(btn.dataset.edit));
    });
  });
  root.querySelectorAll(".mem").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("[data-del], [data-arch], [data-edit], [data-rel], [data-appr], [data-rs], .rel-panel")) return;
      row.classList.toggle("open");
    });
  });
}

function renderProjects() {
  const box = $("#projectsList");
  if (!state.projects.length) {
    box.innerHTML = emptyState("Belum ada proyek", "Proyek akan muncul otomatis saat AI tools mencatat aktivitas.");
    return;
  }
  box.innerHTML = state.projects.map(projectRow).join("");
}

async function loadTags() {
  try {
    const d = await api("/api/tags");
    const sel = $("#filterTag");
    const cur = state.filterTag;
    sel.innerHTML = '<option value="">Semua topik</option>';
    for (const t of d.tags || []) {
      const o = document.createElement("option");
      o.value = t.tag;
      o.textContent = t.tag + " (" + t.count + ")";
      sel.appendChild(o);
    }
    if (cur) sel.value = cur;
  } catch {}
}

function renderSettings() {
  const toolsContainer = $("#toolsList");
  const tools = state.stats && state.stats.perTool ? state.stats.perTool : [];
  const known = [["claude", "Claude Code"], ["codex", "Codex CLI"], ["opencode", "OpenCode"], ["gemini", "Gemini CLI"], ["copilot", "Copilot"], ["antigravity", "Antigravity"]];
  toolsContainer.innerHTML = known
    .map(([key, label]) => {
      const t = tools.find((x) => x.tool === key);
      return `<div class="tool-row">
        <span class="dot ${t ? "on" : "off"}"></span>
        <span class="tool-name">${label}</span>
        <span class="tool-count">${t ? t.count.toLocaleString("id-ID") + " transkrip" : "belum terdeteksi"}</span>
        <span class="tool-status">${t ? "sync" : "–"}</span>
      </div>`;
    })
    .join("") + (tools.filter((t) => !known.some(([k]) => k === t.tool)).map((t) => `
      <div class="tool-row"><span class="dot on"></span><span class="tool-name">${esc(t.tool)}</span><span class="tool-count">${t.count} transkrip</span></div>`).join(""));

  const cfg = state.stats && state.stats.config;
  if (cfg) {
    $("#cfgDataDir").textContent = cfg.dataDir;
    $("#cfgExtractModel").textContent = cfg.ollamaExtractModel;
    $("#cfgEmbedModel").textContent = cfg.ollamaEmbedModel;
    $("#cfgApi").textContent = "http://localhost:" + cfg.httpPort;
  }

  api("/api/settings").then((d) => {
    const s = d.settings || {};
    const box = $("#sourcesToggles");
    const tools = state.stats && state.stats.perTool ? state.stats.perTool : [];
    const counts = Object.fromEntries(tools.map((t) => [t.tool, t.count]));
    box.innerHTML = Object.entries(s.sources || {})
      .map(([key, val]) => {
        const label = (s.sourceLabels && s.sourceLabels[key]) || key;
        const on = String(val) === "1";
        const count = counts[key];
        return `<div class="src-toggle">
          <span class="dot ${on ? "on" : "off"}"></span>
          <span class="st-name">${esc(label)}</span>
          <span class="st-count">${count != null ? count.toLocaleString("id-ID") + " transkrip" : ""}</span>
          <div class="spacer"></div>
          <div class="switch ${on ? "on" : ""}" data-src="${key}"></div>
        </div>`;
      })
      .join("");
    box.querySelectorAll("[data-src]").forEach((sw) => {
      sw.addEventListener("click", (e) => {
        e.stopPropagation();
        const on = !sw.classList.contains("on");
        sw.classList.toggle("on", on);
        api("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "source:" + sw.dataset.src + ":enabled", value: on ? "1" : "0" }) })
          .then(() => toast((sw.dataset.src || "") + (on ? " aktif" : " nonaktif")))
          .catch((err) => toast("Gagal: " + err.message, "err"));
      });
    });
  }).catch(() => {});
  const cmd = [
    "# Claude Code",
    `claude mcp add --scope user memoria -- node "D:\\…\\dist\\engine\\index.js" mcp`,
    "",
    "# opencode / Gemini / Antigravity — MCP stdio:",
    '#   command: node',
    '#   args:    ["D:\\…\\dist\\engine\\index.js", "mcp"]',
  ].join("\n");
  $("#mcpCode").textContent = cmd;

  const cpBtn = document.createElement("button");
  cpBtn.className = "copy";
  cpBtn.title = "Salin perintah";
  cpBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M11 5V3.5a1 1 0 0 0-1-1H3.5a1 1 0 0 0-1 1V10a1 1 0 0 0 1 1H5"/></svg>';
  cpBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(cmd).catch(() => {});
    toast("Contoh perintah disalin");
  });
  $("#mcpCode").appendChild(cpBtn);
}

/* ---------- Timeline ---------- */

let tlMode = "text";

async function renderTimeline() {
  const slug = $("#tlProject").value;
  const box = $("#timelineBox");
  if (!slug) { box.innerHTML = emptyState("Pilih proyek", "Pilih proyek di atas untuk melihat jejak aktivitasnya."); return; }
  box.innerHTML = "<p class='muted' style='padding:20px'>Memuat…</p>";
  try {
    if (tlMode === "git") {
      const d = await api("/api/git?slug=" + encodeURIComponent(slug));
      const log = d.log || [];
      if (!log.length) { box.innerHTML = emptyState("Tidak ada riwayat git", "Proyek ini belum memiliki commit terdeteksi."); return; }
      box.innerHTML = `<div class="list">${log.map((g) => `<div class="tl-item"><div class="tl-badge">${esc(g.date)}</div><div class="tl-text">${esc(g.message)}<div class="tl-tool">git commit</div></div></div>`).join("")}</div>`;
      return;
    }
    const d = await api("/api/timeline?slug=" + encodeURIComponent(slug) + "&limit=60");
    const items = d.timeline || [];
    const mems = d.memories || [];
    if (!items.length) { box.innerHTML = emptyState("Belum ada aktivitas", "Proyek ini belum memiliki transkrip tersimpan."); return; }
    const byDay = {};
    for (const it of items) {
      const day = fmtDate(it.ts);
      (byDay[day] = byDay[day] || []).push(it);
    }
    let html = "";
    if (mems.length) {
      html += `<div class="tl-day">Memori proyek (${mems.length})</div>` + mems
        .map((m) => `<div class="tl-item"><div class="tl-badge" style="width:auto; text-align:left"><span class="mem-kind kind-${m.kind}">${KIND_LABEL[m.kind] || m.kind}</span></div><div class="tl-text">${esc(m.content)}<div class="tl-tool">memori · ${(m.importance * 100).toFixed(0)}</div></div></div>`)
        .join("");
    }
    for (const [day, arr] of Object.entries(byDay)) {
      html += `<div class="tl-day">${day}</div>`;
      html += arr.map((t) => `
        <div class="tl-item ${t.role}">
          <div class="tl-badge">${new Date(t.ts).toTimeString().slice(0, 5)}</div>
          <div class="tl-text">${esc(t.text || t.content)}<div class="tl-tool">${esc(t.tool)} · ${t.role}</div></div>
        </div>`).join("");
    }
    box.innerHTML = html;
  } catch (e) {
    box.innerHTML = emptyState("Gagal memuat", esc(e.message));
  }
}

/* ---------- Handoff ---------- */

let handoffText = "";

async function renderHandoff() {
  const slug = $("#hfProject").value;
  const box = $("#handoffBox");
  if (!slug) { box.textContent = "Pilih proyek lalu klik \"Buat Handoff\"."; return; }
  box.textContent = "Membuat handoff…";
  try {
    const d = await api("/api/handoff?slug=" + encodeURIComponent(slug));
    handoffText = d.text || "";
    box.textContent = handoffText;
    toast("Handoff siap");
  } catch (e) {
    box.textContent = "Gagal membuat handoff: " + e.message;
  }
}

/* ---------- Graph ---------- */

const KIND_COLOR = {
  fact: "#6e8dff", decision: "#d9a05b", task_done: "#4cc38a", task_pending: "#e5686b",
  error_fixed: "#e08a5c", preference: "#9d8cff", context: "#8b93a2",
};

const graph = {
  nodes: [], edges: [], pos: [], vel: [], idx: new Map(),
  zoom: 1, offX: 0, offY: 0, selected: null,
  drag: null, lastX: 0, lastY: 0, running: false, alpha: 0,
};

async function renderGraph() {
  const project = $("#grProject").value || undefined;
  const params = new URLSearchParams({ limit: "250" });
  if (project) params.set("project", project);
  $("#graphSide").innerHTML = '<div class="gs-empty">Memuat graph…</div>';
  try {
    const d = await api("/api/graph?" + params.toString());
    graph.nodes = d.nodes || [];
    graph.edges = (d.edges || []).filter((e) => graph.nodes.some((n) => n.id === e.fromId) && graph.nodes.some((n) => n.id === e.toId));
    graph.idx = new Map(graph.nodes.map((n, i) => [n.id, i]));
    graph.pos = graph.nodes.map(() => ({ x: (Math.random() - 0.5) * 400, y: (Math.random() - 0.5) * 300 }));
    graph.vel = graph.nodes.map(() => ({ x: 0, y: 0 }));
    graph.selected = null;
    graph.alpha = 1;
    $("#grCount").textContent = graph.nodes.length + " node · " + graph.edges.length + " koneksi";
    if (!graph.nodes.length) {
      $("#graphSide").innerHTML = '<div class="gs-empty">Belum ada memori untuk ditampilkan. Jalankan scan + ekstraksi dulu, atau tambahkan memori manual.</div>';
    } else {
      $("#graphSide").innerHTML = '<div class="gs-title">Detail</div><div class="gs-empty">Klik salah satu node di canvas untuk melihat detail dan koneksinya.</div>';
    }
    renderGraphLegend();
    startGraphLoop();
  } catch (e) {
    $("#graphSide").innerHTML = '<div class="gs-empty">Gagal memuat graph: ' + esc(e.message) + "</div>";
  }
}

function renderGraphLegend() {
  const legend = $("#grLegend");
  legend.innerHTML = Object.entries(KIND_LABEL).map(([k, label]) =>
    `<span class="lg"><span class="sw" style="background:${KIND_COLOR[k]}"></span>${label}</span>`
  ).join("");
}

function startGraphLoop() {
  if (graph.running) return;
  graph.running = true;
  const canvas = $("#graphCanvas");
  const ctx = canvas.getContext("2d");

  function frame() {
    if (!graph.running) return;
    const box = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const w = box.clientWidth, h = box.clientHeight;
    if (canvas.width !== Math.floor(w * dpr)) { canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (graph.alpha > 0.01) {
      simulate(w, h);
      graph.alpha *= 0.985;
    }

    ctx.save();
    ctx.translate(w / 2 + graph.offX, h / 2 + graph.offY);
    ctx.scale(graph.zoom, graph.zoom);

    for (const e of graph.edges) {
      const a = graph.pos[graph.idx.get(e.fromId)];
      const b = graph.pos[graph.idx.get(e.toId)];
      if (!a || !b) continue;
      const alpha = e.kind === "cohort" ? 0.06 : 0.08 + e.weight * 0.28;
      ctx.strokeStyle = `rgba(148, 163, 196, ${Math.min(0.4, alpha)})`;
      ctx.lineWidth = 0.7 + e.weight * 1.1;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    for (let i = 0; i < graph.nodes.length; i++) {
      const n = graph.nodes[i];
      const p = graph.pos[i];
      const r = 5 + n.importance * 5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = KIND_COLOR[n.kind] || "#8b93a2";
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (graph.selected === n.id) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
    }
    ctx.restore();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function simulate(w, h) {
  const n = graph.nodes.length;
  const k = 90;
  const nodes = graph.nodes, pos = graph.pos, vel = graph.vel;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let dx = pos[i].x - pos[j].x;
      let dy = pos[i].y - pos[j].y;
      let d2 = dx * dx + dy * dy || 1;
      let f = (k * k) / d2;
      if (f > 40) f = 40;
      dx /= Math.sqrt(d2); dy /= Math.sqrt(d2);
      vel[i].x += dx * f; vel[i].y += dy * f;
      vel[j].x -= dx * f; vel[j].y -= dy * f;
    }
  }

  for (const e of graph.edges) {
    const a = graph.idx.get(e.fromId), b = graph.idx.get(e.toId);
    if (a == null || b == null) continue;
    let dx = pos[b].x - pos[a].x;
    let dy = pos[b].y - pos[a].y;
    let d = Math.sqrt(dx * dx + dy * dy) || 1;
    const rest = 70 + (1 - e.weight) * 40;
    const f = (d - rest) * 0.012;
    dx /= d; dy /= d;
    vel[a].x += dx * f; vel[a].y += dy * f;
    vel[b].x -= dx * f; vel[b].y -= dy * f;
  }

  for (let i = 0; i < n; i++) {
    vel[i].x -= pos[i].x * 0.002;
    vel[i].y -= pos[i].y * 0.002;
    vel[i].x *= 0.85; vel[i].y *= 0.85;
    pos[i].x += vel[i].x;
    pos[i].y += vel[i].y;
  }
}

function graphPointer(e) {
  const canvas = $("#graphCanvas");
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left - rect.width / 2 - graph.offX) / graph.zoom,
    y: (e.clientY - rect.top - rect.height / 2 - graph.offY) / graph.zoom,
  };
}

function graphHit(p) {
  let best = -1, bestD = 22;
  for (let i = 0; i < graph.nodes.length; i++) {
    const q = graph.pos[i];
    const r = 5 + graph.nodes[i].importance * 5;
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < r + 4 && d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function renderGraphSide() {
  const side = $("#graphSide");
  if (graph.selected == null) return;
  const i = graph.idx.get(graph.selected);
  const n = graph.nodes[i];
  if (!n) return;
  const rels = graph.edges
    .filter((e) => e.fromId === n.id || e.toId === n.id)
    .map((e) => {
      const otherId = e.fromId === n.id ? e.toId : e.fromId;
      const other = graph.nodes[graph.idx.get(otherId)];
      return { kind: e.kind, weight: e.weight, other, otherId };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 10);
  side.innerHTML = `
    <div class="gs-node">
      <div class="gs-kind" style="color:${KIND_COLOR[n.kind] || "#8b93a2"}">${KIND_LABEL[n.kind] || n.kind} · kepentingan ${(n.importance * 100).toFixed(0)}</div>
      <div class="gs-content">${esc(n.content)}</div>
      <div class="gs-meta">${esc(n.projectSlug || "global")} · ${esc(TOOL_LABEL[n.sourceTool] || n.sourceTool)} · ${fmtRel(n.createdAt)}</div>
    </div>
    <div class="gs-title" style="margin-top:4px">Koneksi (${rels.length})</div>
    ${rels.length ? rels.map((r) => `
      <div class="gs-link-row" data-goto="${r.otherId}">
        <span class="gs-lk">${r.kind}</span>
        <span class="gs-lt">${esc(r.other.content)}</span>
      </div>`).join("") : '<div class="gs-empty">Tidak ada koneksi pada node ini.</div>'}`;
  side.querySelectorAll("[data-goto]").forEach((el) => {
    el.addEventListener("click", () => {
      graph.selected = Number(el.dataset.goto);
      renderGraphSide();
    });
  });
}

function wireGraphCanvas() {
  const canvas = $("#graphCanvas");
  let moved = false;
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    moved = false;
    graph.drag = { x: e.clientX, y: e.clientY, startOffX: graph.offX, startOffY: graph.offY };
    graph.lastX = e.clientX;
    graph.lastY = e.clientY;
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!graph.drag) return;
    const dx = e.clientX - graph.drag.x;
    const dy = e.clientY - graph.drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    graph.offX = graph.drag.startOffX + dx;
    graph.offY = graph.drag.startOffY + dy;
    graph.alpha = Math.max(graph.alpha, 0.15);
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!graph.drag) return;
    graph.drag = null;
    if (!moved) {
      const p = graphPointer(e);
      const hit = graphHit(p);
      graph.selected = hit >= 0 ? graph.nodes[hit].id : null;
      renderGraphSide();
    }
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    graph.zoom = Math.min(3, Math.max(0.25, graph.zoom * factor));
  }, { passive: false });
}

/* ---------- Integrations ---------- */

const INTEGRATIONS = [
  ["claude", "Claude Code", "MCP stdio — kloning konteks tiap sesi `/memory`"],
  ["codex", "Codex CLI", "Terdaftar di ~/.codex/config.toml"],
  ["opencode", "opencode", "Terdaftar di ~/.config/opencode/opencode.json"],
  ["gemini", "Gemini CLI", "Terdaftar di ~/.gemini/settings.json"],
  ["copilot", "Copilot", "Terdaftar di ~/.copilot/mcp-config.json"],
  ["antigravity", "Antigravity", "Terdaftar di ~/.gemini/config/mcp_config.json"],
];

async function renderIntegrations() {
  const box = $("#integrationsBox");
  try {
    const d = await api("/api/integrations");
    const map = Object.fromEntries((d.integrations || []).map((x) => [x.key, x]));
    box.innerHTML = INTEGRATIONS.map(([key, name, desc]) => {
      const st = map[key];
      const configured = st && st.configured;
      return `<div class="intg-row">
        <div class="intg-icon">${esc(name.slice(0, 2).toUpperCase())}</div>
        <div><div class="intg-name">${esc(name)}</div><div class="intg-desc">${esc(desc)}</div></div>
        <div class="spacer"></div>
        <span class="badge ${configured ? "ok" : "no"}">${configured ? "Terdaftar" : "Belum"}</span>
        <button class="btn primary" data-intg="${key}" ${configured ? "style='opacity:0.55'" : ""}>${configured ? "Daftarkan lagi" : "Daftarkan"}</button>
      </div>`;
    }).join("");
    box.querySelectorAll("[data-intg]").forEach((b) => {
      b.addEventListener("click", async () => {
        b.disabled = true;
        b.textContent = "Proses…";
        try {
          const r = await api("/api/integrate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool: b.dataset.intg }) });
          if (r.ok) toast(b.dataset.intg + " terdaftar");
          else toast("Gagal: " + r.message, "err");
        } catch (e) {
          toast("Gagal: " + e.message, "err");
        }
        b.disabled = false;
        renderIntegrations();
      });
    });
  } catch (e) {
    box.innerHTML = emptyState("Gagal memuat", esc(e.message));
  }
}

/* ---------- Settings: toggles & transfer ---------- */

async function loadSettingsToggles() {
  try {
    const d = await api("/api/settings");
    const s = d.settings || {};
    const keys = ["autoStartOllama", "autoBackup", "autoArchive", "reviewMode", "autoInjectProjectFiles", "quickInbox", "globalPalette", "autoTopics", "weeklyDigest"];
    for (const k of keys) {
      const sw = document.querySelector(`[data-sw="${k}"]`);
      if (sw) sw.classList.toggle("on", String(s[k]) === "1" || s[k] === true);
    }
    try {
      const dg = await api("/api/digest");
      const box = $("#digestBox");
      if (box && dg.text) box.textContent = dg.text;
    } catch {}
  } catch {}
}

async function saveSettings(key, on) {
  try {
    await api("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, value: on ? "1" : "0" }) });
    toast(key + (on ? " diaktifkan" : " dimatikan"));
  } catch (e) {
    toast("Gagal simpan pengaturan: " + e.message, "err");
  }
}

async function loadBackups() {
  const box = $("#backupList");
  if (!box) return;
  try {
    const d = await api("/api/backups");
    const b = d.backups || [];
    if (!b.length) {
      box.innerHTML = '<div class="card-desc" style="margin-top:6px">Belum ada cadangan. Klik "Cadangkan sekarang" untuk membuat yang pertama.</div>';
      return;
    }
    box.innerHTML = '<div class="card-desc" style="margin-top:2px">Cadangan tersimpan:</div>' +
      b.map((x) => `
        <div class="bup-row">
          <div>
            <div class="bup-name">${esc(x.name)}</div>
            <div class="bup-meta">${(x.size / 1024 / 1024).toFixed(1)} MB · ${fmtDate(x.createdAt)}</div>
          </div>
          <div class="spacer"></div>
          <button class="btn" data-restore="${esc(x.path)}">Pulihkan</button>
        </div>`).join("");
    box.querySelectorAll("[data-restore]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Pulihkan cadangan ini? Seluruh memori & konfigurasi saat ini akan diganti dari cadangan.")) return;
        btn.disabled = true;
        btn.textContent = "Memulihkan…";
        try {
          const r = await api("/api/backup/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: btn.dataset.restore }) });
          toast(r.ok ? "Cadangan dipulihkan" : "Gagal: " + (r.error || ""), r.ok ? "ok" : "err");
          if (r.ok) { await Promise.all([loadStats(), loadProjects(), loadBackups()]); }
        } catch (e) {
          toast("Gagal memulihkan: " + e.message, "err");
        }
        btn.disabled = false;
        btn.textContent = "Pulihkan";
      });
    });
  } catch (e) {
    box.innerHTML = '<div class="card-desc" style="margin-top:6px">Gagal memuat cadangan: ' + esc(e.message) + "</div>";
  }
}

function wireSettingsToggles() {
  document.querySelectorAll(".toggle-row[data-key]").forEach((row) => {
    const key = row.dataset.key;
    const sw = row.querySelector(".switch");
    sw.addEventListener("click", (e) => {
      e.stopPropagation();
      const on = !sw.classList.contains("on");
      sw.classList.toggle("on", on);
      saveSettings(key, on);
    });
  });
  document.querySelectorAll(".toggle-row").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest(".switch")) return;
      const sw = row.querySelector(".switch");
      const on = !sw.classList.contains("on");
      sw.classList.toggle("on", on);
      saveSettings(row.dataset.key, on);
    });
  });
}

/* ---------- Edit memory modal ---------- */

let editingId = null;

function openEditModal(id) {
  const items = (state.lastMemories || []).filter((m) => m.id === id);
  renderEditModal(items[0], id);
}

async function renderEditModal(m, id) {
  if (!m) {
    try {
      const d = await api("/api/memories");
      m = (d.memories || []).find((x) => x.id === id);
    } catch {}
    if (!m) { toast("Memori tidak ditemukan", "err"); return; }
  }
  editingId = id;
  $("#overlay h3").textContent = "Edit memori";
  $("#overlay .modal-desc").textContent = "Perbarui isi, jenis, atau tingkat kepentingan.";
  $("#addKind").value = m.kind || "context";
  $("#addProject").value = m.projectSlug || "";
  $("#addContent").value = m.content || "";
  $("#btnSave").textContent = "Simpan perubahan";
  openModal();
}

/* ---------- Actions ---------- */

function download(filename, text, type = "text/markdown") {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function doScan() {
  const btnText = $("#btnScanText");
  const old = btnText.textContent;
  btnText.textContent = "Memindai…";
  $("#btnScan").disabled = true;
  try {
    const d = await api("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" } });
    const props = d.results.filter((r) => r.ok && r.count > 0);
    if (props.length) toast("Scan selesai — baru: " + props.map((r) => `${r.tool} +${r.count}`).join(", "));
    else toast("Scan selesai — tidak ada data baru");
    await Promise.all([loadStats(), loadProjects()]);
    if (state.view === "memories") renderMemories();
  } catch (e) {
    toast("Gagal scan: " + e.message, "err");
  } finally {
    btnText.textContent = old;
    $("#btnScan").disabled = false;
  }
}

async function saveMemory() {
  const content = $("#addContent").value.trim();
  if (!content) { toast("Isi memori tidak boleh kosong", "err"); return; }
  try {
    if (editingId) {
      await api("/api/memories", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId, kind: $("#addKind").value, content }),
      });
      toast("Memori diperbarui");
      resetModal();
      loadStats();
      if (state.view === "memories") renderMemories();
      return;
    }
    await api("/api/remember", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: $("#addKind").value, content, project: $("#addProject").value.trim() }),
    });
    $("#addContent").value = "";
    $("#addProject").value = "";
    closeModal();
    toast("Memori tersimpan");
    loadStats();
    if (state.view === "memories") renderMemories();
  } catch (e) {
    toast("Gagal simpan: " + e.message, "err");
  }
}

function resetModal() {
  editingId = null;
  $("#addContent").value = "";
  $("#addProject").value = "";
  $("#overlay h3").textContent = "Tambah memori";
  $("#overlay .modal-desc").textContent = "Simpan fakta, keputusan, atau tugas agar diingat di semua AI tools.";
  $("#btnSave").textContent = "Simpan memori";
  closeModal();
}

function openModal() { $("#overlay").classList.add("show"); setTimeout(() => $("#addContent").focus(), 60); }
function closeModal() { $("#overlay").classList.remove("show"); }

/* ---------- Events ---------- */

document.querySelectorAll(".nav-item").forEach((n) => {
  n.addEventListener("click", () => {
    setView(n.dataset.view);
    if (n.dataset.view === "memories") { loadTags(); renderMemories(); }
    if (n.dataset.view === "projects") renderProjects();
    if (n.dataset.view === "timeline") renderTimeline();
    if (n.dataset.view === "graph") renderGraph();
    if (n.dataset.view === "integrations") renderIntegrations();
    if (n.dataset.view === "settings") { renderSettings(); loadSettingsToggles(); loadBackups(); }
  });
});
$("#linkAllMem").addEventListener("click", () => { setView("memories"); renderMemories(); });
$("#linkAllProj").addEventListener("click", () => { setView("projects"); renderProjects(); });

$("#btnScan").addEventListener("click", doScan);
$("#btnAdd").addEventListener("click", () => { resetModal(); openModal(); });
$("#btnCancel").addEventListener("click", resetModal);
$("#btnSave").addEventListener("click", saveMemory);
$("#overlay").addEventListener("click", (e) => { if (e.target === $("#overlay")) resetModal(); });

$("#hfGen").addEventListener("click", renderHandoff);
$("#hfProject").addEventListener("change", renderHandoff);
$("#hfCopy").addEventListener("click", () => {
  if (!handoffText) { toast("Belum ada handoff", "err"); return; }
  navigator.clipboard.writeText(handoffText).then(() => toast("Handoff disalin")).catch(() => toast("Gagal menyalin", "err"));
});
$("#hfInject").addEventListener("click", async () => {
  const slug = $("#hfProject").value;
  if (!slug) { toast("Pilih proyek dulu", "err"); return; }
  try {
    const r = await api("/api/handoff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, file: "AGENTS.md" }) });
    if (r.ok) toast("Handoff diinjeksi ke AGENTS.md");
    else toast("Gagal injeksi (periksa izin tulis)", "err");
  } catch (e) {
    toast("Gagal injeksi: " + e.message, "err");
  }
});

$("#tlProject").addEventListener("change", () => { tlMode = "text"; renderTimeline(); });
$("#tlGitBtn").addEventListener("click", () => {
  tlMode = tlMode === "git" ? "text" : "git";
  $("#tlGitBtn").classList.toggle("primary", tlMode === "git");
  renderTimeline();
});

$("#grProject").addEventListener("change", renderGraph);
$("#grRebuild").addEventListener("click", async () => {
  try {
    const r = await api("/api/graph/rebuild", { method: "POST" });
    toast("Koneksi dibangun ulang: " + r.links + " link");
    renderGraph();
  } catch (e) {
    toast("Gagal: " + e.message, "err");
  }
});
wireGraphCanvas();

$("#btnBackupNow").addEventListener("click", async () => {
  try {
    const r = await api("/api/backup", { method: "POST" });
    toast(r.ok ? "Cadangan tersimpan: " + r.path : "Gagal cadangan", r.ok ? "ok" : "err");
    loadBackups();
  } catch (e) {
    toast("Gagal cadangan: " + e.message, "err");
  }
});
$("#btnExport").addEventListener("click", async () => {
  try {
    const d = await api("/api/export?format=md");
    download("memoria.md", d.text || "");
    toast("Ekspor selesai");
  } catch (e) {
    toast("Gagal ekspor: " + e.message, "err");
  }
});
$("#btnExportJson").addEventListener("click", async () => {
  try {
    const d = await api("/api/export?format=json");
    download("memoria.json", JSON.stringify(d, null, 2), "application/json");
    toast("Ekspor JSON selesai");
  } catch (e) {
    toast("Gagal ekspor: " + e.message, "err");
  }
});
$("#btnObsidian").addEventListener("click", async () => {
  try {
    const r = await api("/api/export/obsidian", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    if (r.ok) toast("Vault Obsidian tersimpan: " + r.dir + " (" + r.notes + " catatan)");
    else toast("Gagal ekspor: " + (r.error || ""), "err");
  } catch (e) {
    toast("Gagal ekspor: " + e.message, "err");
  }
});
$("#btnTopics").addEventListener("click", async () => {
  try {
    const btn = $("#btnTopics");
    btn.disabled = true;
    btn.textContent = "Membangun…";
    const r = await api("/api/tags/rebuild", { method: "POST" });
    toast("Tag topik dibangun: " + r.memories + " memori → " + r.topics + " topik");
    loadTags();
  } catch (e) {
    toast("Gagal: " + e.message, "err");
  } finally {
    const btn = $("#btnTopics");
    btn.disabled = false;
    btn.textContent = "Bangun tag topik sekarang";
  }
});
$("#btnDigest").addEventListener("click", async () => {
  const box = $("#digestBox");
  box.textContent = "Membuat ringkasan…";
  try {
    const r = await api("/api/digest/generate", { method: "POST" });
    box.textContent = r.text || "";
    toast("Ringkasan mingguan dibuat (" + r.memories + " memori)");
  } catch (e) {
    box.textContent = "Gagal: " + e.message;
  }
});

$("#btnImport").addEventListener("click", async () => {
  const text = $("#importText").value.trim();
  if (!text) { toast("Teks masih kosong", "err"); return; }
  try {
    const r = await api("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, tool: "import" }) });
    if (r.ok) { toast("Konteks disimpan sebagai transkrip untuk diekstrak"); $("#importText").value = ""; loadStats(); }
    else toast("Gagal impor", "err");
  } catch (e) {
    toast("Gagal impor: " + e.message, "err");
  }
});

wireSettingsToggles();

$("#search").addEventListener("input", debounce(async (e) => {
  state.search = e.target.value;
  if (state.view !== "memories") setView("memories");
  renderMemories();
}, 350));
document.querySelectorAll(".mem-tabs .seg").forEach((b) => {
  b.addEventListener("click", () => {
    state.memTab = b.dataset.memtab;
    document.querySelectorAll(".mem-tabs .seg").forEach((x) => x.classList.toggle("active", x === b));
    renderMemories();
  });
}); 
$("#filterKind").addEventListener("change", (e) => { state.filterKind = e.target.value; renderMemories(); });
$("#filterProject").addEventListener("change", (e) => { state.filterProject = e.target.value; renderMemories(); });
$("#filterTag").addEventListener("change", (e) => { state.filterTag = e.target.value; renderMemories(); });

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    $("#search").focus();
  }
  if (e.key === "Escape") resetModal();
  // Ctrl/Cmd+Enter untuk simpan — Enter biasa tetap buat baris baru (memori bisa multiline).
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && e.target === $("#addContent")) saveMemory();
});

/* ---------- Init ---------- */

(async function init() {
  await loadProjects();
  await loadStats();
  setInterval(loadStats, 12000);
})();