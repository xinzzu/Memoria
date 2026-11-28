// Same-origin: dashboard dilayani oleh HTTP engine itu sendiri — port tidak perlu di-hardcode.
const API = "";
const $ = (sel) => document.querySelector(sel);
// Slug panjang ("users-mac-documents-workspace-foo") -> tampil singkat ("foo").
function prettySlug(slug) {
  if (!slug) return "global";
  let x = slug.replace(/^users-mac-documents(-workspaces?)?-?/, "").replace(/^users-mac-?/, "");
  x = x.replace(/[-_]+/g, " ").trim();
  if (!x) x = slug.replace(/[-_]+/g, " ");
  return x.length > 26 ? x.slice(0, 26).trim() + "…" : x;
}

const KIND_LABEL = {
  fact: "Fact", decision: "Decision", task_done: "Done", task_pending: "Pending",
  error_fixed: "Error Fixed", preference: "Preference", context: "Context",
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
  filterAge: "", // "7"|"30"|"90" hari — "" = semua
};

/* ---------- Helpers ---------- */

async function api(path, opts = {}) {
  const res = await fetch(API + path, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  if (res.status === 401 && data.auth) showSignInHint();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

/* The local API needs a token (cookie). Electron sets it automatically; in a
 * plain browser the user opens the one-time link that `memoria server` prints. */
function showSignInHint() {
  if (document.getElementById("signInHint")) return;
  const el = document.createElement("div");
  el.id = "signInHint";
  el.setAttribute("role", "alert");
  el.style.cssText = "position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:9999;max-width:560px;padding:12px 16px;border-radius:10px;background:var(--card, #1b1d22);border:1px solid var(--border, #333);color:var(--text, #eee);font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.35)";
  el.innerHTML = `<b>${esc(t("Sign in required"))}</b><div style="margin-top:4px">${esc(t("Open the dashboard link printed by `memoria server` (it contains ?token=…). Run `memoria token` to print it again."))}</div>`;
  document.body.appendChild(el);
}

function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getDate()} ${I18N.months()[d.getMonth()]} ${d.getFullYear()}`;
}

function fmtRel(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return t("just now");
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
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

// PR-O: highlight kata pencarian pada konten (esc dulu, token di-escape juga,
// lalu dibungkus <mark> — aman terhadap entity).
function hlContent(text) {
  const escd = esc(text);
  const q = (state.search || "").trim();
  if (!q) return escd;
  const terms = q.toLowerCase().split(/[\s,.;:!?()[\]{}"'/\\-]+/).filter((t) => t.length > 2).slice(0, 6);
  if (!terms.length) return escd;
  // M13 (audit): SATU pass dengan alternasi gabungan — penggantian
  // berurutan per-istilah bisa mencocokkan markup <mark> yang baru
  // disisipkan istilah sebelumnya (mis. query "mark").
  const alt = terms
    .map((t) => esc(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((x, y) => y.length - x.length)
    .join("|");
  return escd.replace(new RegExp(alt, "gi"), (m) => '<mark class="hl">' + m + "</mark>");
}

function memoRowRenderer(renderId) {
  const isDraft = state.memTab === "draft";
  const isArchived = state.memTab === "archived";
  return (h, i) => `
    <div class="mem" data-id="${h.id}">
      <div class="mem-rail">${isDraft ? `<input type="checkbox" class="mem-select" data-sel="${h.id}" />` : `<span class="kind-dot kind-${h.kind}"></span>`}</div>
      <div class="mem-body">
        <div class="mem-meta">
          <span class="mem-kind kind-${h.kind}">${t(KIND_LABEL[h.kind] || h.kind)}</span>
          ${h.status === "draft" ? '<span class="mem-kind" style="opacity:.7">Draft</span>' : ""}
          ${!isArchived && h.kind === "decision" && h.validTo > 0 ? `<span class="mem-kind" style="opacity:.7" title="${esc(t("A newer decision about the same subject replaced this one"))}">${esc(t("Superseded"))}</span>` : ""}
          <span class="sep">·</span>
          <span>${esc(prettySlug(h.projectSlug))}</span>
          <span class="sep">·</span>
          <span>${esc(TOOL_LABEL[h.sourceTool] || h.sourceTool)}</span>
          <span class="sep">·</span>
          <span>${fmtRel(h.createdAt)}</span>
        </div>
        <div class="mem-content">${hlContent(h.content)}</div>
        ${h.entities && h.entities.length ? `<div class="mem-chips">${h.entities.slice(0, 8).map((e) => `<span class="chip ent" data-ent="${esc(e.text)}">${esc(e.text)}</span>`).join("")}</div>` : ""}
        ${h.tags && h.tags.length ? `<div class="mem-chips">${h.tags.map((t) => `<span class="chip tag" data-tag="${esc(t)}">#${esc(t)}</span>`).join("")}</div>` : ""}
      </div>
      <div class="mem-actions">
        ${isDraft ? `<button class="mem-approve" title="${t("Approve memory")}" data-appr="${h.id}">Approve ✓</button>` : ""}
        ${isArchived ? `<button class="mem-approve" title="${t("Restore memory")}" data-rs="${h.id}">Restore</button>` : ""}
        ${!isArchived && h.kind === "decision" && h.validTo > 0 ? `<button class="mem-approve" title="${esc(t("Mark this decision as current again"))}" data-cur="${h.id}">${esc(t("Still current"))}</button>` : ""}
        <button class="icon-btn" title="${t("View connections")}" data-rel="${h.id}">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="3.5" cy="4" r="1.6"/><circle cx="12.5" cy="3" r="1.6"/><circle cx="10" cy="11" r="1.6"/><path d="M5 4.8l5.8-1.2M3.7 5.6l1 4.3M9.2 10l1-7.4"/></svg>
        </button>
        ${isArchived ? "" : `<button class="icon-btn" title="${t("Archive")}" data-arch="${h.id}">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5h12M4 4.5V14h8V4.5M5.5 8h5"/><path d="M2 2.5h12"/></svg>
        </button>`}
        <button class="icon-btn" title="${t("Edit")}" data-edit="${h.id}">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2.5l2.5 2.5L6 12.5l-3 .5.5-3L11 2.5z"/></svg>
        </button>
        <button class="icon-btn danger" title="${t("Delete")}" data-del="${h.id}">
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
  // M1 (audit): matikan RAF label graph saat meninggalkan view graph —
  // dulu loop requestAnimationFrame terus berputar ~60x/s tanpa henti.
  if (name !== "graph" && typeof __labelRaf !== "undefined" && __labelRaf) {
    cancelAnimationFrame(__labelRaf);
    __labelRaf = 0;
  }
  document.querySelectorAll(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.view === name));
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  $("#view-" + name).classList.add("active");
  const meta = {
    overview: ["Overview", t("Memory summary across all AI tools")],
    memories: [t("Memories"), t("Search and manage stored memories")],
    projects: [t("Projects"), t("Activity by project")],
    project: ["Project", t("One project - memories, tasks and activity in one place")],
    timeline: ["Timeline", t("Per-project activity trail")],
    handoff: ["Handoff", t("Context summary for the next AI session")],
    tasks: [t("Tasks"), t("Everything your AI sessions promised - in one checklist")],
    retrievals: [t("Retrievals"), t("What each MCP tool returned to your agents")],
    graph: ["Graph", t("Map of connections between memories")],
    integrations: [t("Integrations"), t("Register Memoria with your AI tools")],
    settings: [t("Settings"), t("Data sources and integrations")],
  }[name];
  $("#pageTitle").textContent = meta[0];
  $("#pageSub").textContent = meta[1];
  if (name !== "graph") graph.running = false;
  // M11 (audit): loader per-view milik setView — pemanggil manapun
  // (nav, tombol jump, banner Review drafts) otomatis memuat data;
  // tidak ada lagi halaman Graph/Integrations kosong dari jalur lain.
  if (name === "memories") { loadTags(); renderMemories(); }
  if (name === "projects") renderProjects();
  if (name === "timeline") renderTimeline();
  if (name === "graph") renderGraph();
  if (name === "tasks") renderTasks();
  if (name === "retrievals") renderRetrievals();
  if (name === "integrations") renderIntegrations();
  if (name === "settings") { renderSettings(); loadSettingsToggles(); loadBackups(); loadSyncStatus(); loadSyncDevices(); loadCaptureHealth(); }
}

/* Kartu Overview: berapa konteks yang dikirim ke agen dan berapa yang dihemat
 * mode indeks (progressive disclosure). Angka lokal, tanpa telemetry. */
async function loadUsage() {
  const body = document.getElementById("usageBody");
  if (!body) return;
  try {
    const c = await api("/api/continuity");
    const u = c.usage7d || {};
    if (!u.calls) {
      body.textContent = t("No context delivered yet. It appears once an AI tool calls Memoria or reads a resume block.");
      return;
    }
    const n = (x) => Number(x || 0).toLocaleString();
    const rows = [
      [t("Context requests"), n(u.calls)],
      [t("Resume blocks written"), n(u.resumeBlocks)],
      [t("Tokens delivered"), "≈ " + n(u.tokensDelivered)],
      [t("Tokens saved by compact index"), "≈ " + n(u.tokensSavedByIndex)],
      [t("Re-explanations avoided (30 days)"), n(c.reExplanationsSaved)],
    ];
    body.innerHTML = rows.map(([k, v]) => `<div style="display:flex; justify-content:space-between; padding:2px 0"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("");
  } catch {
    body.textContent = "";
  }
}

/* Overview card: weekly learning journal. Recurring fixes get the space,
 * new ones a compact line; each row opens the memory. */
async function loadJournal() {
  const body = document.getElementById("journalBody");
  if (!body) return;
  let j;
  try {
    j = await api("/api/journal?days=7");
  } catch {
    body.textContent = "";
    return;
  }
  const entries = j.entries || [];
  if (!entries.length) {
    body.innerHTML = `<div class="jr-empty"><b>${esc(t("No fixed errors this week."))}</b><span>${esc(t("When a session fixes an error, it lands here. Errors that come back are listed first."))}</span></div>`;
    return;
  }
  const rec = entries.filter((e) => e.recurring);
  const fresh = entries.filter((e) => !e.recurring);
  const diff = j.fixes - (j.previousFixes || 0);
  const trend = diff === 0 ? t("same as last week") : t("{0} vs last week", (diff > 0 ? "+" : "−") + Math.abs(diff));
  const stat = (n, label, cls = "") =>
    `<div class="jr-stat ${cls}"><b>${n}</b><span>${esc(label)}${cls === "fx" ? `<span class="jr-trend" title="${esc(t("Compared with the 7 days before"))}">· ${esc(trend)}</span>` : ""}</span></div>`;
  const files = (e) => (e.files || []).slice(0, 2).map((f) => `<span class="jr-file">${esc(f.split("/").slice(-2).join("/"))}</span>`).join("");
  const recRow = (e) => {
    const n = e.timesThisWeek + e.timesBefore;
    const when = e.timesBefore ? t("also fixed {0}× before", e.timesBefore) : t("{0}× this week", e.timesThisWeek);
    return `<div class="jr-item rec" tabindex="0" role="button" data-jr="${e.id}">
      <div class="jr-body">
        <div class="jr-text">${esc(e.content)}</div>
        <div class="jr-meta"><span>${esc(e.project)}</span><span>·</span><span>${esc(when)}</span>${files(e)}</div>
      </div>
      <div class="jr-count" title="${esc(t("Times fixed"))}">${n}×</div>
    </div>`;
  };
  const newRow = (e) => `<div class="jr-new" tabindex="0" role="button" data-jr="${e.id}">
      <span class="jr-dot"></span><span class="jr-one">${esc(e.content)}</span><span class="jr-when">${esc(fmtRel(e.createdAt))}</span>
    </div>`;
  const NEW_SHOWN = 3;
  let html = `<div class="jr-stats">${stat(j.fixes, t("fixed"), "fx")}${stat(rec.length, t("keep coming back"), "rec")}${stat(fresh.length, t("new"))}</div>`;
  if (rec.length) html += `<div class="jr-label">${esc(t("Keeps coming back"))}</div>` + rec.slice(0, 3).map(recRow).join("");
  if (fresh.length) {
    html += `<div class="jr-label" style="margin-top:10px">${esc(t("New this week"))}</div>` + fresh.slice(0, NEW_SHOWN).map(newRow).join("");
    if (fresh.length > NEW_SHOWN) html += `<button class="jr-more" id="jrMore">${esc(t("Show {0} more", fresh.length - NEW_SHOWN))}</button>`;
  }
  body.innerHTML = html;
  const open = (el) => openEditModal(Number(el.dataset.jr));
  body.querySelectorAll("[data-jr]").forEach((el) => {
    el.addEventListener("click", () => open(el));
    el.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); open(el); } });
  });
  body.querySelector("#jrMore")?.addEventListener("click", (ev) => {
    ev.currentTarget.insertAdjacentHTML("beforebegin", fresh.slice(NEW_SHOWN).map(newRow).join(""));
    ev.currentTarget.remove();
    body.querySelectorAll(".jr-new[data-jr]").forEach((el) => { el.onclick = () => open(el); });
  });
}
async function loadStats() {
  loadUsage();
  loadJournal();
  try {
    state.stats = await api("/api/stats");
    $("#sTranscripts").textContent = state.stats.transcripts.toLocaleString("id-ID");
    $("#sMemories").textContent = state.stats.memories.toLocaleString("id-ID");
    $("#sPending").textContent = state.stats.pending.toLocaleString("id-ID");
    // Chip versi dinamis (dulu hardcoded "v0.7.1 · …" — selalu basi tiap rilis).
    $("#chipVersion") && ($("#chipVersion").textContent = (state.stats.version ? "v" + state.stats.version : "") + " · local · private");
    $("#navMemCount").textContent = state.stats.memories > 0 ? state.stats.memories.toLocaleString("id-ID") : "";
    const ollama = state.stats.ollamaOnline;
    const engine = state.stats.engine;
    $("#ollamaDot").className = "dot " + (ollama || engine ? "on" : "off");
    // Chip topbar kini menampilkan mesin aktif (bukan cuma status Ollama) —
    // user tanpa Ollama tetap melihat bahwa heuristik yang bekerja.
    $("#ollamaText").textContent = engine ? t(engine.extract) : (ollama ? t("Ollama: online") : t("Ollama: offline"));
    // Badge jumlah di tab pustaka memori
    const st2 = state.stats || {};
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set("cntActive", st2.memories ?? "");
    set("cntDraft", st2.draft ?? "");
    set("cntArchive", st2.archived ?? "");
    const cm = $("#cfgMem"); if (cm) cm.textContent = st2.rssMB ? st2.rssMB + " MB" : "—";
    $("#sOllama").textContent = "Ollama: " + (ollama ? "online" : "offline");
    if (state.view === "overview") renderOverview();
    if (state.view === "settings") renderSettings();
  } catch (e) {
    $("#ollamaDot").className = "dot off";
    $("#ollamaText").textContent = t("API unreachable");
  }
}

async function loadProjects() {
  try {
    const d = await api("/api/projects");
    state.projects = d.projects || [];
    const sel = $("#filterProject");
    sel.innerHTML = '<option value="">' + t("All projects") + '</option>';
    const hf = $("#hfProject");
    hf.innerHTML = '<option value="">' + t("Pick a project…") + '</option>';
    const tl = $("#tlProject");
    tl.innerHTML = '<option value="">' + t("Pick a project…") + '</option>';
    const gr = $("#grProject");
    gr.innerHTML = '<option value="">' + t("All projects") + '</option>';
    const tk = $("#tkProject");
    if (tk) {
      tk.innerHTML = '<option value="">' + t("All projects") + '</option>';
      for (const p of state.projects) {
        const o = document.createElement("option");
        o.value = p.slug;
        o.textContent = p.name;
        tk.appendChild(o.cloneNode(true));
      }
    }
    for (const p of state.projects) {
      const o = document.createElement("option");
      o.value = p.slug;
      o.textContent = p.name;
      sel.appendChild(o);
      hf.appendChild(o.cloneNode(true));
      tl.appendChild(o.cloneNode(true));
      gr.appendChild(o.cloneNode(true));
    }
    const sp2 = $("#sProjects2"); if (sp2) sp2.textContent = state.projects.length;
    if (state.view === "overview") renderOverview();
    if (state.view === "projects") renderProjects();
  } catch {}
}

function renderOverview() {
  const st = state.stats;
  // Setup checklist: tampil sampai semua aman (wizard pragmatis)
  const setupBox = document.getElementById("setupChecklist");
  if (setupBox) {
    const checks = st ? [
      { ok: st.setup.toolsDetected > 0, label: t("AI tools detected"), hint: t("Use your AI tools, then run a scan") },
      { ok: true, label: t("Engine") + ": " + t(st.setup.engineLabel), hint: "" },
      { ok: st.setup.memoriesCount > 0, label: t("Memories created"), hint: t("Memories appear as sessions are extracted") },
    ] : null;
    if (!checks || checks.every((c) => c.ok)) {
      setupBox.innerHTML = "";
    } else {
      setupBox.innerHTML = `<div class="card setup-card">
        <h4>${t("Setup checklist")}</h4>
        ${checks.map((c) => `<div class="setup-row"><span class="setup-dot ${c.ok ? "ok" : "wait"}"></span><div><div class="setup-label">${esc(c.label)}</div>${c.hint ? `<div class="setup-hint">${esc(c.hint)}</div>` : ""}</div></div>`).join("")}
      </div>`;
    }
  }
  const hero = $("#overviewHero");

  // Greeting personal (ganti hero onboarding saat data mulai ada)
  if (hero) {
    if (st && st.transcripts === 0) {
      hero.innerHTML = `<div class="hero">
        <h3>${t("Welcome to Memoria")}</h3>
        <p>${t("Your AI tools' sessions are captured automatically — decisions, tasks and fixes become memories shared across every tool. Start with a scan, or register your tools.")}</p>
        <div class="hero-actions">
          <button class="btn primary" id="heroScan">${t("Scan now")}</button>
          <button class="btn" id="heroIntegrations">${t("Connect your AI tools")}</button>
        </div>
      </div>`;
      hero.querySelector("#heroScan")?.addEventListener("click", doScan);
      hero.querySelector("#heroIntegrations")?.addEventListener("click", () => setView("integrations"));
    } else if (!st) {
      hero.innerHTML = '<div class="skeleton"></div><div class="skeleton" style="height:20px"></div>';
    } else {
      const name = esc(st.user || "");
      hero.innerHTML = `<div class="greet">
        <h2>${t("Hello, ")}<span class="gname">${name || t("there")}</span></h2>
        <p>${t("Your cross-tool memory — captured locally, ready for every new session.")}</p>
      </div>`;
    }
    // skeleton list saat pertama kali
    const rl0 = $("#recentList");
    if (rl0 && !st && !rl0.innerHTML.trim()) rl0.innerHTML = '<div class="skeleton"></div><div class="skeleton" style="height:40px"></div>';
  }

  const recent = (st && st.recent) || [];
  const rl = $("#recentList");
  if (!recent.length) {
    if (st) rl.innerHTML = emptyState(t("No memories yet"), t("A scan is running, or no AI tool activity has been captured yet."), `<button class="btn primary" id="emptyScan">${t("Scan now")}</button>`);
    const b = rl && rl.querySelector("#emptyScan");
    if (b) b.addEventListener("click", doScan);
  } else {
    rl.innerHTML = recent.map(memoRowRenderer()).join("");
    bindRowActions(rl);
  }

  // Kartu proyek (angka di kartu hijau) + navigasi tombol panah kartu
  $("#sProjects2") && ($("#sProjects2").textContent = state.projects.length.toLocaleString("id-ID"));
  document.querySelectorAll(".stat-go[data-go]").forEach((btn) => {
    btn.onclick = () => setView(btn.dataset.go);
  });

  const pl = $("#recentProjects");
  const projs = state.projects.slice(0, 8);
  if (pl) {
    if (!projs.length) {
      pl.innerHTML = emptyState(t("No projects yet"), t("Projects appear automatically as new transcripts arrive."));
    } else {
      const hues = ["#f5b942", "#a684ff", "#9fdd5f", "#6e8dff", "#ff9d6e", "#63d8e0", "#e5686b", "#9d8cff"];
      pl.innerHTML = projs.map((p, i) => {
        const today = (state.stats.week && state.stats.week[6] && state.stats.week[6].count) || 0;
        const badge = i === 0 && today > 0 ? `+${today}` : `${(p.transcripts || 0).toLocaleString("id-ID")}`;
        return `<div class="feed-item" data-open-project="${esc(p.slug)}" title="${esc(p.slug)}">
          <span class="feed-dot" style="background:${hues[i % hues.length]}"></span>
          <div style="min-width:0">
            <div class="feed-name">${esc(p.name)}</div>
            <div class="feed-sub">${fmtRel(p.last_seen)}</div>
          </div>
          <span class="feed-badge">${badge}</span>
        </div>`;
      }).join("");
      pl.querySelectorAll("[data-open-project]").forEach((el) => {
        el.addEventListener("click", () => showProject(el.dataset.openProject));
      });
    }
  }

  // Kartu resume siap
  const rsl = $("#resumeList");
  if (rsl) {
    const ready = (st && st.resumeReady) || [];
    if (!ready.length) {
      rsl.innerHTML = `<div class="card-desc">${t("No context injected yet — it happens automatically when a session goes idle, or use the Handoff tab.")}</div>`;
    } else {
      rsl.innerHTML = ready.map((r) => `
        <div class="resume-item">
          <span class="resume-dot"></span>
          <div style="min-width:0">
            <div class="feed-name">${esc(r.name)}</div>
            <div class="feed-sub">${t("Context injected")} · ${fmtRel(r.at)}</div>
          </div>
        </div>`).join("") +
        `<button class="btn" id="goHandoff" style="margin-top:10px">${t("Open Handoff")}</button>`;
      const g = rsl.querySelector("#goHandoff");
      if (g) g.addEventListener("click", () => setView("handoff"));
    }
  }

  drawActivityChart();
}

/* Area chart 7 hari gaya Polysure: garis gradien + isian lembut + tooltip hover. */
function drawActivityChart() {
  const canvas = $("#activityChart");
  if (!canvas) return;
  const week = (state.stats && state.stats.week) || [];
  const box = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const W = box.clientWidth - 40, H = 190;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.height = H + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const max = Math.max(4, ...week.map((w) => Math.max(w.count, w.memories || 0)));
  const padL = 8, padR = 8, padT = 18, padB = 26;
  const iw = W - padL - padR, ih = H - padT - padB;
  const pts = week.map((w, i) => ({
    x: padL + (week.length === 1 ? iw / 2 : (i / (week.length - 1)) * iw),
    y: padT + ih - (w.count / max) * ih * 0.9,
    ...w,
  }));
  // PR-L: series kedua — memori dibuat per hari (active + draft heuristik).
  const mpts = week.map((w, i) => ({
    x: padL + (week.length === 1 ? iw / 2 : (i / (week.length - 1)) * iw),
    y: padT + ih - ((w.memories || 0) / max) * ih * 0.9,
    day: w.day,
    count: w.memories || 0,
  }));

  // grid horizontal halus
  ctx.strokeStyle = "rgba(255,255,255,.05)";
  ctx.lineWidth = 1;
  for (let g = 0; g <= 3; g++) {
    const y = padT + (ih / 3) * g;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
  }

  const line = (pts) => {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const xc = (pts[i - 1].x + pts[i].x) / 2;
      ctx.bezierCurveTo(xc, pts[i - 1].y, xc, pts[i].y, pts[i].x, pts[i].y);
    }
  };

  // isian gradien
  const grad = ctx.createLinearGradient(0, padT, 0, H - padB);
  if (isLightTheme()) {
    grad.addColorStop(0, "rgba(122, 95, 208, 0.22)");
    grad.addColorStop(1, "rgba(122, 95, 208, 0)");
  } else {
    grad.addColorStop(0, "rgba(139,110,255,.34)");
    grad.addColorStop(1, "rgba(139,110,255,0)");
  }
  line(pts);
  ctx.lineTo(pts[pts.length - 1].x, H - padB);
  ctx.lineTo(pts[0].x, H - padB);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // garis utama (messages) + series kedua (memories — PR-L)
  const drawMemoriesLine = () => {
    ctx.beginPath();
    if (mpts.length) {
      ctx.moveTo(mpts[0].x, mpts[0].y);
      for (let i = 1; i < mpts.length; i++) {
        const xc = (mpts[i - 1].x + mpts[i].x) / 2;
        ctx.bezierCurveTo(xc, mpts[i - 1].y, xc, mpts[i].y, mpts[i].x, mpts[i].y);
      }
    }
    ctx.strokeStyle = "#4cc38a";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    mpts.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.count > 0 ? 3.4 : 2.6, 0, Math.PI * 2);
      ctx.fillStyle = p.count > 0 ? "#4cc38a" : (isLightTheme() ? "#c8cdd6" : "#3a4152");
      ctx.fill();
    });
  };
  drawMemoriesLine();
  line(pts);
  ctx.strokeStyle = isLightTheme() ? "#7a5fd0" : "#a684ff";
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.stroke();

  // titik + label hari
  ctx.font = "10.5px Inter, sans-serif";
  pts.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p === pts[pts.length - 1] || p.count > 0 ? 4 : 3, 0, Math.PI * 2);
    ctx.fillStyle = p.count > 0 ? (isLightTheme() ? "#7a5fd0" : "#c3a4ff") : (isLightTheme() ? "#c8cdd6" : "#3a4152");
    ctx.fill();
    if (p === pts[pts.length - 1]) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke(); }
    ctx.fillStyle = "#5d6575";
    ctx.textAlign = "center";
    ctx.fillText(p.day.slice(3), p.x, H - 8);
  });

  // tooltip hover
  let tip = $("#chart-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "chart-tip";
    canvas.parentElement.style.position = "relative";
    canvas.parentElement.appendChild(tip);
  }
  canvas.onmousemove = (e) => {
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.x - mx) < Math.abs(best.x - mx)) best = p;
    tip.style.left = best.x + 20 + "px";
    tip.style.top = best.y + 10 + "px";
    tip.style.opacity = 1;
    tip.textContent = `${best.day}: ${best.count} ${t("messages")} · ${best.memories || 0} ${t("memories")}`;
  };
  canvas.onmouseleave = () => { tip.style.opacity = 0; };
}

function projectRow(p, clickable) {
  return `<div class="project-row${clickable ? " clickable" : ""}"${clickable ? ` data-open-project="${esc(p.slug)}"` : ""}>
    <div class="project-icon"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5l6-3 6 3M2 5l6 3 6-3M2 5v6l6 3 6-3V5"/><path d="M8 8v6"/></svg></div>
    <div>
      <div class="project-name">${esc(p.name)}</div>
      <div class="project-slug">${esc(p.slug)}</div>
    </div>
    <div class="project-meta">
      <div>${(p.transcripts || 0).toLocaleString("id-ID")} transcripts</div>
      <div class="sub">${fmtRel(p.last_seen)}</div>
    </div>
  </div>`;
}

let memPagination = null; // { offset, hasMore } untuk tab aktif tanpa filter

let memRenderSeq = 0; // PR-N: "latest wins" — respons fetch lama tidak menimpa

async function renderMemories(append = false) {
  const seq = ++memRenderSeq;
  const fresh = () => seq === memRenderSeq; // false = ada render lebih baru
  const q = state.search.trim();
  const box = $("#memoriesList");
  // PR-O: filter umur — server-side di jalur paginated (`since`), client-side
  // di jalur list/tag/search.
  const since = state.filterAge ? Date.now() - Number(state.filterAge) * 86400000 : 0;
  const byAge = (m) => !since || (m.createdAt || 0) >= since;
  try {
    if (state.filterTag && state.memTab === "active") {
      const offset = append && memPagination ? memPagination.offset : 0;
      const d = await api(`/api/memories/tag?tag=${encodeURIComponent(state.filterTag)}&limit=50&offset=${offset}`);
      if (!fresh()) return;
      const items = (d.memories || []).filter(byAge).map((m) => ({ ...m, score: 1 }));
      memPagination = { offset: offset + (d.memories || []).length, hasMore: !!d.hasMore };
      if (append) appendMemoryList(box, items);
      else renderMemoryList(box, items);
      renderLoadMore(box);
      return;
    }
    if (state.memTab !== "active") {
      const offset = append && memPagination ? memPagination.offset : 0;
      const d = await api(`/api/memories/list?status=${state.memTab}&limit=50&offset=${offset}`);
      if (!fresh()) return;
      const raw = d.memories || [];
      let items = raw;
      if (state.filterKind) items = items.filter((m) => m.kind === state.filterKind);
      if (state.filterProject) items = items.filter((m) => m.projectSlug === state.filterProject);
      if (since) items = items.filter(byAge);
      if (q) items = items.filter((m) => m.content.toLowerCase().includes(q.toLowerCase()));
      // Offset maju per halaman mentah (bukan hasil filter) agar tidak ada
      // halaman yang terlewati; filter tetap bekerja pada halaman termuat.
      memPagination = { offset: offset + raw.length, hasMore: !!d.hasMore };
      const mapped = items.map((m) => ({ ...m, score: 1 }));
      if (append) appendMemoryList(box, mapped);
      else renderMemoryList(box, mapped);
      renderLoadMore(box);
      return;
    }
    const params = new URLSearchParams({ limit: "50" });
    if (state.filterKind) params.set("kind", state.filterKind);
    if (state.filterProject) params.set("project", state.filterProject);
    if (since) params.set("since", String(since));
    if (!q && !state.filterKind && !state.filterProject) {
      const offset = append && memPagination ? memPagination.offset : 0;
      const d = await api(`/api/memories?status=${state.memTab}&limit=50&offset=${offset}${since ? "&since=" + since : ""}`);
      if (!fresh()) return;
      const items = (d.memories || []).map((m) => ({ ...m, score: 1 }));
      memPagination = { offset: offset + items.length, hasMore: !!d.hasMore };
      if (append) appendMemoryList(box, items);
      else renderMemoryList(box, items);
      renderLoadMore(box);
      return;
    }
    memPagination = null;
    // PR-38 H1: filter kind/project TANPA query dulu merender list kosong —
    // /api/search mendukung q kosong (fallback allMemories + filter server),
    // jadi filter tetap hidup tanpa harus mengetik.
    params.set("q", q);
    const d = await api("/api/search?" + params.toString());
    if (!fresh()) return;
    renderMemoryList(box, (d.hits || []).filter(byAge));
  } catch (e) {
    if (!fresh()) return;
    box.innerHTML = `<div class="err-box">
      <h4>${t("Couldn't load memories")}</h4>
      <p>${esc(e.message)}</p>
      <button class="btn" id="memRetry">${t("Retry")}</button>
    </div>`;
    box.querySelector("#memRetry")?.addEventListener("click", () => renderMemories());
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
  btn.textContent = t("Load more");
  btn.addEventListener("click", () => {
    btn.disabled = true;
    btn.textContent = t("Loading…");
    renderMemories(true);
  });
  box.appendChild(btn);
}

function renderMemoryList(box, items) {
  state.lastMemories = items || [];
  // PR-38 H5: batch bar hanya sah di tab draft (dulu bocor ke Active/Archive).
  const bar = document.getElementById('draftBatchBar');
  if (bar) bar.style.display = state.memTab === 'draft' ? 'flex' : 'none';
  if (state.memTab !== 'draft') {
    for (const id of ['draftGroups', 'draftTriageInfo']) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }
  }
  // PR-N: jaga posisi scroll + skip rebuild saat HTML identik — SSE refresh
  // tidak lagi membuat list "berkedip" dan scroll loncat ke atas.
  const content = document.querySelector(".content");
  const scrollBefore = content ? content.scrollTop : 0;
  if (!items || !items.length) {
    box.innerHTML = state.memTab === "draft"
      ? emptyState(t("Inbox is clean"), t("Memoria triages new drafts automatically. Nothing is waiting for you."))
      : (state.search || state.filterKind || state.filterProject || state.filterTag || state.filterAge)
        ? emptyState(t("No matching memories"), t("Try different keywords, or add a memory manually."))
        : state.memTab === "archived"
          ? emptyState(t("Archive is empty"), t("Memories you archive, and drafts that expire, end up here."))
          : emptyState(t("No memories yet"), t("Memories appear here once your AI tools' sessions are scanned. You can also add one with Add."));
    if (state.memTab === "draft") {
      refreshTriageInfo();
      const groups = document.getElementById("draftGroups");
      if (groups) groups.style.display = "none";
    }
    if (content) content.scrollTop = scrollBefore;
    return;
  }
  const html = `<div class="list">${items.map(memoRowRenderer()).join("")}</div>`;
  if (box.innerHTML !== html) {
    box.innerHTML = html;
    bindRowActions(box);
    if (state.memTab === "draft") wireDraftBatch(box);
  }
  if (content) content.scrollTop = scrollBefore;
}

/* ---------- Batch kurasi (Pending approval) ---------- */
function updateDraftBar(box) {
  const n = box.querySelectorAll(".mem-select:checked").length;
  const ba = document.getElementById("batchApprove");
  const bd = document.getElementById("batchDelete");
  if (ba) { ba.style.display = n ? "" : "none"; ba.textContent = `${t("Approve")} ${n}`; }
  if (bd) { bd.style.display = n ? "" : "none"; bd.textContent = `${t("Delete")} ${n}`; }
  const hint = document.getElementById("batchHint");
  if (hint) hint.textContent = n ? "" : t("Select drafts to approve or delete them in one go");
}

function wireCleanNoise() {
  const btn = document.getElementById("batchCleanNoise");
  if (!btn || btn.dataset.wired) return;
  btn.dataset.wired = "1";
  btn.addEventListener("click", async () => {
    if (!confirm(t("Delete all drafts that match known noise patterns (tool status lines, shields.io badges, markdown debris)? This cannot be undone."))) return;
    btn.disabled = true;
    try {
      const r = await api("/api/drafts/clean-noise", { method: "POST" });
      toast(t("Cleaned {0} noise drafts (scanned {1})", r.removed, r.scanned));
      loadStats();
      renderMemories();
    } catch (e) {
      toast(t("Failed: ") + e.message, "err");
    } finally {
      btn.disabled = false;
    }
  });
}
wireCleanNoise();

/* ---------- Auto-triage Tier 0 + inbox berkelompok ----------
 * Draft tidak lagi harus di-approve satu per satu: auto-triage memindahkan
 * noise/duplikat/kedaluwarsa ke arsip dan mempromosikan sinyal kuat, dengan
 * pratinjau sebelum diterapkan dan undo per batch. Grup proyek x jenis
 * memberi aksi massal satu klik untuk sisa draft. */
const kindName = (k) => t(KIND_LABEL[k] || k);

function reasonLabel(r) {
  if (r.startsWith("noise:")) return t("noise") + " (" + r.slice(6) + ")";
  const map = { strong: "strong signal", corroborated: "seen in several sessions", duplicate: "duplicate", "duplicate-of-active": "duplicate of an active memory", expired: "expired", "low-score": "low quality", uncertain: "uncertain" };
  return t(map[r] || r);
}

async function refreshTriageInfo() {
  const info = document.getElementById("draftTriageInfo");
  const undo = document.getElementById("batchUndoTriage");
  if (!info) return;
  try {
    const s = await api("/api/privacy");
    const tr = s.triage || {};
    undo.style.display = tr.lastBatch ? "" : "none";
    const parts = [];
    if (tr.lastAt) parts.push(t("Last auto-triage: {0}", new Date(tr.lastAt).toLocaleString()));
    if (tr.archivedTotal) parts.push(t("{0} noise drafts archived automatically so far", tr.archivedTotal.toLocaleString()));
    if (s.redactedTotal) parts.push(t("{0} secrets redacted before storage", s.redactedTotal.toLocaleString()));
    parts.push(tr.auto ? t("Drafts older than {0} days are re-checked daily", tr.ttlDays) : t("Automatic triage is off"));
    info.textContent = parts.join(" · ");
    info.style.display = "";
  } catch {
    info.style.display = "none";
  }
}

async function renderDraftGroups() {
  const wrap = document.getElementById("draftGroups");
  if (!wrap) return;
  if (state.memTab !== "draft") { wrap.style.display = "none"; return; }
  let data;
  try { data = await api("/api/drafts/groups"); } catch { wrap.style.display = "none"; return; }
  if (!data.groups.length) { wrap.style.display = "none"; return; }
  wrap.style.display = "";
  const patterns = data.patterns || [];
  const patternRows = patterns.length ? `<div class="card-desc" style="margin:12px 0 6px">${esc(t("Drafts that start the same way"))}</div>
    <div class="list">${patterns.map((p, i) => `
      <div style="display:flex; align-items:center; gap:10px; padding:6px 10px; border:1px solid var(--line, rgba(127,127,127,.2)); border-radius:8px">
        <div style="flex:1; min-width:0; font-family:var(--mono); font-size:12px">“${esc(p.pattern)} …” <span class="muted">(${p.ids.length})</span></div>
        <button class="btn" data-pattern-act="archive" data-pattern="${i}">${esc(t("Archive all"))}</button>
        <button class="btn danger-ghost" data-pattern-act="always" data-pattern="${i}" title="${esc(t("Archive these and every future draft that contains this text"))}">${esc(t("Always archive"))}</button>
      </div>`).join("")}</div>` : "";
  wrap.innerHTML = `<div class="card-desc" style="margin:0 0 6px">${esc(t("Review by group — approve or archive a whole group in one click"))}</div>
    <div class="list">${data.groups.slice(0, 12).map((g, i) => `
      <div style="display:flex; align-items:center; gap:10px; padding:6px 10px; border:1px solid var(--line, rgba(127,127,127,.2)); border-radius:8px">
        <div style="flex:1; min-width:0"><b>${esc(g.project)}</b> · ${esc(kindName(g.kind))} <span class="muted">(${g.ids.length})</span></div>
        <button class="btn" data-group-act="approve" data-group="${i}">${esc(t("Approve all"))}</button>
        <button class="btn danger-ghost" data-group-act="archive" data-group="${i}">${esc(t("Archive all"))}</button>
      </div>`).join("")}</div>${patternRows}
    <div class="muted" style="font-size:11.5px; margin-top:8px">${esc(t("Keyboard: j / k move, a approve, x archive, space select"))}</div>`;
  wrap.onclick = async (e) => {
    const pbtn = e.target.closest("[data-pattern-act]");
    if (pbtn) {
      const p = patterns[Number(pbtn.dataset.pattern)];
      pbtn.disabled = true;
      try {
        if (pbtn.dataset.patternAct === "always") {
          const r = await api("/api/drafts/noise-patterns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pattern: p.pattern }) });
          toast(t("Archived {0}; future drafts containing this text are archived automatically", r.archived));
        } else {
          const r = await api("/api/memories/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "archive", ids: p.ids }) });
          toast(t("Archived {0}", r.affected));
        }
        loadStats();
        renderMemories();
        renderDraftGroups();
        refreshTriageInfo();
      } catch (err) {
        toast(t("Failed: ") + err.message, "err");
        pbtn.disabled = false;
      }
      return;
    }
    const btn = e.target.closest("[data-group-act]");
    if (!btn) return;
    const g = data.groups[Number(btn.dataset.group)];
    const action = btn.dataset.groupAct;
    btn.disabled = true;
    try {
      const r = await api("/api/memories/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ids: g.ids }) });
      toast(action === "approve" ? `${t("Approved")} ${r.affected}` : t("Archived {0}", r.affected));
      loadStats();
      renderMemories();
      renderDraftGroups();
    } catch (err) {
      toast(t("Failed: ") + err.message, "err");
      btn.disabled = false;
    }
  };
}

function wireAutoTriage() {
  const run = document.getElementById("batchAutoTriage");
  const undo = document.getElementById("batchUndoTriage");
  if (!run || run.dataset.wired) return;
  run.dataset.wired = "1";
  run.addEventListener("click", async () => {
    run.disabled = true;
    try {
      const { preview } = await api("/api/triage");
      if (!preview.promoted && !preview.archived) {
        toast(t("Nothing to triage — the inbox is already clean"));
        return;
      }
      const top = Object.entries(preview.reasons).sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([r, n]) => `  ${n}  ${reasonLabel(r)}`).join("\n");
      const msg = t("Auto-triage {0} drafts:\n- {1} become active\n- {2} move to archive (recoverable)\n- {3} stay for review", preview.scanned, preview.promoted, preview.archived, preview.kept) + "\n\n" + top + "\n\n" + t("You can undo this afterwards. Continue?");
      if (!confirm(msg)) return;
      const r = await api("/api/triage", { method: "POST" });
      toast(t("Triage done: {0} active, {1} archived", r.result.promoted, r.result.archived));
      loadStats();
      renderMemories();
      renderDraftGroups();
      refreshTriageInfo();
    } catch (e) {
      toast(t("Failed: ") + e.message, "err");
    } finally {
      run.disabled = false;
    }
  });
  undo.addEventListener("click", async () => {
    if (!confirm(t("Restore every memory from the last triage back to Pending approval?"))) return;
    undo.disabled = true;
    try {
      const r = await api("/api/triage/undo", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      toast(t("Restored {0} memories to Pending approval", r.restored));
      loadStats();
      renderMemories();
      renderDraftGroups();
      refreshTriageInfo();
    } catch (e) {
      toast(t("Failed: ") + e.message, "err");
    } finally {
      undo.disabled = false;
    }
  });
}
wireAutoTriage();

function wireDraftBatch(box) {
  const bar = document.getElementById("draftBatchBar");
  if (!bar) return;
  bar.style.display = "flex";
  refreshTriageInfo();
  renderDraftGroups();
  // Perubahan checkbox mengalir lewat delegasi `change` di bindRowActions;
  // di sini cukup set jumlah awal bar.
  updateDraftBar(box);
  const ids = () => [...box.querySelectorAll(".mem-select:checked")].map((c) => Number(c.dataset.sel));
  document.getElementById("batchApprove").onclick = async () => {
    const list = ids();
    if (!list.length) return;
    const r = await api("/api/memories/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approve", ids: list }) });
    toast(`${t("Approved")} ${r.affected}`);
    loadStats();
    renderMemories();
  };
  document.getElementById("batchDelete").onclick = async () => {
    const list = ids();
    if (!list.length || !confirm(t("Delete this memory? This cannot be undone."))) return;
    const r = await api("/api/memories/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", ids: list }) });
    toast(`${t("Deleted")} ${r.affected}`);
    loadStats();
    renderMemories();
  };
}

/* ---------- Aksi baris memori via event delegation (F1C) ----------
 * Dulu: setiap render memasang ulang listener per tombol (O(n) tiap refresh,
 * listener menumpuk di list panjang). Kini satu pasang listener delegated per
 * kontainer list, dipasang sekali (guard WeakSet) — konten list boleh
 * berganti sesering apapun tanpa re-bind. */
const delegatedRoots = new WeakSet();

function bindRowActions(root) {
  if (!root || delegatedRoots.has(root)) return;
  delegatedRoots.add(root);
  root.addEventListener("click", onMemListClick);
  root.addEventListener("change", (e) => {
    if (e.target.classList && e.target.classList.contains("mem-select")) updateDraftBar(root);
  });
}

async function onMemListClick(e) {
  const root = e.currentTarget;
  const goto = e.target.closest("[data-goto]");
  if (goto) {
    e.stopPropagation();
    openEditModal(Number(goto.dataset.goto));
    return;
  }
  const cur = e.target.closest("[data-cur]");
  if (cur) {
    e.stopPropagation();
    try {
      await api("/api/decisions/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: Number(cur.dataset.cur) }) });
      toast(t("Decision marked as current"));
      renderMemories();
    } catch (err) {
      toast(t("Failed: ") + err.message, "err");
    }
    return;
  }
  const del = e.target.closest("[data-del]");
  if (del) {
    e.stopPropagation();
    const id = del.dataset.del;
    if (!confirm(t("Delete this memory? This cannot be undone."))) return;
    try {
      await api("/api/memories?id=" + id, { method: "DELETE" });
      toast(t("Memory deleted"));
      const row = del.closest(".mem");
      if (row) row.remove();
      loadStats();
    } catch (err) {
      toast(t("Failed to delete: ") + err.message, "err");
    }
    return;
  }
  const relBtn = e.target.closest("[data-rel]");
  if (relBtn) {
    e.stopPropagation();
    const id = Number(relBtn.dataset.rel);
    const row = relBtn.closest(".mem");
    if (!row) return;
    let panel = row.querySelector(".rel-panel");
    if (panel) { panel.remove(); return; }
    panel = document.createElement("div");
    panel.className = "rel-panel";
    panel.innerHTML = '<div class="rel-title">Loading connections…</div>';
    row.appendChild(panel);
    try {
      const d = await api("/api/related?id=" + id);
      const rel = d.related || [];
      if (!rel.length) { panel.innerHTML = '<div class="rel-title">No related connections</div>'; return; }
      panel.innerHTML = '<div class="rel-title">Connected to (' + rel.length + ')</div>' + rel.map((r) => `
        <div class="rel-item" data-goto="${r.id}">
          <span class="rel-k">${r.linkKind}</span>
          <span class="rel-t">${esc(r.content)}</span>
        </div>`).join("");
    } catch (err) {
      panel.innerHTML = '<div class="rel-title">Failed: ' + esc(err.message) + '</div>';
    }
    return;
  }
  const ent = e.target.closest("[data-ent]");
  if (ent) {
    e.stopPropagation();
    state.memTab = "active";
    document.querySelectorAll(".mem-tabs .seg").forEach((x) => x.classList.toggle("active", x.dataset.memtab === "active"));
    state.filterTag = "";
    state.search = ent.dataset.ent;
    $("#search").value = ent.dataset.ent;
    renderMemories();
    return;
  }
  const tag = e.target.closest("[data-tag]");
  if (tag) {
    e.stopPropagation();
    state.filterTag = tag.dataset.tag;
    $("#filterTag").value = tag.dataset.tag;
    renderMemories();
    return;
  }
  const appr = e.target.closest("[data-appr]");
  if (appr) {
    e.stopPropagation();
    const id = Number(appr.dataset.appr);
    try {
      await api("/api/memories/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      toast(t("Memory approved"));
      const row = appr.closest(".mem");
      if (row) row.remove();
      loadStats();
    } catch (err) {
      toast(t("Failed to approve: ") + err.message, "err");
    }
    return;
  }
  const rs = e.target.closest("[data-rs]");
  if (rs) {
    e.stopPropagation();
    const id = Number(rs.dataset.rs);
    try {
      await api("/api/memories/archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, archived: false }) });
      toast(t("Memory restored"));
      const row = rs.closest(".mem");
      if (row) row.remove();
      loadStats();
    } catch (err) {
      toast(t("Failed to restore: ") + err.message, "err");
    }
    return;
  }
  const arch = e.target.closest("[data-arch]");
  if (arch) {
    e.stopPropagation();
    const id = arch.dataset.arch;
    try {
      await api("/api/memories/archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: Number(id), archived: true }) });
      toast(t("Memory archived"));
      const row = arch.closest(".mem");
      if (row) row.remove();
      loadStats();
    } catch (err) {
      toast(t("Failed to archive: ") + err.message, "err");
    }
    return;
  }
  const edit = e.target.closest("[data-edit]");
  if (edit) {
    e.stopPropagation();
    openEditModal(Number(edit.dataset.edit));
    return;
  }
  // Toggle expand row: hanya bila klik tidak mengenai aksi/panel di atas.
  const row = e.target.closest(".mem");
  if (row && root.contains(row) && !e.target.closest(".rel-panel")) row.classList.toggle("open");
}

function renderProjects() {
  const box = $("#projectsList");
  if (!state.projects.length) {
    box.innerHTML = emptyState(t("No projects yet"), t("Projects appear automatically as AI tools record activity."));
    return;
  }
  const hues = ["#f5b942", "#a684ff", "#9fdd5f", "#6e8dff", "#ff9d6e", "#63d8e0", "#e5686b", "#9d8cff"];
  box.innerHTML = `<div class="feed">` + state.projects.map((p, i) => `
    <div class="feed-item" data-open-project="${esc(p.slug)}" title="${esc(p.slug)}">
      <span class="feed-dot" style="background:${hues[i % hues.length]}"></span>
      <div style="min-width:0">
        <div class="feed-name">${esc(p.name)}</div>
        <div class="feed-sub">${(p.transcripts || 0).toLocaleString("id-ID")} ${t("transcripts")} · ${fmtRel(p.last_seen)}</div>
      </div>
      <span class="feed-badge">${t("Open")}</span>
    </div>`).join("") + `</div>`;
  box.querySelectorAll("[data-open-project]").forEach((el) => {
    el.addEventListener("click", () => showProject(el.dataset.openProject));
  });
}

async function loadTags() {
  try {
    const d = await api("/api/tags");
    const sel = $("#filterTag");
    const cur = state.filterTag;
    sel.innerHTML = '<option value="">' + t("All topics") + '</option>';
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
  const tools = state.stats && state.stats.perTool ? state.stats.perTool : [];
  const known = [["claude", "Claude Code"], ["codex", "Codex CLI"], ["opencode", "OpenCode"], ["gemini", "Gemini CLI"], ["copilot", "Copilot"], ["antigravity", "Antigravity"], ["vscode", "VS Code"], ["cursor", "Cursor"], ["windsurf", "Windsurf"]];

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
        const icon = TOOL_ICONS[key];
        const initials = esc(label.slice(0, 2).toUpperCase());
        return `<div class="src-toggle">
          <span class="intg-icon" style="width:28px;height:28px;border-radius:8px;flex:none">${icon ? `<img src="${icon}" alt="${initials}" data-fallback="${initials}">` : initials}</span>
          <span class="st-name">${esc(label)}</span>
          <span class="st-count">${count != null ? count.toLocaleString("id-ID") + " transcripts" : ""}</span>
          <div class="spacer"></div>
          <div class="switch ${on ? "on" : ""}" data-src="${key}"></div>
        </div>`;
      })
      .join("");
    box.querySelectorAll("img[data-fallback]").forEach((img) => {
      img.addEventListener("error", () => img.replaceWith(document.createTextNode(img.dataset.fallback || "")));
    });
    box.querySelectorAll("[data-src]").forEach((sw) => {
      sw.addEventListener("click", (e) => {
        e.stopPropagation();
        const on = !sw.classList.contains("on");
        sw.classList.toggle("on", on);
        api("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "source:" + sw.dataset.src + ":enabled", value: on ? "1" : "0" }) })
          .then(() => toast((sw.dataset.src || "") + (on ? " aktif" : " nonaktif")))
          .catch((err) => toast(t("Failed: ") + err.message, "err"));
      });
    });
  }).catch(() => {});
  const cmd = [
    "# PR-K bridge: MCP over HTTP — tool AI manapun, tanpa config per-tool:",
    "#   url: http://127.0.0.1:48210/mcp   (streamable, JSON)",
    "",
    "# Claude Code (stdio, jalur lama):",
    `claude mcp add --scope user memoria -- node "D:\\…\\dist\\engine\\index.js" mcp`,
    "",
    "# opencode / Gemini / Antigravity — MCP stdio:",
    '#   command: node',
    '#   args:    ["D:\\…\\dist\\engine\\index.js", "mcp"]',
  ].join("\n");
  $("#mcpCode").textContent = cmd;

  const cpBtn = document.createElement("button");
  cpBtn.className = "copy";
  cpBtn.title = t("Copy command");
  cpBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M11 5V3.5a1 1 0 0 0-1-1H3.5a1 1 0 0 0-1 1V10a1 1 0 0 0 1 1H5"/></svg>';
  cpBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(cmd).catch(() => {});
    toast(t("Example command copied"));
  });
  $("#mcpCode").appendChild(cpBtn);
}

/* ---------- Timeline ---------- */

let tlMode = "text";

const viewSeqs = {}; // M10 (audit): 'latest wins' untuk semua renderer async
function viewSeq(name) {
  viewSeqs[name] = (viewSeqs[name] || 0) + 1;
  return { name, seq: viewSeqs[name] };
}
function viewFresh(mark) {
  return viewSeqs[mark.name] === mark.seq;
}

async function renderTimeline() {
  const mark = viewSeq('timeline');
  const slug = $("#tlProject").value;
  const box = $("#timelineBox");
  if (!slug) {
    box.innerHTML = (state.projects || []).length
      ? emptyState(t("Pick a project"), t("Pick a project above to see its activity trail."))
      : emptyState(t("No projects yet"), t("Projects appear automatically as AI tools record activity."));
    return;
  }
  box.innerHTML = "<p class='muted' style='padding:20px'>Loading…</p>";
  try {
    if (tlMode === "git") {
      const d = await api("/api/git?slug=" + encodeURIComponent(slug));
      const log = d.log || [];
      if (!log.length) { box.innerHTML = emptyState(t("No git history"), t("No commits detected for this project yet.")); return; }
      box.innerHTML = `<div class="list">${log.map((g) => `<div class="tl-item"><div class="tl-badge">${esc(g.date)}</div><div class="tl-text">${esc(g.message)}<div class="tl-tool">git commit</div></div></div>`).join("")}</div>`;
      return;
    }
    const d = await api("/api/timeline?slug=" + encodeURIComponent(slug) + "&limit=60");
    if (!viewFresh(mark)) return;
    const items = d.timeline || [];
    const mems = d.memories || [];
    if (!items.length) { box.innerHTML = emptyState(t("No activity yet"), t("This project has no stored transcripts yet.")); return; }
    const byDay = {};
    for (const it of items) {
      const day = fmtDate(it.ts);
      (byDay[day] = byDay[day] || []).push(it);
    }
    let html = "";
    if (mems.length) {
      html += `<div class="tl-day">Project memories (${mems.length})</div>` + mems
        .map((m) => `<div class="tl-item"><div class="tl-badge" style="width:auto; text-align:left"><span class="mem-kind kind-${m.kind}">${t(KIND_LABEL[m.kind] || m.kind)}</span></div><div class="tl-text">${esc(m.content)}<div class="tl-tool">memory · ${(m.importance * 100).toFixed(0)}</div></div></div>`)
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
    box.innerHTML = emptyState(t("Failed to load"), esc(e.message));
  }
}

/* ---------- Capture health ---------- */
async function loadCaptureHealth() {
  const box = $("#healthBox");
  if (!box) return;
  try {
    const d = await api("/api/capture-health");
    const label = { ok: t("OK"), behind: t("Behind"), error: t("Error"), idle: t("No sessions yet"), missing: t("Not found"), disabled: t("Off") };
    const color = { ok: "var(--green)", behind: "var(--amber)", error: "var(--red)" };
    box.innerHTML = (d.tools || [])
      .map((h) => `<div class="mem-meta" style="padding:4px 0">
        <span class="mem-kind" style="${color[h.status] ? `color:${color[h.status]}` : "opacity:.6"}">${esc(label[h.status] || h.status)}</span>
        <span>${esc(h.label)}</span>
        ${h.lastStoredAt ? `<span class="sep">·</span><span>${esc(t("last stored {0}", fmtRel(h.lastStoredAt)))}</span>` : ""}
        ${h.stored7d || h.events7d ? `<span class="sep">·</span><span>${esc(t("7d: {0} messages, {1} events", h.stored7d, h.events7d))}</span>` : ""}
        ${h.status === "missing"
          ? `<span class="sep">·</span><span class="muted" title="${esc(h.reason || "")}">${esc(t("not installed, or never used on this computer"))}</span>`
          : h.status === "disabled"
            ? `<span class="sep">·</span><span class="muted">${esc(t("turned off in Data sources"))}</span>`
            : h.reason ? `<span class="sep">·</span><span class="muted">${esc(h.reason)}</span>` : ""}
      </div>`)
      .join("");
  } catch (e) {
    box.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  }
}

/* ---------- Retrieval inspector ----------
 * Local log of what recall/project_context/build_context/file_context
 * returned (last 500 calls, never synced). "Not relevant" marks feed the
 * evidence score later. */

async function renderRetrievals() {
  const mark = viewSeq("retrievals");
  const box = $("#retrievalsBox");
  box.innerHTML = "<p class='muted' style='padding:20px'>Loading…</p>";
  try {
    const src = $("#rtSource").value;
    const d = await api("/api/retrievals?limit=100" + (src ? "&source=" + encodeURIComponent(src) : ""));
    if (!viewFresh(mark)) return;
    const st = d.stats || {};
    const enabled = st.enabled !== false;
    $("#rtEnabled").checked = enabled;
    const entries = d.entries || [];
    const total = st.entries || 0;
    // Nothing logged at all: no toolbar, no row of zeros — say what this page
    // is for and what makes it fill up.
    const toolbar = $("#rtSource").closest(".toolbar");
    toolbar.style.display = total ? "" : "none";
    const parts = [];
    if (total) parts.push(t(total === 1 ? "1 call logged" : "{0} calls logged", total));
    if (st.emptyResults) parts.push(t("{0} returned nothing", st.emptyResults));
    if (st.irrelevantMarks) parts.push(t("{0} marked not relevant", st.irrelevantMarks));
    $("#rtStats").textContent = parts.join(" · ");
    $("#rtStats").style.display = parts.length ? "" : "none";
    if (!entries.length) {
      if (!enabled) {
        box.innerHTML = emptyState(
          t("Logging is paused"),
          t("Turn it on to see which memories your AI tools receive when they ask Memoria for context."),
          `<button class="btn primary" id="rtTurnOn">${esc(t("Turn logging on"))}</button>`
        );
        toolbar.style.display = "";
      } else if (total) {
        box.innerHTML = emptyState(t("No calls from this tool"), t("Pick another tool in the filter, or choose All tools."));
      } else {
        box.innerHTML = emptyState(
          t("Nothing has asked Memoria for context yet"),
          t("When an AI tool you connected looks something up in Memoria, each lookup appears here with the memories it got, so you can see what it was told and mark anything that does not belong."),
          `<button class="btn primary" id="rtConnect">${esc(t("Connect an AI tool"))}</button>`
        );
      }
      $("#rtConnect")?.addEventListener("click", () => setView("integrations"));
      $("#rtTurnOn")?.addEventListener("click", async () => {
        await api("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "retrievalLog", value: "1" }) });
        renderRetrievals();
      });
      return;
    }
    box.innerHTML = `<div class="list">${entries.map((e) => `
      <div class="card" style="margin-bottom:10px">
        <div class="mem-meta">
          <span class="mem-kind">${esc(e.source)}</span>
          <span class="sep">·</span><span>${esc(e.project ? prettySlug(e.project) : t("all projects"))}</span>
          <span class="sep">·</span><span>${fmtRel(e.ts)}</span>
          <span class="sep">·</span><span>${esc(t("{0} chars", e.servedChars))}</span>
        </div>
        ${e.query ? `<div class="mem-content" style="margin:6px 0"><b>${esc(e.query)}</b></div>` : ""}
        ${e.hits.length ? e.hits.map((h, i) => `
          <div class="mem" style="padding:6px 0">
            <div class="mem-rail"><span class="muted">${i + 1}</span></div>
            <div class="mem-body">
              <div class="mem-meta">
                ${h.kind ? `<span class="mem-kind kind-${esc(h.kind)}">${esc(t(KIND_LABEL[h.kind] || h.kind))}</span>` : `<span class="mem-kind" style="opacity:.6">${esc(t("deleted"))}</span>`}
                <span class="sep">·</span><span>#${h.id}</span>
                ${h.score !== null ? `<span class="sep">·</span><span>${esc(t("score {0}", h.score.toFixed(2)))}</span>` : ""}
                ${h.archived ? `<span class="sep">·</span><span>${esc(t("archived"))}</span>` : ""}
              </div>
              <div class="mem-content" style="${h.irrelevant ? "opacity:.55;text-decoration:line-through" : ""}">${esc(h.content || "")}</div>
            </div>
            <div class="mem-actions" style="opacity:1">
              <button class="mem-approve" data-rt-log="${e.id}" data-rt-mem="${h.id}" data-rt-on="${h.irrelevant ? "0" : "1"}">${esc(h.irrelevant ? t("Undo") : t("Not relevant"))}</button>
            </div>
          </div>`).join("") : `<div class="muted" style="padding:6px 0">${esc(t("No result returned"))}</div>`}
      </div>`).join("")}</div>`;
  } catch (e) {
    box.innerHTML = emptyState(t("Failed to load"), esc(e.message));
  }
}

$("#retrievalsBox").addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-rt-log]");
  if (!b) return;
  try {
    await api("/api/retrievals/irrelevant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logId: Number(b.dataset.rtLog), memoryId: Number(b.dataset.rtMem), on: b.dataset.rtOn === "1" }),
    });
    renderRetrievals();
  } catch (e) {
    toast(e.message, "err");
  }
});
$("#rtSource").addEventListener("change", renderRetrievals);
$("#rtEnabled").addEventListener("change", async (ev) => {
  try {
    await api("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "retrievalLog", value: ev.target.checked ? "1" : "0" }) });
    toast(ev.target.checked ? t("Retrieval log on") : t("Retrieval log paused"));
  } catch (e) {
    toast(e.message, "err");
  }
});
$("#rtClear").addEventListener("click", async () => {
  if (!confirm(t("Clear the retrieval log? Not-relevant marks are kept."))) return;
  try {
    await api("/api/retrievals/clear", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    renderRetrievals();
  } catch (e) {
    toast(e.message, "err");
  }
});

/* ---------- Handoff ---------- */

let handoffText = "";

async function renderHandoff() {
  const mark = viewSeq("handoff");
  const slug = $("#hfProject").value;
  const box = $("#handoffBox");
  if (!slug) { box.textContent = t("Pick a project, then click \"Generate handoff\"."); return; }
  box.textContent = t("Generating handoff…");
  try {
    const d = await api("/api/handoff?slug=" + encodeURIComponent(slug));
    if (!viewFresh(mark)) return;
    handoffText = d.text || "";
    box.textContent = handoffText;
    toast(t("Handoff ready"));
  } catch (e) {
    box.textContent = t("Failed to generate handoff: ") + e.message;
  }
}

/* ---------- Graph ---------- */

const KIND_COLOR = {
  fact: "#6e8dff", decision: "#d9a05b", task_done: "#4cc38a", task_pending: "#e5686b",
  error_fixed: "#e08a5c", preference: "#9d8cff", context: "#8b93a2",
};

const graph = {
  nodes: [], edges: [], idx: new Map(), selected: null,
  degree: new Map(), labeled: new Set(),
};
let __g3d = null;
let __labels = [];
let __labelRaf = 0;



const INTEGRATION_LOGOS = {
  claude: "logos/claude.png",
  codex: "logos/codex.png",
  opencode: "logos/opencode.ico",
  gemini: "logos/gemini.png",
  copilot: "logos/copilot.png",
  antigravity: "logos/antigravity.png",
  "claude-desktop": "logos/claude-desktop.svg",
  cursor: "logos/cursor.svg",
  windsurf: "logos/windsurf.svg",
  vscode: "logos/vscode.svg",
  cline: "logos/cline.svg",
  zed: "logos/zed.svg",
};
const TOOL_ICONS = {
  claude: "logos/claude.png",
  codex: "logos/codex.png",
  opencode: "logos/opencode.ico",
  gemini: "logos/gemini.png",
  copilot: "logos/copilot.png",
  antigravity: "logos/antigravity.png",
  vscode: "logos/vscode.svg",
  cursor: "logos/cursor.svg",
  windsurf: "logos/windsurf.svg",
};
const INTEGRATIONS = [
  ["claude", "Claude Code", t("MCP stdio — mirrors context into every `/memory` session")],
  ["codex", "Codex CLI", t("Registered in ~/.codex/config.toml")],
  ["opencode", "opencode", t("Registered in ~/.config/opencode/opencode.json")],
  ["gemini", "Gemini CLI", t("Registered in ~/.gemini/settings.json")],
  ["copilot", "Copilot", t("Registered in ~/.copilot/mcp-config.json")],
  ["antigravity", "Antigravity", t("Registered in ~/.gemini/config/mcp_config.json")],
  ["claude-desktop", "Claude Desktop", t("Registered in claude_desktop_config.json (stdio)")],
  ["cursor", "Cursor", t("Registered in ~/.cursor/mcp.json (HTTP bridge)")],
  ["windsurf", "Windsurf", t("Registered in ~/.codeium/windsurf/mcp_config.json")],
  ["vscode", "VS Code (Copilot)", t("Registered in ~/.vscode/mcp.json (HTTP bridge)")],
  ["cline", "Cline", t("Registered in Cline MCP settings (stdio)")],
  ["zed", "Zed", t("Registered in ~/.config/zed/settings.json (stdio)")],
];

async function renderIntegrations() {
  const mark = viewSeq("integrations");
  const box = $("#integrationsBox");
  try {
    const d = await api("/api/integrations");
    if (!viewFresh(mark)) return;
    const map = Object.fromEntries((d.integrations || []).map((x) => [x.key, x]));
    box.innerHTML = INTEGRATIONS.map(([key, name, desc]) => {
      const st = map[key];
      const configured = st && st.configured;
      const logo = INTEGRATION_LOGOS[key];
      const initials = esc(name.slice(0, 2).toUpperCase());
      return `<div class="intg-row">
        <div class="intg-icon">${logo ? `<img src="${logo}" alt="${initials}" data-fallback="${initials}">` : initials}</div>
        <div><div class="intg-name">${esc(name)}</div><div class="intg-desc">${esc(desc)}</div></div>
        <div class="spacer"></div>
        <span class="badge ${configured ? "ok" : "no"}">${configured ? t("Registered") : t("Not yet")}</span>
        <button class="btn primary" data-intg="${key}" ${configured ? "style='opacity:0.55'" : ""}>${configured ? t("Register again") : t("Register")}</button>
      </div>`;
    }).join("");
    box.querySelectorAll("[data-intg]").forEach((b) => {
      b.addEventListener("click", async () => {
        b.disabled = true;
        b.textContent = t("Working…");
        try {
          const r = await api("/api/integrate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool: b.dataset.intg }) });
          if (r.ok) toast(b.dataset.intg + t(" registered"));
          else toast(t("Failed: ") + r.message, "err");
        } catch (e) {
          toast(t("Failed: ") + e.message, "err");
        }
        b.disabled = false;
        renderIntegrations();
      });
    });
    // H4: fallback ikon tanpa inline onerror (diblokir CSP)
    box.querySelectorAll("img[data-fallback]").forEach((img) => {
      img.addEventListener("error", () => img.replaceWith(document.createTextNode(img.dataset.fallback || "")));
    });
  } catch (e) {
    box.innerHTML = emptyState(t("Failed to load"), esc(e.message));
  }
}

async function renderGraph() {
  const mark = viewSeq("graph");
  const project = $("#grProject").value || undefined;
  const params = new URLSearchParams({ limit: "250" });
  if (project) params.set("project", project);
  $("#graphSide").innerHTML = '<div class="gs-empty">Loading graph…</div>';
  try {
    const d = await api("/api/graph?" + params.toString());
    graph.nodes = d.nodes || [];
    graph.edges = (d.edges || []).filter((e) => graph.nodes.some((n) => n.id === e.fromId) && graph.nodes.some((n) => n.id === e.toId));
    graph.idx = new Map(graph.nodes.map((n, i) => [n.id, i]));
    graph.selected = null;
    // degree (jumlah koneksi) -> ukuran node & prioritas label
    graph.degree = new Map();
    for (const e of graph.edges) {
      graph.degree.set(e.fromId, (graph.degree.get(e.fromId) || 0) + 1);
      graph.degree.set(e.toId, (graph.degree.get(e.toId) || 0) + 1);
    }
    const labeled = [...graph.nodes]
      .sort((a, b) => (graph.degree.get(b.id) || 0) - (graph.degree.get(a.id) || 0))
      .slice(0, Math.min(80, Math.ceil(graph.nodes.length * 0.5)))
      .map((n) => n.id);
    graph.labeled = new Set(labeled);
    $("#grCount").textContent = graph.nodes.length + t(" nodes · ") + graph.edges.length + t(" connections");
    if (!graph.nodes.length) {
      $("#graphSide").innerHTML = '<div class="gs-empty">' + esc(t("No memories to show yet. Run a scan + extraction first, or add memories manually.")) + '</div>';
    } else {
      $("#graphSide").innerHTML = '<div class="gs-title">Details</div><div class="gs-empty">Click a node on the canvas to see its details and connections.</div>';
    }
    renderGraphLegend();
    initGraph3D();
  } catch (e) {
    console.error("[memoria] renderGraph error:", e);
    $("#graphSide").innerHTML = '<div class="gs-empty">Failed to load graph: ' + esc(e.message) + "</div>";
  }
}

function renderGraphLegend() {
  const legend = $("#grLegend");
  legend.innerHTML = Object.entries(KIND_LABEL).map(([k, label]) =>
    `<span class="lg"><span class="sw" style="background:${KIND_COLOR[k]}"></span>${t(label)}</span>`
  ).join("");
}

/* ---------- Mesin 3D (3d-force-graph, vendor lokal) ---------- */
function initGraph3D() {
  const el = document.getElementById("graph3d");
  if (!el || !window.ForceGraph3D) return;
  if (el.clientWidth === 0) { requestAnimationFrame(() => initGraph3D()); return; }
  if (__g3d) { try { __g3d._destructor(); } catch (e) {} __g3d = null; }
  el.innerHTML = "";

  const nodes = graph.nodes.map((n) => {
    const deg = graph.degree.get(n.id) || 0;
    return {
      id: n.id,
      name: n.content.replace(/\s+/g, " ").slice(0, 44),
      color: KIND_COLOR[n.kind] || "#8b93a2",
      val: 2 + n.importance * 5 + Math.min(10, deg * 1.3),
    };
  });
  const links = graph.edges.map((e) => ({ source: e.fromId, target: e.toId }));

  __g3d = ForceGraph3D()(el)
    .backgroundColor("rgba(0,0,0,0)")
    .showNavInfo(false)
    .nodeColor((n) => n.color)
    .nodeVal((n) => n.val)
    .nodeOpacity(0.92)
    .nodeLabel((n) => n.name)
    .linkColor(() => (isLightTheme() ? "rgba(90,100,125,0.35)" : "rgba(148,163,196,0.3)"))
    .linkOpacity(0.35)
    .width(el.clientWidth)
    .height(el.clientHeight)
    .onNodeClick((n) => { graph.selected = n.id; renderGraphSide(); })
    .onNodeHover((n) => { el.style.cursor = n ? "pointer" : null; });
  __g3d.graphData({ nodes, links });
  __g3d.d3Force("charge")?.strength(-90);
  __g3d.cameraPosition({ x: 0, y: 40, z: 620 });
  buildLabels3D(nodes);
}

/* Label DOM mengikuti koordinat 3D (graph2ScreenCoords) — teks tajam & sadar tema.
 * PENTING: baca koordinat dari objek `decorated` yang sama yang diberikan ke
 * ForceGraph3D — simulasi menulis x/y/z di objek itu, BUKAN di graph.nodes
 * mentah (dulu label diambil dari graph.nodes sehingga n.x selalu undefined →
 * semua label tidak pernah diposisikan dan menumpuk di pojok kiri atas). */
function buildLabels3D(decorated) {
  document.querySelectorAll(".label3d-layer").forEach((e) => e.remove());
  const el = document.getElementById("graph3d");
  if (!el || !__g3d || !decorated || !decorated.length) return;
  const layer = document.createElement("div");
  layer.className = "label3d-layer";
  el.appendChild(layer);
  __labels = decorated
    .slice()
    .sort((p, q) => (graph.degree.get(q.id) || 0) - (graph.degree.get(p.id) || 0))
    .slice(0, Math.min(90, Math.ceil(decorated.length * 0.55)))
    .map((n) => {
      const d = document.createElement("div");
      d.className = "label3d";
      const labelSrc = n.name || n.content || "";
      d.textContent = labelSrc.replace(/\s+/g, " ").slice(0, 34) + (labelSrc.replace(/\s+/g, " ").length > 34 ? "…" : "");
      layer.appendChild(d);
      return { node: n, el: d };
    });
  if (!__labelRaf) {
    const loop = () => {
      if (__g3d && state.view === "graph") {
        const el = document.getElementById("graph3d");
        const w = el ? el.clientWidth : 0;
        const h = el ? el.clientHeight : 0;
        // PR-P: anti-overlap greedy — label diproses sesuai urutan prioritas
        // degree (sudah di-sort saat build); slot yang sudah dipakai tidak boleh
        // ditumpuk label lain di cluster padat.
        const placed = [];
        const collides = (x, y) => placed.some((p) => Math.abs(p.x - x) < 150 && Math.abs(p.y - y) < 15);
        for (const it of __labels) {
          const n = it.node;
          if (n.x === undefined) continue;
          const c = __g3d.graph2ScreenCoords(n.x, n.y, n.z);
          // Offscreen / di belakang kamera → sembunyikan (dulu label terpotong
          // telanjang di tepi canvas & menumpuk di luar batas terlihat).
          if (c.x == null || c.x < -60 || c.x > w + 60 || c.y < -30 || c.y > h + 30) {
            it.el.style.opacity = 0;
            continue;
          }
          const cx = Math.min(Math.max(c.x - 50, 2), Math.max(2, w - 90));
          const cy = Math.min(Math.max(c.y + 6, 0), Math.max(0, h - 20));
          if (collides(cx, cy)) {
            it.el.style.opacity = 0.18; // tetap samar — bukan hilang total
            continue;
          }
          placed.push({ x: cx, y: cy });
          it.el.style.opacity = 1;
          it.el.style.transform = "translate(" + cx.toFixed(1) + "px, " + cy.toFixed(1) + "px)";
        }
      }
      __labelRaf = requestAnimationFrame(loop);
    };
    __labelRaf = requestAnimationFrame(loop);
  }
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
      <div class="gs-kind" style="color:${KIND_COLOR[n.kind] || "#8b93a2"}">${t(KIND_LABEL[n.kind] || n.kind)} · importance ${(n.importance * 100).toFixed(0)}</div>
      <div class="gs-content">${esc(n.content)}</div>
      <div class="gs-meta">${esc(n.projectSlug || "global")} · ${esc(TOOL_LABEL[n.sourceTool] || n.sourceTool)} · ${fmtRel(n.createdAt)}</div>
      <button class="btn" id="gsEdit" style="margin-top:10px">${t("Edit memory")}</button>
    </div>
    <div class="gs-title" style="margin-top:4px">Connections (${rels.length})</div>
    ${rels.length ? rels.map((r) => `
      <div class="gs-link-row" data-goto="${r.otherId}">
        <span class="gs-lk">${r.kind}</span>
        <span class="gs-lt">${esc(r.other.content)}</span>
      </div>`).join("") : '<div class="gs-empty">This node has no connections.</div>'}`;
  side.querySelectorAll("[data-goto]").forEach((el) => {
    el.addEventListener("click", () => {
      graph.selected = Number(el.dataset.goto);
      graph.dirty = true;
      renderGraphSide();
    });
  });
  side.querySelector("#gsEdit")?.addEventListener("click", () => openEditModal(graph.selected));
}

/* ---------- Settings: toggle statis (persist + muat) ----------
 * saveSettings/loadSettingsToggles dulu DIPANGGIL tapi tidak pernah
 * didefinisi — toggle statis tidak pernah tersimpan & tidak pernah dimuat
 * dari GET /api/settings. Kini didefinisikan; call site lama tetap cocok. */
function saveSettings(key, on) {
  api("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value: on ? "1" : "0" }),
  }).catch(() => {
    /* simpan gagal — load berikutnya akan menyelaraskan visual */
  });
}

async function loadSettingsToggles() {
  try {
    const d = await api("/api/settings");
    const s = (d && d.settings) || {};
    document.querySelectorAll(".toggle-row[data-key]").forEach((row) => {
      const v = s[row.dataset.key];
      if (v === undefined) return;
      const sw = row.querySelector(".switch");
      if (sw) sw.classList.toggle("on", v === "1" || v === true);
    });
    // Field webhook: isi nilai non-secret + status secret tersimpan.
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el && val !== undefined && val !== "") el.value = val;
    };
    setVal("setNotifyTelegramChat", s.notifyTelegramChat);
    setVal("setCaptureExclude", s.captureExclude);
    setVal("setObsidianVault", s.obsidianVault);
    setVal("setNotifyDraftMin", s.notifyDraftMin);
    const mark = (hasKey, stId) => {
      const st = document.getElementById(stId);
      if (st) st.textContent = s[hasKey] === "1" ? t("Saved") : t("Not set");
    };
    mark("notifyDiscordHas", "stNotifyDiscord");
    mark("notifyTelegramHas", "stNotifyTelegram");
    mark("notifyGenericHas", "stNotifyGeneric");
    // Engine/provider fields
    const setSel = (id, val) => {
      const el = document.getElementById(id);
      if (el && val !== undefined && val !== null && val !== "") el.value = String(val);
    };
    const setInput = (id, val) => {
      const el = document.getElementById(id);
      if (el && val !== undefined && val !== null) el.value = String(val);
    };
    setSel("setExtractEngine", s.extractEngine || "auto");
    setSel("setEmbedEngine", s.embedEngine || "auto");
    setSel("setApiProvider", s.openaiProvider || "custom");
    setInput("setOpenaiBaseUrl", s.openaiBaseUrl || "");
    setInput("setOpenaiExtractModel", s.openaiExtractModel || "");
    setInput("setOpenaiEmbedModel", s.openaiEmbedModel || "");
    const kst = document.getElementById("stOpenaiKey");
    if (kst) kst.textContent = s.openaiHasKey === "1" ? t("API key stored — refill to replace") : t("Not set");
    updateEngineVisibility();
  } catch {
    /* non-blokir */
  }
}

/* Backups list (Settings → Data). Lost in a refactor on 2026-11-05: Settings
 * threw "loadBackups is not defined", which also stopped the sync status,
 * device list and capture health from loading. */
async function loadBackups() {
  const box = $("#backupList");
  if (!box) return;
  try {
    const d = await api("/api/backups");
    const b = d.backups || [];
    if (!b.length) {
      box.innerHTML = `<div class="card-desc" style="margin-top:6px">${esc(t("No backups yet. Click \"Back up now\" to make the first one."))}</div>`;
      return;
    }
    box.innerHTML = `<div class="card-desc" style="margin-top:2px">${esc(t("Stored backups:"))}</div>` +
      b.map((x) => `
        <div class="bup-row">
          <div>
            <div class="bup-name">${esc(x.name)}</div>
            <div class="bup-meta">${(x.size / 1024 / 1024).toFixed(1)} MB · ${fmtDate(x.mtime)}</div>
          </div>
          <div class="spacer"></div>
          <button class="btn" data-restore="${esc(x.path)}">${esc(t("Restore"))}</button>
        </div>`).join("");
    box.querySelectorAll("[data-restore]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm(t("Restore this backup? The current database is replaced."))) return;
        btn.disabled = true;
        try {
          const r = await api("/api/backup/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: btn.dataset.restore }) });
          toast(r.ok ? t("Backup restored") : t("Failed to restore: ") + (r.message || ""), r.ok ? "ok" : "err");
          if (r.ok) await Promise.all([loadStats(), loadProjects(), loadBackups()]);
        } catch (e) {
          toast(t("Failed to restore: ") + e.message, "err");
        }
        btn.disabled = false;
      });
    });
  } catch (e) {
    box.innerHTML = `<div class="card-desc" style="margin-top:6px">${esc(t("Failed to load backups: ") + e.message)}</div>`;
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

async function openEditModal(id) {
  let m = (state.lastMemories || []).find((x) => x.id === id);
  if (!m) {
    try { m = (await api("/api/memories/one?id=" + id)).memory; } catch (e) {}
  }
  renderEditModal(m, id);
}

async function renderEditModal(m, id) {
  if (!m) {
    try {
      const d = await api("/api/memories");
      m = (d.memories || []).find((x) => x.id === id);
    } catch {}
    if (!m) { toast(t("Memory not found"), "err"); return; }
  }
  editingId = id;
  $("#overlay h3").textContent = t("Edit memory");
  $("#overlay .modal-desc").textContent = t("Update the content, kind, or importance.");
  $("#addKind").value = m.kind || "context";
  $("#addProject").value = m.projectSlug || "";
  $("#addContent").value = m.content || "";
  const ft = $("#fieldTags");
  if (ft) ft.style.display = "";
  const at = $("#addTags");
  if (at) at.value = (m.tags || []).join(", ");
  $("#btnSave").textContent = t("Save changes");
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
    if (props.length) toast(t("Scan finished — new: {0}") + props.map((r) => `${r.tool} +${r.count}`).join(", "));
    else toast(t("Scan finished — nothing new"));
    await Promise.all([loadStats(), loadProjects()]);
    if (state.view === "memories") renderMemories();
  } catch (e) {
    toast(t("Scan failed: ") + e.message, "err");
  } finally {
    btnText.textContent = old;
    $("#btnScan").disabled = false;
  }
}

async function saveMemory() {
  const content = $("#addContent").value.trim();
  if (!content) { toast(t("Memory content cannot be empty"), "err"); return; }
  try {
    if (editingId) {
      const tags = $("#addTags").value.split(",").map((x) => x.trim()).filter(Boolean);
      await api("/api/memories", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId, kind: $("#addKind").value, content, project: $("#addProject").value.trim(), tags }),
      });
      toast(t("Memory updated"));
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
    toast(t("Memory saved"));
    loadStats();
    if (state.view === "memories") renderMemories();
  } catch (e) {
    toast(t("Failed to save: ") + e.message, "err");
  }
}

function resetModal() {
  editingId = null;
  const ftx = $("#fieldTags");
  if (ftx) ftx.style.display = "none";
  $("#addContent").value = "";
  $("#addProject").value = "";
  $("#overlay h3").textContent = t("Add memory");
  $("#overlay .modal-desc").textContent = t("Save a fact, decision, or task so every AI tool remembers it.");
  $("#btnSave").textContent = t("Save memory");
  closeModal();
}

function openModal() {
  $("#overlay").classList.add("show");
  setTimeout(() => $("#addContent").focus(), 60);
}
function closeModal() { $("#overlay").classList.remove("show"); }

/* ---------- Events ---------- */

document.querySelectorAll(".nav-item").forEach((n) => {
  n.addEventListener("click", () => {
    // M11 (audit): loader per-view pindah ke setView — nav cukup memanggil itu.
    setView(n.dataset.view);
  });
});
// Optional chaining WAJIB: selector yang hilang tak boleh mematikan seluruh script
// (kejadian nyata: #linkAllProj terhapus saat redesign overview -> TypeError saat
// load -> wireSettingsTabs/init tak pernah jalan -> halaman Settings kosong).
$("#linkAllMem")?.addEventListener("click", () => { setView("memories"); renderMemories(); });
$("#linkAllProj")?.addEventListener("click", () => { setView("projects"); renderProjects(); });

$("#btnScan").addEventListener("click", doScan);
$("#btnAdd").addEventListener("click", () => { resetModal(); openModal(); });
$("#btnCancel").addEventListener("click", resetModal);
$("#btnSave").addEventListener("click", saveMemory);
$("#overlay").addEventListener("click", (e) => { if (e.target === $("#overlay")) resetModal(); });

$("#hfGen").addEventListener("click", renderHandoff);
$("#hfProject").addEventListener("change", renderHandoff);
$("#hfResume").addEventListener("click", async () => {
  const slug = $("#hfProject").value;
  if (!slug) { toast(t("Pick a project first"), "err"); return; }
  try {
    const d = await api("/api/resume?slug=" + encodeURIComponent(slug));
    await navigator.clipboard.writeText(d.text || "");
    toast(t("Resume prompt copied — paste it into the target tool and the new session picks up instantly"));
  } catch (e) {
    toast(t("Failed to build resume prompt: ") + e.message, "err");
  }
});
$("#hfCopy").addEventListener("click", () => {
  if (!handoffText) { toast(t("No handoff yet"), "err"); return; }
  navigator.clipboard.writeText(handoffText).then(() => toast(t("Handoff copied"))).catch(() => toast(t("Copy failed"), "err"));
});
$("#hfInject").addEventListener("click", async () => {
  const slug = $("#hfProject").value;
  if (!slug) { toast(t("Pick a project first"), "err"); return; }
  try {
    const r = await api("/api/handoff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug }) });
    if (r.ok) {
      const okFiles = (r.results || []).filter((x) => x.ok).map((x) => x.file);
      const failFiles = (r.results || []).filter((x) => !x.ok).map((x) => x.file);
      let msg = okFiles.length ? t("Context injected into: ") + okFiles.join(", ") : t("Injection failed (check write permissions)");
      if (failFiles.length) msg += t(" · failed: ") + failFiles.join(", ");
      toast(msg, okFiles.length ? "ok" : "err");
    } else {
      toast(t("Injection failed (check write permissions)"), "err");
    }
  } catch (e) {
    toast(t("Injection failed: ") + e.message, "err");
  }
});

$("#tlProject").addEventListener("change", () => { tlMode = "text"; renderTimeline(); });
$("#tlGitBtn").addEventListener("click", () => {
  tlMode = tlMode === "git" ? "text" : "git";
  $("#tlGitBtn").classList.toggle("primary", tlMode === "git");
  renderTimeline();
});

$("#grProject").addEventListener("change", renderGraph);
$("#grPause")?.addEventListener("click", (e) => {
  if (!__g3d) return;
  graph.paused = !graph.paused;
  e.currentTarget.classList.toggle("primary", graph.paused);
  graph.paused ? __g3d.pauseAnimation() : __g3d.resumeAnimation();
});
$("#grZoomIn")?.addEventListener("click", () => {
  if (!__g3d) return;
  const p = __g3d.cameraPosition();
  __g3d.cameraPosition({ x: p.x * 0.78, y: p.y * 0.78, z: p.z * 0.78 });
});
$("#grZoomOut")?.addEventListener("click", () => {
  if (!__g3d) return;
  const p = __g3d.cameraPosition();
  __g3d.cameraPosition({ x: p.x * 1.28, y: p.y * 1.28, z: p.z * 1.28 });
});
$("#grReset")?.addEventListener("click", () => {
  if (!__g3d) return;
  __g3d.cameraPosition({ x: 0, y: 40, z: 620 });
  __g3d.d3ReheatSimulation();
});
$("#grRebuild").addEventListener("click", async () => {
  try {
    const r = await api("/api/graph/rebuild", { method: "POST" });
    toast(t("Connections rebuilt: ") + r.links + " link");
    renderGraph();
  } catch (e) {
    toast(t("Failed: ") + e.message, "err");
  }
});

/* ---------- Project detail ---------- */
function showProject(slug) {
  setView("project");
  renderProjectDetail(slug);
}

async function renderProjectDetail(slug) {
  const mark = viewSeq("project:" + slug);
  const box = $("#projectDetail");
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div><div class="skeleton" style="height:300px"></div>';
  try {
    const d = await api("/api/project-detail?slug=" + encodeURIComponent(slug));
    if (!viewFresh(mark)) return;
    const st = d.stats;
    const git = d.git;
    box.innerHTML = `
      <div class="pd-head">
        <div>
          <h2>${esc(d.project.name)}</h2>
          <div class="pd-path">${esc(d.project.path || d.project.slug)}${git && git.branch ? " · " + esc(git.branch) : ""}</div>
        </div>
        <div class="pd-actions">
          <button class="btn" id="pdTimeline">${t("Timeline")}</button>
          <button class="btn" id="pdTasks">${t("Tasks")}</button>
          <button class="btn" id="pdHandoff">${t("Handoff")}</button>
          <button class="btn danger-ghost" id="pdPurge" title="${t("Delete ALL memories of this project")}">${t("Purge")}</button>
        </div>
      </div>
      <div class="pd-stats">
        <div class="stat"><div class="stat-value">${st.transcripts.toLocaleString("id-ID")}</div><div class="stat-label">${t("Transcripts stored")}</div></div>
        <div class="stat"><div class="stat-value">${st.memories.toLocaleString("id-ID")}</div><div class="stat-label">${t("Active memories")}</div></div>
        <div class="stat"><div class="stat-value">${st.tasksOpen.toLocaleString("id-ID")}</div><div class="stat-label">${t("Open tasks")}</div></div>
        <div class="stat"><div class="stat-value">${fmtRel(st.lastSeen)}</div><div class="stat-label">${t("Recently accessed")}</div></div>
      </div>
      ${git && git.dirty.length ? `<div class="pd-git"><span class="git-dot"></span>${t("Working tree changes")}: ${esc(git.dirty.slice(0, 6).join(", "))}${git.dirty.length > 6 ? " …" : ""}</div>` : ""}
      <div class="pd-grid">
        <div>
          <div class="card" style="margin-bottom:16px">
            <h4>${t("Open tasks")}</h4>
            <div id="pdTasksList" style="margin-top:8px"></div>
          </div>
          <div class="card">
            <h4>${t("Recent memories")}</h4>
            <div id="pdMemories" style="margin-top:8px"></div>
          </div>
        </div>
        <div>
          <div class="card">
            <h4>${t("7-day activity")}</h4>
            <canvas id="pdChart" height="170" style="width:100%; display:block"></canvas>
          </div>
          <div class="card" style="margin-top:16px">
            <h4>${t("Jump to")}</h4>
            <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px">
              <button class="btn" id="pdGoTimeline">${t("Timeline")}</button>
              <button class="btn" id="pdGoTasks">${t("Tasks")}</button>
              <button class="btn" id="pdGoHandoff">${t("Handoff")}</button>
              <button class="btn" id="pdGoGraph">${t("Graph")}</button>
            </div>
          </div>
          ${d.project.path ? `<div class="card" style="margin-top:16px">
            <h4>${t("Project brain for your team")}</h4>
            <div class="card-desc">${esc(t("Keep this project's decisions, conventions, fixes and open tasks in .memoria/brain.md in the repo. Teammates using Memoria get them automatically; review changes in pull requests. Secrets are redacted."))}</div>
            <div style="display:flex; gap:8px; align-items:center; margin-top:8px">
              <button class="btn" id="pdBrain">${d.brain && d.brain.export ? t("Stop sharing") : t("Share in repo")}</button>
              <span class="muted" style="font-size:12px">${d.brain && d.brain.exists ? esc(t("{0} entries in .memoria/brain.md", d.brain.entries)) : ""}</span>
            </div>
          </div>` : ""}
        </div>
      </div>`;
    document.getElementById("pdBrain")?.addEventListener("click", async () => {
      try {
        const on = !(d.brain && d.brain.export);
        const r = await api("/api/projects/brain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, export: on }) });
        toast(on ? t("Shared: {0} entries written to {1}", r.entries, r.file) : t("Sharing stopped. The file stays in the repo until you delete it."));
        renderProjectDetail(slug);
      } catch (e) {
        toast(t("Failed: ") + e.message, "err");
      }
    });
    // aksi
    const goTimeline = () => { setView("timeline"); const sel = $("#tlProject"); if (sel) sel.value = slug; tlMode = "text"; renderTimeline(); };
    const goTasks = () => { setView("tasks"); const sel = $("#tkProject"); if (sel) sel.value = slug; renderTasks(); };
    const goHandoff = () => { setView("handoff"); const sel = $("#hfProject"); if (sel) sel.value = slug; };
    $("#pdTimeline")?.addEventListener("click", goTimeline);
    $("#pdTasks")?.addEventListener("click", goTasks);
    $("#pdHandoff")?.addEventListener("click", goHandoff);
    // PR-M: purge massal — dua konfirmasi (jumlah memori + konfirmasi akhir).
    $("#pdPurge")?.addEventListener("click", async () => {
      try {
        // M11 (audit): probe count di dalam try — dulu 404/500 di sini
        // menjadi unhandled rejection tanpa toast.
        const first = await api("/api/memories/purge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug }) });
        const n = first.memories ?? 0;
        if (!n) { toast(t("No memories to purge")); return; }
        if (!confirm(t("Delete ALL {0} active memories of this project? This cannot be undone.", n))) return;
        if (!confirm(t("Last confirmation — purge {0} memories now?", n))) return;
        const r = await api("/api/memories/purge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, confirm: true }) });
        toast(t("Purged {0} memories", r.removed));
        loadStats();
        renderProjectDetail(slug);
      } catch (e) {
        toast(t("Failed: ") + e.message, "err");
      }
    });
    $("#pdGoTimeline")?.addEventListener("click", goTimeline);
    $("#pdGoTasks")?.addEventListener("click", goTasks);
    $("#pdGoHandoff")?.addEventListener("click", goHandoff);
    $("#pdGoGraph")?.addEventListener("click", () => setView("graph"));
    // tugas mini
    const tk = $("#pdTasksList");
    if (d.tasks.open.length) {
      tk.innerHTML = d.tasks.open.slice(0, 6).map((t) => `
        <div class="task-item"><div class="task-check" data-pdtoggle="${t.id}"></div>
          <div class="task-body"><div class="task-text">${esc(t.content)}</div>
          <div class="task-meta">${esc(TOOL_LABEL[t.sourceTool] || t.sourceTool)} · ${fmtRel(t.createdAt)}</div></div></div>`).join("");
      tk.querySelectorAll("[data-pdtoggle]").forEach((el) => {
        el.addEventListener("click", async () => {
          await api("/api/tasks/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: Number(el.dataset.pdtoggle), resolved: true }) });
          renderProjectDetail(slug);
        });
      });
    } else {
      tk.innerHTML = `<div class="card-desc">${t("No open tasks")}</div>`;
    }
    // memori terbaru
    const mm = $("#pdMemories");
    // PR-I: hasil heuristik parkir di draft — proyek "0 memori aktif" tidak
    // boleh terlihat kosong; tunjukkan jumlah draft + pintasan ke tinjauan.
    if (d.draftCount > 0) {
      const banner = document.createElement("div");
      banner.style.cssText = "margin:0 0 12px";
      banner.innerHTML = `<div class="card-desc" style="margin:0 0 8px">${t("Heuristic results are parked as drafts — {0} waiting for this project", d.draftCount)}</div>`;
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = t("Review drafts");
      btn.addEventListener("click", () => {
        state.memTab = "draft";
        state.filterProject = slug;
        const sel = $("#filterProject");
        if (sel) sel.value = slug;
        setView("memories");
      });
      banner.appendChild(btn);
      mm.parentElement.insertBefore(banner, mm);
    }
    if (d.recentMemories.length) {
      mm.innerHTML = d.recentMemories.map((m) => `
        <div class="mem"><div class="mem-rail"><span class="kind-dot kind-${m.kind}"></span></div>
          <div class="mem-body"><div class="mem-meta"><span class="mem-kind kind-${m.kind}">${t(KIND_LABEL[m.kind] || m.kind)}</span>
          <span class="sep">·</span><span>${esc(TOOL_LABEL[m.sourceTool] || m.sourceTool)}</span><span class="sep">·</span><span>${fmtRel(m.createdAt)}</span></div>
          <div class="mem-content">${esc(m.content)}</div></div></div>`).join("");
    } else {
      mm.innerHTML = `<div class="card-desc">${t("No memories yet")}</div>`;
    }
    drawProjectChart(d.week);
  } catch (e) {
    box.innerHTML = `<div class="err-box"><h4>${t("Couldn't load project")}</h4><p>${esc(e.message)}</p><button class="btn" id="pdRetry">${t("Retry")}</button></div>`;
    box.querySelector('#pdRetry')?.addEventListener('click', () => renderProjectDetail(slug));
  }
}

/* Area chart mini per proyek (sadar tema) */
function drawProjectChart(week) {
  const canvas = document.getElementById("pdChart");
  if (!canvas || !week) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.parentElement.clientWidth - 36, H = 170;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.height = H + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const light = isLightTheme();
  const max = Math.max(4, ...week.map((w) => w.count));
  const padL = 6, padR = 6, padT = 14, padB = 22;
  const iw = W - padL - padR, ih = H - padT - padB;
  const pts = week.map((w, i) => ({
    x: padL + (week.length === 1 ? iw / 2 : (i / (week.length - 1)) * iw),
    y: padT + ih - (w.count / max) * ih * 0.9,
    ...w,
  }));
  const grad = ctx.createLinearGradient(0, padT, 0, H - padB);
  grad.addColorStop(0, light ? "rgba(122, 95, 208, 0.25)" : "rgba(139,110,255,.34)");
  grad.addColorStop(1, light ? "rgba(122, 95, 208, 0)" : "rgba(139,110,255,0)");
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const xc = (pts[i - 1].x + pts[i].x) / 2;
    ctx.bezierCurveTo(xc, pts[i - 1].y, xc, pts[i].y, pts[i].x, pts[i].y);
  }
  ctx.lineTo(pts[pts.length - 1].x, H - padB);
  ctx.lineTo(pts[0].x, H - padB);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const xc = (pts[i - 1].x + pts[i].x) / 2;
    ctx.bezierCurveTo(xc, pts[i - 1].y, xc, pts[i].y, pts[i].x, pts[i].y);
  }
  ctx.strokeStyle = light ? "#7a5fd0" : "#a684ff";
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.font = "10px Inter, sans-serif";
  pts.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = light ? "#7a5fd0" : "#a684ff";
    ctx.fill();
    ctx.fillStyle = light ? "#8b93a2" : "#5d6575";
    ctx.textAlign = "center";
    ctx.fillText(p.day.slice(3), p.x, H - 6);
  });
}

/* ---------- Tasks ---------- */
async function renderTasks() {
  const mark = viewSeq("tasks");
  const slug = $("#tkProject") ? $("#tkProject").value : "";
  const openBox = $("#tasksOpen");
  const doneBox = $("#tasksDone");
  if (!openBox) return;
  try {
    const d = await api("/api/tasks" + (slug ? "?slug=" + encodeURIComponent(slug) : ""));
    if (!viewFresh(mark)) return;
    const item = (task, done) => `
      <div class="task-item ${done ? "done-row" : ""}" data-id="${task.id}">
        <div class="task-check" data-toggle="${task.id}" title="${done ? t("Reopen") : t("Mark done")}">${done ? '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.5 3.5L13 5"/></svg>' : ""}</div>
        <div class="task-body">
          <div class="task-text">${esc(task.content)}</div>
          <div class="task-meta">${esc(prettySlug(task.projectSlug))} · ${esc(TOOL_LABEL[task.sourceTool] || task.sourceTool)} · ${done ? t("done") + " " + fmtRel(task.resolvedAt || task.createdAt) : fmtRel(task.createdAt)}</div>
        </div>
        <button class="task-del" data-tdel="${task.id}" title="${t("Delete")}"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 4h10M6 4V3h4v1M5.5 4l.6 9h3.8l.6-9"/></svg></button>
      </div>`;
    openBox.innerHTML = d.open.length
      ? d.open.map((task) => item(task, false)).join("")
      : emptyState(t("No open tasks"), t("Pending tasks captured from your AI sessions show up here."));
    doneBox.innerHTML = d.done.length
      ? d.done.map((task) => item(task, true)).join("")
      : `<div class="card-desc" style="padding:6px 2px">${t("Nothing completed yet.")}</div>`;
    $("#tkOpenBadge").textContent = t("{0} open", d.open.length);
    const navBadge = document.getElementById("navTaskCount");
    if (navBadge) navBadge.textContent = d.open.length > 0 ? d.open.length : "";

    openBox.querySelectorAll("[data-toggle]").forEach((el) => {
      el.addEventListener("click", async () => {
        await api("/api/tasks/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: Number(el.dataset.toggle), resolved: true }) });
        renderTasks();
      });
    });
    doneBox.querySelectorAll("[data-toggle]").forEach((el) => {
      el.addEventListener("click", async () => {
        await api("/api/tasks/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: Number(el.dataset.toggle), resolved: false }) });
        renderTasks();
      });
    });
    document.querySelectorAll("[data-tdel]").forEach((el) => {
      el.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(t("Delete this task?"))) return;
        await api("/api/memories?id=" + el.dataset.tdel, { method: "DELETE" });
        renderTasks();
      });
    });
  } catch (e) {
    openBox.innerHTML = `<div class="err-box"><h4>${t("Couldn't load tasks")}</h4><p>${esc(e.message)}</p><button class="btn" id="taskRetry">${t("Retry")}</button></div>`;
    openBox.querySelector("#taskRetry")?.addEventListener("click", () => renderTasks());
    if (doneBox) doneBox.innerHTML = "";
  }
}
$("#tkProject")?.addEventListener("change", renderTasks);

$("#btnBackupNow").addEventListener("click", async () => {
  try {
    const r = await api("/api/backup", { method: "POST" });
    toast(r.ok ? t("Backup saved: ") + r.path : t("Backup failed"), r.ok ? "ok" : "err");
    loadBackups();
  } catch (e) {
    toast(t("Backup failed: ") + e.message, "err");
  }
});
$("#btnExport").addEventListener("click", async () => {
  try {
    const d = await api("/api/export?format=md");
    download("memoria.md", d.text || "");
    toast(t("Export finished"));
  } catch (e) {
    toast(t("Export failed: ") + e.message, "err");
  }
});
$("#btnExportJson").addEventListener("click", async () => {
  try {
    const d = await api("/api/export?format=json");
    download("memoria.json", JSON.stringify(d, null, 2), "application/json");
    toast(t("JSON export finished"));
  } catch (e) {
    toast(t("Export failed: ") + e.message, "err");
  }
});
$("#btnObsidian").addEventListener("click", async () => {
  try {
    const r = await api("/api/export/obsidian", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    if (r.ok) toast(t("Obsidian vault saved: ") + r.dir + " (" + r.notes + " " + t("notes") + ")");
    else toast(t("Export failed: ") + (r.error || ""), "err");
  } catch (e) {
    toast(t("Export failed: ") + e.message, "err");
  }
});
$("#btnTopics").addEventListener("click", async () => {
  try {
    const btn = $("#btnTopics");
    btn.disabled = true;
    btn.textContent = "Membangun…";
    const r = await api("/api/tags/rebuild", { method: "POST" });
    toast(t("Topic tags built: {0} memories → {1} topics", r.memories, r.topics));
    loadTags();
  } catch (e) {
    toast(t("Failed: ") + e.message, "err");
  } finally {
    const btn = $("#btnTopics");
    btn.disabled = false;
    btn.textContent = t("Build topic tags now");
  }
});
$("#btnDigest").addEventListener("click", async () => {
  const box = $("#digestBox");
  box.textContent = t("Generating digest…");
  try {
    const r = await api("/api/digest/generate", { method: "POST" });
    box.textContent = r.text || "";
    toast(t("Weekly digest generated ({0} memories)", r.memories));
  } catch (e) {
    box.textContent = t("Failed: ") + e.message;
  }
});

$("#btnImport").addEventListener("click", async () => {
  const text = $("#importText").value.trim();
  if (!text) { toast(t("Text is empty"), "err"); return; }
  try {
    const r = await api("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, tool: "import" }) });
    if (r.ok) { toast(t("Context stored as a transcript, ready for extraction")); $("#importText").value = ""; loadStats(); }
    else toast(t("Import failed"), "err");
  } catch (e) {
    toast(t("Import failed: ") + e.message, "err");
  }
});

wireSettingsToggles();

// PR-G: Import Markdown folder (Obsidian dua arah — sisi import).
$("#btnImportMd").addEventListener("click", async () => {
  const folder = $("#mdFolder").value.trim();
  if (!folder) { toast(t("Folder path is empty"), "err"); return; }
  const btn = $("#btnImportMd");
  btn.disabled = true;
  try {
    const r = await api("/api/import/markdown", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folder }) });
    if (r.ok) {
      toast(t("Imported {0} notes ({1} merged)", r.imported, r.merged));
      $("#mdFolder").value = "";
      loadStats();
    } else toast(t("Import failed: ") + (r.error || ""), "err");
  } catch (e) {
    toast(t("Import failed: ") + e.message, "err");
  } finally {
    btn.disabled = false;
  }
});

// Chat export upload: raw bytes (exports are often larger than a JSON body).
document.getElementById("btnImportChats")?.addEventListener("click", async () => {
  const input = document.getElementById("chatExportFile");
  const file = input && input.files && input.files[0];
  if (!file) { toast(t("Choose an export file first"), "err"); return; }
  const btn = document.getElementById("btnImportChats");
  btn.disabled = true;
  btn.textContent = t("Importing…");
  try {
    const r = await api("/api/import/chats", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
    toast(t("Imported {0} conversations ({1} messages) from {2}", r.conversations, r.messages, r.source === "chatgpt" ? "ChatGPT" : "Claude"));
    input.value = "";
    loadStats();
    loadProjects();
  } catch (e) {
    toast(t("Import failed: ") + e.message, "err");
  } finally {
    btn.disabled = false;
    btn.textContent = t("Import");
  }
});

document.getElementById("btnObsidianSync")?.addEventListener("click", async () => {
  const dir = document.getElementById("setObsidianVault").value.trim();
  if (!dir) { toast(t("Folder path is empty"), "err"); return; }
  try {
    const r = await api("/api/obsidian/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dir }) });
    if (!r.ok) throw new Error(r.error || "sync failed");
    toast(t("Vault synced: {0} notes, {1} updated from Obsidian, {2} new, {3} archived", r.notes, r.updatedFromNotes, r.createdFromNotes, r.archivedFromNotes));
    loadStats();
  } catch (e) {
    toast(t("Failed: ") + e.message, "err");
  }
});

function wireShortcutInputs() {
  for (const [sel, key] of [["#setShortcutQuick", "shortcutQuick"], ["#setShortcutPalette", "shortcutPalette"]]) {
    const el = document.querySelector(sel);
    if (!el) continue;
    el.addEventListener("change", async () => {
      try {
        await api("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value: el.value.trim() }),
        });
        toast(t("Shortcut saved — applies after app restart"));
      } catch (e) {
        toast(t("Failed to save shortcut: ") + e.message, "err");
      }
    });
  }
}
wireShortcutInputs();

const PROVIDER_PRESETS = {
  custom: { baseUrl: "", extract: "gpt-4o-mini", embed: "text-embedding-3-small" },
  lmstudio: { baseUrl: "http://localhost:1234/v1", extract: "local-model", embed: "text-embedding-nomic-embed-text-v1.5" },
  ollama: { baseUrl: "http://localhost:11434/v1", extract: "llama3.2", embed: "nomic-embed-text" },
  llamacpp: { baseUrl: "http://localhost:8080/v1", extract: "local-model", embed: "local-embed" },
  openai: { baseUrl: "https://api.openai.com/v1", extract: "gpt-4o-mini", embed: "text-embedding-3-small" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", extract: "openai/gpt-4o-mini", embed: "openai/text-embedding-3-small" },
  groq: { baseUrl: "https://api.groq.com/openai/v1", extract: "llama-3.3-70b-versatile", embed: "" },
  together: { baseUrl: "https://api.together.xyz/v1", extract: "meta-llama/Llama-3.3-70B-Instruct-Turbo", embed: "togethercomputer/m2-bert-80M-8k-retrieval" },
  fireworks: { baseUrl: "https://api.fireworks.ai/inference/v1", extract: "accounts/fireworks/models/llama-v3p3-70b-instruct", embed: "nomic-ai/nomic-embed-text-v1.5" },
  mistral: { baseUrl: "https://api.mistral.ai/v1", extract: "mistral-small-latest", embed: "mistral-embed" },
  deepseek: { baseUrl: "https://api.deepseek.com/v1", extract: "deepseek-chat", embed: "" },
};

function intelModeFrom(ex, em) {
  if (ex === "heuristic" && em === "hash") return "local";
  if (ex === "auto" && em === "auto") return "auto";
  if (ex === "ollama" && em === "ollama") return "ollama";
  if (ex === "openai" && em === "openai") return "cloud";
  return "custom";
}

function updateEngineVisibility() {
  const ex = document.getElementById("setExtractEngine");
  const em = document.getElementById("setEmbedEngine");
  const box = document.getElementById("engineCloudConfig");
  const modeSel = document.getElementById("setIntelMode");
  const hint = document.getElementById("intelModeHint");
  const customOpt = document.getElementById("intelModeCustom");
  const advBox = document.getElementById("intelAdvancedBox");
  const advSw = document.getElementById("intelAdvancedSw");
  if (!ex || !em) return;
  const mode = intelModeFrom(ex.value, em.value);
  if (modeSel) {
    if (customOpt) { customOpt.hidden = mode !== "custom"; customOpt.disabled = mode !== "custom"; }
    modeSel.value = mode;
  }
  if (hint) {
    const hints = {
      local: t("No model, fully local. Rule-based extraction with automatic triage + local hash embeddings."),
      auto: t("Uses Ollama when running, otherwise local heuristics/hash. Nothing leaves this machine."),
      ollama: t("Local LLM via Ollama for both extraction and semantic embeddings."),
      cloud: t("Uses the provider below for extraction and embeddings (data may leave this machine)."),
      custom: t("Mixed/advanced configuration (extraction and embedding set separately)."),
    };
    hint.textContent = hints[mode] || "";
  }
  // auto-show advanced when custom
  if (mode === "custom" && advBox && advSw) {
    advBox.style.display = "";
    advSw.classList.add("on");
  }
  if (box) {
    const needs = ex.value === "openai" || em.value === "openai";
    box.style.display = needs ? "" : "none";
  }
}

function wireEngineSettings() {
  // API key hanya dikirim bila diisi (tidak menimpa key tersimpan dengan kosong).
  const fields = [
    ["#setExtractEngine", "extractEngine", false],
    ["#setEmbedEngine", "embedEngine", false],
    ["#setOpenaiBaseUrl", "openaiBaseUrl", false],
    ["#setOpenaiExtractModel", "openaiExtractModel", false],
    ["#setOpenaiEmbedModel", "openaiEmbedModel", false],
    ["#setOpenaiApiKey", "openaiApiKey", true],
  ];
  for (const [sel, key, onlyIfFilled] of fields) {
    const el = document.querySelector(sel);
    if (!el) continue;
    el.addEventListener("change", async () => {
      const value = el.value.trim();
      if (onlyIfFilled && !value) return;
      try {
        await api("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value }),
        });
        if (key === "openaiApiKey") {
          el.value = "";
          const kst = document.getElementById("stOpenaiKey");
          if (kst) kst.textContent = t("API key stored — refill to replace");
          toast(t("Saved — encrypted"));
        } else {
          if (key === "extractEngine" || key === "embedEngine") updateEngineVisibility();
          toast(t("Engine updated — applied instantly"));
        }
        loadStats();
      } catch (e) {
        toast(t("Failed to save: ") + e.message, "err");
      }
    });
  }

  const modeSel = document.getElementById("setIntelMode");
  if (modeSel) {
    modeSel.addEventListener("change", async () => {
      const mode = modeSel.value;
      if (mode === "custom") { updateEngineVisibility(); return; }
      const map = {
        local: ["heuristic", "hash"],
        auto: ["auto", "auto"],
        ollama: ["ollama", "ollama"],
        cloud: ["openai", "openai"],
      };
      const pair = map[mode];
      if (!pair) return;
      const exEl = document.getElementById("setExtractEngine");
      const emEl = document.getElementById("setEmbedEngine");
      if (exEl) exEl.value = pair[0];
      if (emEl) emEl.value = pair[1];
      updateEngineVisibility();
      try {
        await Promise.all([
          api("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "extractEngine", value: pair[0] }) }),
          api("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "embedEngine", value: pair[1] }) }),
        ]);
        toast(t("Engine updated — applied instantly"));
        loadStats();
      } catch (e) {
        toast(t("Failed to save: ") + e.message, "err");
      }
    });
  }

  const advSw = document.getElementById("intelAdvancedSw");
  const advBox = document.getElementById("intelAdvancedBox");
  const advRow = document.getElementById("intelAdvancedRow");
  if (advSw && advBox) {
    const toggleAdv = () => {
      const on = advSw.classList.toggle("on");
      advBox.style.display = on ? "" : "none";
    };
    advSw.addEventListener("click", toggleAdv);
    if (advRow) advRow.addEventListener("click", (e) => { if (e.target !== advSw && !advSw.contains(e.target)) toggleAdv(); });
  }

  updateEngineVisibility();
  const prov = document.getElementById("setApiProvider");
  if (prov) {
    prov.addEventListener("change", async () => {
      const p = PROVIDER_PRESETS[prov.value];
      const base = document.getElementById("setOpenaiBaseUrl");
      const ex = document.getElementById("setOpenaiExtractModel");
      const em = document.getElementById("setOpenaiEmbedModel");
      if (p) {
        if (base) base.value = prov.value === "custom" ? (base.value || "") : (p.baseUrl || "");
        if (ex) ex.value = p.extract || "";
        if (em) em.value = p.embed || "";
      }
      try {
        await Promise.all([
          api("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "openaiProvider", value: prov.value }) }),
          base ? api("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "openaiBaseUrl", value: base.value.trim() }) }) : Promise.resolve(),
          ex ? api("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "openaiExtractModel", value: ex.value.trim() }) }) : Promise.resolve(),
          em ? api("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "openaiEmbedModel", value: em.value.trim() }) }) : Promise.resolve(),
        ]);
        toast(t("Engine updated — applied instantly"));
        loadStats();
      } catch (e) {
        toast(t("Failed to save: ") + e.message, "err");
      }
    });
  }
}
wireEngineSettings();

/* ---------- Settings: webhook notifications (F3) ---------- */
function wireNotifySettings() {
  const post = (key, value) =>
    api("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
  // Secret: hanya dikirim bila diisi (tidak menimpa yang tersimpan dengan kosong);
  // setelah tersimpan, input dikosongkan & badge diperbarui.
  const wireSecret = (sel, key, stId) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.addEventListener("change", async () => {
      const v = el.value.trim();
      if (!v) return;
      try {
        await post(key, v);
        el.value = "";
        const st = document.getElementById(stId);
        if (st) st.textContent = t("Saved");
        toast(t("Saved — encrypted"));
      } catch (e) {
        toast(t("Failed to save: ") + e.message, "err");
      }
    });
  };
  const wireField = (sel, key) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.addEventListener("change", async () => {
      try {
        await post(key, el.value.trim());
        toast(t("Saved"));
      } catch (e) {
        toast(t("Failed to save: ") + e.message, "err");
      }
    });
  };
  const wireTest = (btnId, platform) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const old = btn.textContent;
      btn.textContent = t("Sending…");
      try {
        const r = await api("/api/notify/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ platform }),
        });
        if (r.ok) toast(t("Test notification sent"));
        else toast(t("Failed: ") + (r.error || "not configured"), "err");
      } catch (e) {
        toast(t("Failed: ") + e.message, "err");
      } finally {
        btn.disabled = false;
        btn.textContent = old;
      }
    });
  };
  wireSecret("#setNotifyDiscord", "notifyDiscordUrl", "stNotifyDiscord");
  wireSecret("#setNotifyTelegramToken", "notifyTelegramToken", "stNotifyTelegram");
  wireSecret("#setNotifyGeneric", "notifyGenericUrl", "stNotifyGeneric");
  wireField("#setNotifyTelegramChat", "notifyTelegramChat");
  wireField("#setCaptureExclude", "captureExclude");
  wireField("#setNotifyDraftMin", "notifyDraftMin");
  wireTest("btnTestDiscord", "discord");
  wireTest("btnTestTelegram", "telegram");
  wireTest("btnTestGeneric", "generic");
}
wireNotifySettings();

function fmtSyncTime(ms) {
  const n = Number(ms);
  if (!n) return t("never");
  return new Date(n).toLocaleString();
}

async function loadSyncStatus() {
  const box = document.getElementById("syncStatusBox");
  try {
    const d = await api("/api/sync/status");
    const st = d.status || {};
    const folder = d.folder || {};
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    if (box) {
      if (!st.configured) box.textContent = t("Not configured") + ". " + "CLI: memoria sync setup";
      else if (st.locked) box.textContent = t("Configured (locked — unlock via CLI)");
      else box.textContent = t("Configured") + (st.storage ? " (" + st.storage + ")" : "");
    }
    set("syncKvStatus", !st.configured ? t("Not configured") : st.locked ? t("Locked") : t("Configured"));
    set("syncKvGroup", st.groupId || (st.locked ? t("Locked") : "—"));
    set("syncKvDevice", st.deviceName ? st.deviceName + " (" + (st.deviceId || "").slice(0, 8) + ")" : "—");
    const pendingN = st.pendingSinceExport ?? st.pendingOutbox ?? 0;
    set("syncKvPending", st.configured ? String(pendingN) : (pendingN ? `${pendingN} (${t("not configured")})` : "—"));
    set("syncKvExport", fmtSyncTime(st.lastExportAt));
    set("syncKvImport", fmtSyncTime(st.lastImportAt));
    set("syncKvConflicts", st.configured ? String(st.conflicts ?? 0) : "—");
    set("syncKvEmbed", st.configured ? String(st.embeddingsQueued ?? 0) : "—");
    const f = folder || {};
    const pathInput = document.getElementById("setSyncFolder");
    if (pathInput && document.activeElement !== pathInput) pathInput.value = f.path || "";
    set("syncKvFolder", f.path || t("Not set"));
    let fstate = t("Not set");
    if (f.path) {
      const parts = [];
      parts.push(f.available ? t("Available") : t("Unavailable"));
      if (f.writable) parts.push(t("writable"));
      parts.push(f.watching ? t("Watching") : t("Not watching"));
      fstate = parts.join(", ");
    }
    set("syncKvFolderState", fstate);
    set("syncKvError", f.lastError || "—");
  } catch (e) {
    if (box) box.textContent = t("Failed to load sync status");
  }
}

/* Settings → Sync → Devices: list, rotate the group key, revoke a device. */
let syncStorage = "";
async function loadSyncDevices() {
  const box = document.getElementById("syncDevices");
  const rot = document.getElementById("btnSyncRotate");
  if (!box) return;
  try {
    const [d, st] = await Promise.all([api("/api/sync/devices"), api("/api/sync/status")]);
    syncStorage = (st.status && st.status.storage) || "";
    if (rot) rot.disabled = !d.configured;
    if (!d.configured) {
      box.innerHTML = `<div class="card-desc">${esc(t("Set up sync first: memoria sync setup"))}</div>`;
      return;
    }
    const devs = (d.devices || []).slice().sort((a, b) => Number(b.self) - Number(a.self) || Number(a.revoked) - Number(b.revoked) || b.lastBundleAt - a.lastBundleAt);
    box.innerHTML = devs.map((dev) => {
      const tags = (dev.self ? `<span class="dev-tag self">${esc(t("this device"))}</span>` : "") + (dev.revoked ? `<span class="dev-tag rev">${esc(t("revoked"))}</span>` : "");
      const sub = dev.self
        ? t("Your current device")
        : dev.lastBundleAt ? (dev.bundles === 1 ? t("Last bundle {0} · 1 bundle", fmtRel(dev.lastBundleAt)) : t("Last bundle {0} · {1} bundles", fmtRel(dev.lastBundleAt), dev.bundles)) : t("No bundles applied yet");
      const action = !dev.self && !dev.revoked
        ? `<button class="btn danger" data-revoke="${esc(dev.deviceId)}" data-name="${esc(dev.name || dev.deviceId.slice(0, 8))}">${esc(t("Revoke"))}</button>`
        : "";
      return `<div class="dev-row ${dev.revoked ? "revoked" : ""}">
        <div class="dev-main">
          <div class="dev-name">${esc(dev.name || t("Unnamed device"))} <span class="dev-id">${esc(dev.deviceId.slice(0, 8))}</span> ${tags}</div>
          <div class="dev-sub">${esc(sub)}</div>
        </div>${action}
      </div>`;
    }).join("");
    if (devs.length === 1) box.insertAdjacentHTML("beforeend", `<div class="card-desc">${esc(t("Other devices appear here after their first bundle is applied."))}</div>`);
    box.querySelectorAll("[data-revoke]").forEach((b) => b.addEventListener("click", () => syncKeyDialog({ revoke: b.dataset.revoke, name: b.dataset.name })));
  } catch (e) {
    box.innerHTML = `<div class="card-desc">${esc(t("Failed to load devices"))}</div>`;
  }
}
/* Confirm → (passphrase) → run → show the new recovery code once. */
function syncKeyDialog(opts = {}) {
  const dlg = document.createElement("dialog");
  dlg.className = "sync-dlg";
  const revoking = !!opts.revoke;
  const needsPass = syncStorage === "passphrase";
  dlg.innerHTML = `
    <h3>${esc(revoking ? t("Revoke {0}?", opts.name) : t("Rotate the sync key?"))}</h3>
    <p>${esc(revoking
      ? t("This device can no longer read new bundles. Memoria creates a new group key, and every device you keep must rejoin with the new recovery code.")
      : t("Memoria creates a new group key. Every other device must rejoin with the new recovery code before it can sync again."))}</p>
    ${needsPass ? `<label class="t-label" for="dlgPass">${esc(t("Sync passphrase"))}</label><input type="password" id="dlgPass" autocomplete="current-password">` : ""}
    <div class="dlg-err" id="dlgErr" role="alert"></div>
    <div class="dlg-actions">
      <button class="btn" id="dlgCancel">${esc(t("Cancel"))}</button>
      <button class="btn ${revoking ? "danger" : "primary"}" id="dlgGo">${esc(revoking ? t("Revoke and rotate") : t("Rotate key"))}</button>
    </div>`;
  document.body.appendChild(dlg);
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  dlg.querySelector("#dlgCancel").addEventListener("click", close);
  dlg.querySelector("#dlgGo").addEventListener("click", async (ev) => {
    const go = ev.currentTarget;
    const pass = dlg.querySelector("#dlgPass")?.value || "";
    if (needsPass && !pass) { dlg.querySelector("#dlgErr").textContent = t("Enter the passphrase."); return; }
    go.disabled = true;
    try {
      const r = await api(revoking ? "/api/sync/revoke" : "/api/sync/rotate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, deviceId: opts.revoke, passphrase: pass || undefined }),
      });
      if (!r.ok) throw new Error(r.error || "failed");
      const cmd = `memoria sync setup --join ${r.recoveryCode} --force`;
      dlg.innerHTML = `
        <h3>${esc(t("New recovery code"))}</h3>
        <p>${esc(t("Run this on every device you keep. It is shown once; store it like a password."))}</p>
        <div class="code" id="dlgCode">${esc(cmd)}</div>
        <p>${esc(r.republished ? t("All memories were re-exported to the shared folder under the new key ({0} changes).", r.republished.opCount) : r.republishError ? t("The key was rotated, but the re-export failed: {0}", r.republishError) : t("No shared folder: run memoria sync export --full and import it on the other devices."))}</p>
        <div class="dlg-actions">
          <button class="btn" id="dlgCopy">${esc(t("Copy command"))}</button>
          <button class="btn primary" id="dlgDone">${esc(t("Done"))}</button>
        </div>`;
      dlg.querySelector("#dlgCopy").addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(cmd); toast(t("Copied")); } catch { toast(t("Copy failed"), "err"); }
      });
      dlg.querySelector("#dlgDone").addEventListener("click", close);
      toast(revoking ? t("Device revoked, key rotated") : t("Sync key rotated"));
      loadSyncDevices();
      loadSyncStatus();
    } catch (e) {
      go.disabled = false;
      dlg.querySelector("#dlgErr").textContent = String(e.message || e);
    }
  });
  dlg.showModal();
  (dlg.querySelector("#dlgPass") || dlg.querySelector("#dlgCancel")).focus();
}
document.getElementById("btnSyncRotate")?.addEventListener("click", () => syncKeyDialog());
async function loadSyncConflicts() {
  const box = document.getElementById("syncConflictsBox");
  if (!box) return;
  try {
    const d = await api("/api/sync/conflicts?limit=30");
    const rows = d.conflicts || [];
    if (!rows.length) { box.innerHTML = `<div class="card-desc">${t("No sync conflicts.")}</div>`; return; }
    box.innerHTML = `<div class="list">${rows.map(r => `
      <div class="mem" style="padding:8px 0">
        <div class="mem-meta"><span class="mem-kind kind-context">${esc(r.entity)}</span> <span class="sep">·</span> ${esc(new Date(r.createdAt).toLocaleString())}</div>
        <div class="mem-content" style="font-family:var(--mono); font-size:11px">${esc(r.entityUid)}</div>
        <div class="card-desc">winner ${esc(String(r.winnerHlc).slice(-18))} · loser ${esc(String(r.loserHlc).slice(-18))}</div>
      </div>`).join("")}</div>`;
  } catch (e) {
    box.innerHTML = `<div class="card-desc">${t("Failed to load conflicts")}</div>`;
  }
}

function wireSyncSettings() {
  const setBtn = document.getElementById("btnSyncFolderSet");
  const clearBtn = document.getElementById("btnSyncFolderClear");
  const refBtn = document.getElementById("btnSyncRefresh");
  if (setBtn && !setBtn.dataset.wired) {
    setBtn.dataset.wired = "1";
    setBtn.addEventListener("click", async () => {
      const path = (document.getElementById("setSyncFolder")?.value || "").trim();
      if (!path) return;
      setBtn.disabled = true;
      try {
        const r = await api("/api/sync/folder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
        if (r.ok) toast(t("Folder saved")); else toast(t("Failed to save folder: ") + (r.error || ""), "err");
      } catch (e) { toast(t("Failed to save folder: ") + e.message, "err"); }
      setBtn.disabled = false;
      loadSyncStatus();
    });
  }
  if (clearBtn && !clearBtn.dataset.wired) {
    clearBtn.dataset.wired = "1";
    clearBtn.addEventListener("click", async () => {
      clearBtn.disabled = true;
      try {
        await api("/api/sync/folder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clear: true }) });
        toast(t("Folder sync disabled."));
      } catch (e) { toast(t("Failed to save folder: ") + e.message, "err"); }
      clearBtn.disabled = false;
      loadSyncStatus();
    });
  }
  if (refBtn && !refBtn.dataset.wired) {
    refBtn.dataset.wired = "1";
    refBtn.addEventListener("click", () => { loadSyncStatus(); loadSyncConflicts(); });
  }
}

function wireSettingsTabs() {
  const nav = document.querySelector("#settingsTabs");
  if (!nav) return;
  nav.querySelectorAll("[data-stab-btn]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.stabBtn;
      localStorage.setItem("memoria_settab", tab);
      nav.querySelectorAll(".stab").forEach((x) => x.classList.toggle("active", x === btn));
      document.querySelectorAll(".settings-group").forEach((g) => g.classList.toggle("active", g.dataset.stab === tab));
      if (tab === "sync") { wireSyncSettings(); loadSyncStatus(); loadSyncConflicts(); loadSyncDevices(); }
    });
  });
  const saved = localStorage.getItem("memoria_settab") || "sources";
  const target = nav.querySelector(`[data-stab-btn="${saved}"]`) || nav.querySelector('[data-stab-btn="sources"]');
  if (target) target.click();
}
wireSettingsTabs();

const promoBtn = document.getElementById("promoHandoff");
if (promoBtn) promoBtn.addEventListener("click", () => setView("handoff"));

$("#btnTheme")?.addEventListener("click", () => {
  const next = (document.documentElement.dataset.theme || "dark") === "light" ? "dark" : "light";
  localStorage.setItem("memoria_theme", next);
  applyTheme();
});
const themeSel = document.querySelector("#setTheme");
if (themeSel) {
  themeSel.value = localStorage.getItem("memoria_theme") || "auto";
  themeSel.addEventListener("change", () => {
    localStorage.setItem("memoria_theme", themeSel.value);
    applyTheme();
  });
}
const langSel = document.querySelector("#setLang");
if (langSel) {
  langSel.value = I18N.lang;
  langSel.addEventListener("change", () => {
    I18N.setLang(langSel.value);
    toast(langSel.value === "id" ? "Bahasa diganti ke Indonesia" : "Language switched to English");
  });
}

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
$("#filterAge").addEventListener("change", (e) => { state.filterAge = e.target.value; renderMemories(); });

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

// Tema: setting uiTheme (auto/dark/light) -> attribute data-theme di <html>
function applyTheme() {
  let pref = localStorage.getItem("memoria_theme") || "auto";
  if (pref === "auto") pref = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  document.documentElement.dataset.theme = pref;
  const tb = document.getElementById("btnTheme");
  if (tb) {
    const sun = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="3"/><path d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1"/></svg>';
    const moon = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 9.5A6 6 0 0 1 6.5 2.5a6 6 0 1 0 7 7z"/></svg>';
    tb.innerHTML = pref === "light" ? moon : sun;
    tb.title = pref === "light" ? "Switch to dark" : "Switch to light";
  }
}
applyTheme();
window.addEventListener("memoria:theme", () => {
  if (window.__g3d) __g3d.linkColor(() => (isLightTheme() ? "rgba(90,100,125,0.35)" : "rgba(148,163,196,0.3)"));
  if (state.view === "overview") drawActivityChart();
});
window.matchMedia("(prefers-color-scheme: light)")?.addEventListener?.("change", () => { if ((localStorage.getItem("memoria_theme") || "auto") === "auto") applyTheme(); });
I18N.apply();
let rzT;
window.addEventListener("resize", () => { clearTimeout(rzT); rzT = setTimeout(() => { if (state.view === "overview") drawActivityChart(); }, 150); });
document.addEventListener("memoria:lang", () => {
  I18N.apply();
  setView(state.view);
  if (state.view === "memories") renderMemories();
  if (state.view === "projects") renderProjects();
  if (state.view === "timeline") renderTimeline();
  if (state.view === "graph") renderGraph();
  if (state.view === "integrations") renderIntegrations();
  if (state.view === "settings") { renderSettings(); loadSettingsToggles(); loadBackups(); loadSyncStatus(); }
  loadStats();
});

if (location.protocol === "file:") {
  const warn = document.createElement("div");
  warn.style.cssText = "margin:0 0 14px;padding:11px 14px;border-radius:12px;background:rgba(217,160,91,.1);border:1px solid rgba(217,160,91,.35);color:#eec08a;font-size:12.5px";
  warn.textContent = t("Preview mode — data loads only inside the Memoria app (npm run start) or via http://127.0.0.1:48210");
  const c = document.querySelector(".content");
  if (c) c.prepend(warn);
}

function isLightTheme() { return document.documentElement.dataset.theme === "light"; }

/* ---------- SSE: sinyal live dari engine ---------- */
let sseLastRefresh = 0;
function setupLiveEvents() {
  if (!window.EventSource) return;
  const es = new EventSource("/api/events");
  const throttled = (fn) => () => {
    const now = Date.now();
    if (now - sseLastRefresh < 2500) return;
    sseLastRefresh = now;
    fn();
  };
  const refreshCounts = throttled(() => {
    loadStats();
    if (state.view === "memories") {
      // PR-N: di tab draft (review 4-5k item) SSE refresh tidak boleh rebuild
      // list — data "hilang-hilangan" & scroll loncat. Angka cukup via
      // loadStats; list di-render ulang saat user pindah tab/filter.
      if (state.memTab !== "draft") renderMemories();
    }
    if (state.view === "tasks") renderTasks();
    if (state.view === "overview") loadProjects();
  });
  es.addEventListener("memory", refreshCounts);
  es.addEventListener("tasks", refreshCounts);
  es.addEventListener("scan", refreshCounts);
  es.onerror = () => { /* engine restart — EventSource reconnect otomatis */ };
}
setupLiveEvents();

/* ---------- First-run onboarding ----------
 * detect tools → connect (capture + MCP registration) → import existing
 * sessions in the background → show what Memoria remembers. Shown once, on
 * installs without memories; "Run setup again" in Settings reopens it. */
const ONB_PHASES = {
  connecting: "Connecting your AI tools…",
  scanning: "Reading your existing sessions…",
  extracting: "Turning sessions into memories (no AI model needed)…",
  triaging: "Filtering noise…",
};

function onbShell() {
  let el = document.getElementById("onboarding");
  if (!el) {
    el = document.createElement("div");
    el.id = "onboarding";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.style.cssText = "position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);padding:24px";
    document.body.appendChild(el);
  }
  return el;
}

function onbCard(inner) {
  onbShell().innerHTML = `<div style="width:min(640px,100%);max-height:88vh;overflow:auto;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:14px;padding:24px;box-shadow:var(--shadow)">${inner}</div>`;
}

function closeOnboarding() {
  document.getElementById("onboarding")?.remove();
}

async function openOnboarding() {
  let data;
  try { data = await api("/api/onboarding"); } catch { return; }
  const phase = data.status.phase;
  if (phase && phase !== "idle" && phase !== "done" && phase !== "error") return onbProgress();
  const tools = data.tools;
  const found = tools.filter((x) => x.found);
  const rows = tools.map((x) => `
    <label style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--border-soft, var(--border));border-radius:8px;${x.found ? "" : "opacity:.55"}">
      <input type="checkbox" class="onb-tool" value="${esc(x.tool)}" ${x.found ? "checked" : ""} ${x.found ? "" : "disabled"} />
      <span style="flex:1">${esc(x.label)}</span>
      <span class="muted" style="font-size:12px">${x.found ? esc(t("sessions found")) : esc(t("not installed"))}${x.integrated ? " · " + esc(t("connected")) : ""}</span>
    </label>`).join("");
  onbCard(`
    <h3 style="margin:0 0 6px">${esc(t("Welcome to Memoria"))}</h3>
    <p class="muted" style="margin:0 0 16px">${esc(found.length
      ? t("Memoria found {0} AI tools on this machine. Pick the ones to connect: Memoria will read their past sessions and give every tool the same memory.", found.length)
      : t("No AI tool sessions were found yet. Use Claude Code, Codex, Cursor, Gemini or another supported tool, then run setup again."))}</p>
    <div style="display:grid;gap:6px;margin-bottom:16px">${rows}</div>
    <p class="muted" style="font-size:12px;margin:0 0 16px">${esc(t("Everything stays on this computer. Secrets are redacted before anything is stored."))}</p>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn" id="onbSkip">${esc(t("Skip"))}</button>
      <button class="btn primary" id="onbStart" ${found.length ? "" : "disabled"}>${esc(t("Connect and import"))}</button>
    </div>`);
  document.getElementById("onbSkip").onclick = async () => {
    try { await api("/api/onboarding/skip", { method: "POST" }); } catch {}
    closeOnboarding();
  };
  document.getElementById("onbStart").onclick = async () => {
    const picked = [...document.querySelectorAll(".onb-tool:checked")].map((c) => c.value);
    if (!picked.length) return;
    try {
      await api("/api/onboarding/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tools: picked }) });
      onbProgress();
    } catch (e) {
      toast(t("Failed: ") + e.message, "err");
    }
  };
}

async function onbProgress() {
  let s;
  try { s = (await api("/api/onboarding")).status; } catch { return; }
  if (!document.getElementById("onboarding") && s.phase !== "connecting") onbShell();
  if (s.phase === "done") return onbResult(s);
  if (s.phase === "error") {
    onbCard(`<h3 style="margin:0 0 8px">${esc(t("Setup stopped"))}</h3><p class="muted">${esc(s.error)}</p>
      <div style="display:flex;justify-content:flex-end"><button class="btn" id="onbClose">${esc(t("Close"))}</button></div>`);
    document.getElementById("onbClose").onclick = closeOnboarding;
    return;
  }
  const secs = Math.max(0, Math.round((Date.now() - s.startedAt) / 1000));
  onbCard(`
    <h3 style="margin:0 0 6px">${esc(t("Setting up Memoria"))}</h3>
    <p style="margin:0 0 14px">${esc(t(ONB_PHASES[s.phase] || "Working…"))}</p>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px">
      ${[[t("Messages read"), s.transcripts], [t("Memories"), s.memories], [t("Still to process"), s.pending]]
        .map(([k, v]) => `<div style="border:1px solid var(--border);border-radius:8px;padding:10px"><div class="muted" style="font-size:12px">${esc(k)}</div><b style="font-size:18px">${Number(v || 0).toLocaleString()}</b></div>`).join("")}
    </div>
    <p class="muted" style="font-size:12px;margin:0">${esc(t("{0}s elapsed. Large histories keep importing in the background after this.", secs))}</p>`);
  setTimeout(onbProgress, 1500);
}

async function onbResult(s) {
  let projects = [];
  try { projects = (await api("/api/onboarding/summary")).projects; } catch {}
  const secs = Math.round(((s.finishedAt || Date.now()) - s.startedAt) / 1000);
  const blocks = projects.map((p) => `
    <div style="border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(p.name)}</b><span class="muted" style="font-size:12px">${esc(t("{0} messages", p.transcripts.toLocaleString()))}</span></div>
      <ul style="margin:8px 0 0 18px;padding:0;font-size:13px">${p.memories.slice(0, 5).map((m) => `<li style="margin:3px 0"><span class="muted">[${esc(kindName(m.kind))}]</span> ${esc(m.content.replace(/\s+/g, " ").slice(0, 160))}</li>`).join("")}</ul>
    </div>`).join("");
  const connected = s.connected.length ? t("Connected: {0}.", s.connected.join(", ")) + " " : "";
  const failed = s.failed.length ? t("Could not connect: {0}.", s.failed.map((f) => f.tool).join(", ")) + " " : "";
  onbCard(`
    <h3 style="margin:0 0 6px">${esc(projects.length ? t("Here is what Memoria remembers") : t("Memoria is ready"))}</h3>
    <p class="muted" style="margin:0 0 14px">${esc(connected + failed + t("Done in {0}s. Your next session in any connected tool starts with this context.", secs))}</p>
    ${blocks || `<p class="muted">${esc(t("No memories yet — they appear as you work. Imports continue in the background."))}</p>`}
    <div style="display:flex;justify-content:flex-end;margin-top:6px"><button class="btn primary" id="onbDone">${esc(t("Open dashboard"))}</button></div>`);
  document.getElementById("onbDone").onclick = () => {
    closeOnboarding();
    loadStats();
    loadProjects();
  };
}

document.getElementById("btnRunSetup")?.addEventListener("click", openOnboarding);

/* Inbox keyboard review: j/k move, a approve, x archive, space toggles the
 * checkbox. Only on the Pending approval tab, never while typing. */
let draftFocus = -1;
document.addEventListener("keydown", async (e) => {
  if (state.view !== "memories" || state.memTab !== "draft") return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = (e.target && e.target.tagName) || "";
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (e.target && e.target.isContentEditable)) return;
  if (document.getElementById("onboarding") || document.querySelector("#overlay.show")) return;
  const rows = [...document.querySelectorAll("#memoriesList .mem")];
  if (!rows.length) return;
  const focusRow = (i) => {
    draftFocus = Math.max(0, Math.min(rows.length - 1, i));
    rows.forEach((r, j) => (r.style.outline = j === draftFocus ? "2px solid var(--accent)" : ""));
    rows[draftFocus].scrollIntoView({ block: "nearest" });
  };
  const key = e.key.toLowerCase();
  if (key === "j" || key === "arrowdown") { e.preventDefault(); focusRow(draftFocus + 1); return; }
  if (key === "k" || key === "arrowup") { e.preventDefault(); focusRow(draftFocus - 1); return; }
  if (draftFocus < 0 || !rows[draftFocus]) return;
  const id = Number(rows[draftFocus].dataset.id);
  if (key === " ") {
    e.preventDefault();
    const cb = rows[draftFocus].querySelector(".mem-select");
    if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event("change", { bubbles: true })); }
    return;
  }
  if (key !== "a" && key !== "x") return;
  e.preventDefault();
  try {
    await api("/api/memories/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: key === "a" ? "approve" : "archive", ids: [id] }) });
    rows[draftFocus].remove();
    const left = [...document.querySelectorAll("#memoriesList .mem")];
    if (left.length) {
      draftFocus = Math.min(draftFocus, left.length - 1);
      left[draftFocus].style.outline = "2px solid var(--accent)";
    }
    loadStats();
  } catch (err) {
    toast(t("Failed: ") + err.message, "err");
  }
});

(async function init() {
  await loadProjects();
  await loadStats();
  setInterval(loadStats, 12000);
  try {
    const o = await api("/api/onboarding");
    if (!o.status.done) openOnboarding();
  } catch {
    /* not signed in yet, or an older engine */
  }
})();