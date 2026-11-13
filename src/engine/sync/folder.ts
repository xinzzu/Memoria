import * as fs from "node:fs";
import * as path from "node:path";
import * as chokidar from "chokidar";
import {
  getDb,
  getDeviceId,
  getSyncState,
  isBundleApplied,
  listRecentConflicts,
  recordAppliedBundle,
  setSyncState,
} from "../store/db";
import { exportBundle } from "./export";
import { applyBundleFile } from "./apply";
import { embeddingBackfillCount, processEmbeddingBackfill } from "./embed";
import { isSyncConfigured, loadGroupKey, syncStatus } from "./keys";

export interface FolderStatus {
  configured: boolean;
  path: string;
  available: boolean;
  writable: boolean;
  watching: boolean;
  pendingOutbox: number;
  pendingSinceExport: number;
  lastExportHlc: string;
  lastExportAt: string;
  lastImportHlc: string;
  lastImportAt: string;
  lastError: string;
  conflicts: number;
  embeddingsQueued: number;
}

let watcher: chokidar.FSWatcher | null = null;
let exportInterval: NodeJS.Timeout | null = null;
let scanTimer: NodeJS.Timeout | null = null;
let busy = false;

function setError(msg: string): void {
  setSyncState("sync.folder.lastError", msg || "");
}

function getError(): string {
  return getSyncState("sync.folder.lastError");
}

function folderPath(): string {
  return getSyncState("sync.folder.path");
}

function sanitizeSegment(s: string): string {
  return String(s || "").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "bundle";
}

function isWritableDir(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function setSharedFolder(inputPath: string | null, opts: { passphrase?: string } = {}): FolderStatus {
  if (!inputPath || !String(inputPath).trim() || String(inputPath).trim() === "--clear") {
    setSyncState("sync.folder.path", "");
    setSyncState("sync.folder.enabled", "0");
    setError("");
    stopFolderWatcher();
    return getFolderStatus();
  }
  if (!isSyncConfigured()) {
    throw new Error("Sync is not configured. Run: node dist/engine/index.js sync setup");
  }
  try {
    loadGroupKey({ passphrase: opts.passphrase });
  } catch (err) {
    throw new Error(`Sync key unavailable: ${(err as Error).message}`);
  }
  const resolved = path.resolve(String(inputPath).trim());
  if (!isWritableDir(resolved)) {
    throw new Error(`Shared folder is not writable: ${resolved}`);
  }
  setSyncState("sync.folder.path", resolved);
  setSyncState("sync.folder.enabled", "1");
  setError("");
  return getFolderStatus();
}

export function getFolderStatus(): FolderStatus {
  const p = folderPath();
  let available = false;
  let writable = false;
  if (p) {
    try {
      available = fs.existsSync(p) && fs.statSync(p).isDirectory();
      writable = available ? isWritableDir(p) : false;
    } catch {
      available = false;
      writable = false;
    }
  }
  const st = (() => {
    try {
      return syncStatus({});
    } catch {
      return null;
    }
  })();
  return {
    configured: !!p && isSyncConfigured(),
    path: p,
    available,
    writable,
    watching: !!watcher,
    pendingOutbox: st ? st.pendingOutbox : 0,
    pendingSinceExport: st ? st.pendingSinceExport : 0,
    lastExportHlc: getSyncState("sync.folder.lastExportHlc") || getSyncState("last_export_hlc"),
    lastExportAt: getSyncState("sync.folder.lastExportAt") || getSyncState("last_export_at"),
    lastImportHlc: getSyncState("last_import_hlc"),
    lastImportAt: getSyncState("last_import_at"),
    lastError: getError(),
    conflicts: st ? st.conflicts : 0,
    embeddingsQueued: st ? st.embeddingsQueued : embeddingBackfillCount(),
  };
}

function pendingForFolder(): number {
  const last = getSyncState("sync.folder.lastExportHlc");
  const row = getDb().prepare("SELECT COUNT(*) AS c FROM sync_outbox WHERE hlc > ?").get(last) as { c: number };
  return Number(row.c);
}

export function exportPendingToFolder(opts: { passphrase?: string; force?: boolean } = {}): { exported: boolean; filePath?: string; opCount?: number } {
  const p = folderPath();
  if (!p || getSyncState("sync.folder.enabled") !== "1") return { exported: false };
  if (!isWritableDir(p)) {
    setError("folder_unavailable");
    return { exported: false };
  }
  if (!opts.force && pendingForFolder() <= 0) return { exported: false };
  const groupKey = loadGroupKey({ passphrase: opts.passphrase });
  const deviceId = getDeviceId();
  const safeDev = sanitizeSegment(deviceId.slice(0, 8));
  const stamp = Date.now().toString(36);
  const out = path.join(p, `${safeDev}-${stamp}.memsync`);
  const result = exportBundle({ filePath: out, groupKey, full: false });
  setSyncState("sync.folder.lastExportHlc", result.hlcMax);
  setSyncState("sync.folder.lastExportAt", String(Date.now()));
  setSyncState("sync.folder.lastExportFile", result.filePath);
  setError("");
  return { exported: true, filePath: result.filePath, opCount: result.opCount };
}

function isOwnBundleFile(file: string): boolean {
  const dev = sanitizeSegment(getDeviceId().slice(0, 8));
  return path.basename(file).startsWith(`${dev}-`);
}

export interface ScanResult {
  scanned: number;
  applied: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export async function scanAndApplyFolder(opts: { passphrase?: string; embed?: boolean } = {}): Promise<ScanResult> {
  const p = folderPath();
  const res: ScanResult = { scanned: 0, applied: 0, skipped: 0, failed: 0, errors: [] };
  if (!p || getSyncState("sync.folder.enabled") !== "1") return res;
  if (!fs.existsSync(p)) {
    setError("folder_unavailable");
    return res;
  }
  let groupKey: Buffer;
  try {
    groupKey = loadGroupKey({ passphrase: opts.passphrase });
  } catch (err) {
    setError((err as Error).message);
    return res;
  }
  let files: string[] = [];
  try {
    files = fs
      .readdirSync(p)
      .filter((f) => f.endsWith(".memsync"))
      .map((f) => path.join(p, f))
      .sort();
  } catch (err) {
    setError(`folder_unavailable: ${(err as Error).message}`);
    return res;
  }
  for (const file of files) {
    if (isOwnBundleFile(file)) continue;
    res.scanned++;
    try {
      // quick skip if ledger knows filename? rely on apply/bundle id after read; but need to read to know fileId.
      const result = applyBundleFile(file, groupKey, "folder", path.basename(file));
      if (result.alreadyApplied) res.skipped++;
      else res.applied++;
    } catch (err) {
      const msg = `${path.basename(file)}: ${(err as Error).message}`;
      res.failed++;
      res.errors.push(msg);
      console.warn("[memoria] sync folder skip:", msg);
    }
  }
  if (res.failed) setError(res.errors[0] || "import_failed");
  else setError("");
  if (opts.embed) {
    try {
      for (let i = 0; i < 20; i++) {
        const n = await processEmbeddingBackfill(100);
        if (!n || embeddingBackfillCount() === 0) break;
      }
    } catch {
      /* best effort */
    }
  }
  return res;
}

export function cleanupOwnBundles(maxAgeDays = 14): number {
  const p = folderPath();
  if (!p || !fs.existsSync(p)) return 0;
  const cutoff = Date.now() - maxAgeDays * 86400_000;
  let removed = 0;
  try {
    for (const f of fs.readdirSync(p)) {
      if (!f.endsWith(".memsync")) continue;
      const full = path.join(p, f);
      if (!isOwnBundleFile(full)) continue;
      try {
        const st = fs.statSync(full);
        if (st.mtimeMs < cutoff) {
          fs.unlinkSync(full);
          removed++;
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return removed;
}

async function tickExport(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    exportPendingToFolder();
    cleanupOwnBundles(14);
  } catch (err) {
    setError((err as Error).message);
  } finally {
    busy = false;
  }
}

function scheduleScan(delay = 500): void {
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = setTimeout(async () => {
    scanTimer = null;
    if (busy) return;
    busy = true;
    try {
      await scanAndApplyFolder();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      busy = false;
    }
  }, delay);
}

export function startFolderWatcher(): void {
  stopFolderWatcher();
  const p = folderPath();
  if (!p || getSyncState("sync.folder.enabled") !== "1") return;
  if (!isSyncConfigured()) return;
  if (!fs.existsSync(p)) {
    setError("folder_unavailable");
    return;
  }
  try {
    watcher = chokidar.watch(p, {
      ignoreInitial: true,
      depth: 0,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    });
    watcher.on("add", (file) => {
      if (file.endsWith(".memsync") && !isOwnBundleFile(file)) scheduleScan(300);
    });
    watcher.on("error", (err) => setError(String(err)));
  } catch (err) {
    setError((err as Error).message);
    return;
  }
  exportInterval = setInterval(() => {
    void tickExport();
  }, 30_000);
  setTimeout(() => {
    try { void scanAndApplyFolder(); } catch {}
    try { void tickExport(); } catch {}
  }, 1000);
}

export function stopFolderWatcher(): void {
  if (watcher) {
    try { void watcher.close(); } catch {}
    watcher = null;
  }
  if (exportInterval) {
    clearInterval(exportInterval);
    exportInterval = null;
  }
  if (scanTimer) {
    clearTimeout(scanTimer);
    scanTimer = null;
  }
}

export { listRecentConflicts };
