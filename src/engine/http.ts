import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { getConfig } from "./config";
import { scanAll, stats, ensureDb } from "./ingest/manager";
import { searchMemories, projectContext, setQueryEmbedding } from "./retrieve/search";
import { allMemories, recentProjects, insertMemory, ensureProject, deleteMemory, projectSlugById, getSetting, setSetting, listArchived, archiveMemory, updateMemory, archiveStaleEligibles, listDraft, approveMemory, effectiveStatus, countMemories, countDraft, entitiesForMemory, tagsForMemory, allTags, memoriesByTag } from "./store/db";
import { embed, ollamaAvailable } from "./extract/ollama";
import { extractQueue } from "./extract/extractor";
import { addMemoryWithDedupe } from "./extract/dedupe";
import { generateHandoff, injectHandoff, removeInject } from "./handoff";
import { backupDb, pruneArchivedBackups, listBackups, restoreBackup } from "./store/backup";
import { registerIntegration, integrationStatus } from "./integrate";
import { runGitLog } from "./git";
import { graphSnapshot, relatedMemories, rebuildAllLinks } from "./graph";
import { countOpen } from "./extract/tasklife";

function sendJson(res: ServerResponse, code: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
  res.end(body);
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

export function startHttpServer(): void {
  ensureDb();
  const port = getConfig().httpPort;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${port}`);
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST", "Access-Control-Allow-Headers": "Content-Type" });
        res.end();
        return;
      }
      if (url.pathname === "/api/stats" && req.method === "GET") {
        const s = stats();
        const ollama = await ollamaAvailable();
        const cfg = getConfig();
        const recent = allMemories()
          .slice(0, 8)
          .map((m) => ({ id: m.id, kind: m.kind, content: m.content, importance: m.importance, createdAt: m.createdAt, sourceTool: m.sourceTool, projectSlug: projectSlugById(m.projectId) }))
          .map(enrichMemory);
        sendJson(res, 200, {
          ...s,
          ollamaOnline: ollama,
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
        const qEmb = await embed(q);
        if (qEmb) setQueryEmbedding(qEmb);
        const hits = searchMemories(q, { limit, projectSlug: project, kind }).map(enrichMemory);
        sendJson(res, 200, { hits });
      } else if (url.pathname === "/api/project" && req.method === "GET") {
        const project = url.searchParams.get("slug") || "";
        sendJson(res, 200, { hits: projectContext(project) });
      } else if (url.pathname === "/api/projects" && req.method === "GET") {
        sendJson(res, 200, { projects: recentProjects(20) });
      } else if (url.pathname === "/api/memories" && req.method === "GET") {
        const status = url.searchParams.get("status") || "active";
        const recent = allMemories()
          .slice(0, 8)
          .map((m) => ({ id: m.id, kind: m.kind, content: m.content, importance: m.importance, createdAt: m.createdAt, sourceTool: m.sourceTool, status: m.status, projectSlug: projectSlugById(m.projectId) }))
          .map(enrichMemory);
        sendJson(res, 200, {
          memories: recent,
          counts: {
            active: countMemories(),
            draft: countDraft(),
            archived: listArchived().length,
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
          invalidateVecIndex();
          invalidateCentrality();
        }
        sendJson(res, r.ok ? 200 : 400, r);
      } else if (url.pathname === "/api/tasks" && req.method === "GET") {
        const project = url.searchParams.get("slug") || undefined;
        const proj = project ? (await import("./store/db")).projectRecord(project) : null;
        const open = countOpen(proj ? proj.id : undefined);
        sendJson(res, 200, { open });
      } else if (url.pathname === "/api/remember" && req.method === "POST") {
        const body = await readBody(req);
        const kind = ["fact", "decision", "task_done", "task_pending", "error_fixed", "preference", "context"].includes(body.kind) ? body.kind : "context";
        const project = String(body.project || "").replace(/[\\/:]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
        const projectId = project && project !== "_unknown" ? ensureProject(project) : null;
        const embedding = await embed(String(body.content || ""));
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
          setSetting(String(body.key), String(body.value));
          sendJson(res, 200, { ok: true });
        } else {
          sendJson(res, 400, { error: "key & value wajib" });
        }
      } else if (url.pathname === "/api/handoff" && req.method === "GET") {
        const slug = url.searchParams.get("slug") || "";
        const md = await generateHandoff(slug);
        sendJson(res, 200, { text: md });
      } else if (url.pathname === "/api/handoff" && req.method === "POST") {
        const body = await readBody(req);
        const res2 = await injectHandoff(String(body.slug || ""), String(body.file || "AGENTS.md"));
        sendJson(res, res2.ok ? 200 : 400, res2);
      } else if (url.pathname === "/api/handoff/remove" && req.method === "POST") {
        const body = await readBody(req);
        const res2 = removeInject(String(body.slug || ""), String(body.file || "AGENTS.md"));
        sendJson(res, res2.ok ? 200 : 400, res2);
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
        const { insertTranscript, ensureProject: _e } = await import("./store/db");
        const text = String(body.text || "").trim();
        const slug = String(body.project || "_import").toLowerCase().replace(/[\\/:]+/g, "-").replace(/^-+|-+$/g, "");
        const projectId = ensureProject(slug);
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
      } else {
        sendJson(res, 404, { error: "not found" });
      }
    } catch (e) {
      sendJson(res, 500, { error: String(e) });
    }
  });
  server.listen(port, () => {
    console.log(`[memoria] HTTP API aktif di http://localhost:${port}`);
  });
}
