import { getDb, getPendingExtraction, markExtracted, projectSlugById, getBoolSetting } from "../store/db";
import { extractMemories, embed, ollamaAvailable } from "./ollama";
import { addMemoryWithDedupe } from "./dedupe";

let running = false;
let lastAttempt = 0;

const GENERIC_PATTERNS = [
  /identify the task/i,
  /identify the requirement/i,
  /understand the user/i,
  /understand what/i,
  /help the user/i,
  /assist the user/i,
  /user['’]s request/i,
  /user['’]s needs/i,
  /determine what to create/i,
  /determine what to fix/i,
  /what to build/i,
  /gather information about the project/i,
  /the next step is to/i,
  /proceed with the (task|request)/i,
];

export function isGenericMemory(content: string): boolean {
  const c = content.toLowerCase();
  if (c.length < 15) return true;
  for (const p of GENERIC_PATTERNS) {
    if (p.test(c)) return true;
  }
  return false;
}

export async function extractQueue(force = false, opts: { order?: "asc" | "desc" } = {}): Promise<number> {
  if (running) return 0;
  if (!force && Date.now() - lastAttempt < 30_000) return 0;
  lastAttempt = Date.now();
  running = true;
  let extracted = 0;
  try {
    if (!(await ollamaAvailable())) return 0;
    // order "desc" = sesi TERBARU diproses duluan — dipakai hot-path resume agar
    // konteks untuk pindah tool tersedia secepatnya, sisanya menyusul di background.
    const pending = getPendingExtraction(160, opts.order ?? "asc");
    if (!pending.length) return 0;
    const reviewMode = getBoolSetting("reviewMode", false);
    const status = reviewMode ? "draft" : "active";

    const bySession = new Map<string, typeof pending>();
    for (const t of pending) {
      const key = `${t.projectId}:${t.sessionId}`;
      if (!bySession.has(key)) bySession.set(key, []);
      bySession.get(key)!.push(t);
    }

    for (const rows of bySession.values()) {
      const sorter = rows.sort((a, b) => a.ts - b.ts || a.seq - b.seq);
      const projectId = rows[0].projectId;
      const tool = rows[0].tool;

      const windows: typeof pending[] = [];
      const CHUNK = 24;
      for (let i = 0; i < sorter.length; i += CHUNK) {
        windows.push(sorter.slice(i, i + CHUNK));
      }

      for (const winRows of windows) {
        const conversation = winRows.map((r) => ({
          role: r.role === "user" ? "user" : "assistant",
          content: r.content,
        }));
        const memories = await extractMemories({ projectName: projectSlugById(projectId) || "unknown", conversation });
        const ids = winRows.map((r) => r.id as number).filter((x) => x != null);
        if (!memories) break; // ollama hiccup → retry next cycle
        for (const mem of memories) {
          if (isGenericMemory(mem.content)) continue;
          if (mem.importance < 0.3) continue;
          const embedding = await embed(mem.content);
          addMemoryWithDedupe({
            projectId: projectId || null,
            kind: mem.kind,
            content: mem.content,
            importance: mem.importance,
            createdAt: winRows[0]?.ts || Date.now(),
            lastAccessed: 0,
            accessCount: 0,
            sourceTool: tool,
            embedding,
            status,
          });
          extracted++;
        }
        for (const id of ids) markExtracted(id);
      }
      if (projectId != null) {
        const { runTaskLifecycle } = await import("./tasklife");
        runTaskLifecycle(projectId);
      }
    }
  } catch {
    // retry next cycle
  } finally {
    running = false;
  }
  return extracted;
}

export function runHousekeeping(): void {
  const d = getDb();
  d.prepare(
    "UPDATE transcripts SET extracted = 1 WHERE content IS NULL OR TRIM(content) = ''"
  ).run();
}