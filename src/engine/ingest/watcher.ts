import * as chokidar from "chokidar";
import { getConfig } from "../config";
import { scanAll } from "./manager";
import { extractQueue } from "../extract/extractor";

let watcher: ReturnType<typeof chokidar.watch> | null = null;

/* ---------- Hot-path resume ----------
 * Skenario: user kena limit lalu pindah tool di tengah tugas. Konteks resume
 * harus siap SECEPATNYA — bukan menunggu antrian batch berikutnya.
 *
 * Heuristic "sesi selesai": aktivitas transkrip terjadi lalu diam >= RESUME_IDLE_MS.
 * Saat terpicu: scan incremental -> ekstraksi dengan PRIORITAS SESI TERBARU
 * (order desc) -> auto-inject konteks ke file target proyek yang aktif.
 * Target latensi: resume siap <= 5 menit setelah pesan terakhir.
 * -------------------------------------- */

const RESUME_IDLE_MS = 4 * 60_000;
const HOT_LOOP_MS = 30_000;

let hotTimer: NodeJS.Timeout | null = null;
let lastEventAt = 0;
let dirtySinceResume = false;
let hotRunning = false;

function hotResumeTick(): void {
  if (!dirtySinceResume || hotRunning) return;
  if (Date.now() - lastEventAt < RESUME_IDLE_MS) return;
  dirtySinceResume = false;
  hotRunning = true;
  (async () => {
    try {
      console.log("[memoria] Sesi terdeteksi selesai (idle) — hot resume: ekstraksi prioritas + injeksi konteks");
      await scanAll();
      // Sesi terbaru duluan — konteks pindah-tool tidak boleh mengantri di belakang backlog lama.
      await extractQueue(true, { order: "desc" });
      const { autoInjectContext } = await import("../handoff");
      const injected = await autoInjectContext();
      if (injected.length) console.log(`[memoria] Konteks resume siap untuk: ${injected.join(", ")}`);
    } catch {
      // biarkan siklus berikutnya mencoba lagi
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
