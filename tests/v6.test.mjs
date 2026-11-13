/* Migrasi v6 (temporal + provenance + continuity) + project brief +
 * build_context — dijalankan terhadap dist/ (npm test), DB sementara. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
const require = createRequire(import.meta.url);

process.env.MEMORIA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-v6-"));
const dbmod = require("../dist/engine/store/db.js");
const snap = require("../dist/engine/extract/snapshot.js");
const searchmod = require("../dist/engine/retrieve/search.js");
const ctxmod = require("../dist/engine/retrieve/contextblock.js");

const d = dbmod.initDb(process.env.MEMORIA_DATA_DIR);

let seq = 0;
function addTranscript(projectId, sessionId, role, content) {
  dbmod.insertTranscript({
    tool: "claude",
    sessionId,
    projectId,
    role,
    content,
    ts: Date.now(),
    seq: ++seq,
  });
}

function mem(content, extra = {}) {
  return {
    projectId: extra.projectId ?? null,
    kind: extra.kind ?? "fact",
    content,
    importance: extra.importance ?? 0.5,
    createdAt: extra.createdAt ?? Date.now(),
    lastAccessed: 0,
    sourceTool: "test",
    status: "active",
    embedding: extra.embedding ?? null,
    embedModel: extra.embedModel,
    sourceSession: extra.sourceSession,
  };
}

/* ---- Migrasi v6 ---- */
test("v6: migrasi diterapkan — kolom baru + continuity_events + backfill", () => {
  const uv = Number(d.prepare("PRAGMA user_version").get().user_version);
  assert.equal(uv, 7, "user_version harus 7 setelah migrasi");
  const cols = d.prepare("PRAGMA table_info(memories)").all().map((c) => c.name);
  for (const c of ["valid_from", "valid_to", "source_session"]) assert.ok(cols.includes(c), `kolom ${c} harus ada`);
  const t = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='continuity_events'").get();
  assert.ok(t, "tabel continuity_events harus ada");
  dbmod.insertMemory(mem("memori untuk cek valid_from backfill v6"));
  const row = dbmod.allMemories().find((m) => m.content.includes("valid_from backfill v6"));
  assert.ok(row.validFrom > 0, "valid_from harus ter-backfill dari created_at");
  assert.equal(row.validTo, 0, "valid_to awal 0 (masih berlaku)");
});

test("v6: provenance — insertMemory & snapshot menyimpan session sumber", async () => {
  dbmod.insertMemory(mem("memori ber-provenance sess-abc", { sourceSession: "sess-abc" }));
  const row = dbmod.allMemories().find((m) => m.content.includes("ber-provenance sess-abc"));
  assert.equal(row.sourceSession, "sess-abc");

  // Snapshot F4 kini juga membawa session_id transkrip terakhir.
  const projId = dbmod.ensureProject("users-mac-v6snap", undefined);
  addTranscript(projId, "sess-f4x", "user", "kerjakan refactor src/app/store.ts sekarang");
  addTranscript(projId, "sess-f4x", "assistant", "$ npm run build selesai tanpa error");
  const r = await snap.captureSessionSnapshot(projId, "claude");
  assert.ok(r && r.inserted, "snapshot harus ter-insert");
  const snapMem = dbmod.allMemories().find((m) => m.content.startsWith("Work snapshot"));
  assert.equal(snapMem.sourceSession, "sess-f4x", "snapshot harus membawa provenance sesi");
});

/* ---- Temporal: archive menutup valid_to ---- */
test("v6: temporal — archive menutup valid_to, unarchive membuka lagi", () => {
  dbmod.insertMemory(mem("fakta temporal yang nanti diarsipkan"));
  const row = dbmod.allMemories().find((m) => m.content.includes("fakta temporal yang nanti diarsipkan"));
  dbmod.archiveMemory(row.id, true);
  const archived = dbmod.memoryById(row.id);
  assert.ok(archived.validTo > 0, "archive harus menutup valid_to");
  dbmod.archiveMemory(row.id, false);
  const restored = dbmod.memoryById(row.id);
  assert.equal(restored.validTo, 0, "unarchive harus membuka valid_to lagi");
});

/* ---- Project brief ---- */
test("v6: project brief — generate berisi keputusan/task + replace saat regenerasi", async () => {
  const projId = dbmod.ensureProject("users-mac-v6brief", undefined);
  dbmod.insertMemory(mem("Pilih pnpm daripada npm untuk workspace ini", { projectId: projId, kind: "decision", importance: 0.9 }));
  dbmod.insertMemory(mem("Selesaikan migrasi embed queue minggu depan", { projectId: projId, kind: "task_pending", importance: 0.8 }));
  dbmod.insertMemory(mem("User lebih suka jawaban singkat", { projectId: projId, kind: "preference", importance: 0.7 }));
  dbmod.insertMemory(mem("Docker compose dipakai untuk layanan lokal", { projectId: projId, kind: "fact", importance: 0.6 }));

  const brief = await dbmod.generateProjectBrief(projId);
  assert.ok(brief, "brief harus terbentuk");
  assert.match(brief.content, /^Project brief:/);
  assert.match(brief.content, /pnpm/, "keputusan harus masuk brief");
  assert.match(brief.content, /embed queue/, "tugas terbuka harus masuk brief");
  assert.match(brief.content, /jawaban singkat/, "preferensi harus masuk brief");
  assert.equal(brief.importance, 1, "brief harus importance maksimum");

  // Regenerasi: brief lama diganti, tidak menumpuk.
  dbmod.insertMemory(mem("Keputusan baru: migrasi ke bun", { projectId: projId, kind: "decision", importance: 0.95 }));
  const brief2 = await dbmod.generateProjectBrief(projId);
  assert.ok(brief2 && brief2.id !== brief.id, "brief baru harus berbeda id");
  const briefs = dbmod.allMemories().filter((m) => m.content.startsWith("Project brief:"));
  assert.equal(briefs.length, 1, "hanya boleh ada SATU brief per proyek");
  assert.match(briefs[0].content, /migrasi ke bun/, "brief baru harus memuat keputusan terbaru");

  // projectContext: brief SELALU posisi pertama.
  const slug = dbmod.projectSlugById(projId);
  const ctx = searchmod.projectContext(slug, 8);
  assert.equal(ctx[0].kind, "brief", "brief harus selalu pertama di projectContext");
});

/* ---- Continuity metrics ---- */
test("v6: continuity — limit_hit & resume_ready tercatat & diagregasi", () => {
  dbmod.recordContinuity("limit_hit", 1, "snapshotted=true");
  dbmod.recordContinuity("resume_ready", null, "proj-a");
  const s = dbmod.continuityStats();
  assert.ok(s.limits30d >= 1, "limit_hit 30 hari harus terhitung");
  assert.ok(s.resumesReady30d >= 1, "resume_ready 30 hari harus terhitung");
  assert.ok(s.lastLimitAt > 0 && s.lastResumeAt > 0);
});

/* ---- build_context ---- */
test("v6: buildContextBlock — brief + key memories + budget karakter", () => {
  const block = ctxmod.buildContextBlock({ project: "users-mac-v6brief", maxChars: 6000 });
  assert.match(block, /^# Memoria context/);
  assert.match(block, /## Project brief/, "brief harus bagian pertama blok");
  assert.match(block, /## Key memories/, "memori kunci harus ada");
  assert.match(block, /migrasi ke bun/);

  const tight = ctxmod.buildContextBlock({ project: "users-mac-v6brief", maxChars: 600 });
  assert.ok(tight.length <= 600, "budget maxChars harus dihormati");
});
