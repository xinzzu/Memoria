/* F4 — Zero-AI Brain: snapshot sesi deterministik + deteksi pesan limit.
 * Dua mekanisme tanpa model apapun:
 *
 * 1. Snapshot sesi: transkrip terakhir sesi (file disentuh, command dijalankan,
 *    error, pesan user terakhir) + git status proyek → satu memori `context`
 *    ber-origin heuristic. Ini "bukti kerja" yang membuat recall/handoff di
 *    tool berikutnya terasa seperti orang yang menonton dari belakang bahu.
 *
 * 2. Deteksi pre-limit: pesan "limit/credit/quota habis" muncul DI transkrip
 *    saat penyedia AI menutup sesi. Terdeteksi → ekstraksi prioritas + inject
 *    SEKARANG — bukan menunggu trigger idle 4 menit (watcher.ts).
 */
import { getDb, getSetting, setSetting, effectiveStatus, Memory } from "../store/db";
import { addMemoryWithDedupe } from "./dedupe";
import { runGitStatus } from "../git";
import { emitEvent } from "../events";
import { getEmbedProvider } from "./provider";

/* ---------- 1. Deteksi pesan limit ----------
 * Pola sengaja menuntut konteks kematian sesi ("reached/hit/exceeded",
 * "out of", "too low", "upgrade to continue") agar percakapan dev TENTANG
 * limit (mis. "raise the rate limit to 100 requests") tidak dianggap sinyal. */
const LIMIT_PATTERNS: RegExp[] = [
  /usage limit (reached|exceeded)/i,
  /\b(hit|reached)\s+(your|the|a|our)\s+(usage |rate |weekly |daily |message |token |prompt )?limit/i,
  /you'?ve\s+(hit|reached|used)/i,
  /you (are|'re) out of/i,
  /out of (credits?|usage|free (usage|credits?))/i,
  /credit balance (is )?too low/i,
  /quota exceeded/i,
  /upgrade to (continue|keep (using|going|coding))/i,
];

export function looksLikeLimitMessage(content: string): boolean {
  return LIMIT_PATTERNS.some((re) => re.test(content));
}

/** Proyek yang transkrip barunya mengandung pesan limit, sejak cursor
 * terakhir (setting `limitScanLastId` — dipanggil tiap scanAll selesai). */
export function collectLimitProjects(): number[] {
  const d = getDb();
  const cursor = Number(getSetting("limitScanLastId", "0")) || 0;
  const rows = d
    .prepare("SELECT id, project_id, content FROM transcripts WHERE id > ? AND content != '' ORDER BY id LIMIT 5000")
    .all(cursor) as Array<{ id: number; project_id: number | null; content: string }>;
  if (rows.length) {
    setSetting("limitScanLastId", String(rows[rows.length - 1].id));
  }
  const hits = new Set<number>();
  for (const r of rows) {
    if (r.project_id != null && looksLikeLimitMessage(r.content)) hits.add(r.project_id);
  }
  return [...hits];
}

/* ---------- 2. Snapshot sesi deterministik ---------- */
const SNAPSHOT_COOLDOWN_MS = 15 * 60_000; // maks satu snapshot per proyek per 15 menit
const KNOWN_EXT_RE =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|md|json|ya?ml|toml|sql|sh|css|scss|html|vue|svelte|kt|swift|c|cpp|h|hpp|env|lock)$/i;
const FILE_RE = /[\w.@+-]+(?:\/[\w.@+-]+)*\/[\w.@+-]+\.[A-Za-z0-9]{1,6}|[\w@+-]+\.[A-Za-z0-9]{1,6}\b/g;
const CMD_RE = /^\s*(?:\$\s+)?((?:npm|pnpm|yarn|bun|node|npx|git|python3?|pip|cargo|go|make|docker|kubectl|curl)\s[^\n]{2,110})$/;

function uniqTop(values: string[], n: number): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))].slice(0, n);
}

function extractSignals(lines: Array<{ role: string; content: string }>): {
  files: string[];
  commands: string[];
  errors: string[];
  lastUser: string;
} {
  const files: string[] = [];
  const commands: string[] = [];
  const errors: string[] = [];
  let lastUser = "";
  for (const { role, content } of lines) {
    const text = content.replace(/\s+/g, " ");
    for (const m of text.matchAll(FILE_RE)) {
      const cand = m[0];
      if (cand.length > 3 && KNOWN_EXT_RE.test(cand)) files.push(cand.split("/").slice(-2).join("/"));
    }
    for (const line of content.split("\n")) {
      const cm = line.match(CMD_RE);
      if (cm) commands.push(cm[1].trim());
      if (/\b(error|exception|failed|traceback)\b/i.test(line) && line.trim().length > 8) {
        errors.push(line.trim().slice(0, 100));
      }
    }
    if (role === "user" && text.trim().length > 4) lastUser = text.trim();
  }
  return {
    files: uniqTop(files, 5),
    commands: uniqTop(commands, 3),
    errors: uniqTop(errors, 2),
    lastUser: lastUser.slice(0, 160),
  };
}

/** Susun + simpan satu memori snapshot untuk proyek. null = cooldown /
 * tidak ada bahan. Dedupe text-path mencegah snapshot identik menumpuk. */
export async function captureSessionSnapshot(projectId: number, fallbackTool = "unknown"): Promise<{ inserted: boolean; mergedInto?: number } | null> {
  const cooldownKey = `f4snap:${projectId}`;
  const last = Number(getSetting(cooldownKey, "0")) || 0;
  if (Date.now() - last < SNAPSHOT_COOLDOWN_MS) return null;
  setSetting(cooldownKey, String(Date.now()));

  const d = getDb();
  const proj = d.prepare("SELECT path, name FROM projects WHERE id = ?").get(projectId) as
    | { path: string | null; name: string | null }
    | undefined;
  if (!proj) return null;

  const rows = d
    .prepare("SELECT role, content FROM transcripts WHERE project_id = ? AND content != '' ORDER BY id DESC LIMIT 16")
    .all(projectId) as Array<{ role: string; content: string }>;
  if (!rows.length) return null;
  const { files, commands, errors, lastUser } = extractSignals(rows.reverse());

  // Git status: sinyal absolut "apa yang sedang dikerjakan" (F1A sudah membaca
  // ini untuk handoff — kini juga disimpan sebagai memori).
  let gitPart = "";
  try {
    if (proj.path) {
      const gs = await runGitStatus(proj.path, 4);
      if (gs.branch) {
        gitPart = ` · branch ${gs.branch}${gs.dirty.length ? ` · dirty: ${gs.dirty.slice(0, 3).join(", ")}` : ""}`;
      }
    }
  } catch {
    /* proyek bukan repo git / path hilang — snapshot tetap dibuat tanpa git */
  }

  const parts = [
    `Work snapshot (${proj.name || fallbackTool})`,
    gitPart,
    files.length ? ` · files: ${files.join(", ")}` : "",
    commands.length ? ` · cmd: ${commands.join(" | ")}` : "",
    errors.length ? ` · error: ${errors.join(" || ")}` : "",
    lastUser ? ` · last: "${lastUser}"` : "",
  ];
  const content = parts.filter(Boolean).join("");
  if (content.length < 40) return null; // tidak ada bahan berarti

  const eprov = await getEmbedProvider();
  const embedding = await eprov.embed(content);
  const result = addMemoryWithDedupe({
    projectId,
    kind: "context",
    content,
    importance: 0.65,
    createdAt: Date.now(),
    lastAccessed: 0,
    accessCount: 0,
    sourceTool: fallbackTool,
    embedding: embedding ?? null,
    status: effectiveStatus(),
    origin: "heuristic",
    embedModel: embedding ? eprov.embedModel : undefined,
  });
  return result;
}

/* ---------- 3. Orkestrasi pre-limit ---------- */
let limitFiring = false;

/** Dipanggil di akhir scanAll: transkrip baru mengandung pesan limit →
 * snapshot sesi + ekstraksi prioritas + inject konteks SEKARANG. */
export async function checkLimitSignals(): Promise<void> {
  try {
    const projects = collectLimitProjects();
    if (!projects.length) return;
    if (limitFiring) return;
    limitFiring = true;
    try {
      const snapshotResults: Array<{ projectId: number; snapshotted: boolean }> = [];
      for (const pid of projects) {
        const snap = await captureSessionSnapshot(pid);
        snapshotResults.push({ projectId: pid, snapshotted: !!snap });
        emitEvent("limit_hit", { projectId: pid, snapshotted: !!snap });
      }
      console.log(
        `[memoria] Limit signal on ${projects.length} project(s) - snapshot + priority extraction + inject now` +
          (snapshotResults.some((r) => r.snapshotted) ? "" : " (snapshot cooldown)")
      );
      const { extractQueue } = await import("./extractor");
      await extractQueue(true, { order: "desc" });
      const { autoInjectContext } = await import("../handoff");
      const injected = await autoInjectContext();
      if (injected.length) console.log(`[memoria] Pre-limit resume context ready for: ${injected.join(", ")}`);
    } finally {
      limitFiring = false;
    }
  } catch {
    /* kegagalan di jalur ini tidak boleh mengganggu scan */
  }
}
