import { getConfig } from "../config";
import { initDb, getDb, countTranscripts, countMemories, perToolCounts, pendingExtractionCount, countDraft, countArchived, getBoolSetting } from "../store/db";
import { scanClaude } from "./claude";
import { scanCodex } from "./codex";
import { scanOpencode } from "./opencode";
import { scanGenericJsonl } from "./generic";
import { scanCopilot } from "./copilot";
import { scanAntigravity } from "./antigravity";
import { scanVscdb } from "./vscdb";
import { extractQueue } from "../extract/extractor";

export interface ScanResult {
  tool: string;
  ok: boolean;
  detail: string;
  count: number;
}

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
  const results: ScanResult[] = [];
  for (const src of cfg.sources) {
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
  await extractQueue();
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
} {
  ensureDb();
  return {
    transcripts: countTranscripts(),
    memories: countMemories(),
    pending: pendingExtractionCount(),
    draft: countDraft(),
    archived: countArchived(),
    lastScan: new Date().toISOString(),
    perTool: perToolCounts(),
  };
}
