import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { extractEntities } from "../extract/entities";
import { canonicalPath, projectSlugFromCwd } from "../ingest/util";

export interface Transcript {
  id?: number;
  tool: string;
  sessionId: string;
  projectId: number;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  ts: number;
  seq: number;
}

export interface Memory {
  id?: number;
  uid?: string;
  projectId: number | null;
  kind: string;
  content: string;
  importance: number;
  createdAt: number;
  lastAccessed: number;
  accessCount: number;
  sourceTool: string;
  embedding?: number[] | null;
  status?: string;
  resolvedAt?: number;
  /** Asal memori: llm (default) | heuristic | user — untuk transparansi kualitas. */
  origin?: string;
  /** Dialek embedding (nama model / hash-256-v1). Vektor lintas dialek tak boleh dibandingkan. */
  embedModel?: string;
  updatedAt?: number;
  updatedBy?: string;
}

let db: DatabaseSync | null = null;

export function initDb(dataDir: string): DatabaseSync {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "memory.db");
  db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      path TEXT,
      name TEXT,
      last_seen INTEGER
    );
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool TEXT NOT NULL,
      path TEXT NOT NULL,
      file TEXT NOT NULL,
      offset INTEGER DEFAULT 0,
      mtime REAL DEFAULT 0,
      UNIQUE(tool, file)
    );
    CREATE TABLE IF NOT EXISTS transcripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool TEXT NOT NULL,
      session_id TEXT NOT NULL,
      project_id INTEGER,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      ts INTEGER NOT NULL,
      seq INTEGER DEFAULT 0,
      extracted INTEGER DEFAULT 0,
      UNIQUE(tool, session_id, seq)
    );
    CREATE INDEX IF NOT EXISTS idx_transcripts_project ON transcripts(project_id);
    CREATE INDEX IF NOT EXISTS idx_transcripts_pending ON transcripts(extracted, ts);
    DROP INDEX IF EXISTS idx_transcripts_extracted;
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      importance REAL DEFAULT 0.5,
      created_at INTEGER NOT NULL,
      last_accessed INTEGER DEFAULT 0,
      access_count INTEGER DEFAULT 0,
      source_tool TEXT,
      embedding TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id);
    CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS memory_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_memory_id INTEGER NOT NULL,
      to_memory_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      weight REAL DEFAULT 0.5,
      created_at INTEGER DEFAULT 0,
      UNIQUE(from_memory_id, to_memory_id)
    );
    CREATE INDEX IF NOT EXISTS idx_links_from ON memory_links(from_memory_id);
    CREATE INDEX IF NOT EXISTS idx_links_to ON memory_links(to_memory_id);
    CREATE TABLE IF NOT EXISTS memory_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      type TEXT NOT NULL,
      UNIQUE(memory_id, text)
    );
    CREATE INDEX IF NOT EXISTS idx_entities_text ON memory_entities(text);
    CREATE INDEX IF NOT EXISTS idx_entities_memory ON memory_entities(memory_id);
    CREATE TABLE IF NOT EXISTS memory_tags (
      memory_id INTEGER NOT NULL,
      tag TEXT NOT NULL,
      UNIQUE(memory_id, tag)
    );
    CREATE INDEX IF NOT EXISTS idx_tags_tag ON memory_tags(tag);
    CREATE INDEX IF NOT EXISTS idx_tags_memory ON memory_tags(memory_id);
  `);
  migrate(db);
  runMigrations(db);
  return db;
}

function migrate(d: DatabaseSync): void {
  const cols = (d.prepare("PRAGMA table_info(memories)").all() as Array<{ name: string }>).map((c) => c.name);
  if (!cols.includes("archived")) {
    d.exec("ALTER TABLE memories ADD COLUMN archived INTEGER DEFAULT 0");
  }
  if (!cols.includes("updated_at")) {
    d.exec("ALTER TABLE memories ADD COLUMN updated_at INTEGER DEFAULT 0");
  }
  if (!cols.includes("status")) {
    d.exec("ALTER TABLE memories ADD COLUMN status TEXT DEFAULT 'active'");
  }
  if (!cols.includes("resolved_at")) {
    d.exec("ALTER TABLE memories ADD COLUMN resolved_at INTEGER DEFAULT 0");
  }
  if (!cols.includes("origin")) {
    d.exec("ALTER TABLE memories ADD COLUMN origin TEXT DEFAULT 'llm'");
  }
  if (!cols.includes("embed_model")) {
    d.exec("ALTER TABLE memories ADD COLUMN embed_model TEXT DEFAULT ''");
  }
  // Backfill nama proyek lama yang masih berupa slug path panjang.
  const prows = d.prepare("SELECT id, path, slug, name FROM projects").all() as Array<{ id: number; path: string | null; slug: string; name: string }>;
  for (const r of prows) {
    const pretty = prettifyProjectName(r.path || r.slug || "");
    if (pretty && pretty !== r.name) {
      d.prepare("UPDATE projects SET name = ? WHERE id = ?").run(pretty, r.id);
    }
  }
}

/* ---------- Migrasi berversi (PRAGMA user_version) ----------
 * Dipicu F1C: FTS5 butuh virtual table + trigger + backfill sekali jalan,
 * kolom embedding pindah dari JSON TEXT ke Float32 BLOB. migrate() di atas
 * tetap dipertahankan untuk penambahan kolom inkremental. */
type Migration = { version: number; name: string; up: (d: DatabaseSync) => void };

const MIGRATIONS: Migration[] = [
  { version: 1, name: "fts5-keyword-index", up: m1Fts5 },
  { version: 2, name: "embedding-float32-blob", up: m2EmbeddingBlob },
  { version: 3, name: "sync-uid-outbox", up: m3Sync },
];

function runMigrations(d: DatabaseSync): void {
  const row = d.prepare("PRAGMA user_version").get() as { user_version: number | null };
  let v = Number(row.user_version) || 0;
  for (const m of MIGRATIONS) {
    if (m.version <= v) continue;
    d.exec("BEGIN");
    try {
      m.up(d);
      d.exec(`PRAGMA user_version = ${m.version}`);
      d.exec("COMMIT");
      v = m.version;
    } catch (err) {
      try {
        d.exec("ROLLBACK");
      } catch {
        /* transaksi mungkin sudah batal */
      }
      throw err;
    }
  }
}

/** M1: index FTS5 keyword + sync trigger + index (archived,status).
 * Index memories diletakkan di sini (bukan blok DDL utama) karena kolom
 * archived/status baru ada setelah migrate() pada DB lama. */
function m1Fts5(d: DatabaseSync): void {
  d.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(content, content='memories', content_rowid='id');
    CREATE TRIGGER IF NOT EXISTS memories_fts_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS memories_fts_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS memories_fts_au AFTER UPDATE OF content ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
      INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
    END;
    CREATE INDEX IF NOT EXISTS idx_memories_active ON memories(archived, status);
  `);
  // 'rebuild' mengisi FTS dari tabel content — backfill DB yang sudah berisi data.
  d.exec(`INSERT INTO memories_fts(memories_fts) VALUES('rebuild')`);
}

/** M2: kolom embedding JSON TEXT → Float32 BLOB (hemat ±50% + tanpa JSON.parse
 * per baris). typeof='text' membuat migrasi idempotent: baris BLOB di-skip. */
function m2EmbeddingBlob(d: DatabaseSync): void {
  const rows = d
    .prepare("SELECT id, embedding FROM memories WHERE embedding IS NOT NULL AND typeof(embedding) = 'text'")
    .all() as Array<{ id: number; embedding: string }>;
  const upd = d.prepare("UPDATE memories SET embedding = ? WHERE id = ?");
  for (const r of rows) {
    try {
      const arr = JSON.parse(r.embedding) as unknown;
      if (!Array.isArray(arr)) continue;
      upd.run(f32ToBlob(arr.map(Number)), r.id);
    } catch {
      continue; // vektor rusak: biarkan, jalur baca juga menoleransi ini
    }
  }
}

/** M3: identitas stabil + outbox sync. UID dipakai lintas mesin karena id
 * autoincrement lokal tidak mungkin sama. Snapshot awal di-enqueue sekali agar
 * peer baru bisa bootstrap tanpa membaca seluruh tabel dari sisi exporter. */
function m3Sync(d: DatabaseSync): void {
  const addColumn = (table: string, column: string, decl: string): void => {
    const cols = (d.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
    if (!cols.includes(column)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  };
  addColumn("projects", "uid", "TEXT");
  addColumn("projects", "updated_by", "TEXT DEFAULT ''");
  addColumn("memories", "uid", "TEXT");
  addColumn("memories", "updated_by", "TEXT DEFAULT ''");

  d.exec(`
    CREATE TABLE IF NOT EXISTS sync_devices (
      device_id TEXT PRIMARY KEY,
      name TEXT,
      created_at INTEGER NOT NULL,
      last_seen INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      op_id TEXT UNIQUE NOT NULL,
      seq INTEGER NOT NULL,
      hlc TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_uid TEXT NOT NULL,
      op TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sync_outbox_hlc ON sync_outbox(hlc);
    CREATE INDEX IF NOT EXISTS idx_sync_outbox_entity ON sync_outbox(entity, entity_uid);
    CREATE TABLE IF NOT EXISTS sync_applied (
      file_id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      applied_at INTEGER NOT NULL,
      op_count INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const deviceId = getDeviceId();
  const updProjectUid = d.prepare("UPDATE projects SET uid = ? WHERE id = ?");
  for (const row of d.prepare("SELECT id FROM projects WHERE uid IS NULL OR uid = ''").all() as Array<{ id: number }>) {
    updProjectUid.run(randomUUID(), row.id);
  }
  const updMemoryUid = d.prepare("UPDATE memories SET uid = ? WHERE id = ?");
  for (const row of d.prepare("SELECT id FROM memories WHERE uid IS NULL OR uid = ''").all() as Array<{ id: number }>) {
    updMemoryUid.run(randomUUID(), row.id);
  }
  d.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_uid ON projects(uid);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_uid ON memories(uid);
  `);

  d.prepare("UPDATE memories SET updated_at = created_at WHERE updated_at IS NULL OR updated_at = 0").run();
  d.prepare("UPDATE memories SET updated_by = ? WHERE updated_by IS NULL OR updated_by = ''").run(deviceId);
  d.prepare("UPDATE projects SET updated_by = ? WHERE updated_by IS NULL OR updated_by = ''").run(deviceId);
  d.prepare("INSERT OR IGNORE INTO sync_devices (device_id, name, created_at, last_seen) VALUES (?, ?, ?, ?)").run(
    deviceId,
    "local",
    Date.now(),
    Date.now()
  );

  for (const row of d.prepare("SELECT id FROM projects ORDER BY id").all() as Array<{ id: number }>) {
    enqueueProjectSnapshot(row.id);
  }
  for (const row of d.prepare("SELECT id FROM memories ORDER BY id").all() as Array<{ id: number }>) {
    enqueueMemorySnapshot(row.id);
  }
  for (const row of d.prepare("SELECT from_memory_id, to_memory_id, kind, weight FROM memory_links ORDER BY id").all() as Array<{
    from_memory_id: number;
    to_memory_id: number;
    kind: string;
    weight: number;
  }>) {
    enqueueLinkSnapshot(row.from_memory_id, row.to_memory_id, row.kind, row.weight);
  }
}

/* ---------- Codec embedding Float32 ----------
 * On-disk: BLOB raw bytes Float32 little-endian. In-memory: number[] biasa. */

export function f32ToBlob(v: number[]): Buffer {
  return Buffer.from(Float32Array.from(v).buffer);
}

export function decodeEmbedding(raw: unknown): number[] | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    // Sisa baris lama yang terlewat migrasi (JSON rusak dsb.) — toleran.
    try {
      const a = JSON.parse(raw) as unknown;
      return Array.isArray(a) ? a.map(Number) : null;
    } catch {
      return null;
    }
  }
  const buf = raw as Buffer;
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return Array.from(new Float32Array(ab));
}

export function getSetting(key: string, def: string = ""): string {
  const d = getDb();
  const row = d.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? row.value : def;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

export function getBoolSetting(key: string, def: boolean): boolean {
  const v = getSetting(key, "");
  if (v === "") return def;
  return v === "1" || v === "true";
}

export function setBoolSetting(key: string, value: boolean): void {
  setSetting(key, value ? "1" : "0");
}

export function effectiveStatus(): string {
  return getBoolSetting("reviewMode", false) ? "draft" : "active";
}

export function getDb(): DatabaseSync {
  if (!db) throw new Error("DB belum diinit. Panggil initDb() dulu.");
  return db;
}

export function closeDb(): void {
  if (db) {
    try {
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      db.close();
    } catch {
      /* ignore */
    }
    db = null;
  }
}

/* ---------- Sync primitives M1 (HLC + outbox) ----------
 * Outbox di level aplikasi (bukan trigger SQL) agar payload bisa memuat tag,
 * UID proyek, dan link tanpa query rekursif dari trigger. Semua kegagalan
 * pencatatan sync sengaja non-blokir: ingest tetap jalan walau outbox rusak. */

export type SyncEntity = "project" | "memory" | "link";
export type SyncOp = "upsert" | "delete";

let syncCaptureEnabled = true;

/** Dipakai jalur apply M2 agar replay dari peer tidak masuk outbox lagi. */
export function setSyncCaptureEnabled(enabled: boolean): void {
  syncCaptureEnabled = enabled;
}

function syncStateGet(key: string): string {
  const row = getDb().prepare("SELECT value FROM sync_state WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? "";
}

function syncStateSet(key: string, value: string): void {
  getDb()
    .prepare("INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

export function getDeviceId(): string {
  const d = getDb();
  const existing = syncStateGet("device_id");
  if (existing) return existing;
  const id = randomUUID();
  syncStateSet("device_id", id);
  d.prepare("INSERT OR IGNORE INTO sync_devices (device_id, name, created_at, last_seen) VALUES (?, ?, ?, ?)").run(
    id,
    "local",
    Date.now(),
    Date.now()
  );
  return id;
}

function nextSeq(): number {
  const next = Number(syncStateGet("seq") || 0) + 1;
  syncStateSet("seq", String(next));
  return next;
}

/** HLC zero-padded agar perbandingan string konsisten lintas device. */
export function nextHlc(deviceId = getDeviceId()): string {
  const prev = syncStateGet("clock");
  const [prevWallRaw, prevCounterRaw] = prev.split(".");
  const prevWall = Number(prevWallRaw) || 0;
  const prevCounter = Number(prevCounterRaw) || 0;
  const now = Date.now();
  const wall = now > prevWall ? now : prevWall;
  const counter = now > prevWall ? 0 : prevCounter + 1;
  const hlc = `${String(wall).padStart(13, "0")}.${String(counter).padStart(6, "0")}.${deviceId}`;
  syncStateSet("clock", hlc);
  return hlc;
}

export function compareHlc(a: string, b: string): number {
  const [aw, ac, ...ad] = String(a || "").split(".");
  const [bw, bc, ...bd] = String(b || "").split(".");
  const wallA = Number(aw) || 0;
  const wallB = Number(bw) || 0;
  if (wallA !== wallB) return wallA < wallB ? -1 : 1;
  const counterA = Number(ac) || 0;
  const counterB = Number(bc) || 0;
  if (counterA !== counterB) return counterA < counterB ? -1 : 1;
  const devA = ad.join(".");
  const devB = bd.join(".");
  if (devA === devB) return 0;
  return devA < devB ? -1 : 1;
}

export function hlcNewer(a: string, b: string): boolean {
  return compareHlc(a, b) > 0;
}

/** Catat jam peer agar HLC lokal berikutnya selalu menang atas operasi yang baru dilihat. */
export function observeHlc(remote: string): void {
  if (!remote) return;
  const local = syncStateGet("clock");
  if (!local || hlcNewer(remote, local)) syncStateSet("clock", remote);
}

export function queueSyncOp(entity: SyncEntity, entityUid: string, op: SyncOp, payload: unknown): void {
  if (!syncCaptureEnabled || !entityUid) return;
  try {
    const d = getDb();
    const deviceId = getDeviceId();
    const seq = nextSeq();
    const hlc = nextHlc(deviceId);
    d.prepare(
      `INSERT INTO sync_outbox (op_id, seq, hlc, entity, entity_uid, op, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(`${deviceId}:${seq}`, seq, hlc, entity, entityUid, op, JSON.stringify(payload ?? {}), Date.now());
  } catch (err) {
    console.warn("[memoria] sync outbox:", err instanceof Error ? err.message : err);
  }
}

function enqueueProjectSnapshot(id: number): void {
  try {
    const row = getDb()
      .prepare("SELECT uid, slug, name, last_seen, updated_by FROM projects WHERE id = ?")
      .get(id) as
      | {
          uid: string | null;
          slug: string;
          name: string | null;
          last_seen: number | null;
          updated_by: string | null;
        }
      | undefined;
    if (!row?.uid) return;
    queueSyncOp("project", row.uid, "upsert", {
      slug: row.slug,
      name: row.name || row.slug,
      lastSeen: row.last_seen || 0,
      updatedBy: row.updated_by || "",
    });
  } catch {
    /* non-blokir */
  }
}

function enqueueMemorySnapshot(id: number): void {
  try {
    const row = getDb()
      .prepare(
        `SELECT m.uid, m.kind, m.content, m.importance, m.created_at, m.updated_at, m.updated_by, m.source_tool,
                m.status, m.resolved_at, m.origin, m.archived, p.uid AS project_uid
         FROM memories m LEFT JOIN projects p ON p.id = m.project_id WHERE m.id = ?`
      )
      .get(id) as
      | {
          uid: string | null;
          kind: string;
          content: string;
          importance: number;
          created_at: number;
          updated_at: number | null;
          updated_by: string | null;
          source_tool: string | null;
          status: string | null;
          resolved_at: number | null;
          origin: string | null;
          archived: number | null;
          project_uid: string | null;
        }
      | undefined;
    if (!row?.uid) return;
    queueSyncOp("memory", row.uid, "upsert", {
      projectUid: row.project_uid || null,
      kind: row.kind,
      content: row.content,
      importance: row.importance,
      createdAt: row.created_at,
      updatedAt: row.updated_at || 0,
      updatedBy: row.updated_by || "",
      sourceTool: row.source_tool || "",
      status: row.status || "active",
      resolvedAt: row.resolved_at || 0,
      origin: row.origin || "user",
      archived: row.archived ? 1 : 0,
      tags: tagsForMemory(id),
    });
  } catch {
    /* non-blokir */
  }
}

function enqueueLinkSnapshot(fromId: number, toId: number, kind: string, weight: number): void {
  try {
    const row = getDb()
      .prepare(
        `SELECT a.uid AS from_uid, b.uid AS to_uid
         FROM memories a JOIN memories b ON b.id = ? WHERE a.id = ?`
      )
      .get(toId, fromId) as { from_uid: string | null; to_uid: string | null } | undefined;
    if (!row?.from_uid || !row.to_uid) return;
    queueSyncOp("link", `${row.from_uid}|${row.to_uid}`, "upsert", {
      fromUid: row.from_uid,
      toUid: row.to_uid,
      kind,
      weight,
    });
  } catch {
    /* non-blokir */
  }
}

function enqueueMemoryDelete(uid: string): void {
  queueSyncOp("memory", uid, "delete", {});
}


/** Nama tampilan proyek dari path/slug: ambil segmen terakhir, rapikan jadi judul. */
export function prettifyProjectName(src: string): string {
  const base = src.split(/[\\/]/).filter(Boolean).pop() || src;
  const pretty = base.replace(/^[-_]+/, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return pretty || base;
}

// Memo resolve (slug+path) -> projectId: hindari syscall realpath berulang
// saat scan memproses ribuan pesan dengan cwd yang sama.
const ensureProjectMemo = new Map<string, number>();

export function resetProjectMemo(): void {
  ensureProjectMemo.clear();
}

/**
 * Resolve input proyek (bisa path, slug, atau nama) ke record proyek.
 * Urutan: slug persis -> slug hasil slugify path -> path kanonik -> LIKE nama/slug.
 * Dipakai MCP dan HTTP agar input agent/user yang formatnya beda dikit tetap
 * menemu-kan proyek yang benar, bukan "Belum ada memori".
 */
export function resolveProject(input: string): { id: number; slug: string } | null {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const db = getDb();

  for (const cand of [raw.toLowerCase(), projectSlugFromCwd(raw)]) {
    const bySlug = db.prepare("SELECT id, slug FROM projects WHERE slug = ?").get(cand) as
      | { id: number; slug: string }
      | undefined;
    if (bySlug) return bySlug;
  }

  const canon = canonicalPath(raw);
  if (canon) {
    const rows = db.prepare("SELECT id, slug, path FROM projects WHERE path IS NOT NULL AND path != ''").all() as
      Array<{ id: number; slug: string; path: string }>;
    for (const r of rows) {
      if (canonicalPath(r.path) === canon) return { id: r.id, slug: r.slug };
    }
  }

  const like = `%${raw.toLowerCase()}%`;
  const byLike = db
    .prepare("SELECT id, slug FROM projects WHERE lower(name) LIKE ? OR lower(slug) LIKE ? ORDER BY last_seen DESC LIMIT 1")
    .get(like, like) as { id: number; slug: string } | undefined;
  return byLike ?? null;
}

export function ensureProject(slug: string, projectPath?: string): number {
  const d = getDb();
  const clean = slug || "_unknown";
  const memoKey = `${clean}\u0000${projectPath || ""}`;
  const memo = ensureProjectMemo.get(memoKey);
  if (memo) return memo;

  const canon = canonicalPath(projectPath);
  const finish = (id: number): number => {
    if (ensureProjectMemo.size > 1000) ensureProjectMemo.clear();
    ensureProjectMemo.set(memoKey, id);
    return id;
  };

  // 1) Cocokkan by slug (jalur lama — kompatibel dengan DB yang sudah ada).
  const existing = d.prepare("SELECT id FROM projects WHERE slug = ?").get(clean) as
    | { id: number }
    | undefined;
  if (existing) {
    if (canon) {
      // Backfill path bila proyek lama belum punya — jadi bisa dicocokkan lintas tool.
      d.prepare("UPDATE projects SET last_seen = ?, path = COALESCE(NULLIF(path, ''), ?) WHERE id = ?").run(Date.now(), canon, existing.id);
    } else {
      d.prepare("UPDATE projects SET last_seen = ? WHERE id = ?").run(Date.now(), existing.id);
    }
    return finish(existing.id);
  }

  // 2) Cocokkan by path kanonik: proyek fisik yang sama yang dilaporkan tool
  //    berbeda dengan format slug berbeda tetap menjadi SATU proyek.
  if (canon) {
    const rows = d
      .prepare("SELECT id, path FROM projects WHERE path IS NOT NULL AND path != ''")
      .all() as Array<{ id: number; path: string }>;
    for (const r of rows) {
      if (canonicalPath(r.path) === canon) {
        d.prepare("UPDATE projects SET last_seen = ? WHERE id = ?").run(Date.now(), r.id);
        return finish(r.id);
      }
    }
  }

  // 3) Buat proyek baru. Nama tampilan = nama folder (bukan slug path penuh
  //    yang panjang seperti "users-mac-documents-workspace-...").
  const name = prettifyProjectName(canon || projectPath || clean);
  const res = d
    .prepare("INSERT INTO projects (slug, path, name, last_seen, uid, updated_by) VALUES (?, ?, ?, ?, ?, ?)")
    .run(clean, canon || projectPath || null, name || clean, Date.now(), randomUUID(), getDeviceId());
  const id = Number(res.lastInsertRowid);
  enqueueProjectSnapshot(id);
  return finish(id);
}

export function insertTranscript(t: Transcript): boolean {
  const d = getDb();
  try {
    d.prepare(
      "INSERT OR IGNORE INTO transcripts (tool, session_id, project_id, role, content, ts, seq) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(t.tool, t.sessionId, t.projectId, t.role, t.content, t.ts, t.seq);
    return true;
  } catch {
    return false;
  }
}

export function getSourceOffset(tool: string, file: string): number {
  const d = getDb();
  const row = d
    .prepare("SELECT offset, mtime FROM sources WHERE tool = ? AND file = ?")
    .get(tool, file) as { offset: number; mtime: number } | undefined;
  return row ? row.offset : 0;
}

export function setSourceOffset(tool: string, file: string, offset: number, mtime: number): void {
  const d = getDb();
  d.prepare(
    "INSERT INTO sources (tool, path, file, offset, mtime) VALUES (?, ?, ?, ?, ?) ON CONFLICT(tool, file) DO UPDATE SET offset = excluded.offset, mtime = excluded.mtime"
  ).run(tool, path.dirname(file), file, offset, mtime);
}

export function getPendingExtraction(limit = 30, order: "asc" | "desc" = "asc"): Transcript[] {
  const d = getDb();
  const rows = d
    .prepare(
      `SELECT id, tool, session_id AS sessionId, project_id AS projectId, role, content, ts, seq
       FROM transcripts WHERE extracted = 0 AND content != '' ORDER BY ts ${order === "desc" ? "DESC" : "ASC"} LIMIT ?`
    )
    .all(limit) as unknown as Transcript[];
  return rows;
}

export function markExtracted(id: number): void {
  getDb().prepare("UPDATE transcripts SET extracted = 1 WHERE id = ?").run(id);
}

export function countTranscripts(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS c FROM transcripts").get() as { c: number };
  return row.c;
}

export function countMemories(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS c FROM memories WHERE archived = 0 AND status = 'active'").get() as { c: number };
  return row.c;
}

export function insertMemory(m: Memory): void {
  const d = getDb();
  const uid = m.uid || randomUUID();
  const now = Date.now();
  d.prepare(
    `INSERT INTO memories (project_id, kind, content, importance, created_at, source_tool, embedding, status, origin, embed_model, uid, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    m.projectId,
    m.kind,
    m.content,
    m.importance,
    m.createdAt,
    m.sourceTool,
    m.embedding ? f32ToBlob(m.embedding) : null,
    m.status || "active",
    m.origin || "user",
    m.embedModel || "",
    uid,
    m.updatedAt || now,
    m.updatedBy || getDeviceId()
  );
  // node:sqlite mengembalikan objek ber-prototype null — ambil properti .id-nya.
  // Number(row) di atas objek null-prototype melempar "Cannot convert object to
  // primitive value" (bug lama: memori tersimpan tapi API membalas 500).
  const idRow = d.prepare("SELECT last_insert_rowid() AS id").get() as { id: number };
  const id = Number(idRow.id);
  try {
    reindexEntities(id, m.content);
  } catch {
    /* non-blokir */
  }
  enqueueMemorySnapshot(id);
}

export function reindexEntities(memoryId: number, content: string): void {
  const d = getDb();
  d.prepare("DELETE FROM memory_entities WHERE memory_id = ?").run(memoryId);
  const stmt = d.prepare("INSERT OR IGNORE INTO memory_entities (memory_id, text, type) VALUES (?, ?, ?)");
  for (const e of extractEntities(content)) {
    stmt.run(memoryId, e.text, e.type);
  }
}

export function entitiesForMemory(memoryId: number): Array<{ text: string; type: string }> {
  const rows = getDb()
    .prepare("SELECT text, type FROM memory_entities WHERE memory_id = ? ORDER BY id")
    .all(memoryId) as Array<{ text: string; type: string }>;
  return rows;
}

export function setMemoryTag(memoryId: number, tag: string): void {
  const d = getDb();
  const res = d.prepare("INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)").run(memoryId, tag);
  if (res.changes > 0) {
    d.prepare("UPDATE memories SET updated_at = ?, updated_by = ? WHERE id = ?").run(Date.now(), getDeviceId(), memoryId);
    enqueueMemorySnapshot(memoryId);
  }
}

export function clearMemoryTags(memoryId?: number): void {
  const d = getDb();
  if (memoryId) {
    const res = d.prepare("DELETE FROM memory_tags WHERE memory_id = ?").run(memoryId);
    if (res.changes > 0) {
      d.prepare("UPDATE memories SET updated_at = ?, updated_by = ? WHERE id = ?").run(Date.now(), getDeviceId(), memoryId);
      enqueueMemorySnapshot(memoryId);
    }
    return;
  }
  const ids = d.prepare("SELECT DISTINCT memory_id AS id FROM memory_tags").all() as Array<{ id: number }>;
  d.prepare("DELETE FROM memory_tags").run();
  for (const row of ids) {
    d.prepare("UPDATE memories SET updated_at = ?, updated_by = ? WHERE id = ?").run(Date.now(), getDeviceId(), row.id);
    enqueueMemorySnapshot(row.id);
  }
}

/** Ganti seluruh tag sebuah memori (untuk kurasi manual). */
export function replaceMemoryTags(memoryId: number, tags: string[]): void {
  const d = getDb();
  d.prepare("DELETE FROM memory_tags WHERE memory_id = ?").run(memoryId);
  const stmt = d.prepare("INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)");
  for (const t of tags.map((t) => t.trim().toLowerCase()).filter(Boolean)) stmt.run(memoryId, t);
  const res = d
    .prepare("UPDATE memories SET updated_at = ?, updated_by = ? WHERE id = ?")
    .run(Date.now(), getDeviceId(), memoryId);
  if (res.changes > 0) enqueueMemorySnapshot(memoryId);
}

export function tagsForMemory(memoryId: number): string[] {
  const rows = getDb()
    .prepare("SELECT tag FROM memory_tags WHERE memory_id = ?")
    .all(memoryId) as Array<{ tag: string }>;
  return rows.map((r) => r.tag);
}

export function allTags(minCount = 2): Array<{ tag: string; count: number }> {
  const rows = getDb()
    .prepare(
      `SELECT t.tag, COUNT(*) AS count FROM memory_tags t
       JOIN memories m ON m.id = t.memory_id
       WHERE m.archived = 0 AND m.status = 'active'
       GROUP BY t.tag HAVING COUNT(*) >= ? ORDER BY count DESC, tag ASC LIMIT 60`
    )
    .all(minCount) as Array<{ tag: string; count: number }>;
  return rows;
}

export function memoriesByTag(tag: string): number[] {
  const rows = getDb()
    .prepare(
      `SELECT t.memory_id AS id FROM memory_tags t
       JOIN memories m ON m.id = t.memory_id
       WHERE t.tag = ? AND m.archived = 0 AND m.status = 'active'
       ORDER BY m.created_at DESC`
    )
    .all(tag) as Array<{ id: number }>;
  return rows.map((r) => r.id);
}

export function listDraft(): Memory[] {
  return readMemories("WHERE archived = 0 AND status = 'draft' ORDER BY created_at DESC", []);
}

export function approveMemory(id: number): boolean {
  const res = getDb()
    .prepare("UPDATE memories SET status = 'active', updated_at = ?, updated_by = ? WHERE id = ?")
    .run(Date.now(), getDeviceId(), id);
  if (res.changes > 0) enqueueMemorySnapshot(id);
  return res.changes > 0;
}

/** Daftar task per proyek: terbuka (belum resolved) & selesai. */
export function listTasks(projectId: number | null, limit = 300): { open: Memory[]; done: Memory[] } {
  const cond = projectId != null ? "AND project_id = ?" : "";
  const params = projectId != null ? [projectId, limit] : [limit];
  const open = readMemories(
    `WHERE kind = 'task_pending' AND archived = 0 AND status = 'active' AND COALESCE(resolved_at, 0) = 0 ${cond} ORDER BY created_at DESC LIMIT ?`,
    params
  );
  const done = readMemories(
    `WHERE kind = 'task_pending' AND archived = 0 AND status = 'active' AND COALESCE(resolved_at, 0) > 0 ${cond} ORDER BY resolved_at DESC LIMIT ?`,
    params
  );
  return { open, done };
}

/** Toggle resolved manual dari dashboard Tasks. */
export function setTaskResolved(id: number, resolved: boolean): boolean {
  const res = getDb()
    .prepare("UPDATE memories SET resolved_at = ?, updated_at = ?, updated_by = ? WHERE id = ?")
    .run(resolved ? Date.now() : 0, Date.now(), getDeviceId(), id);
  if (res.changes > 0) enqueueMemorySnapshot(id);
  return res.changes > 0;
}

export function markResolved(id: number): boolean {
  const res = getDb()
    .prepare("UPDATE memories SET resolved_at = ?, updated_at = ?, updated_by = ? WHERE id = ?")
    .run(Date.now(), Date.now(), getDeviceId(), id);
  if (res.changes > 0) enqueueMemorySnapshot(id);
  return res.changes > 0;
}

export function countDraft(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS c FROM memories WHERE archived = 0 AND status = 'draft'").get() as { c: number };
  return row.c;
}

export function countArchived(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS c FROM memories WHERE archived = 1").get() as { c: number };
  return row.c;
}

export function updateMemory(
  id: number,
  patch: { content?: string; kind?: string; importance?: number; projectId?: number | null }
): boolean {
  const d = getDb();
  const current = d.prepare("SELECT * FROM memories WHERE id = ?").get(id) as
    | { content: string; kind: string; importance: number; project_id: number | null; embedding: string | null }
    | undefined;
  if (!current) return false;
  const content = patch.content ?? current.content;
  const kind = patch.kind ?? current.kind;
  const importance = patch.importance ?? current.importance;
  const projectId = patch.projectId !== undefined ? patch.projectId : current.project_id;
  d.prepare(
    `UPDATE memories SET content = ?, kind = ?, importance = ?, project_id = ?, updated_at = ?, updated_by = ? WHERE id = ?`
  ).run(content, kind, importance, projectId, Date.now(), getDeviceId(), id);
  try {
    reindexEntities(id, content);
  } catch {
    /* non-blokir */
  }
  enqueueMemorySnapshot(id);
  return true;
}

export function archiveMemory(id: number, archived = true): boolean {
  const res = getDb()
    .prepare("UPDATE memories SET archived = ?, updated_at = ?, updated_by = ? WHERE id = ?")
    .run(archived ? 1 : 0, Date.now(), getDeviceId(), id);
  if (res.changes > 0) enqueueMemorySnapshot(id);
  return res.changes > 0;
}

export function listArchived(): Memory[] {
  return readMemories("WHERE archived = 1 ORDER BY created_at DESC", []);
}

export function archiveStaleEligibles(): number {
  const d = getDb();
  const rows = d
    .prepare(
      `SELECT id, importance, created_at, access_count, last_accessed FROM memories
       WHERE archived = 0 ORDER BY created_at LIMIT 5000`
    )
    .all() as Array<{ id: number; importance: number; created_at: number; access_count: number; last_accessed: number }>;
  let archived = 0;
  const now = Date.now();
  for (const r of rows) {
    const ageDays = (now - r.created_at) / 86400000;
    const recency = Math.exp(-ageDays / 30);
    const touched = r.access_count > 0 || r.last_accessed > 0;
    const score = r.importance * recency * (touched ? 1 : 0.5);
    if (ageDays > 60 && score < 0.18) {
      archiveMemory(r.id, true);
      archived++;
    }
  }
  return archived;
}

export function allMemories(): Memory[] {
  return readMemories("WHERE archived = 0 AND status = 'active' ORDER BY created_at DESC", []);
}

/** Halaman pustaka langsung di SQL — jangan materialisasi seluruh tabel (F1C sisa). */
export function listMemoriesPage(status: string, limit: number, offset: number): { memories: Memory[]; total: number } {
  if (status === "draft") {
    return {
      memories: readMemories("WHERE archived = 0 AND status = 'draft' ORDER BY created_at DESC LIMIT ? OFFSET ?", [limit, offset]),
      total: countDraft(),
    };
  }
  if (status === "archived") {
    return {
      memories: readMemories("WHERE archived = 1 ORDER BY created_at DESC LIMIT ? OFFSET ?", [limit, offset]),
      total: countArchived(),
    };
  }
  return {
    memories: readMemories("WHERE archived = 0 AND status = 'active' ORDER BY created_at DESC LIMIT ? OFFSET ?", [limit, offset]),
    total: countMemories(),
  };
}

export function memoryById(id: number): Memory | null {
  const rows = readMemories("WHERE id = ?", [id]);
  return rows[0] ?? null;
}

export function readMemories(whereClause: string, params: Array<number | string | null>): Memory[] {
  const rows = getDb()
    .prepare(`SELECT * FROM memories ${whereClause}`)
    .all(...params) as unknown as Array<{
    id: number;
    uid: string | null;
    project_id: number | null;
    kind: string;
    content: string;
    importance: number;
    created_at: number;
    last_accessed: number;
    access_count: number;
    source_tool: string;
    embedding: Buffer | string | null;
    status: string | null;
    resolved_at: number;
    origin: string | null;
    embed_model: string | null;
    updated_at: number | null;
    updated_by: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    uid: r.uid || "",
    projectId: r.project_id,
    kind: r.kind,
    content: r.content,
    importance: r.importance,
    createdAt: r.created_at,
    lastAccessed: r.last_accessed,
    accessCount: r.access_count,
    sourceTool: r.source_tool,
    embedding: decodeEmbedding(r.embedding),
    status: r.status || "active",
    resolvedAt: r.resolved_at || 0,
    origin: r.origin || "user",
    embedModel: r.embed_model || "",
    updatedAt: r.updated_at || 0,
    updatedBy: r.updated_by || "",
  }));
}

export function projectSlugById(id: number | null): string | null {
  if (id == null) return null;
  const row = getDb().prepare("SELECT slug FROM projects WHERE id = ?").get(id) as
    | { slug: string }
    | undefined;
  return row ? row.slug : null;
}

export function projectRecord(slug: string): { id: number; slug: string; path: string | null; name: string } | null {
  const row = getDb().prepare("SELECT id, slug, path, name FROM projects WHERE slug = ?").get(slug) as
    | { id: number; slug: string; path: string | null; name: string | null }
    | undefined;
  if (!row) return null;
  return { id: row.id, slug: row.slug, path: row.path, name: row.name || row.slug };
}

export function recentProjects(limit = 20): Array<{ slug: string; name: string; last_seen: number; transcripts: number }> {
  const rows = getDb()
    .prepare(
      `SELECT p.slug, p.name, p.last_seen,
              (SELECT COUNT(*) FROM transcripts t WHERE t.project_id = p.id) AS transcripts
       FROM projects p ORDER BY p.last_seen DESC LIMIT ?`
    )
    .all(limit) as Array<{ slug: string; name: string; last_seen: number; transcripts: number }>;
  return rows;
}

export function perToolCounts(): Array<{ tool: string; count: number }> {
  const rows = getDb()
    .prepare("SELECT tool, COUNT(*) AS count FROM transcripts GROUP BY tool ORDER BY count DESC")
    .all() as Array<{ tool: string; count: number }>;
  return rows;
}

export function pendingExtractionCount(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS c FROM transcripts WHERE extracted = 0").get() as { c: number };
  return row.c;
}

export function deleteMemory(id: number): boolean {
  const d = getDb();
  const row = d.prepare("SELECT uid FROM memories WHERE id = ?").get(id) as { uid: string | null } | undefined;
  const links = d
    .prepare(
      `SELECT a.uid AS from_uid, b.uid AS to_uid
       FROM memory_links l
       JOIN memories a ON a.id = l.from_memory_id
       JOIN memories b ON b.id = l.to_memory_id
       WHERE l.from_memory_id = ? OR l.to_memory_id = ?`
    )
    .all(id, id) as Array<{ from_uid: string | null; to_uid: string | null }>;
  const res = d.prepare("DELETE FROM memories WHERE id = ?").run(id);
  if (res.changes > 0) {
    d.prepare("DELETE FROM memory_links WHERE from_memory_id = ? OR to_memory_id = ?").run(id, id);
    for (const link of links) {
      if (link.from_uid && link.to_uid) queueSyncOp("link", `${link.from_uid}|${link.to_uid}`, "delete", {});
    }
    if (row?.uid) enqueueMemoryDelete(row.uid);
  }
  return res.changes > 0;
}

export function countProjectTranscripts(projectId: number): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS c FROM transcripts WHERE project_id = ?")
    .get(projectId) as { c: number };
  return row.c;
}

export function insertMemoryLink(fromId: number, toId: number, kind: string, weight: number): void {
  const a = Math.min(fromId, toId);
  const b = Math.max(fromId, toId);
  getDb()
    .prepare(
      "INSERT INTO memory_links (from_memory_id, to_memory_id, kind, weight, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(from_memory_id, to_memory_id) DO UPDATE SET weight = MAX(memory_links.weight, excluded.weight)"
    )
    .run(a, b, kind, weight, Date.now());
  enqueueLinkSnapshot(a, b, kind, weight);
}

export function linksForMemory(id: number, limit = 12): Array<{ memoryId: number; kind: string; weight: number }> {
  const rows = getDb()
    .prepare(
      `SELECT from_memory_id, to_memory_id, kind, weight FROM memory_links
       WHERE from_memory_id = ? OR to_memory_id = ?
       ORDER BY weight DESC LIMIT ?`
    )
    .all(id, id, limit) as Array<{ from_memory_id: number; to_memory_id: number; kind: string; weight: number }>;
  return rows.map((r) => ({
    memoryId: r.from_memory_id === id ? r.to_memory_id : r.from_memory_id,
    kind: r.kind,
    weight: r.weight,
  }));
}

export function allMemoryLinks(limit = 800): Array<{ fromId: number; toId: number; kind: string; weight: number }> {
  const rows = getDb()
    .prepare(`SELECT from_memory_id, to_memory_id, kind, weight FROM memory_links ORDER BY weight DESC LIMIT ?`)
    .all(limit) as Array<{ from_memory_id: number; to_memory_id: number; kind: string; weight: number }>;
  return rows.map((r) => ({ fromId: r.from_memory_id, toId: r.to_memory_id, kind: r.kind, weight: r.weight }));
}

export function clearMemoryLinks(): void {
  const d = getDb();
  const rows = d
    .prepare(
      `SELECT l.from_memory_id AS from_id, l.to_memory_id AS to_id, a.uid AS from_uid, b.uid AS to_uid
       FROM memory_links l
       JOIN memories a ON a.id = l.from_memory_id
       JOIN memories b ON b.id = l.to_memory_id`
    )
    .all() as Array<{ from_id: number; to_id: number; from_uid: string | null; to_uid: string | null }>;
  d.prepare("DELETE FROM memory_links").run();
  for (const row of rows) {
    if (row.from_uid && row.to_uid) queueSyncOp("link", `${row.from_uid}|${row.to_uid}`, "delete", {});
  }
}
