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

function memoRowRenderer(renderId) {
  const isDraft = state.memTab === "draft";
  const isArchived = state.memTab === "archived";
  return (h, i) => `
    <div class="mem" data-id="${h.id}">
      <div class="mem-rail"><span class="kind-dot kind-${h.kind}"></span></div>
      <div class="mem-body">
        <div class="mem-meta">
          <span class="mem-kind kind-${h.kind}">${t(KIND_LABEL[h.kind] || h.kind)}</span>
          ${h.status === "draft" ? '<span class="mem-kind" style="opacity:.7">Draft</span>' : ""}
          <span class="sep">·</span>
          <span>${esc(prettySlug(h.projectSlug))}</span>
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
        ${isDraft ? `<button class="mem-approve" title="${t("Approve memory")}" data-appr="${h.id}">Approve ✓</button>` : ""}
        ${isArchived ? `<button class="mem-approve" title=t("Restore memory") data-rs="${h.id}">Restore</button>` : ""}
        <button class="icon-btn" title=t("View connections") data-rel="${h.id}">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="3.5" cy="4" r="1.6"/><circle cx="12.5" cy="3" r="1.6"/><circle cx="10" cy="11" r="1.6"/><path d="M5 4.8l5.8-1.2M3.7 5.6l1 4.3M9.2 10l1-7.4"/></svg>
        </button>
        ${isArchived ? "" : `<button class="icon-btn" title=t("Archive") data-arch="${h.id}">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5h12M4 4.5V14h8V4.5M5.5 8h5"/><path d="M2 2.5h12"/></svg>
        </button>`}
        <button class="icon-btn" title=t("Edit")) data-edit="${h.id}">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2.5l2.5 2.5L6 12.5l-3 .5.5-3L11 2.5z"/></svg>
        </button>
        <button class="icon-btn danger" title=t("Delete") data-del="${h.id}">
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
    overview: ["Overview", t("Memory summary across all AI tools")],
    memories: [t("Memories"), t("Search and manage stored memories")],
    projects: [t("Projects"), t("Activity by project")],
    timeline: ["Timeline", t("Per-project activity trail")],
    handoff: ["Handoff", t("Context summary for the next AI session")],
    tasks: ["Tasks", t("Everything your AI sessions promised - in one checklist")],
    graph: ["Graph", t("Map of connections between memories")],
    integrations: [t("Integrations"), t("Register Memoria with your AI tools")],
    settings: [t("Settings"), t("Data sources and integrations")],
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
    const engine = state.stats.engine;
    $("#ollamaDot").className = "dot " + (ollama || engine ? "on" : "off");
    // Chip topbar kini menampilkan mesin aktif (bukan cuma status Ollama) —
    // user tanpa Ollama tetap melihat bahwa heuristik yang bekerja.
    $("#ollamaText").textContent = engine ? engine.extract : (ollama ? t("Ollama: online") : t("Ollama: offline"));
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
    sel.innerHTML = '<option value="">All projects</option>';
    const hf = $("#hfProject");
    hf.innerHTML = '<option value="">Pick a project…</option>';
    const tl = $("#tlProject");
    tl.innerHTML = '<option value="">Pick a project…</option>';
    const gr = $("#grProject");
    gr.innerHTML = '<option value="">All projects</option>';
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
      { ok: true, label: t("Engine") + ": " + st.setup.engineLabel, hint: "" },
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
        el.addEventListener("click", () => {
          setView("timeline");
          const sel = $("#tlProject");
          if (sel) sel.value = el.dataset.openProject;
          tlMode = "text";
          renderTimeline();
        });
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

  const max = Math.max(4, ...week.map((w) => w.count));
  const padL = 8, padR = 8, padT = 18, padB = 26;
  const iw = W - padL - padR, ih = H - padT - padB;
  const pts = week.map((w, i) => ({
    x: padL + (week.length === 1 ? iw / 2 : (i / (week.length - 1)) * iw),
    y: padT + ih - (w.count / max) * ih * 0.9,
    ...w,
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
  grad.addColorStop(0, "rgba(139,110,255,.34)");
  grad.addColorStop(1, "rgba(139,110,255,0)");
  line(pts);
  ctx.lineTo(pts[pts.length - 1].x, H - padB);
  ctx.lineTo(pts[0].x, H - padB);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // garis utama
  line(pts);
  ctx.strokeStyle = "#a684ff";
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.stroke();

  // titik + label hari
  ctx.font = "10.5px Inter, sans-serif";
  pts.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p === pts[pts.length - 1] || p.count > 0 ? 4 : 3, 0, Math.PI * 2);
    ctx.fillStyle = p.count > 0 ? "#c3a4ff" : "#3a4152";
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
    tip.textContent = `${best.day}: ${best.count} ${t("messages")}`;
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
  if (!items || !items.length) {
    box.innerHTML = emptyState(t("No matching memories"), t("Try different keywords, or add a memory manually."));
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
      if (!confirm(t("Delete this memory? This cannot be undone."))) return;
      try {
        await api("/api/memories?id=" + id, { method: "DELETE" });
        toast(t("Memory deleted"));
        const row = btn.closest(".mem");
        if (row) row.remove();
        loadStats();
      } catch (err) {
        toast(t("Failed to delete: ") + err.message, "err");
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
        panel.querySelectorAll("[data-goto]").forEach((it) => {
          it.addEventListener("click", (ev) => {
            ev.stopPropagation();
            openEditModal(Number(it.dataset.goto));
          });
        });
      } catch (err) {
        panel.innerHTML = '<div class="rel-title">Failed: ' + esc(err.message) + '</div>';
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
        toast(t("Memory approved"));
        const row = btn.closest(".mem");
        if (row) row.remove();
        loadStats();
      } catch (err) {
        toast(t("Failed to approve: ") + err.message, "err");
      }
    });
  });
  root.querySelectorAll("[data-rs]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.rs);
      try {
        await api("/api/memories/archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, archived: false }) });
        toast(t("Memory restored"));
        const row = btn.closest(".mem");
        if (row) row.remove();
        loadStats();
      } catch (err) {
        toast(t("Failed to restore: ") + err.message, "err");
      }
    });
  });
  root.querySelectorAll("[data-arch]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.arch;
      try {
        await api("/api/memories/archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: Number(id), archived: true }) });
        toast(t("Memory archived"));
        const row = btn.closest(".mem");
        if (row) row.remove();
        loadStats();
      } catch (err) {
        toast(t("Failed to archive: ") + err.message, "err");
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
    el.addEventListener("click", () => {
      setView("timeline");
      const sel = $("#tlProject");
      if (sel) sel.value = el.dataset.openProject;
      tlMode = "text";
      renderTimeline();
    });
  });
}

async function loadTags() {
  try {
    const d = await api("/api/tags");
    const sel = $("#filterTag");
    const cur = state.filterTag;
    sel.innerHTML = '<option value="">All topics</option>';
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
        return `<div class="src-toggle">
          <span class="dot ${on ? "on" : "off"}"></span>
          <span class="st-name">${esc(label)}</span>
          <span class="st-count">${count != null ? count.toLocaleString("id-ID") + " transcripts" : ""}</span>
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
          .catch((err) => toast(t("Failed: ") + err.message, "err"));
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

async function renderTimeline() {
  const slug = $("#tlProject").value;
  const box = $("#timelineBox");
  if (!slug) { box.innerHTML = emptyState(t("Pick a project"), t("Pick a project above to see its activity trail.")); return; }
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

/* ---------- Handoff ---------- */

let handoffText = "";

async function renderHandoff() {
  const slug = $("#hfProject").value;
  const box = $("#handoffBox");
  if (!slug) { box.textContent = "Pick a project lalu klik \"Generate handoff\"."; return; }
  box.textContent = t("Generating handoff…");
  try {
    const d = await api("/api/handoff?slug=" + encodeURIComponent(slug));
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
  nodes: [], edges: [], pos: [], vel: [], idx: new Map(),
  zoom: 1, offX: 0, offY: 0, selected: null,
  drag: null, lastX: 0, lastY: 0, running: false, alpha: 0,
  hover: null, degree: new Map(), dirty: true, labeled: new Set(),
};

async function renderGraph() {
  const project = $("#grProject").value || undefined;
  const params = new URLSearchParams({ limit: "250" });
  if (project) params.set("project", project);
  $("#graphSide").innerHTML = '<div class="gs-empty">Loading graph…</div>';
  try {
    const d = await api("/api/graph?" + params.toString());
    graph.nodes = d.nodes || [];
    graph.edges = (d.edges || []).filter((e) => graph.nodes.some((n) => n.id === e.fromId) && graph.nodes.some((n) => n.id === e.toId));
    graph.idx = new Map(graph.nodes.map((n, i) => [n.id, i]));
    graph.pos = graph.nodes.map(() => ({ x: (Math.random() - 0.5) * 400, y: (Math.random() - 0.5) * 300 }));
    graph.vel = graph.nodes.map(() => ({ x: 0, y: 0 }));
    graph.selected = null;
    graph.hover = null;
    graph.alpha = 1;
    graph.dirty = true;
    // degree (jumlah koneksi) -> ukuran node & prioritas label
    graph.degree = new Map();
    for (const e of graph.edges) {
      graph.degree.set(e.fromId, (graph.degree.get(e.fromId) || 0) + 1);
      graph.degree.set(e.toId, (graph.degree.get(e.toId) || 0) + 1);
    }
    const labeled = [...graph.nodes]
      .sort((a, b) => (graph.degree.get(b.id) || 0) - (graph.degree.get(a.id) || 0))
      .slice(0, Math.max(20, Math.min(30, Math.ceil(graph.nodes.length * 0.25))))
      .map((n) => n.id);
    graph.labeled = new Set(labeled);
    $("#grCount").textContent = graph.nodes.length + t(" nodes · ") + graph.edges.length + t(" connections");
    if (!graph.nodes.length) {
      $("#graphSide").innerHTML = '<div class="gs-empty">No memories to show yet. Run a scan + extraction first, or add memories manually.</div>';
    } else {
      $("#graphSide").innerHTML = '<div class="gs-title">Details</div><div class="gs-empty">Click a node on the canvas to see its details and connections.</div>';
    }
    renderGraphLegend();
    startGraphLoop();
  } catch (e) {
    $("#graphSide").innerHTML = '<div class="gs-empty">Failed to load graph: ' + esc(e.message) + "</div>";
  }
}

function renderGraphLegend() {
  const legend = $("#grLegend");
  legend.innerHTML = Object.entries(KIND_LABEL).map(([k, label]) =>
    `<span class="lg"><span class="sw" style="background:${KIND_COLOR[k]}"></span>${t(label)}</span>`
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
    if (canvas.width !== Math.floor(w * dpr)) { canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr); graph.dirty = true; }

    if (graph.alpha > 0.01) {
      simulate(w, h);
      graph.alpha *= 0.985;
      graph.dirty = true;
    }
    // Dirty-flag: simulasi stabil + tanpa interaksi = tidak menggambar apa-apa (hemat CPU/baterai).
    if (!graph.dirty) { requestAnimationFrame(frame); return; }
    graph.dirty = false;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ctx.save();
    ctx.translate(w / 2 + graph.offX, h / 2 + graph.offY);
    ctx.scale(graph.zoom, graph.zoom);

    const focus = graph.hover != null ? graph.hover : graph.selected;
    const neighbors = new Set();
    if (focus != null) {
      for (const e of graph.edges) {
        if (e.fromId === focus) neighbors.add(e.toId);
        if (e.toId === focus) neighbors.add(e.fromId);
      }
    }

    for (const e of graph.edges) {
      const a = graph.pos[graph.idx.get(e.fromId)];
      const b = graph.pos[graph.idx.get(e.toId)];
      if (!a || !b) continue;
      let alpha = e.kind === "cohort" ? 0.06 : 0.08 + e.weight * 0.28;
      if (focus != null && e.fromId !== focus && e.toId !== focus) alpha *= 0.25;
      ctx.strokeStyle = `rgba(148, 163, 196, ${Math.min(0.4, alpha)})`;
      ctx.lineWidth = 0.7 + e.weight * 1.1;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // label tampil bila node sedikit, zoom besar, atau node terpilih/hover/penting
    const showAllLabels = graph.nodes.length <= 40 || graph.zoom > 1.6;

    for (let i = 0; i < graph.nodes.length; i++) {
      const n = graph.nodes[i];
      const p = graph.pos[i];
      const deg = graph.degree.get(n.id) || 0;
      const r = 5 + n.importance * 4 + Math.min(6, deg * 0.8);
      const isFocus = focus != null && (n.id === focus || neighbors.has(n.id));
      const dimmed = focus != null && !isFocus;
      ctx.globalAlpha = dimmed ? 0.15 : 0.9;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = KIND_COLOR[n.kind] || "#8b93a2";
      ctx.fill();
      ctx.globalAlpha = 1;
      if (graph.selected === n.id) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.8;
        ctx.stroke();
      } else if (graph.hover === n.id) {
        ctx.strokeStyle = "rgba(255,255,255,.55)";
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
      // Label ala Obsidian
      if (showAllLabels || graph.labeled.has(n.id) || n.id === focus) {
        ctx.globalAlpha = dimmed ? 0.12 : n.id === focus ? 0.95 : 0.7;
        ctx.fillStyle = "#dfe3ec";
        ctx.font = "10px Inter, sans-serif";
        ctx.textAlign = "center";
        const label = n.content.replace(/\s+/g, " ").slice(0, 26) + (n.content.length > 26 ? "…" : "");
        ctx.fillText(label, p.x, p.y + r + 12);
        ctx.globalAlpha = 1;
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
    if (!graph.drag) {
      // Hover ala Obsidian: sorot node + tetangga, redupkan sisanya
      const p = graphPointer(e);
      const hit = graphHit(p);
      const hv = hit >= 0 ? graph.nodes[hit].id : null;
      if (graph.hover !== hv) {
        graph.hover = hv;
        graph.dirty = true;
        canvas.style.cursor = hv != null ? "pointer" : "grab";
      }
      return;
    }
    const dx = e.clientX - graph.drag.x;
    const dy = e.clientY - graph.drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    graph.offX = graph.drag.startOffX + dx;
    graph.offY = graph.drag.startOffY + dy;
    graph.alpha = Math.max(graph.alpha, 0.15);
    graph.dirty = true;
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!graph.drag) return;
    graph.drag = null;
    if (!moved) {
      const p = graphPointer(e);
      const hit = graphHit(p);
      graph.selected = hit >= 0 ? graph.nodes[hit].id : null;
      graph.dirty = true;
      renderGraphSide();
    }
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    graph.zoom = Math.min(3, Math.max(0.25, graph.zoom * factor));
    graph.dirty = true;
  }, { passive: false });
}

/* ---------- Integrations ---------- */

const INTEGRATION_LOGOS = {
  claude: "logos/claude.png", codex: "logos/codex.png", opencode: "logos/opencode.ico",
  gemini: "logos/gemini.png", copilot: "logos/copilot.svg", antigravity: "logos/antigravity.png",
};
const INTEGRATIONS = [
  ["claude", "Claude Code", t("MCP stdio — mirrors context into every `/memory` session")],
  ["codex", "Codex CLI", t("Registered in ~/.codex/config.toml")],
  ["opencode", "opencode", t("Registered in ~/.config/opencode/opencode.json")],
  ["gemini", "Gemini CLI", t("Registered in ~/.gemini/settings.json")],
  ["copilot", "Copilot", t("Registered in ~/.copilot/mcp-config.json")],
  ["antigravity", "Antigravity", t("Registered in ~/.gemini/config/mcp_config.json")],
];

async function renderIntegrations() {
  const box = $("#integrationsBox");
  try {
    const d = await api("/api/integrations");
    const map = Object.fromEntries((d.integrations || []).map((x) => [x.key, x]));
    box.innerHTML = INTEGRATIONS.map(([key, name, desc]) => {
      const st = map[key];
      const configured = st && st.configured;
      const logo = INTEGRATION_LOGOS[key];
      const initials = esc(name.slice(0, 2).toUpperCase());
      return `<div class="intg-row">
        <div class="intg-icon">${logo ? `<img src="${logo}" alt="${initials}" onerror="this.replaceWith(document.createTextNode('${initials}'))">` : initials}</div>
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
  } catch (e) {
    box.innerHTML = emptyState(t("Failed to load"), esc(e.message));
  }
}

/* ---------- Settings: toggles & transfer ---------- */

async function loadSettingsToggles() {
  try {
    const d = await api("/api/settings");
    const s = d.settings || {};
    const keys = ["autoStartOllama", "autoBackup", "autoArchive", "reviewMode", "autoInjectProjectFiles", "quickInbox", "globalPalette", "autoTopics", "weeklyDigest", "autoStartLogin", "injectFile:AGENTS.md", "injectFile:CLAUDE.md", "injectFile:GEMINI.md"];
    for (const k of keys) {
      const sw = document.querySelector(`[data-sw="${k}"]`);
      if (sw) sw.classList.toggle("on", String(s[k]) === "1" || s[k] === true);
    }
    const sq = $("#setShortcutQuick");
    const sp = $("#setShortcutPalette");
    if (sq) sq.value = s.shortcutQuick || "";
    if (sp) sp.value = s.shortcutPalette || "";
    // Intelligence engine
    const ee = $("#setExtractEngine"), de = $("#setEmbedEngine");
    if (ee) ee.value = s.extractEngine || "auto";
    if (de) de.value = s.embedEngine || "auto";
    const ob = $("#setOpenaiBaseUrl"), om1 = $("#setOpenaiExtractModel"), om2 = $("#setOpenaiEmbedModel"), ok = $("#setOpenaiApiKey");
    if (ob) ob.value = s.openaiBaseUrl || "";
    if (om1) om1.value = s.openaiExtractModel || "";
    if (om2) om2.value = s.openaiEmbedModel || "";
    if (ok) ok.value = ""; // key tidak dikirim balik ke UI — hanya indikator
    if (ok) ok.placeholder = s.openaiHasKey === "1" ? t("API key stored — refill to replace") : t("API key (optional for local LM Studio)");
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
    toast(key + (on ? " — " + t("enabled") : " — " + t("disabled")));
  } catch (e) {
    toast(t("Failed to save setting: ") + e.message, "err");
  }
}

async function loadBackups() {
  const box = $("#backupList");
  if (!box) return;
  try {
    const d = await api("/api/backups");
    const b = d.backups || [];
    if (!b.length) {
      box.innerHTML = '<div class="card-desc" style="margin-top:6px">Not yet ada cadangan. Klik t("Back up now") untuk membuat yang pertama.</div>';
      return;
    }
    box.innerHTML = '<div class="card-desc" style="margin-top:2px">Stored backups:</div>' +
      b.map((x) => `
        <div class="bup-row">
          <div>
            <div class="bup-name">${esc(x.name)}</div>
            <div class="bup-meta">${(x.size / 1024 / 1024).toFixed(1)} MB · ${fmtDate(x.createdAt)}</div>
          </div>
          <div class="spacer"></div>
          <button class="btn" data-restore="${esc(x.path)}">Restore</button>
        </div>`).join("");
    box.querySelectorAll("[data-restore]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm(t("Restore this backup? Current memories & settings will be replaced from the backup."))) return;
        btn.disabled = true;
        btn.textContent = t("Restoring…");
        try {
          const r = await api("/api/backup/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: btn.dataset.restore }) });
          toast(r.ok ? t("Backup restored") : t("Failed: ") + (r.error || ""), r.ok ? "ok" : "err");
          if (r.ok) { await Promise.all([loadStats(), loadProjects(), loadBackups()]); }
        } catch (e) {
          toast(t("Failed to restore: ") + e.message, "err");
        }
        btn.disabled = false;
        btn.textContent = t("Restore");
      });
    });
  } catch (e) {
    box.innerHTML = '<div class="card-desc" style="margin-top:6px">Failed to load backups: ' + esc(e.message) + "</div>";
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
    if (!m) { toast(t("Memory not found"), "err"); return; }
  }
  editingId = id;
  $("#overlay h3").textContent = t("Edit memory");
  $("#overlay .modal-desc").textContent = t("Update the content, kind, or importance.");
  $("#addKind").value = m.kind || "context";
  $("#addProject").value = m.projectSlug || "";
  $("#addContent").value = m.content || "";
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
      await api("/api/memories", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId, kind: $("#addKind").value, content }),
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
  $("#addContent").value = "";
  $("#addProject").value = "";
  $("#overlay h3").textContent = t("Add memory");
  $("#overlay .modal-desc").textContent = t("Save a fact, decision, or task so every AI tool remembers it.");
  $("#btnSave").textContent = t("Save memory");
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
    if (n.dataset.view === "tasks") renderTasks();
    if (n.dataset.view === "integrations") renderIntegrations();
    if (n.dataset.view === "settings") { renderSettings(); loadSettingsToggles(); loadBackups(); }
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
$("#grRebuild").addEventListener("click", async () => {
  try {
    const r = await api("/api/graph/rebuild", { method: "POST" });
    toast(t("Connections rebuilt: ") + r.links + " link");
    renderGraph();
  } catch (e) {
    toast(t("Failed: ") + e.message, "err");
  }
});
wireGraphCanvas();

/* ---------- Tasks ---------- */
async function renderTasks() {
  const slug = $("#tkProject") ? $("#tkProject").value : "";
  const openBox = $("#tasksOpen");
  const doneBox = $("#tasksDone");
  if (!openBox) return;
  try {
    const d = await api("/api/tasks" + (slug ? "?slug=" + encodeURIComponent(slug) : ""));
    const item = (task, done) => `
      <div class="task-item ${done ? "done-row" : ""}" data-id="${task.id}">
        <div class="task-check" data-toggle="${task.id}" title="${done ? t("Reopen") : t("Mark done")}">${done ? '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.5 3.5L13 5"/></svg>' : ""}</div>
        <div class="task-body">
          <div class="task-text">${esc(task.content)}</div>
          <div class="task-meta">${esc(prettySlug(task.projectSlug))} · ${esc(TOOL_LABEL[task.sourceTool] || task.sourceTool)} · ${done ? t("done") + " " + fmtRel(task.resolvedAt) : fmtRel(task.createdAt)}</div>
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
    openBox.innerHTML = `<div class="err-box"><h4>${t("Couldn't load tasks")}</h4><p>${esc(e.message)}</p><button class="btn" onclick="renderTasks()">${t("Retry")}</button></div>`;
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
        toast(t("Engine updated — applied instantly"));
        loadStats();
      } catch (e) {
        toast(t("Failed to save: ") + e.message, "err");
      }
    });
  }
}
wireEngineSettings();

function wireSettingsTabs() {
  const nav = document.querySelector("#settingsTabs");
  if (!nav) return;
  nav.querySelectorAll("[data-stab-btn]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.stabBtn;
      localStorage.setItem("memoria_settab", tab);
      nav.querySelectorAll(".stab").forEach((x) => x.classList.toggle("active", x === btn));
      document.querySelectorAll(".settings-group").forEach((g) => g.classList.toggle("active", g.dataset.stab === tab));
    });
  });
  const saved = localStorage.getItem("memoria_settab") || "sources";
  const target = nav.querySelector(`[data-stab-btn="${saved}"]`) || nav.querySelector('[data-stab-btn="sources"]');
  if (target) target.click();
}
wireSettingsTabs();

const promoBtn = document.getElementById("promoHandoff");
if (promoBtn) promoBtn.addEventListener("click", () => setView("handoff"));

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
}
applyTheme();
window.addEventListener("memoria:theme", () => { if (window.graph) graph.dirty = true; if (state.view === "overview") drawActivityChart(); });
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
  if (state.view === "settings") { renderSettings(); loadSettingsToggles(); loadBackups(); }
  loadStats();
});

if (location.protocol === "file:") {
  const warn = document.createElement("div");
  warn.style.cssText = "margin:0 0 14px;padding:11px 14px;border-radius:12px;background:rgba(217,160,91,.1);border:1px solid rgba(217,160,91,.35);color:#eec08a;font-size:12.5px";
  warn.textContent = t("Preview mode — data loads only inside the Memoria app (npm run start) or via http://127.0.0.1:48210");
  const c = document.querySelector(".content");
  if (c) c.prepend(warn);
}

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
    if (state.view === "memories") renderMemories();
    if (state.view === "tasks") renderTasks();
    if (state.view === "overview") loadProjects();
  });
  es.addEventListener("memory", refreshCounts);
  es.addEventListener("tasks", refreshCounts);
  es.addEventListener("scan", refreshCounts);
  es.onerror = () => { /* engine restart — EventSource reconnect otomatis */ };
}
setupLiveEvents();

(async function init() {
  await loadProjects();
  await loadStats();
  setInterval(loadStats, 12000);
})();