import { getBoolSetting, getSetting } from "./store/db";
import { backupDb, pruneArchivedBackups } from "./store/backup";
import { archiveStaleEligibles } from "./store/db";
import { ensureOllamaRunning } from "./extract/ollama-serve";

let timers: NodeJS.Timeout[] = [];

export function startBackgroundJobs(): void {
  ensureOllamaRunning().catch(() => {});
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
    const { autoInjectContext } = await import("./handoff");
    try {
      const done = await autoInjectContext();
      if (done.length) console.log(`[memoria] Auto-inject AGENTS.md: ${done.join(", ")}`);
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
    if (getBoolSetting("autoTopics", true)) {
      try {
        const { rebuildTopics } = require("./extract/topics") as typeof import("./extract/topics");
        const r = rebuildTopics();
        console.log(`[memoria] Topic tags: ${r.memories} memori, ${r.topics} topik`);
      } catch {
        /* non-blokir */
      }
    }
    if (getBoolSetting("weeklyDigest", true)) {
      try {
        const { nextWeeklyDigestDue, generateWeeklyDigest } = require("./summary/weekly") as typeof import("./summary/weekly");
        if (nextWeeklyDigestDue()) {
          const d = generateWeeklyDigest();
          console.log(`[memoria] Weekly digest: ${d.memories} memori -> ${d.path}`);
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