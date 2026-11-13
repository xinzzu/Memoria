/* PR-B: Konsolidasi berkala — cluster near-duplicate per proyek+kind,
 * merge ke survivor terbaik, tag gabungan, guard lintas proyek/kind.
 * Dijalankan terhadap dist/ (npm test), DB sementara. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
const require = createRequire(import.meta.url);

process.env.MEMORIA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-cons-"));
const dbmod = require("../dist/engine/store/db.js");
const { consolidateMemories } = require("../dist/engine/extract/consolidate.js");
const { getEmbedProvider } = require("../dist/engine/extract/provider.js");

dbmod.initDb(process.env.MEMORIA_DATA_DIR);

async function insertWithEmbed(content, projectId, kind = "decision", importance = 0.5) {
  const eprov = await getEmbedProvider();
  const emb = await eprov.embed(content);
  dbmod.insertMemory({
    projectId,
    kind,
    content,
    importance,
    createdAt: Date.now(),
    lastAccessed: 0,
    sourceTool: "test",
    embedding: emb,
    status: "active",
    embedModel: eprov.embedModel,
  });
  return dbmod.allMemories().find((m) => m.content === content);
}

test("konsolidasi: cluster near-duplicate merge, survivor terbaik + tag gabungan", async () => {
  const pA = dbmod.ensureProject("users-mac-consa", undefined);
  const base = "Deploy service auth ke staging cluster satu";
  const m1 = await insertWithEmbed(base, pA, "decision", 0.5);
  const m2 = await insertWithEmbed(base + " sekarang", pA, "decision", 0.6);
  const m3 = await insertWithEmbed(base + " sekarang juga", pA, "decision", 0.7);
  dbmod.setMemoryTag(m1.id, "deploy");
  dbmod.setMemoryTag(m3.id, "staging");

  const r = await consolidateMemories();
  assert.ok(r.clusters >= 1, `minimal 1 cluster harus terbentuk (${JSON.stringify(r)})`);
  assert.ok(r.removed >= 2, `dua duplikat harus dihapus (${JSON.stringify(r)})`);
  const kept = dbmod.allMemories().filter((m) => m.content.includes("Deploy service auth"));
  assert.equal(kept.length, 1, "hanya survivor yang tersisa");
  const survivor = kept[0];
  assert.ok(survivor.content.length >= base.length + 8, "survivor harus konten terpanjang");
  assert.ok(survivor.importance >= 0.7, "survivor harus importance maksimum dari cluster");
  const tags = dbmod.tagsForMemory(survivor.id);
  assert.ok(tags.includes("deploy") && tags.includes("staging"), "tag gabungan: deploy + staging");
});

test("konsolidasi: konten tak berkaitan tidak ikut terhapus", async () => {
  const pA = dbmod.ensureProject("users-mac-consa", undefined);
  await insertWithEmbed("Design new logo for marketing campaign", pA, "fact", 0.5);
  await insertWithEmbed("Refactor payment gateway retry logic", pA, "fact", 0.5);
  const before = dbmod.allMemories().filter((m) => m.projectId === pA).length;
  await consolidateMemories();
  const after = dbmod.allMemories().filter((m) => m.projectId === pA && m.kind === "fact").length;
  assert.ok(after >= 2, `dua konten berbeda harus tetap ada (sebelum ${before}, sesudah ${after})`);
});

test("konsolidasi: beda proyek & beda kind tidak boleh digabung", async () => {
  const pB = dbmod.ensureProject("users-mac-consb", undefined);
  const content = "Deploy service auth ke staging cluster satu";
  await insertWithEmbed(content, pB, "decision", 0.5); // proyek beda, konten mirip
  await insertWithEmbed(content + " juga", pB, "fact", 0.5); // kind beda

  const beforeB = dbmod.allMemories().filter((m) => m.projectId === pB).length;
  await consolidateMemories();
  const afterB = dbmod.allMemories().filter((m) => m.projectId === pB).length;
  assert.equal(afterB, beforeB, "proyek/kind berbeda tidak boleh tergabung");
});
