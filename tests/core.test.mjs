/* Test inti engine — dijalankan terhadap dist/ hasil build.
 * npm test = build + node --test tests/ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { textSimilarity } = require("../dist/engine/extract/dedupe.js");
const { keywordScore } = require("../dist/engine/retrieve/search.js");
const { canonicalPath, looksLikePath, projectSlugFromCwd } = require("../dist/engine/ingest/util.js");
const { prettifyProjectName } = require("../dist/engine/store/db.js");
const handoffSrc = require("node:fs").readFileSync(require.resolve("../dist/engine/handoff.js"), "utf8");

/* ---- dedupe: kemiripan teks (jalur tanpa model) ---- */
test("textSimilarity: duplikat nyaris identik -> tinggi", () => {
  const s = textSimilarity(
    "selesaikan endpoint refresh-token segera",
    "selesaikan endpoint refresh-token segera ya"
  );
  assert.ok(s >= 0.6, `kemiripan rendah tak terduga: ${s}`);
});

test("textSimilarity: kalimat berbeda -> rendah", () => {
  const s = textSimilarity("pakai pnpm untuk monorepo", "ganti warna tombol jadi biru");
  assert.ok(s < 0.2, `kemiripan tinggi tak terduga: ${s}`);
});

/* ---- retrieval: keyword score + toleransi typo ---- */
test("keywordScore: kecocokan persis", () => {
  assert.ok(keywordScore("Database memakai Neon serverless", "database neon") >= 0.99);
});

test("keywordScore: typo satu huruf tetap kena (fuzzy)", () => {
  assert.ok(keywordScore("docker compose gagal pull image", "doker") > 0);
});

test("keywordScore: tak berhubungan -> 0", () => {
  assert.equal(keywordScore("ganti tema jadi terang", "docker kubernetes"), 0);
});

/* ---- identitas proyek ---- */
test("canonicalPath: symlink ter-resolve sesuai realpath OS", () => {
  assert.equal(canonicalPath("/tmp"), require("node:fs").realpathSync("/tmp"));
});

test("looksLikePath: path vs nama polos", () => {
  assert.equal(looksLikePath("/Users/mac/proyek"), true);
  assert.equal(looksLikePath("C:\\Users\\mac"), true);
  assert.equal(looksLikePath("smoke-proj"), false);
});

test("projectSlugFromCwd: separator jadi strip + lowercase", () => {
  assert.equal(projectSlugFromCwd("/Users/mac/My App"), "users-mac-my app"); // spasi dipertahankan
});

test("prettifyProjectName: ambil basename & rapikan", () => {
  assert.equal(prettifyProjectName("/Users/mac/Documents/Workspace/asti"), "asti");
  assert.equal(prettifyProjectName("users-mac-documents-workspace-work-wealth"), "users mac documents workspace work wealth");
});

/* ---- handoff: marker injeksi idempotent ---- */
test("MARK_RE menimpa blok lama (bukan menumpuk) + mengenali marker legacy pecut", () => {
  const m = handoffSrc.match(/const MARK_RE = (\/.*?\/);\n/);
  assert.ok(m, "MARK_RE tidak ketemu di dist");
  const re = eval(m[1]);
  const file =
    "intro\n<!-- memoria:start -->\nlama\n<!-- memoria:end -->\ntail\n";
  const replaced = file.replace(re, "<!-- memoria:start -->baru<!-- memoria:end -->\n");
  assert.equal((replaced.match(/memoria:start/g) || []).length, 1, "blok harus tertimpa, bukan menumpuk");
  const legacy = "x\n<!-- pecut-memory:start -->old<!-- pecut-memory:end -->\ny";
  assert.ok(re.test(legacy), "marker legacy pecut-memory harus ikut terenali");
});

/* ---- F1C: DB fixture — FTS5, Float32 BLOB, dedupe SQL, pagination ----
 * DB sementara per-file test; migrasi DB lama diuji di migration.test.mjs
 * agar singleton db.ts tidak saling menimpa antar-file. */
const fs = require("node:fs");
const os = require("node:os");
const nodePath = require("node:path");
const dbmod = require("../dist/engine/store/db.js");
const searchmod = require("../dist/engine/retrieve/search.js");
const { addMemoryWithDedupe } = require("../dist/engine/extract/dedupe.js");

const tmpDir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "memoria-test-"));
dbmod.initDb(tmpDir);

function cosineArr(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

function mem(content, extra = {}) {
  return {
    projectId: extra.projectId ?? null,
    kind: extra.kind ?? "fact",
    content,
    importance: extra.importance ?? 0.5,
    createdAt: extra.createdAt ?? Date.now(),
    sourceTool: "test",
    status: extra.status,
    embedding: extra.embedding ?? null,
    embedModel: extra.embedModel,
  };
}

test("F1C: BLOB roundtrip — embedding tersimpan & terbaca kembali (Float32)", () => {
  const emb = [0.1, -0.2, 0.3, 0.4, 0.5];
  dbmod.insertMemory(mem("memori vektor pertama", { embedding: emb, embedModel: "hash-256-v1" }));
  const row = dbmod.allMemories().find((m) => m.content === "memori vektor pertama");
  assert.ok(row && row.embedding && row.embedding.length === 5, "embedding harus terbaca");
  assert.ok(cosineArr(emb, row.embedding) > 0.999999, "nilai vektor harus presisi float32");
  const t = dbmod
    .getDb()
    .prepare("SELECT typeof(embedding) AS t FROM memories WHERE id = ?")
    .get(row.id);
  assert.equal(t.t, "blob", "on-disk harus BLOB, bukan JSON TEXT");
});

test("F1C: FTS — kata & substring ketemu; arsip & draft tidak ikut", () => {
  dbmod.insertMemory(mem("docker compose dipakai untuk layanan lokal unikq"));
  dbmod.insertMemory(mem("docker hanya di draft unikq", { status: "draft" }));
  const archRow = dbmod.allMemories().find((m) => m.content === "docker compose dipakai untuk layanan lokal unikq");
  dbmod.insertMemory(mem("docker di arsip unikq"));
  const archived = dbmod.allMemories().find((m) => m.content === "docker di arsip unikq");
  dbmod.archiveMemory(archived.id, true);

  const hits = searchmod.searchMemories("compose docker", { limit: 10 });
  assert.ok(hits.some((h) => h.content.includes("docker compose dipakai")), "memori aktif harus ketemu");
  assert.ok(!hits.some((h) => h.content.includes("draft unikq")), "draft tidak boleh ikut");
  assert.ok(!hits.some((h) => h.content.includes("arsip unikq")), "arsip tidak boleh ikut");
  assert.ok(archRow, "fixture: memori aktif harus ada");

  const sub = searchmod.searchMemories("comp", { limit: 10 });
  assert.ok(sub.some((h) => h.content.includes("compose")), "substring (trigram) harus ketemu");
});

test("F1C: FTS — edit konten memperbarui index (trigger UPDATE)", () => {
  dbmod.insertMemory(mem("alpha bravo charlie zetta"));
  const row = dbmod.allMemories().find((m) => m.content === "alpha bravo charlie zetta");
  assert.ok(searchmod.searchMemories("bravo", { limit: 10 }).some((h) => h.id === row.id));
  dbmod.updateMemory(row.id, { content: "delta echo zetta" });
  assert.ok(searchmod.searchMemories("echo", { limit: 10 }).some((h) => h.id === row.id), "kata baru harus ketemu");
  // Kata lama dicek langsung di index FTS — level blended sengaja tidak dipakai
  // karena fallback legacy memang mengisi hasil dengan memori recency-only
  // (perilaku score > 0.02 yang sudah ada sebelum F1C).
  const stale = dbmod.getDb().prepare('SELECT rowid FROM memories_fts WHERE memories_fts MATCH ?').all('"bravo"');
  assert.equal(stale.length, 0, "kata lama harus terhapus dari index FTS (delete-command trigger)");
});

test("F1C: search tanpa hasil FTS fallback ke scan legacy (recall typo)", () => {
  // "doker" (typo dari docker) tidak match trigram sama sekali → FTS 0 baris →
  // fallback scan legacy harus tetap menemukan via keywordScore fuzzy
  // (editDistance ≤ 1), persis perilaku sebelum F1C.
  const hits = searchmod.searchMemories("doker", { limit: 10 });
  assert.ok(hits.some((h) => h.content.includes("docker compose dipakai")), "typo harus tetap ketemu lewat fallback");
});

test("F1C: dedupe — duplikat teks merge, beda proyek tetap insert", () => {
  const r1 = addMemoryWithDedupe(mem("ganti warna tombol jadi biru", { projectId: 1 }));
  assert.ok(r1.inserted);
  const r2 = addMemoryWithDedupe(mem("ganti warna tombol jadi biru", { projectId: 1 }));
  assert.equal(r2.inserted, false, "duplikat proyek sama harus merge");
  const firstId = dbmod.allMemories().find((m) => m.content === "ganti warna tombol jadi biru").id;
  assert.equal(r2.mergedInto, firstId);
  const r3 = addMemoryWithDedupe(mem("ganti warna tombol jadi biru", { projectId: 2 }));
  assert.ok(r3.inserted, "proyek beda tidak boleh merge");
});

test("F1C: dedupe — embedding beda dialek tidak tergabung", () => {
  const e = [1, 0, 0, 0, 0, 0, 0, 0];
  const a1 = addMemoryWithDedupe(mem("vektor dedupe alphasept", { embedding: e, embedModel: "hash-256-v1" }));
  assert.ok(a1.inserted);
  const a2 = addMemoryWithDedupe(mem("vektor dedupe alphasept lain", { embedding: e, embedModel: "model-lain" }));
  assert.ok(a2.inserted, "dialek beda tidak boleh dibandingkan");
  const a3 = addMemoryWithDedupe(mem("vektor dedupe alphasept salinan", { embedding: e, embedModel: "hash-256-v1" }));
  assert.equal(a3.inserted, false, "dialek sama + vektor identik harus merge");
});

test("F1C: count konsisten untuk hasMore pagination", () => {
  // Pagination HTTP diverifikasi live (server + curl); di sini cukup jaga
  // invariant count vs list yang dipakai respons /api/memories/list.
  const before = dbmod.countMemories();
  dbmod.insertMemory(mem("memori untuk hitung count paginationq"));
  assert.equal(dbmod.countMemories(), before + 1);
  assert.equal(dbmod.countDraft(), dbmod.listDraft().length);
  assert.equal(dbmod.countArchived(), dbmod.listArchived().length);
});

test("F1C: listMemoriesPage — SQL LIMIT/OFFSET setara materialisasi lama", () => {
  dbmod.insertMemory(mem("halaman arsip unikz"));
  const arch = dbmod.allMemories().find((m) => m.content === "halaman arsip unikz");
  dbmod.archiveMemory(arch.id, true);
  for (let i = 0; i < 5; i++) {
    dbmod.insertMemory(mem(`halaman draft unikz ${i}`, { createdAt: 2000 + i, status: "draft" }));
  }
  const fixtures = [
    ["active", dbmod.allMemories()],
    ["draft", dbmod.listDraft()],
    ["archived", dbmod.listArchived()],
  ];
  for (const [status, expected] of fixtures) {
    const limit = 2;
    const gotIds = [];
    for (let offset = 0; offset < expected.length + limit; offset += limit) {
      const page = dbmod.listMemoriesPage(status, limit, offset);
      assert.equal(page.total, expected.length, `total ${status} harus konsisten`);
      assert.ok(page.memories.length <= limit, `limit ${status} harus dihormati`);
      gotIds.push(...page.memories.map((m) => m.id));
    }
    assert.deepEqual(gotIds, expected.map((m) => m.id), `urutan halaman ${status} harus sama`);
  }
});

/* ---- MCP self-editing: update_memory (re-embed) & forget (delete) ---- */
test("MCP: updateMemory — konten baru + vektor baru + FTS mengikuti", () => {
  dbmod.insertMemory(mem("preferensi build pakai pnpm bukan npm updatecase", { embedding: [0, 0, 0.5, 0, 0, 0, 0, 0], embedModel: "hash-256-v1" }));
  const row = dbmod.allMemories().find((m) => m.content.includes("updatecase"));
  const embLama = row.embedding.slice();
  const ok = dbmod.updateMemory(row.id, {
    content: "preferensi build pakai bun bukan pnpm",
    embedding: [1, 0, 0, 0, 0, 0, 0, 0],
    embedModel: "hash-256-v1",
  });
  assert.ok(ok, "update harus berhasil");
  const after = dbmod.memoryById(row.id);
  assert.match(after.content, /bun/);
  assert.equal(after.embedding[0], 1, "vektor baru harus tersimpan");
  assert.notEqual(after.embedding[0], embLama[0], "vektor harus berubah dari sebelum edit");
  assert.equal(after.embedModel, "hash-256-v1");
  assert.ok(searchmod.searchMemories("bun", { limit: 5 }).some((h) => h.id === row.id), "FTS harus ketemu konten baru");
  const stale = dbmod.getDb().prepare('SELECT rowid FROM memories_fts WHERE memories_fts MATCH ?').all('"updatecase"');
  assert.equal(stale.length, 0, "kata lama harus hilang dari index FTS");
});

test("MCP: updateMemory tanpa embedding patch — vektor lama dipertahankan", () => {
  dbmod.insertMemory(mem("memori update tanpa vektor baru keepvec", { embedding: [0, 1, 0, 0], embedModel: "hash-256-v1" }));
  const row = dbmod.allMemories().find((m) => m.content.includes("keepvec"));
  dbmod.updateMemory(row.id, { importance: 0.9 });
  const after = dbmod.memoryById(row.id);
  assert.equal(after.importance, 0.9);
  assert.equal(after.embedding[1], 1, "vektor lama tidak boleh hilang");
});

test("MCP: deleteMemory — baris hilang + FTS tidak lagi match", () => {
  dbmod.insertMemory(mem("memori sementara untuk dihapus forgetq"));
  const row = dbmod.allMemories().find((m) => m.content.includes("forgetq"));
  assert.ok(dbmod.deleteMemory(row.id), "delete harus berhasil");
  assert.equal(dbmod.memoryById(row.id), null);
  const stale = dbmod.getDb().prepare('SELECT rowid FROM memories_fts WHERE memories_fts MATCH ?').all('"forgetq"');
  assert.equal(stale.length, 0, "index FTS harus bersih setelah delete");
});

test("PR-H: recentProjects — proyek tanpa transkrip tidak muncul", () => {
  dbmod.ensureProject("users-mac-emptyproj", undefined); // tanpa transkrip
  dbmod.insertTranscript({ tool: "claude", sessionId: "s-rp", projectId: dbmod.ensureProject("users-mac-fullproj", undefined), role: "user", content: "proyek dengan aktivitas nyata recentq", ts: Date.now(), seq: 9999 });
  const slugs = dbmod.recentProjects(50).map((p) => p.slug);
  assert.ok(!slugs.includes("users-mac-emptyproj"), "proyek 0-aktivitas harus disembunyikan");
  assert.ok(slugs.includes("users-mac-fullproj"), "proyek aktif harus muncul");
});

test("PR-N2: isGenericMemory — noise tool/badge/markdown tersaring", async () => {
  const { isGenericMemory } = require("../dist/engine/extract/extractor.js");
  const noise = [
    "The file /Users/mac/Documents/Work/November/8/hypeflow/web/components/sections/Bottom.tsx has been updated successfully.",
    "[This command modified 1 file you've previously read: app/page.tsx.",
    "[!Tests](https://img.shields.io/badge/Foundry%20Tests-26%20passed-brightgreen.svg)](#contracts)",
    "[!Solidity](https://img.shields.io/badge/Solidity-0.8.24-blue.svg)](packages/contracts)\n\nkonten lain",
    "-- **Invariant (8,192 call ack):** 'claimed <= total' untuk setup posisi",
    "```\nsome code fragment\n```",
  ];
  for (const n of noise) assert.ok(isGenericMemory(n), `harus dianggap noise: ${n.slice(0, 60)}`);
  const keep = [
    "Keputusan arsitektur: pakai pnpm workspace untuk monorepo ini dan hindari npm biasa.",
    "User memilih bun sebagai runtime karena startup lebih cepat 3x dibanding node.",
    "Invariant escrow: claimed <= total harus dijaga di kontrak posisi (dites via fuzzing).",
    // PR-37 H5: memori nyata multi-baris yang KEBETULAN punya satu fence —
    // tidak boleh dihapus hanya karena satu baris cocok pola struktural.
    "auth flow diperbaiki\n```\nnpm run build\n```\nlanjut verifikasi manual di staging",
  ];
  for (const k of keep) assert.ok(!isGenericMemory(k), `konten nyata tidak boleh tersaring: ${k.slice(0, 60)}`);
});
