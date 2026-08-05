import * as chokidar from "chokidar";
import { getConfig } from "../config";
import { scanAll } from "./manager";
import { extractQueue } from "../extract/extractor";

let watcher: ReturnType<typeof chokidar.watch> | null = null;

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
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      await scanAll();
      await extractQueue();
    }, cfg.watcherDebounceMs);
    onEvent?.({ tool: "watcher", path: p });
  };

  watcher.on("add", schedule).on("change", schedule).on("addDir", schedule);
}

export function stopWatcher(): void {
  watcher?.close();
  watcher = null;
}
