import * as fs from "node:fs";
import * as path from "node:path";
import { getConfig } from "../config";
import { getDb } from "./db";

export interface BackupInfo {
  name: string;
  path: string;
  size: number;
  mtime: number;
}

function backupsDir(): string {
  const dir = path.join(getConfig().dataDir, "backups");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function listBackups(): BackupInfo[] {
  const dir = backupsDir();
  const out: BackupInfo[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".db")) continue;
    const full = path.join(dir, f);
    try {
      const st = fs.statSync(full);
      out.push({ name: f, path: full, size: st.size, mtime: st.mtimeMs });
    } catch {
      continue;
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

export function backupDb(): string | null {
  const cfg = getConfig();
  const src = path.join(cfg.dataDir, "memory.db");
  if (!fs.existsSync(src)) return null;
  const dir = backupsDir();
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  const dest = path.join(dir, `memory-${stamp}.db`);
  try {
    // H1 (audit): copyFileSync atas DB WAL yang hidup bisa robek/stale —
    // VACUUM INTO menghasilkan snapshot konsisten (SQLite >= 3.27).
    getDb().prepare('VACUUM INTO ?').run(dest);
  } catch {
    try {
      fs.copyFileSync(src, dest); // fallback lama bila VACUUM gagal
    } catch {
      return null;
    }
  }
  const all = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".db"))
    .sort();
  while (all.length > 10) {
    const victim = all.shift()!;
    try {
      fs.rmSync(path.join(dir, victim), { force: true });
    } catch {
      /* ignore */
    }
  }
  return dest;
}

export function restoreBackup(srcPath: string): { ok: boolean; message: string } {
  const cfg = getConfig();
  const dest = path.join(cfg.dataDir, "memory.db");
  if (!fs.existsSync(srcPath)) return { ok: false, message: "File backup tidak ditemukan" };
  const { closeDb, initDb } = require("./db") as typeof import("./db");
  try {
    closeDb();
    fs.copyFileSync(srcPath, dest);
    for (const side of ["-wal", "-shm"]) {
      const p = dest + side;
      if (fs.existsSync(p)) fs.rmSync(p, { force: true });
    }
    initDb(cfg.dataDir);
    return { ok: true, message: "Restore berhasil" };
  } catch (e) {
    try {
      initDb(cfg.dataDir);
    } catch {
      /* ignore */
    }
    return { ok: false, message: String(e) };
  }
}

export function pruneArchivedBackups(): void {
  const dir = backupsDir();
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (!f.endsWith(".db")) continue;
    const ageMs = Date.now() - fs.statSync(full).mtimeMs;
    if (ageMs > 30 * 86400000) {
      try {
        fs.rmSync(full, { force: true });
      } catch {
        /* ignore */
      }
    }
  }
}