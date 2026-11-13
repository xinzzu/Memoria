import { getConfig } from "../config";
import * as os from "node:os";
import { initDb, getDb, countTranscripts, countMemories, perToolCounts, pendingExtractionCount, countDraft, countArchived, getBoolSetting } from "../store/db";
import { scanClaude } from "./claude";
import { scanCodex } from "./codex";
import { scanOpencode } from "./opencode";
import { scanGenericJsonl } from "./generic";
import { scanCopilot } from "./copilot";
import { scanAntigravity } from "./antigravity";
import { scanVscdb } from "./vscdb";
import { extractQueue } from "../extract/extractor";
import { emitEvent } from "../events";

export interface ScanResult {
  tool: string;
  ok: boolean;
  detail: string;
  count: number;
}

// Timestamp scan terakhir yang BENAR-BENAR selesai (dulu stats() selalu
// mengembalikan Date.now() — nilai palsu yang menyesatkan user).
let lastScanFinishedAt = 0;

export function ensureDb(): void {
  if (!getDbSafe()) initDb(getConfig().dataDir);
}

function getDbSafe() {
  try {
    return getDb();
  } catch {
    return null;
  }
}

export async function scanAll(log?: (msg: string) => void): Promise<ScanResult[]> {
  ensureDb();
  const cfg = getConfig();
  const results: ScanResult[] = [];  for (const src of cfg.sources) {
    const enabled = getBoolSetting(`source:${src.tool}:enabled`, src.enabled);
    if (!enabled) {
      results.push({ tool: src.tool, ok: false, detail: "disabled", count: 0 });
      continue;
    }
    try {
      let count = 0;
      switch (src.kind) {
        case "jsonl":
          if (src.tool === "claude") {
            for (const p of src.paths) {
              const r = await scanClaude(p, log);
              count += r.lines;
            }
          } else if (src.tool === "codex") {
            for (const p of src.paths) {
              const r = await scanCodex(p, log);
              count += r.lines;
            }
          } else {
            for (const p of src.paths) {
              const r = await scanGenericJsonl(src.tool, [p], [".jsonl"], log);
              count += r.lines;
            }
          }
          break;
        case "sqlite":
          if (src.tool === "opencode") {
            const r = scanOpencode(src.paths[0]);
            count = r.messages;
          } else if (src.tool === "copilot") {
            const r = scanCopilot(src.paths[0]);
            count = r.messages;
          }
          break;
        case "logs":
          for (const p of src.paths) {
            const r = scanAntigravity(p);
            count += r.lines;
          }
          break;
        case "vscdb":
          if (src.tool === "vscode" || src.tool === "cursor" || src.tool === "windsurf") {
            const r = scanVscdb(src.tool, src.paths);
            count += r.messages;
          }
          break;
        default:
          break;
      }
      results.push({ tool: src.tool, ok: true, detail: "ok", count });
    } catch (e) {
      results.push({ tool: src.tool, ok: false, detail: String(e), count: 0 });
    }
  }
  // F3: tangkap jumlah memori baru (return extractQueue tadinya dibuang)
  // agar event scan membawa ringkasan lengkap untuk notifikasi webhook.
  const newMemories = await extractQueue();
  lastScanFinishedAt = Date.now();
  const tools = results.filter((r) => r.ok && r.count > 0).map((r) => `${r.tool}+${r.count}`);
  const newTranscripts = results.reduce((a, r) => a + (r.ok ? r.count : 0), 0);
  emitEvent("scan", { tools, newTranscripts, newMemories });
  // F4: pesan "limit habis" pada transkrip baru → snapshot sesi + ekstraksi
  // prioritas + inject SEKARANG (lebih cepat dari trigger idle di watcher).
  try {
    const { checkLimitSignals } = await import("../extract/snapshot");
    void checkLimitSignals();
  } catch {
    /* non-blokir */
  }
  return results;
}

export function stats(): {
  transcripts: number;
  memories: number;
  pending: number;
  draft: number;
  archived: number;
  lastScan: string;
  perTool: Array<{ tool: string; count: number }>;
  week: Array<{ day: string; count: number }>;
  resumeReady: Array<{ slug: string; name: string; at: number }>;
  user: string;
} {
  ensureDb();
  const db = getDb();

  // Aktivitas 7 hari (jumlah pesan per hari) — bahan grafik Overview.
  const DAY = 86400000;
  const today = Math.floor(Date.now() / DAY);
  // CAST wajib: node:sqlite mem-bind angka JS sebagai REAL, jadi tanpa CAST
  // pembagian menghasilkan float (20760.72) yang tak pernah cocok dgn bucket harian.
  const rows = db
    .prepare("SELECT CAST(ts / ? AS INTEGER) AS d, COUNT(*) AS c FROM transcripts WHERE ts >= ? GROUP BY d")
    .all(DAY, Date.now() - 14 * DAY) as Array<{ d: number; c: number }>;
  const byDay = new Map(rows.map((r) => [Number(r.d), r.c]));
  // PR-L: aktivitas MEMORI per hari (active + draft) — aktivitas heuristik
  // (draft masuk inbox) kini ikut terlihat di chart, bukan cuma pesan mentah.
  const memRows = db
    .prepare("SELECT CAST(created_at / ? AS INTEGER) AS d, COUNT(*) AS c FROM memories WHERE created_at >= ? GROUP BY d")
    .all(DAY, Date.now() - 14 * DAY) as Array<{ d: number; c: number }>;
  const memByDay = new Map(memRows.map((r) => [Number(r.d), r.c]));
  const week: Array<{ day: string; count: number; memories: number }> = [];
  for (let i = 13; i >= 0; i--) {
    const dd = today - i;
    week.push({ day: new Date(dd * DAY).toISOString().slice(5, 10), count: byDay.get(dd) || 0, memories: memByDay.get(dd) || 0 });
  }

  // Proyek dengan konteks resume yang baru diinjeksi (48 jam terakhir).
  const cutoff = Date.now() - 48 * 3600_000;
  const injects = db
    .prepare("SELECT key, value FROM settings WHERE key LIKE 'proj:%:handoff_at'")
    .all() as Array<{ key: string; value: string }>;
  const resumeReady: Array<{ slug: string; name: string; at: number }> = [];
  for (const r of injects) {
    const at = Number(r.value) || 0;
    if (at < cutoff) continue;
    const slug = r.key.slice("proj:".length, -":handoff_at".length);
    const proj = db.prepare("SELECT name FROM projects WHERE slug = ?").get(slug) as { name: string } | undefined;
    resumeReady.push({ slug, name: proj?.name || slug, at });
  }
  resumeReady.sort((a, b) => b.at - a.at);

  return {
    transcripts: countTranscripts(),
    memories: countMemories(),
    pending: pendingExtractionCount(),
    draft: countDraft(),
    archived: countArchived(),
    lastScan: lastScanFinishedAt ? new Date(lastScanFinishedAt).toISOString() : "",
    perTool: perToolCounts(),
    week,
    resumeReady: resumeReady.slice(0, 6),
    // Nama user untuk greeting Overview ("Hello, {user}") — fallback sopan bila gagal.
    user: (() => {
      try {
        return os.userInfo().username || "";
      } catch {
        return "";
      }
    })(),
  };
}
