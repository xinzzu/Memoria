import { createServer, IncomingMessage, ServerResponse } from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { getConfig } from "./config";
import { scanAll, stats, ensureDb } from "./ingest/manager";
import { searchMemories, projectContext } from "./retrieve/search";
import { allMemories, recentProjects, insertMemory, ensureProject, deleteMemory, projectSlugById, projectRecord, getDb, getSetting, setSetting, listArchived, archiveMemory, updateMemory, archiveStaleEligibles, listDraft, approveMemory, effectiveStatus, countMemories, countDraft, countArchived, entitiesForMemory, tagsForMemory, allTags, memoriesByTag, resolveProject } from "./store/db";
import { looksLikePath, projectSlugFromCwd } from "./ingest/util";
import { ollamaAvailable } from "./extract/ollama";
import { getEmbedProvider, engineStatus } from "./extract/provider";
import { extractQueue } from "./extract/extractor";
import { addMemoryWithDedupe } from "./extract/dedupe";
import { generateHandoff, injectHandoff, injectHandoffAll, removeInjectAll } from "./handoff";
import { backupDb, pruneArchivedBackups, listBackups, restoreBackup } from "./store/backup";
import { registerIntegration, integrationStatus } from "./integrate";
import { runGitLog } from "./git";
import { graphSnapshot, relatedMemories, rebuildAllLinks } from "./graph";
import { countOpen } from "./extract/tasklife";
import { addListener, removeListener, emitEvent } from "./events";
import { runGitStatus } from "./git";

function sendJson(res: ServerResponse, code: number, data: unknown): void {
  const body = JSON.stringify(data);
  // CORS hanya untuk origin lokal — situs eksternal tidak boleh membaca respons API.
  const origin = String(res.req?.headers?.origin || "");
  const allowOrigin = isLocalHost(origin) ? origin : "";
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    ...(allowOrigin ? { "Access-Control-Allow-Origin": allowOrigin, Vary: "Origin" } : {}),
  });
  res.end(body);
}

function isLocalHost(hostOrUrl: string): boolean {
  if (!hostOrUrl) return false;
  let hostname = hostOrUrl;
  if (hostOrUrl.includes("://")) {
    try {
      hostname = new URL(hostOrUrl).hostname;
    } catch {
      return false;
    }
  }
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
}

function enrichMemory(m: any): any {
  if (m.id == null) return m;
  try {
    return { ...m, entities: entitiesForMemory(Number(m.id)), tags: tagsForMemory(Number(m.id)) };
  } catch {
    return m;
  }
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

// Dashboard/palette/quick dilayani dari sini agar UI tidak perlu hardcode port:
// fetch("/api/...") same-origin bekerja di port berapa pun hasil config.
const WEB_DIR = path.resolve(__dirname, "..", "..", "web");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function serveStatic(url: URL, res: ServerResponse): boolean {
  if (url.pathname.startsWith("/api/")) return false;
  // Aset logo tinggal di root aplikasi (dipakai juga ikon tray/app) —
  // layankan path tetap ini tanpa membuka direktori lain.
  if (url.pathname === "/logo.png") {
    try {
      const logo = path.resolve(WEB_DIR, "..", "logo.png");
      const data = fs.readFileSync(logo);
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "max-age=3600" });
      res.end(data);
      return true;
    } catch {
      sendJson(res, 404, { error: "not found" });
      return true;
    }
  }
  const rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  const file = path.resolve(path.join(WEB_DIR, rel));
  if (!file.startsWith(WEB_DIR + path.sep)) {
    sendJson(res, 403, { error: "forbidden" });
    return true;
  }
  try {
    const data = fs.readFileSync(file);
    const mime = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    // HTML/JS/CSS tanpa cache agar update UI selalu terlihat; gambar boleh cache.
    const cache = mime.startsWith("image/") ? "max-age=3600" : "no-cache";
    res.writeHead(200, { "Content-Type": mime, "Cache-Control": cache });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: "not found" });
  }
  return true;
}

export function startHttpServer(): Promise<void> {
  ensureDb();
  const port = getConfig().httpPort;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${port}`);
    try {
      // --- Pemeriksaan keamanan (server hanya boleh diakses dari mesin ini) ---
      // 1) Host header: proteksi DNS-rebinding (host asing = tolak).
      const hostName = String(req.headers.host || "").replace(/:\d+$/, "").toLowerCase();
      if (hostName && !isLocalHost(hostName)) {
        sendJson(res, 403, { error: "forbidden host" });
        return;
      }
      // 2) Origin untuk request pengubah data: cegah drive-by dari situs eksternal.
      if (req.method !== "GET" && req.headers.origin && !isLocalHost(String(req.headers.origin))) {
        sendJson(res, 403, { error: "forbidden origin" });
        return;
      }
      // 3) Token opsional (setting "apiToken") untuk lapisan tambahan.
      const apiToken = getSetting("apiToken", "");
      if (apiToken && req.headers["x-memoria-token"] !== apiToken) {
        sendJson(res, 401, { error: "token tidak valid (header x-memoria-token)" });
        return;
      }
      if (req.method === "OPTIONS") {
        const origin = String(req.headers.origin || "");
        res.writeHead(204, {
          ...(isLocalHost(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
          "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE",
          "Access-Control-Allow-Headers": "Content-Type,x-memoria-token",
        });
        res.end();
        return;
      }
      if (req.method === "GET" && serveStatic(url, res)) return;
      if (url.pathname === "/api/stats" && req.method === "GET") {
        const s = stats();
        const ollama = await ollamaAvailable();
        const engine = await engineStatus();
        const cfg = getConfig();
        const recent = allMemories()
          .slice(0, 8)
          .map((m) => ({ id: m.id, kind: m.kind, content: m.content, importance: m.importance, createdAt: m.createdAt, sourceTool: m.sourceTool, projectSlug: projectSlugById(m.projectId) }))
          .map(enrichMemory);
        sendJson(res, 200, {
          ...s,
          ollamaOnline: ollama,
          engine,
          setup: {
            toolsDetected: s.perTool.length,
            engineLabel: engine.extract,
            llmReady: !engine.extract.startsWith("Heuristics"),
            memoriesCount: s.memories,
          },
          rssMB: Math.round(process.memoryUsage().rss / 1048576),
          recent,
          config: { dataDir: cfg.dataDir, ollamaExtractModel: cfg.ollamaExtractModel, ollamaEmbedModel: cfg.ollamaEmbedModel, httpPort: cfg.httpPort },
        });
      } else if (url.pathname === "/api/scan" && req.method === "POST") {
        const logLines: string[] = [];
        const results = await scanAll((m) => logLines.push(m));
        await extractQueue(true);
        sendJson(res, 200, { results, log: logLines });
      } else if (url.pathname === "/api/search" && req.method === "GET") {
        const q = url.searchParams.get("q") || "";
        const project = url.searchParams.get("project") || undefined;
        const kind = url.searchParams.get("kind") || undefined;
        const limit = Number(url.searchParams.get("limit") || 10);
        const eprov = await getEmbedProvider();
        const qEmb = await eprov.embed(q);
        const hits = searchMemories(q, { limit, projectSlug: project, kind, embedModel: eprov.embedModel }, qEmb).map(enrichMemory);
        sendJson(res, 200, { hits });
      } else if (url.pathname === "/api/project" && req.method === "GET") {
        const project = url.searchParams.get("slug") || "";
        sendJson(res, 200, { hits: projectContext(project) });
      } else if (url.pathname === "/api/projects" && req.method === "GET") {
        sendJson(res, 200, { projects: recentProjects(20) });
      } else if (url.pathname === "/api/memories" && req.method === "GET") {
        // Pustaka lengkap dengan pagination — param `status` kini benar-benar dihormati.
        const status = url.searchParams.get("status") || "active";
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 50)));
        const offset = Math.max(0, Number(url.searchParams.get("offset") || 0) || 0);
        let mems: import("./store/db").Memory[];
        let total: number;
        if (status === "draft") {
          mems = listDraft();
          total = countDraft();
        } else if (status === "archived") {
          mems = listArchived();
          total = countArchived();
        } else {
          mems = allMemories();
          total = countMemories();
        }
        const page = mems
          .slice(offset, offset + limit)
          .map((m) => ({ id: m.id, kind: m.kind, content: m.content, importance: m.importance, createdAt: m.createdAt, sourceTool: m.sourceTool, status: m.status, projectSlug: projectSlugById(m.projectId) }))
          .map(enrichMemory);
        sendJson(res, 200, {
          memories: page,
          total,
          offset,
          limit,
          hasMore: offset + page.length < total,
          counts: {
            active: countMemories(),
            draft: countDraft(),
            archived: countArchived(),
          },
        });
      } else if (url.pathname === "/api/memories/list" && req.method === "GET") {
        const status = url.searchParams.get("status") || "active";
        let mems: import("./store/db").Memory[];
        if (status === "draft") mems = listDraft();
        else if (status === "archived") mems = listArchived();
        else mems = allMemories();
        sendJson(res, 200, {
          memories: mems.map((m) => ({ ...m, embedding: undefined, projectSlug: projectSlugById(m.projectId) })).map(enrichMemory),
        });
      } else if (url.pathname === "/api/memories/approve" && req.method === "POST") {
        const body = await readBody(req);
        const ok = approveMemory(Number(body.id || 0));
        sendJson(res, ok ? 200 : 404, { ok });
      } else if (url.pathname === "/api/backups" && req.method === "GET") {
        sendJson(res, 200, { backups: listBackups() });
      } else if (url.pathname === "/api/backup/restore" && req.method === "POST") {
        const body = await readBody(req);
        const r = restoreBackup(String(body.path || ""));
        if (r.ok) {
          const { invalidateVecIndex } = await import("./vecfind");
          const { invalidateCentrality } = await import("./retrieve/search");
          const { resetProjectMemo } = await import("./store/db");
          invalidateVecIndex();
          invalidateCentrality();
          resetProjectMemo();
        }
        sendJson(res, r.ok ? 200 : 400, r);
      } else if (url.pathname === "/api/project-detail" && req.method === "GET") {
        // Agregat satu panggilan untuk halaman detail proyek.
        const slug = url.searchParams.get("slug") || "";
        const proj = resolveProject(slug);
        if (!proj) { sendJson(res, 404, { error: "project not found" }); return; }
        const rec = projectRecord(proj.slug);
        if (!rec) { sendJson(res, 404, { error: "project not found" }); return; }
        const db = getDb();
        const lastSeen = (db.prepare("SELECT MAX(last_seen) AS m FROM projects WHERE id = ?").get(rec.id) as { m: number | null }).m ?? 0;
        const DAY = 86400000;
        const today = Math.floor(Date.now() / DAY);
        const weekRows = db
          .prepare("SELECT CAST(ts / ? AS INTEGER) AS d, COUNT(*) AS c FROM transcripts WHERE project_id = ? AND ts >= ? GROUP BY d")
          .all(DAY, rec.id, Date.now() - 7 * DAY) as Array<{ d: number; c: number }>;
        const byDay = new Map(weekRows.map((r) => [Number(r.d), r.c]));
        const week: Array<{ day: string; count: number }> = [];
        for (let i = 6; i >= 0; i--) {
          const dd = today - i;
          week.push({ day: new Date(dd * DAY).toISOString().slice(5, 10), count: byDay.get(dd) || 0 });
        }
        const transcripts = (db.prepare("SELECT COUNT(*) AS c FROM transcripts WHERE project_id = ?").get(rec.id) as { c: number }).c;
        const memCount = (db.prepare("SELECT COUNT(*) AS c FROM memories WHERE project_id = ? AND archived = 0 AND status = 'active'").get(rec.id) as { c: number }).c;
        const tasksOpen = (db.prepare("SELECT COUNT(*) AS c FROM memories WHERE project_id = ? AND kind = 'task_pending' AND archived = 0 AND status = 'active' AND COALESCE(resolved_at, 0) = 0").get(rec.id) as { c: number }).c;
        const { listTasks } = await import("./store/db");
        const tasks = listTasks(rec.id, 60);
        const slim = (m: any) => ({ id: m.id, content: m.content, importance: m.importance, createdAt: m.createdAt, resolvedAt: m.resolvedAt, sourceTool: m.sourceTool });
        const git = rec.path && fs.existsSync(rec.path) ? await runGitStatus(rec.path) : null;
        const recentMemories = allMemories().filter((m) => m.projectId === rec.id).slice(0, 8)
          .map((m) => ({ id: m.id, kind: m.kind, content: m.content, importance: m.importance, createdAt: m.createdAt, sourceTool: m.sourceTool }));
        sendJson(res, 200, {
          project: { slug: rec.slug, name: rec.name, path: rec.path },
          stats: { transcripts, memories: memCount, tasksOpen, lastSeen },
          week, git, tasks: { open: tasks.open.map(slim), done: tasks.done.map(slim) },
          recentMemories,
        });
      } else if (url.pathname === "/api/tasks" && req.method === "GET") {
        const slug = url.searchParams.get("slug") || "";
        const proj = slug ? resolveProject(slug) : null;
        const { listTasks } = await import("./store/db");
        const { open, done } = listTasks(proj ? proj.id : null, 300);
        const slim = (m: any) => ({ id: m.id, content: m.content, importance: m.importance, createdAt: m.createdAt, resolvedAt: m.resolvedAt, sourceTool: m.sourceTool, projectSlug: projectSlugById(m.projectId) });
        sendJson(res, 200, { open: open.map(slim), done: done.map(slim), countOpen: open.length, project: proj?.slug ?? null });
      } else if (url.pathname === "/api/tasks/resolve" && req.method === "POST") {
        const body = await readBody(req);
        const { setTaskResolved } = await import("./store/db");
        const ok = setTaskResolved(Number(body.id || 0), body.resolved !== false);
        if (ok) emitEvent("tasks", { id: Number(body.id || 0), resolved: body.resolved !== false });
        sendJson(res, ok ? 200 : 404, { ok });
      } else if (url.pathname === "/api/remember" && req.method === "POST") {
        const body = await readBody(req);
        const kind = ["fact", "decision", "task_done", "task_pending", "error_fixed", "preference", "context"].includes(body.kind) ? body.kind : "context";
        // Jangan slugify sebelum ensureProject — path mentah dibutuhkan agar
        // proyek yang sama dari tool berbeda bisa di-merge (identitas kanonik).
        const rawProject = String(body.project || "").trim();
        const projectId = rawProject && rawProject !== "_unknown"
          ? ensureProject(projectSlugFromCwd(rawProject), looksLikePath(rawProject) ? rawProject : undefined)
          : null;
        const eprov = await getEmbedProvider();
        const embedding = await eprov.embed(String(body.content || ""));
        addMemoryWithDedupe({
          projectId,
          kind,
          content: String(body.content || ""),
          importance: Math.min(1, Math.max(0, Number(body.importance) || 0.5)),
          createdAt: Date.now(),
          lastAccessed: 0,
          accessCount: 0,
          sourceTool: "dashboard",
          embedding,
          status: effectiveStatus(),
          origin: "user",
          embedModel: eprov.embedModel,
        });
        sendJson(res, 200, { ok: true });
      } else if (url.pathname === "/api/memories" && req.method === "DELETE") {
        const id = Number(url.searchParams.get("id") || 0);
        const ok = deleteMemory(id);
        sendJson(res, ok ? 200 : 404, { ok });
      } else if (url.pathname === "/api/memories" && req.method === "PUT") {
        const body = await readBody(req);
        const id = Number(body.id || 0);
        const ok = updateMemory(id, {
          content: body.content !== undefined ? String(body.content) : undefined,
          kind: body.kind !== undefined ? String(body.kind) : undefined,
          importance: body.importance !== undefined ? Math.min(1, Math.max(0, Number(body.importance))) : undefined,
        });
        sendJson(res, ok ? 200 : 404, { ok });
      } else if (url.pathname === "/api/memories/archive" && req.method === "POST") {
        const body = await readBody(req);
        const id = Number(body.id || 0);
        const ok = archiveMemory(id, body.archived !== false);
        sendJson(res, ok ? 200 : 404, { ok });
      } else if (url.pathname === "/api/archived" && req.method === "GET") {
        sendJson(res, 200, {
          memories: listArchived().map((m) => ({ ...m, embedding: undefined, projectSlug: projectSlugById(m.projectId) })),
        });
      } else if (url.pathname === "/api/settings" && req.method === "GET") {
        const cfg = getConfig();
        sendJson(res, 200, {
          settings: {
            autoInjectProjectFiles: getSetting("autoInjectProjectFiles", cfg.autoInjectProjectFiles ? "1" : "0"),
            autoStartOllama: getSetting("autoStartOllama", "1"),
            autoBackup: getSetting("autoBackup", "1"),
            autoArchive: getSetting("autoArchive", "1"),
            autoTopics: getSetting("autoTopics", "1"),
            globalPalette: getSetting("globalPalette", "1"),
            reviewMode: getSetting("reviewMode", "0"),
            weeklyDigest: getSetting("weeklyDigest", "1"),
            autoStartLogin: getSetting("autoStartLogin", "1"),
            shortcutQuick: getSetting("shortcutQuick", "CommandOrControl+Shift+M"),
            shortcutPalette: getSetting("shortcutPalette", "CommandOrControl+Shift+Space"),
            "injectFile:AGENTS.md": getSetting("injectFile:AGENTS.md", "1"),
            "injectFile:CLAUDE.md": getSetting("injectFile:CLAUDE.md", "1"),
            "injectFile:GEMINI.md": getSetting("injectFile:GEMINI.md", "1"),
            extractEngine: getSetting("extractEngine", "auto"),
            embedEngine: getSetting("embedEngine", "auto"),
            openaiBaseUrl: getSetting("openaiBaseUrl", "http://localhost:1234/v1"),
            openaiExtractModel: getSetting("openaiExtractModel", "gpt-4o-mini"),
            openaiEmbedModel: getSetting("openaiEmbedModel", "text-embedding-3-small"),
            openaiHasKey: getSetting("openaiApiKey", "") ? "1" : "0",
            extractThreshold: getSetting("extractThreshold", "0.3"),
            sources: Object.fromEntries(
              cfg.sources.map((s) => [s.tool, getSetting(`source:${s.tool}:enabled`, s.enabled ? "1" : "0")])
            ),
            sourceLabels: Object.fromEntries(cfg.sources.map((s) => [s.tool, s.label])),
          },
        });
      } else if (url.pathname === "/api/settings" && req.method === "POST") {
        const body = await readBody(req);
        if (body.key && body.value !== undefined) {
          // API key disimpan terenkripsi bila safeStorage tersedia (Keychain/DPAPI).
          if (String(body.key) === "openaiApiKey") {
            const { encryptSecret } = await import("./store/secure");
            const enc = encryptSecret(String(body.value));
            setSetting("openaiApiKey", enc ?? String(body.value));
            sendJson(res, 200, { ok: true, encrypted: !!enc });
            return;
          }
          setSetting(String(body.key), String(body.value));
          sendJson(res, 200, { ok: true });
        } else {
          sendJson(res, 400, { error: "key & value wajib" });
        }
      } else if (url.pathname === "/api/handoff" && req.method === "GET") {
        const proj = resolveProject(url.searchParams.get("slug") || "");
        const md = await generateHandoff(proj ? proj.slug : "");
        sendJson(res, 200, { text: md });
      } else if (url.pathname === "/api/resume" && req.method === "GET") {
        // Prompt lanjutan ringkas siap-paste — plan B bila injeksi file tidak terbaca tool.
        const { generateResumePrompt } = await import("./handoff");
        const proj = resolveProject(url.searchParams.get("slug") || "");
        const text = await generateResumePrompt(proj ? proj.slug : "");
        sendJson(res, 200, { text });
      } else if (url.pathname === "/api/handoff" && req.method === "POST") {
        const body = await readBody(req);
        const proj = resolveProject(String(body.slug || ""));
        const slug = proj ? proj.slug : String(body.slug || "");
        if (body.file) {
          // Mode lama: satu file eksplisit (kompatibel dengan pemanggil lama).
          const res2 = await injectHandoff(slug, String(body.file));
          sendJson(res, res2.ok ? 200 : 400, res2);
        } else {
          // Default: suntik ke semua target konvensi tool (AGENTS/CLAUDE/GEMINI).
          const results = await injectHandoffAll(slug);
          sendJson(res, results.some((r) => r.ok) ? 200 : 400, { ok: results.some((r) => r.ok), results });
        }
      } else if (url.pathname === "/api/handoff/remove" && req.method === "POST") {
        const body = await readBody(req);
        const proj = resolveProject(String(body.slug || ""));
        const results = removeInjectAll(proj ? proj.slug : String(body.slug || ""));
        sendJson(res, results.some((r) => r.ok) ? 200 : 400, { ok: results.some((r) => r.ok), results });
      } else if (url.pathname === "/api/backup" && req.method === "POST") {
        pruneArchivedBackups();
        const p = backupDb();
        sendJson(res, p ? 200 : 500, { ok: !!p, path: p });
      } else if (url.pathname === "/api/integrations" && req.method === "GET") {
        sendJson(res, 200, { integrations: integrationStatus() });
      } else if (url.pathname === "/api/integrate" && req.method === "POST") {
        const body = await readBody(req);
        sendJson(res, 200, registerIntegration(String(body.tool || "")));
      } else if (url.pathname === "/api/git" && req.method === "GET") {
        const { projectRecord } = await import("./store/db");
        const proj = projectRecord(url.searchParams.get("slug") || "");
        const log = proj?.path ? await runGitLog(proj.path, 20) : [];
        sendJson(res, 200, { log });
      } else if (url.pathname === "/api/timeline" && req.method === "GET") {
        const db = (await import("./store/db")).getDb();
        const slug = url.searchParams.get("slug") || "";
        const limit = Number(url.searchParams.get("limit") || 40);
        const proj = (await import("./store/db")).projectRecord(slug);
        const rows = proj
          ? (db
              .prepare("SELECT role, content, ts, tool FROM transcripts WHERE project_id = ? ORDER BY ts DESC LIMIT ?")
              .all(proj.id, limit) as Array<{ role: string; content: string; ts: number; tool: string }>)
          : [];
        const mems = proj ? allMemories().filter((m) => m.projectId === proj.id).slice(0, 60) : [];
        sendJson(res, 200, {
          timeline: rows.map((r) => ({ ...r, text: r.content.slice(0, 500) })),
          memories: mems.map((m) => ({ id: m.id, kind: m.kind, content: m.content, importance: m.importance, createdAt: m.createdAt, sourceTool: m.sourceTool })),
        });
      } else if (url.pathname === "/api/tags" && req.method === "GET") {
        sendJson(res, 200, { tags: allTags(Number(url.searchParams.get("min") || 1)) });
      } else if (url.pathname === "/api/tags/rebuild" && req.method === "POST") {
        const { rebuildTopics } = await import("./extract/topics");
        const r = rebuildTopics();
        sendJson(res, 200, r);
      } else if (url.pathname === "/api/memories/tag" && req.method === "GET") {
        const tag = url.searchParams.get("tag") || "";
        const ids = memoriesByTag(tag);
        const byId = new Map(allMemories().map((m) => [m.id as number, m]));
        const mems = ids.map((id) => byId.get(id)).filter(Boolean).map((m) => enrichMemory({ ...m, type: undefined, projectSlug: projectSlugById(m!.projectId) }));
        sendJson(res, 200, { memories: mems.map((m: any) => ({ id: m.id, kind: m.kind, content: m.content, importance: m.importance, createdAt: m.createdAt, sourceTool: m.sourceTool, status: m.status, projectSlug: m.projectSlug, entities: m.entities, tags: m.tags })) });
      } else if (url.pathname === "/api/digest" && req.method === "GET") {
        const { latestDigestText } = await import("./summary/weekly");
        sendJson(res, 200, { text: latestDigestText() });
      } else if (url.pathname === "/api/digest/generate" && req.method === "POST") {
        const { generateWeeklyDigest } = await import("./summary/weekly");
        sendJson(res, 200, generateWeeklyDigest());
      } else if (url.pathname === "/api/export/obsidian" && req.method === "POST") {        const body = await readBody(req);
        const cfg = getConfig();
        const target = String(body.dir || "") || require("node:path").join(cfg.dataDir, "obsidian-export");
        const { exportObsidianVault } = await import("./export/obsidian");
        sendJson(res, 200, exportObsidianVault(target));
      } else if (url.pathname === "/api/export" && req.method === "GET") {
        const fmt = url.searchParams.get("format") || "md";
        const slug = url.searchParams.get("slug") || "";
        const proj = (await import("./store/db")).projectRecord(slug);
        const mems = proj ? allMemories().filter((m) => m.projectId === proj.id) : allMemories();
        if (fmt === "json") {
          sendJson(res, 200, { memories: mems.map((m) => ({ ...m, embedding: undefined, project: projectSlugById(m.projectId) })) });
        } else {
          const text = mems
            .map((m) => `[${m.kind}] (${projectSlugById(m.projectId) ?? "global"} · ${(m.importance * 100).toFixed(0)})\n${m.content}`)
            .join("\n\n");
          sendJson(res, 200, { text });
        }
      } else if (url.pathname === "/api/import" && req.method === "POST") {
        const body = await readBody(req);
        const { insertTranscript } = await import("./store/db");
        const text = String(body.text || "").trim();
        const rawProject = String(body.project || "_import").trim();
        const projectId = ensureProject(projectSlugFromCwd(rawProject), looksLikePath(rawProject) ? rawProject : undefined);
        const tool = String(body.tool || "import");
        let ok = false;
        if (text) {
          ok = insertTranscript({
            tool,
            sessionId: `import-${Date.now()}`,
            projectId,
            role: "user",
            content: text,
            ts: Date.now(),
            seq: 0,
          });
        }
        sendJson(res, ok ? 200 : 400, { ok });
      } else if (url.pathname === "/api/graph" && req.method === "GET") {
        const project = url.searchParams.get("project") || undefined;
        const limit = Number(url.searchParams.get("limit") || 250);
        sendJson(res, 200, graphSnapshot(project, limit));
      } else if (url.pathname === "/api/graph/rebuild" && req.method === "POST") {
        const n = rebuildAllLinks();
        sendJson(res, 200, { ok: true, links: n });
      } else if (url.pathname === "/api/related" && req.method === "GET") {
        const id = Number(url.searchParams.get("id") || 0);
        const rel = relatedMemories(id, 8);
        sendJson(res, 200, {
          related: rel.map((r) => ({
            ...r.memory,
            embedding: undefined,
            projectSlug: projectSlugById(r.memory.projectId),
            linkKind: r.linkKind,
            linkWeight: r.weight,
          })),
        });
      } else if (url.pathname === "/api/events" && req.method === "GET") {
        // SSE: sinyal live (memory/scan/tasks) — client yang memutuskan refresh-nya.
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write("event: hello\ndata: {}\n\n");
        const listener = (type: string, data?: unknown) => {
          res.write(`event: ${type}\ndata: ${JSON.stringify(data ?? {})}\n\n`);
        };
        addListener(listener);
        const hb = setInterval(() => res.write(": hb\n\n"), 25000);
        req.on("close", () => {
          clearInterval(hb);
          removeListener(listener);
        });
      } else {
        sendJson(res, 404, { error: "not found" });
      }
    } catch (e) {
      console.error("[memoria] API error:", url.pathname, e);
      sendJson(res, 500, { error: String(e) });
    }
  });
  // Bind eksplisit ke loopback — tanpa ini Node bind ke semua interface (LAN ikut kebuka).
  return new Promise<void>((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      console.log(`[memoria] HTTP API aktif di http://127.0.0.1:${port} (khusus mesin ini)`);
      resolve();
    });
  });
}
