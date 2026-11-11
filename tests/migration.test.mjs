/* Migrasi DB lama → v2 (FTS5 + Float32 BLOB) — file terpisah supaya singleton
 * db.ts di core.test.mjs tidak tertimpa initDb() arah lain. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
const require = createRequire(import.meta.url);

const dbmod = require("../dist/engine/store/db.js");
const searchmod = require("../dist/engine/retrieve/search.js");

test("migrasi v0 → v2: FTS backfill + embedding JSON TEXT jadi Float32 BLOB", () => {
  // Simulasi DB era pra-migrasi: hanya tabel memories dengan kolom asli,
  // satu baris embedding JSON TEXT, user_version masih 0.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-old-"));
  const old = new DatabaseSync(path.join(dir, "memory.db"));
  old.exec(`CREATE TABLE memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    kind TEXT NOT NULL,
    content TEXT NOT NULL,
    importance REAL DEFAULT 0.5,
    created_at INTEGER NOT NULL,
    last_accessed INTEGER DEFAULT 0,
    access_count INTEGER DEFAULT 0,
    source_tool TEXT,
    embedding TEXT)`);
  old.prepare(
    "INSERT INTO memories (kind, content, importance, created_at, source_tool, embedding) VALUES ('fact', ?, 0.5, ?, 'test', ?)"
  ).run("memori lama format json legacyq", Date.now(), JSON.stringify([0.5, 0.5, 0.25]));
  old.close();

  const d = dbmod.initDb(dir);

  const uv = Number(d.prepare("PRAGMA user_version").get().user_version);
  assert.equal(uv, 2, "user_version harus naik ke jumlah migrasi");

  // Embedding lama terbaca sebagai vektor & tersimpan BLOB di disk.
  const m = dbmod.allMemories().find((x) => x.content === "memori lama format json legacyq");
  assert.ok(m && m.embedding && m.embedding.length === 3, "embedding harus terbaca sebagai vektor");
  assert.ok(Math.abs(m.embedding[0] - 0.5) < 1e-6, "nilai float32 harus akurat");
  const t = d.prepare("SELECT typeof(embedding) AS t FROM memories WHERE id = ?").get(m.id);
  assert.equal(t.t, "blob", "kolom harus berisi BLOB setelah migrasi");

  // FTS rebuild mem-backfill konten lama → search ketemu.
  const hits = searchmod.searchMemories("legacyq", { limit: 5 });
  assert.ok(hits.some((h) => h.content.includes("legacyq")), "FTS backfill harus mengindeks data lama");

  // Migrasi idempotent: initDb ulang pada dir yang sama tidak mengubah apa pun.
  const d2 = dbmod.initDb(dir);
  const uv2 = Number(d2.prepare("PRAGMA user_version").get().user_version);
  assert.equal(uv2, 2);
  const t2 = d2.prepare("SELECT typeof(embedding) AS t FROM memories WHERE id = ?").get(m.id);
  assert.equal(t2.t, "blob", "baris BLOB tidak boleh tersentuh ulang");
});
