/* Test M1 sync: backfill UID, outbox capture, HLC. File terpisah karena
 * initDb() memakai singleton; jalankan terhadap dist/ hasil build. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
const require = createRequire(import.meta.url);

const dbmod = require("../dist/engine/store/db.js");

function freshDb() {
  dbmod.closeDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-sync-"));
  return { dir, d: dbmod.initDb(dir) };
}

function outbox(d, entity) {
  const rows = entity
    ? d.prepare("SELECT * FROM sync_outbox WHERE entity = ? ORDER BY id").all(entity)
    : d.prepare("SELECT * FROM sync_outbox ORDER BY id").all();
  return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
}

test("migrasi v2 -> v3: uid backfill + snapshot project/memory/link", () => {
  dbmod.closeDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-sync-old-"));
  const old = new DatabaseSync(path.join(dir, "memory.db"));
  old.exec(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      path TEXT,
      name TEXT NOT NULL,
      last_seen INTEGER NOT NULL
    );
    CREATE TABLE memories (
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
    CREATE TABLE memory_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_memory_id INTEGER NOT NULL,
      to_memory_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      weight REAL DEFAULT 0.5,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE memory_tags (
      memory_id INTEGER NOT NULL,
      tag TEXT NOT NULL,
      UNIQUE(memory_id, tag)
    );
  `);
  const now = Date.now() - 1000;
  old.prepare("INSERT INTO projects (slug, path, name, last_seen) VALUES (?, ?, ?, ?)").run(
    "legacyproj",
    "/tmp/legacyproj",
    "Legacy",
    now
  );
  old.prepare(
    "INSERT INTO memories (project_id, kind, content, importance, created_at, source_tool) VALUES (1, 'fact', ?, 0.5, ?, 'test')"
  ).run("memori legacy satu", now);
  old.prepare(
    "INSERT INTO memories (project_id, kind, content, importance, created_at, source_tool) VALUES (1, 'fact', ?, 0.5, ?, 'test')"
  ).run("memori legacy dua", now + 1);
  old.prepare("INSERT INTO memory_links (from_memory_id, to_memory_id, kind, weight, created_at) VALUES (1, 2, 'related', 0.9, ?)").run(
    now + 2
  );
  old.prepare("INSERT INTO memory_tags (memory_id, tag) VALUES (1, 'legacy')").run();
  old.exec("PRAGMA user_version = 2");
  old.close();

  const d = dbmod.initDb(dir);
  assert.equal(Number(d.prepare("PRAGMA user_version").get().user_version), 3);

  const projects = d.prepare("SELECT id, uid FROM projects").all();
  assert.equal(projects.length, 1);
  assert.ok(projects[0].uid, "project lama harus dapat uid");
  const memories = d.prepare("SELECT id, uid, updated_at FROM memories ORDER BY id").all();
  assert.equal(memories.length, 2);
  assert.equal(new Set(memories.map((m) => m.uid)).size, 2, "uid memori harus unik");
  assert.ok(memories.every((m) => m.updated_at > 0 && m.uid), "updated_at lama harus di-backfill");

  const ops = outbox(d);
  const projectOps = ops.filter((o) => o.entity === "project");
  const memoryOps = ops.filter((o) => o.entity === "memory");
  const linkOps = ops.filter((o) => o.entity === "link");
  assert.equal(projectOps.length, 1);
  assert.equal(memoryOps.length, 2);
  assert.equal(linkOps.length, 1);
  assert.equal(projectOps[0].payload.slug, "legacyproj");
  assert.ok(projectOps[0].payload.updatedBy, "snapshot harus membawa updated_by");
  assert.equal(memoryOps[0].payload.projectUid, projectOps[0].entity_uid);
  assert.ok(memoryOps[0].payload.updatedBy, "snapshot memori harus membawa updated_by");
  assert.deepEqual(memoryOps[0].payload.tags, ["legacy"]);
  assert.equal(linkOps[0].payload.fromUid, memories[0].uid);
  assert.equal(linkOps[0].payload.toUid, memories[1].uid);
  assert.equal(linkOps[0].payload.kind, "related");

  const before = Number(d.prepare("SELECT COUNT(*) AS c FROM sync_outbox").get().c);
  dbmod.closeDb();
  const d2 = dbmod.initDb(dir);
  assert.equal(Number(d2.prepare("PRAGMA user_version").get().user_version), 3);
  assert.equal(Number(d2.prepare("SELECT COUNT(*) AS c FROM sync_outbox").get().c), before, "migrasi ulang tidak boleh duplikat");
});

test("mutasi DB menghasilkan outbox upsert/delete + HLC monotonic", () => {
  const { d } = freshDb();
  const pid = dbmod.ensureProject("sync-demo", "/tmp/sync-demo");
  const project = d.prepare("SELECT uid FROM projects WHERE id = ?").get(pid);
  assert.ok(project.uid, "project baru harus punya uid");
  const projectOps = outbox(d, "project");
  assert.equal(projectOps.length, 1);
  assert.equal(projectOps[0].op, "upsert");
  assert.equal(projectOps[0].payload.slug, "sync-demo");

  dbmod.insertMemory({
    projectId: pid,
    kind: "fact",
    content: "awal sync",
    importance: 0.5,
    createdAt: Date.now(),
    lastAccessed: 0,
    accessCount: 0,
    sourceTool: "test",
    status: "draft",
  });
  const mem = dbmod.memoryById(1);
  assert.ok(mem?.uid, "memori baru harus punya uid");
  let ops = outbox(d, "memory");
  assert.equal(ops.length, 1);
  assert.equal(ops[0].entity_uid, mem.uid);
  assert.equal(ops[0].payload.projectUid, project.uid);
  assert.deepEqual(ops[0].payload.tags, []);
  assert.equal(ops[0].payload.status, "draft");

  dbmod.replaceMemoryTags(1, [" Alpha ", "beta"]);
  ops = outbox(d, "memory");
  assert.deepEqual(ops.at(-1).payload.tags, ["alpha", "beta"]);

  dbmod.updateMemory(1, { content: "isi sudah diedit" });
  ops = outbox(d, "memory");
  assert.equal(ops.at(-1).payload.content, "isi sudah diedit");

  dbmod.approveMemory(1);
  ops = outbox(d, "memory");
  assert.equal(ops.at(-1).payload.status, "active");

  dbmod.setTaskResolved(1, true);
  ops = outbox(d, "memory");
  assert.ok(ops.at(-1).payload.resolvedAt > 0);

  dbmod.archiveMemory(1, true);
  ops = outbox(d, "memory");
  assert.equal(ops.at(-1).payload.archived, 1);

  dbmod.insertMemory({
    projectId: pid,
    kind: "fact",
    content: "memori kedua",
    importance: 0.5,
    createdAt: Date.now(),
    lastAccessed: 0,
    accessCount: 0,
    sourceTool: "test",
  });
  dbmod.insertMemoryLink(1, 2, "related", 0.8);
  const linkOps = outbox(d, "link");
  assert.equal(linkOps.length, 1);
  assert.equal(linkOps[0].op, "upsert");
  assert.equal(linkOps[0].payload.fromUid, mem.uid);
  assert.equal(linkOps[0].payload.kind, "related");

  dbmod.clearMemoryLinks();
  assert.equal(outbox(d, "link").at(-1).op, "delete");

  dbmod.insertMemoryLink(1, 2, "related", 0.8);
  dbmod.deleteMemory(1);
  assert.equal(outbox(d, "link").at(-1).op, "delete", "hapus memori harus menombstone link");
  const deleted = outbox(d, "memory").at(-1);
  assert.equal(deleted.op, "delete");
  assert.equal(deleted.entity_uid, mem.uid);
  assert.equal(dbmod.memoryById(1), null);
  assert.equal(dbmod.allMemoryLinks().length, 0, "link ke memori terhapus harus dibersihkan");

  const hlcRows = d.prepare("SELECT hlc FROM sync_outbox ORDER BY id").all();
  for (let i = 1; i < hlcRows.length; i++) {
    assert.ok(dbmod.hlcNewer(hlcRows[i].hlc, hlcRows[i - 1].hlc), "HLC harus naik monoton");
  }

  const before = Number(d.prepare("SELECT COUNT(*) AS c FROM sync_outbox").get().c);
  dbmod.setSyncCaptureEnabled(false);
  dbmod.insertMemory({
    projectId: pid,
    kind: "fact",
    content: "replay peer",
    importance: 0.5,
    createdAt: Date.now(),
    lastAccessed: 0,
    accessCount: 0,
    sourceTool: "test",
  });
  assert.equal(Number(d.prepare("SELECT COUNT(*) AS c FROM sync_outbox").get().c), before, "capture off harus diam");
  dbmod.setSyncCaptureEnabled(true);

  const remote = "9999999999999.000001.remote-device";
  dbmod.observeHlc(remote);
  const after = dbmod.nextHlc();
  assert.ok(dbmod.hlcNewer(after, remote), "HLC lokal harus menang setelah observe");
  assert.equal(dbmod.getDeviceId(), dbmod.getDeviceId(), "device id harus stabil");
  dbmod.closeDb();
});
