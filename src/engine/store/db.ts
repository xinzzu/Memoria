import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { extractEntities } from "../extract/entities";
import { canonicalPath } from "../ingest/util";

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
    CREATE INDEX IF NOT EXISTS idx_transcripts_extracted ON transcripts(extracted);
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

// Memo resolve (slug+path) -> projectId: hindari syscall realpath berulang
// saat scan memproses ribuan pesan dengan cwd yang sama.
const ensureProjectMemo = new Map<string, number>();

export function resetProjectMemo(): void {
  ensureProjectMemo.clear();
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

  // 3) Buat proyek baru.
  const name = clean
    .replace(/^[-a-z]+--/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
  const res = d
    .prepare("INSERT INTO projects (slug, path, name, last_seen) VALUES (?, ?, ?, ?)")
    .run(clean, canon || projectPath || null, name || clean, Date.now());
  return finish(Number(res.lastInsertRowid));
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
  d.prepare(
    `INSERT INTO memories (project_id, kind, content, importance, created_at, source_tool, embedding, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    m.projectId,
    m.kind,
    m.content,
    m.importance,
    m.createdAt,
    m.sourceTool,
    m.embedding ? JSON.stringify(m.embedding) : null,
    m.status || "active"
  );
  const id = Number(d.prepare("SELECT last_insert_rowid() AS id").get() as { id: number });
  try {
    reindexEntities(id, m.content);
  } catch {
    /* non-blokir */
  }
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
  getDb()
    .prepare("INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)")
    .run(memoryId, tag);
}

export function clearMemoryTags(memoryId?: number): void {
  if (memoryId) {
    getDb().prepare("DELETE FROM memory_tags WHERE memory_id = ?").run(memoryId);
  } else {
    getDb().prepare("DELETE FROM memory_tags").run();
  }
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
    .prepare("UPDATE memories SET status = 'active', updated_at = ? WHERE id = ?")
    .run(Date.now(), id);
  return res.changes > 0;
}

export function markResolved(id: number): boolean {
  const res = getDb()
    .prepare("UPDATE memories SET resolved_at = ?, updated_at = ? WHERE id = ?")
    .run(Date.now(), Date.now(), id);
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
    `UPDATE memories SET content = ?, kind = ?, importance = ?, project_id = ?, updated_at = ? WHERE id = ?`
  ).run(content, kind, importance, projectId, Date.now(), id);
  try {
    reindexEntities(id, content);
  } catch {
    /* non-blokir */
  }
  return true;
}

export function archiveMemory(id: number, archived = true): boolean {
  const res = getDb().prepare("UPDATE memories SET archived = ? WHERE id = ?").run(archived ? 1 : 0, id);
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

export function memoryById(id: number): Memory | null {
  const rows = readMemories("WHERE id = ?", [id]);
  return rows[0] ?? null;
}

function readMemories(whereClause: string, params: Array<number | string | null>): Memory[] {
  const rows = getDb()
    .prepare(`SELECT * FROM memories ${whereClause}`)
    .all(...params) as unknown as Array<{
    id: number;
    project_id: number | null;
    kind: string;
    content: string;
    importance: number;
    created_at: number;
    last_accessed: number;
    access_count: number;
    source_tool: string;
    embedding: string | null;
    status: string | null;
    resolved_at: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    kind: r.kind,
    content: r.content,
    importance: r.importance,
    createdAt: r.created_at,
    lastAccessed: r.last_accessed,
    accessCount: r.access_count,
    sourceTool: r.source_tool,
    embedding: r.embedding ? JSON.parse(r.embedding) : null,
    status: r.status || "active",
    resolvedAt: r.resolved_at || 0,
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
  const res = getDb().prepare("DELETE FROM memories WHERE id = ?").run(id);
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
  getDb().prepare("DELETE FROM memory_links").run();
}
