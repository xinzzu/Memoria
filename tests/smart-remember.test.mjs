/* PR-C: Smart remember — mem0-style ADD/UPDATE/NOOP versi zero-LLM.
 * Konten baru lebih panjang + overlap ≥60% → UPDATE konten + vektor baru;
 * selain itu NOOP + importance bump. Beda proyek tetap insert. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
const require = createRequire(import.meta.url);

process.env.MEMORIA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-smart-"));
const dbmod = require("../dist/engine/store/db.js");
const { addMemoryWithDedupe } = require("../dist/engine/extract/dedupe.js");
const { getEmbedProvider } = require("../dist/engine/extract/provider.js");

dbmod.initDb(process.env.MEMORIA_DATA_DIR);

async function emb(text) {
  const eprov = await getEmbedProvider();
  return { embedding: await eprov.embed(text), embedModel: eprov.embedModel };
}

function m(content, projectId, extra = {}) {
  return {
    projectId,
    kind: extra.kind ?? "decision",
    content,
    importance: extra.importance ?? 0.5,
    createdAt: Date.now(),
    lastAccessed: 0,
    accessCount: 0,
    sourceTool: "test",
    status: "active",
    origin: "user",
    ...extra.fields,
  };
}

test("smart remember: konten lebih panjang & overlap → UPDATE konten + vektor", async () => {
  const pid = dbmod.ensureProject("users-mac-sra", undefined);
  const oldText = "Deploy auth service ke staging cluster";
  const e1 = await emb(oldText);
  const r1 = addMemoryWithDedupe(m(oldText, pid, { fields: e1 }));
  assert.ok(r1.inserted, "memori pertama harus insert");

  const newText = "Deploy auth service ke staging cluster one with canary rollout";
  const e2 = await emb(newText);
  const r2 = addMemoryWithDedupe(m(newText, pid, { fields: e2 }));
  assert.equal(r2.inserted, false, "near-duplicate tidak insert baru");
  assert.equal(r2.updated, r2.mergedInto, "harus UPDATE memori lama");
  const after = dbmod.memoryById(r2.updated);
  assert.equal(after.content, newText, "konten harus diganti versi baru");
  assert.equal(after.embedModel, e2.embedModel, "dialek vektor harus ikut baru");
  assert.ok(after.embedding.length === e2.embedding.length, "vektor baru harus tersimpan");
  const count = dbmod.allMemories().filter((x) => x.projectId === pid).length;
  assert.equal(count, 1, "tidak boleh ada duplikat tersisa");
});

test("smart remember: konten identik → NOOP + importance bump saja", async () => {
  const pid = dbmod.ensureProject("users-mac-srb", undefined);
  const text = "Deploy auth service ke staging cluster dua dengan canary rollout penuh";
  const e1 = await emb(text);
  addMemoryWithDedupe(m(text, pid, { importance: 0.4, fields: e1 }));
  const e2 = await emb(text);
  const r = addMemoryWithDedupe(m(text, pid, { importance: 0.8, fields: e2 }));
  assert.equal(r.inserted, false, "identik → tidak insert");
  assert.equal(r.updated, undefined, "konten sama tidak boleh di-update");
  const kept = dbmod.allMemories().filter((x) => x.projectId === pid);
  assert.equal(kept.length, 1, "tidak ada duplikat tersisa");
  assert.equal(kept[0].content, text, "konten lama tetap");
  assert.equal(kept[0].importance, 0.8, "importance harus naik ke maksimum");
});

test("smart remember: konten beda subjek → tetap INSERT", async () => {
  const pid = dbmod.ensureProject("users-mac-src", undefined);
  const e1 = await emb("Deploy auth service ke staging cluster");
  addMemoryWithDedupe(m("Deploy auth service ke staging cluster", pid, { fields: e1 }));
  const e2 = await emb("Refactor payment gateway retry logic with exponential backoff");
  const r = addMemoryWithDedupe(m("Refactor payment gateway retry logic with exponential backoff", pid, { fields: e2 }));
  assert.ok(r.inserted, "konten berbeda subjek harus insert");
});
