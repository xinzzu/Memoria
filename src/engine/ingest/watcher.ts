import * as chokidar from "chokidar";
import { getConfig } from "../config";
import { getSetting } from "../store/db";
import { scanAll } from "./manager";
import { extractQueue } from "../extract/extractor";

let watcher: ReturnType<typeof chokidar.watch> | null = null;

/* ---------- Hot-path resume ----------
 * Scenario: the user hits a limit and switches tools mid-task. The resume
 * context must be ready AS SOON AS POSSIBLE — not wait for the next batch
 * queue.
 *
 * "Session finished" heuristic: transcript activity happens, then silence
 * for >= idle.
 * When triggered: incremental scan -> extraction with NEWEST-SESSION
 * PRIORITY (order desc) -> auto-inject context into the active project's
 * target file.
 * Latency target: resume ready <= 5 minutes after the last message.
 * Threshold is configurable via the "resumeIdleMinutes" setting (default 4, min 1).
 * -------------------------------------- */

const HOT_LOOP_MS = 30_000;

function resumeIdleMs(): number {
  const minutes = Number(getSetting("resumeIdleMinutes", "4"));
  return Math.max(1, Number.isFinite(minutes) ? minutes : 4) * 60_000;
}

let hotTimer: NodeJS.Timeout | null = null;
let lastEventAt = 0;
let dirtySinceResume = false;
let hotRunning = false;

function hotResumeTick(): void {
  if (!dirtySinceResume || hotRunning) return;
  if (Date.now() - lastEventAt < resumeIdleMs()) return;
  dirtySinceResume = false;
  hotRunning = true;
  (async () => {
    try {
      console.log("[memoria] Session idle detected - hot resume: priority extraction + context injection");
      await scanAll();
      // Newest session first — tool-switch context must not queue behind the old backlog.
      await extractQueue(true, { order: "desc" });
      const { autoInjectContext } = await import("../handoff");
      const injected = await autoInjectContext();
      if (injected.length) console.log(`[memoria] Resume context ready for: ${injected.join(", ")}`);
    } catch {
      // Let the next cycle try again.
      dirtySinceResume = true;
    } finally {
      hotRunning = false;
    }
  })();
}

function startHotResumeLoop(): void {
  if (hotTimer) return;
  hotTimer = setInterval(hotResumeTick, HOT_LOOP_MS);
  hotTimer.unref?.();
}

export function startWatcher(onEvent?: (e: { tool: string; path: string }) => void): void {
  if (watcher) return;
  const cfg = getConfig();
  const watchPaths: string[] = [];
  for (const src of cfg.sources) {
    if (!src.enabled) continue;
    if (src.kind === "jsonl") {
      for (const p of src.paths) {
        if (p.includes("sessions") || src.tool === "claude" || src.tool === "codex" || src.tool === "gemini") {
          watchPaths.push(p);
        }
      }
    } else if (src.kind === "sqlite" || src.kind === "logs") {
      watchPaths.push(src.paths[0]);
    } else if (src.kind === "vscdb") {
      watchPaths.push(src.paths[0]);
    }
  }
  if (!watchPaths.length) return;

  watcher = chokidar.watch(watchPaths, {
    ignoreInitial: true,
    persistent: true,
    depth: 6,
    awaitWriteFinish: { stabilityThreshold: cfg.watcherDebounceMs, pollInterval: 2000 },
  });

  let timer: NodeJS.Timeout | null = null;
  const schedule = (p: string) => {
    lastEventAt = Date.now();
    dirtySinceResume = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      await scanAll();
      await extractQueue();
    }, cfg.watcherDebounceMs);
    onEvent?.({ tool: "watcher", path: p });
  };

  watcher.on("add", schedule).on("change", schedule).on("addDir", schedule);
  startHotResumeLoop();
}

export function stopWatcher(): void {
  watcher?.close();
  watcher = null;
  if (hotTimer) {
    clearInterval(hotTimer);
    hotTimer = null;
  }
}
