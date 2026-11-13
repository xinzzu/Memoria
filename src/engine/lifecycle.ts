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
  try {
    const { startFolderWatcher } = require("./sync/folder") as typeof import("./sync/folder");
    startFolderWatcher();
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
  try {
    const { stopFolderWatcher } = require("./sync/folder") as typeof import("./sync/folder");
    stopFolderWatcher();
  } catch {
    /* non-blokir */
  }
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
    // PR-B: konsolidasi berkala — merge near-duplicate (zero-LLM, guard
    // konservatif: proyek sama + kind sama + cosine >= 0.85). Default ON.
    try {
      const { pruneContinuity } = require('./store/db') as typeof import('./store/db');
      const pruned = pruneContinuity(90);
      if (pruned) console.log(`[memoria] Continuity events pruned: ${pruned}`);
    } catch {
      /* non-blokir */
    }
    if (getBoolSetting('autoConsolidate', true)) {
      void (async () => {
        try {
          const { consolidateMemories } = require("./extract/consolidate") as typeof import("./extract/consolidate");
          const r = await consolidateMemories();
          if (r.removed) {
            console.log(`[memoria] Consolidation: ${r.removed} near-duplicate memories removed in ${r.clusters} clusters`);
          }
        } catch {
          /* non-blokir */
        }
      })();
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
    // A4: project brief — satu memori ringkas per proyek yang selalu pertama
    // di recall/handoff (Letta core memory / Cline memory bank, versi otomatis).
    void (async () => {
      try {
        const db = require("./store/db") as typeof import("./store/db");
        const projects = db
          .getDb()
          .prepare(
            `SELECT DISTINCT m.project_id AS id FROM memories m
             WHERE m.project_id IS NOT NULL AND m.archived = 0 AND m.status = 'active'
             ORDER BY m.created_at DESC LIMIT 20`
          )
          .all() as Array<{ id: number }>;
        let made = 0;
        for (const p of projects) {
          try {
            const brief = await db.generateProjectBrief(p.id);
            if (brief) made++;
          } catch {
            /* satu proyek gagal tidak menghentikan yang lain */
          }
        }
        if (made) console.log(`[memoria] Project briefs refreshed: ${made}`);
      } catch {
        /* non-blokir */
      }
    })();
  } catch {
    // aman untuk diabaikan
  }
}

export function manualBackupNow(): string | null {
  pruneArchivedBackups();
  return backupDb();
}