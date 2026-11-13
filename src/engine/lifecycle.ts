import { getBoolSetting, getSetting, setSetting, countDraft } from "./store/db";
import { backupDb, pruneArchivedBackups } from "./store/backup";
import { archiveStaleEligibles, pruneSyncTombstones } from "./store/db";
import { ensureOllamaRunning } from "./extract/ollama-serve";
import { emitEvent } from "./events";

let timers: NodeJS.Timeout[] = [];

export function startBackgroundJobs(): void {
  ensureOllamaRunning().catch(() => {});
  try {
    const { registerWebhooks } = require("./notify/webhook") as typeof import("./notify/webhook");
    registerWebhooks();
  } catch {
    /* non-blokir */
  }
  runHousekeepingSoon();
  const t = setInterval(runHousekeepingSoon, 5 * 60_000);
  const daily = setInterval(dailyMaintenance, 6 * 60 * 60_000);
  timers.push(t, daily);
}

export function stopBackgroundJobs(): void {
  for (const t of timers) clearInterval(t);
  timers = [];
}

async function runHousekeepingSoon(): Promise<void> {
  try {
    const { extractQueue, runHousekeeping } = await import("./extract/extractor");
    runHousekeeping();
    await extractQueue(false);
    try {
      const { processEmbeddingBackfill } = await import("./sync/embed");
      const embedded = await processEmbeddingBackfill(50);
      if (embedded) console.log(`[memoria] Sync embeddings: ${embedded} backfilled`);
    } catch {
      /* antrean dicoba lagi pada siklus berikutnya */
    }
    const { autoInjectContext } = await import("./handoff");
    try {
      const done = await autoInjectContext();
      if (done.length) console.log(`[memoria] Auto-injected AGENTS.md: ${done.join(", ")}`);
    } catch {
      // proyek mungkin tanpa izin tulis; diabaikan
    }
  } catch {
    // aman untuk diabaikan
  }
}

function dailyMaintenance(): void {
  try {
    if (getBoolSetting("autoArchive", true)) {
      archiveStaleEligibles();
    }
    if (getBoolSetting("autoBackup", true)) {
      pruneArchivedBackups();
      backupDb();
    }
    try {
      const pruned = pruneSyncTombstones(180);
      if (pruned) console.log(`[memoria] Sync tombstones pruned: ${pruned}`);
    } catch {
      /* non-blokir */
    }
    if (getBoolSetting("autoTopics", true)) {
      try {
        const { rebuildTopics } = require("./extract/topics") as typeof import("./extract/topics");
        const r = rebuildTopics();
        console.log(`[memoria] Topic tags: ${r.memories} memories, ${r.topics} topics`);
      } catch {
        /* non-blokir */
      }
    }
    if (getBoolSetting("weeklyDigest", true)) {
      try {
        const { nextWeeklyDigestDue, generateWeeklyDigest } = require("./summary/weekly") as typeof import("./summary/weekly");
        if (nextWeeklyDigestDue()) {
          const d = generateWeeklyDigest();
          console.log(`[memoria] Weekly digest: ${d.memories} memories -> ${d.path}`);
        }
      } catch {
        /* non-blokir */
      }
    }
    // F3: notifikasi draft menunggu kurasi — maks sekali per 24 jam.
    if (getBoolSetting("notifyDrafts", false)) {
      try {
        const min = Number(getSetting("notifyDraftMin", "3")) || 3;
        const pending = countDraft();
        const last = Number(getSetting("notifyLastDraft", "0"));
        if (pending >= min && Date.now() - last >= 24 * 60 * 60_000) {
          emitEvent("drafts_pending", { count: pending });
          setSetting("notifyLastDraft", String(Date.now()));
        }
      } catch {
        /* non-blokir */
      }
    }
  } catch {
    // aman untuk diabaikan
  }
}

export function manualBackupNow(): string | null {
  pruneArchivedBackups();
  return backupDb();
}