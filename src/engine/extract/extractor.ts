import { getDb, getPendingExtraction, markExtracted, projectSlugById, getBoolSetting } from "../store/db";
import { getExtractProvider, getEmbedProvider, embedManyVia } from "./provider";
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
  // PR-N2: noise tool & markdown — biang 4.8k draft (status tool, badge
  // shields.io, debris formatting) yang dulu lolos jadi "fakta".
  /has been updated successfully/i,
  /modified \d+ files? (you|you've|you have) previously read/i,
  /\[!\[[^\]]*\]\(https?:\/\/img\.shields\.io/i,
  /\]\(https?:\/\/img\.shields\.io/i,
  /img\.shields\.io\/badge\//i,
  /^\[!\w+\]\(/,
  /^\s*(--|\*)\s*\*\*[^*]+\*\*/,
  /^\s*```/,
];

export function isGenericMemory(content: string): boolean {
  const c = content.toLowerCase();
  if (c.length < 15) return true;
  // Per-baris + keseluruhan: noise badge/status biasanya SATU BARIS di tengah
  // konten multi-baris, bukan seluruh string.
  const lines = c.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of [c, ...lines]) {
    for (const p of GENERIC_PATTERNS) {
      if (p.test(line)) return true;
    }
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
    // Tiered intelligence: pilihan mesin dibaca tiap siklus (ubah di Pengaturan
    // langsung aktif). Tanpa model apapun pun, heuristik tetap menghasilkan memori.
    const extractProv = await getExtractProvider();
    const embedProv = await getEmbedProvider();
    // order "desc" = sesi TERBARU diproses duluan — dipakai hot-path resume agar
    // konteks untuk pindah tool tersedia secepatnya, sisanya menyusul di background.
    const pending = getPendingExtraction(160, opts.order ?? "asc");
    if (!pending.length) return 0;
    // Hasil heuristik kualitasnya lebih rendah → SELALU lewat antrian tinjau (draft),
    // terlepas dari mode tinjau global.
    const heuristic = extractProv.id === "heuristic";
    const status = heuristic ? "draft" : getBoolSetting("reviewMode", false) ? "draft" : "active";
    const origin = heuristic ? "heuristic" : "llm";

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
        const memories = await extractProv.extract(projectSlugById(projectId) || "unknown", conversation);
        const ids = winRows.map((r) => r.id as number).filter((x) => x != null);
        if (!memories) break; // provider bermasalah → coba siklus berikutnya
        const kept = memories.filter((mem) => !isGenericMemory(mem.content) && mem.importance >= 0.3);
        // Batch embedding: satu panggilan untuk seluruh window (F1C).
        const embs = await embedManyVia(embedProv, kept.map((m) => m.content));
        kept.forEach((mem, i) => {
          addMemoryWithDedupe({
            projectId: projectId || null,
            kind: mem.kind,
            content: mem.content,
            importance: mem.importance,
            createdAt: winRows[0]?.ts || Date.now(),
            lastAccessed: 0,
            accessCount: 0,
            sourceTool: tool,
            embedding: embs[i],
            status,
            origin,
            embedModel: embs[i] ? embedProv.embedModel : "",
            // Provenance: sesi sumber → tiap memori bisa ditelusuri ke
            // percakapan asalnya (A2/Hindsight-style traceability).
            sourceSession: rows[0].sessionId || "",
          });
          extracted++;
        });
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