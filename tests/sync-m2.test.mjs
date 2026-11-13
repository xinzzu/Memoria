/* Test M2 sync: group key, bundle export/import, LWW, tombstone, alias proyek,
 * embedding backfill, dan CLI. Jalankan terhadap dist/ hasil build. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
const require = createRequire(import.meta.url);

const dbmod = require("../dist/engine/store/db.js");
const keys = require("../dist/engine/sync/keys.js");
const crypto = require("../dist/engine/sync/crypto.js");
const syncExport = require("../dist/engine/sync/export.js");
const syncApply = require("../dist/engine/sync/apply.js");
const bundle = require("../dist/engine/sync/bundle.js");
const embed = require("../dist/engine/sync/embed.js");
const search = require("../dist/engine/retrieve/search.js");

const PASS = "m2-test-passphrase";
const ENV_KEY = "MEMORIA_SYNC_KEY";
const ENV_PASS = "MEMORIA_SYNC_PASSPHRASE";

function fresh(tag) {
  dbmod.closeDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `memoria-m2-${tag}-`));
  dbmod.initDb(dir);
  return dir;
}

function use(dir) {
  dbmod.closeDb();
  dbmod.initDb(dir);
}

function setupSource(tag) {
  const dir = fresh(tag);
  const result = keys.setupSync({ passphrase: PASS, deviceName: tag });
  return { dir, recovery: result.recoveryCode, groupId: result.groupId, key: keys.loadGroupKey({ passphrase: PASS }) };
}

function joinSource(dir, recovery, tag) {
  use(dir);
  keys.setupSync({ joinCode: recovery, passphrase: PASS, deviceName: tag });
  return keys.loadGroupKey({ passphrase: PASS });
}

function sourceMemory(uid) {
  return dbmod.allMemories().find((m) => m.uid === uid) ?? null;
}

test("setup kunci: passphrase, status, unlock env, dan CLI", () => {
  const savedKey = process.env[ENV_KEY];
  const savedPass = process.env[ENV_PASS];
  delete process.env[ENV_KEY];
  delete process.env[ENV_PASS];
  try {
    const dir = fresh("keys");
    const result = keys.setupSync({ passphrase: PASS, deviceName: "laptop-a" });
    assert.ok(result.recoveryCode);
    assert.equal(result.groupId, crypto.groupIdFor(keys.loadGroupKey({ passphrase: PASS })));
    const stored = dbmod.getSetting("sync.groupKey", "");
    assert.ok(stored.startsWith("pass1:"), "kunci harus dibungkus passphrase, bukan plaintext");
    assert.ok(!stored.includes(result.recoveryCode), "recovery code tidak boleh disimpan di settings");
    assert.throws(() => keys.loadGroupKey({}), /locked/);
    assert.throws(() => keys.loadGroupKey({ passphrase: "wrong" }), /Wrong passphrase/);
    assert.equal(keys.loadGroupKey({ passphrase: PASS }).length, 32);

    const status = keys.syncStatus({});
    assert.equal(status.configured, true);
    assert.equal(status.storage, "passphrase");
    assert.equal(status.locked, true);
    assert.equal(status.groupId, null);
    const unlocked = keys.syncStatus({ passphrase: PASS });
    assert.equal(unlocked.groupId, result.groupId);
    assert.equal(unlocked.deviceName, "laptop-a");
    assert.ok(unlocked.deviceId);

    process.env[ENV_KEY] = result.recoveryCode;
    assert.deepEqual(keys.loadGroupKey({}), crypto.decodeRecoveryCode(result.recoveryCode));
    assert.equal(keys.syncStatus({}).groupId, result.groupId);
    delete process.env[ENV_KEY];

    process.env[ENV_PASS] = PASS;
    assert.equal(keys.loadGroupKey({}).length, 32);
    delete process.env[ENV_PASS];

    assert.throws(() => keys.setupSync({ passphrase: PASS }), /already configured/);
    assert.throws(() => keys.setupSync({ force: true }), /safeStorage|passphrase/);
    dbmod.closeDb();

    const cliData = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-m2-cli-data-"));
    const cliHome = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-m2-cli-home-"));
    const env = { ...process.env, MEMORIA_DATA_DIR: cliData, HOME: cliHome };
    delete env[ENV_KEY];
    delete env[ENV_PASS];
    const indexPath = path.resolve("dist/engine/index.js");
    const setup = spawnSync(
      process.execPath,
      [indexPath, "sync", "setup", "--passphrase", "cli-pass", "--device-name", "cli-node"],
      { env, encoding: "utf8" }
    );
    assert.equal(setup.status, 0, setup.stderr);
    assert.match(setup.stdout, /Sync group created/);
    assert.match(setup.stdout, /Recovery : [0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){12}/);
    const cliStatus = spawnSync(process.execPath, [indexPath, "sync", "status", "--passphrase", "cli-pass"], {
      env,
      encoding: "utf8",
    });
    assert.equal(cliStatus.status, 0, cliStatus.stderr);
    assert.match(cliStatus.stdout, /Configured  : yes \(passphrase\)/);
    assert.match(cliStatus.stdout, /Device      : cli-node/);
    const duplicate = spawnSync(process.execPath, [indexPath, "sync", "setup", "--passphrase", "cli-pass"], {
      env,
      encoding: "utf8",
    });
    assert.equal(duplicate.status, 1);
    assert.match(duplicate.stderr, /already configured/);
    const empty = spawnSync(
      process.execPath,
      [indexPath, "sync", "export", "--full", "--passphrase", "cli-pass", "--out", path.join(cliData, "empty.memsync")],
      { env, encoding: "utf8" }
    );
    assert.equal(empty.status, 1);
    assert.match(empty.stderr, /Nothing to export/);
    fs.rmSync(cliData, { recursive: true, force: true });
    fs.rmSync(cliHome, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  } finally {
    if (savedKey === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = savedKey;
    if (savedPass === undefined) delete process.env[ENV_PASS];
    else process.env[ENV_PASS] = savedPass;
  }
});

test("full export/import: scope aman, idempotent, embedding backfill, relay", () => {
  const A = setupSource("A");
  const pid = dbmod.ensureProject("m2-demo", "/tmp/m2-demo");
  dbmod.insertMemory({
    projectId: pid,
    kind: "fact",
    content: "alpha memory for sync",
    importance: 0.7,
    createdAt: Date.now(),
    lastAccessed: 0,
    accessCount: 0,
    sourceTool: "test",
    embedding: [0.1, 0.2, 0.3],
    embedModel: "test-dialect",
  });
  dbmod.insertMemory({
    projectId: pid,
    kind: "fact",
    content: "beta memory for sync",
    importance: 0.5,
    createdAt: Date.now(),
    lastAccessed: 0,
    accessCount: 0,
    sourceTool: "test",
  });
  dbmod.replaceMemoryTags(1, ["Alpha", "beta"]);
  dbmod.insertMemoryLink(1, 2, "related", 0.85);
  dbmod.setSetting("openaiApiKey", "sk-do-not-sync");
  const fileA = path.join(A.dir, "full.memsync");
  const exported = syncExport.exportBundle({ filePath: fileA, groupKey: A.key, full: true });
  assert.equal(exported.opCount, 4, "project + 2 memori + link");

  const read = bundle.readBundleFile(fileA, A.key);
  assert.equal(read.header.groupId, A.groupId);
  assert.equal(read.header.opCount, read.ops.length);
  assert.ok(!JSON.stringify(read.ops).includes("sk-do-not-sync"), "setting rahasia tidak boleh ikut");
  assert.ok(!JSON.stringify(read.ops).includes("embedding"), "vektor tidak boleh ikut");
  const linkOp = read.ops.find((op) => op.entity === "link");
  assert.equal(linkOp.entityUid, [linkOp.payload.fromUid, linkOp.payload.toUid].sort().join("|"));

  const B = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-m2-B-"));
  const keyB = joinSource(B, A.recovery, "B");
  assert.deepEqual(keyB, A.key);
  const applied = syncApply.applyBundleFile(fileA, keyB);
  assert.equal(applied.applied, 4);
  assert.equal(applied.alreadyApplied, false);
  assert.equal(applied.deferredEmbeddings, 2);
  assert.equal(dbmod.allMemories().length, 2);
  assert.equal(dbmod.allMemoryLinks().length, 1);
  const memA = dbmod.allMemories().find((m) => m.content === "alpha memory for sync");
  assert.ok(memA);
  assert.equal(memA.embedding, null, "embedding tidak disinkronkan");
  assert.deepEqual(dbmod.tagsForMemory(memA.id).sort(), ["alpha", "beta"]);
  assert.ok(search.searchMemories("alpha sync", { limit: 5 }).some((h) => h.content.includes("alpha memory")));

  const again = syncApply.applyBundleFile(fileA, keyB);
  assert.equal(again.alreadyApplied, true);
  assert.equal(again.applied, 0);

  dbmod.setSetting("embedEngine", "hash");
  assert.equal(embed.embeddingBackfillCount(), 2);
  return embed.processEmbeddingBackfill(10).then((done) => {
    assert.equal(done, 2);
    assert.equal(embed.embeddingBackfillCount(), 0);
    const backfilled = dbmod.allMemories().find((m) => m.content === "alpha memory for sync");
    assert.ok(backfilled.embedding && backfilled.embedding.length === 256);
    assert.equal(backfilled.embedModel, "hash-256-v1");

    const fileB = path.join(B, "relay.memsync");
    const relay = syncExport.exportBundle({ filePath: fileB, groupKey: keyB, full: true });
    assert.equal(relay.opCount, 4, "full export peer harus me-relay data hasil import");

    const C = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-m2-C-"));
    const keyC = joinSource(C, A.recovery, "C");
    const relayed = syncApply.applyBundleFile(fileB, keyC);
    assert.equal(relayed.applied, 4);
    assert.equal(dbmod.allMemories().length, 2);
    assert.equal(dbmod.allMemoryLinks().length, 1);
    assert.equal(relayed.deferredEmbeddings, 2);
    const status = keys.syncStatus({ passphrase: PASS });
    assert.equal(status.configured, true);
    assert.ok(status.lastImportHlc);
    assert.equal(status.embeddingsQueued, 2);
    dbmod.closeDb();
    for (const dir of [A.dir, B, C]) fs.rmSync(dir, { recursive: true, force: true });
  });
});

test("delta + LWW conflict + tombstone mencegah resurrect", () => {
  const A = setupSource("A");
  const pid = dbmod.ensureProject("lww-demo", "/tmp/lww-demo");
  dbmod.insertMemory({
    projectId: pid,
    kind: "fact",
    content: "version one",
    importance: 0.5,
    createdAt: Date.now(),
    lastAccessed: 0,
    accessCount: 0,
    sourceTool: "test",
  });
  dbmod.insertMemory({
    projectId: pid,
    kind: "fact",
    content: "stable memory",
    importance: 0.5,
    createdAt: Date.now(),
    lastAccessed: 0,
    accessCount: 0,
    sourceTool: "test",
  });
  const uid1 = dbmod.memoryById(1).uid;
  dbmod.insertMemoryLink(1, 2, "related", 0.8);
  const f1 = path.join(A.dir, "1-full.memsync");
  syncExport.exportBundle({ filePath: f1, groupKey: A.key, full: true });

  dbmod.updateMemory(1, { content: "version two" });
  const f2 = path.join(A.dir, "2-delta.memsync");
  const delta = syncExport.exportBundle({ filePath: f2, groupKey: A.key });
  assert.equal(delta.opCount, 1);
  assert.equal(bundle.readBundleFile(f2, A.key).ops[0].entity, "memory");

  const B = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-m2-B-"));
  const keyB = joinSource(B, A.recovery, "B");
  syncApply.applyBundleFile(f1, keyB);
  syncApply.applyBundleFile(f2, keyB);
  assert.equal(sourceMemory(uid1).content, "version two");

  use(A.dir);
  const f3 = path.join(A.dir, "3-full.memsync");
  syncExport.exportBundle({ filePath: f3, groupKey: A.key, full: true });

  use(B);
  dbmod.observeHlc("9999999999999.000001.future-device");
  dbmod.updateMemory(sourceMemory(uid1).id, { content: "B local wins" });
  const conflicted = syncApply.applyBundleFile(f3, keyB);
  assert.ok(conflicted.conflicts >= 1, "operasi lama harus tercatat sebagai konflik");
  assert.equal(sourceMemory(uid1).content, "B local wins");
  const conflictRow = dbmod.getDb().prepare("SELECT entity, winner_hlc FROM sync_conflicts").get();
  assert.equal(conflictRow.entity, "memory");

  use(A.dir);
  dbmod.deleteMemory(dbmod.memoryById(1).id);
  const f4 = path.join(A.dir, "4-delete.memsync");
  const deleted = syncExport.exportBundle({ filePath: f4, groupKey: A.key });
  const deleteOps = bundle.readBundleFile(f4, A.key).ops;
  assert.equal(deleted.opCount, deleteOps.length);
  assert.ok(deleteOps.some((op) => op.entity === "memory" && op.op === "delete"));
  assert.ok(deleteOps.some((op) => op.entity === "link" && op.op === "delete"));

  const C = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-m2-C-"));
  const keyC = joinSource(C, A.recovery, "C");
  syncApply.applyBundleFile(f3, keyC);
  assert.equal(dbmod.allMemoryLinks().length, 1);
  syncApply.applyBundleFile(f4, keyC);
  assert.equal(sourceMemory(uid1), null, "memori harus terhapus");
  assert.equal(dbmod.allMemories().length, 1);
  assert.equal(dbmod.allMemoryLinks().length, 0);

  const old = syncApply.applyBundleFile(f1, keyC);
  assert.equal(old.applied, 0);
  assert.equal(sourceMemory(uid1), null, "bundle lama tidak boleh menghidupkan kembali memori");
  assert.equal(dbmod.allMemoryLinks().length, 0);
  const tombs = dbmod.getDb().prepare("SELECT entity FROM sync_tombstones ORDER BY entity").all().map((r) => r.entity);
  assert.ok(tombs.includes("memory"));
  assert.ok(tombs.includes("link"));
  dbmod.closeDb();
  for (const dir of [A.dir, B, C]) fs.rmSync(dir, { recursive: true, force: true });
});

test("alias proyek: slug sama di dua mesin tidak menduplikasi proyek", () => {
  const A = setupSource("A");
  const pidA = dbmod.ensureProject("shared-slug", "/tmp/shared-a");
  dbmod.insertMemory({
    projectId: pidA,
    kind: "fact",
    content: "memory with shared slug",
    importance: 0.5,
    createdAt: Date.now(),
    lastAccessed: 0,
    accessCount: 0,
    sourceTool: "test",
  });
  const projectA = dbmod.getDb().prepare("SELECT uid FROM projects WHERE id = ?").get(pidA);
  const fileA = path.join(A.dir, "alias.memsync");
  syncExport.exportBundle({ filePath: fileA, groupKey: A.key, full: true });

  const B = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-m2-B-"));
  const keyB = joinSource(B, A.recovery, "B");
  const pidB = dbmod.ensureProject("shared-slug", "/tmp/shared-b");
  const projectB = dbmod.getDb().prepare("SELECT uid FROM projects WHERE id = ?").get(pidB);
  assert.notEqual(projectB.uid, projectA.uid);
  const applied = syncApply.applyBundleFile(fileA, keyB);
  assert.equal(applied.applied, 2);
  assert.equal(Number(dbmod.getDb().prepare("SELECT COUNT(*) AS c FROM projects").get().c), 1, "slug sama harus merge");
  assert.equal(dbmod.allMemories()[0].projectId, pidB);
  const alias = dbmod.getDb().prepare("SELECT project_id FROM sync_project_alias WHERE remote_uid = ?").get(projectA.uid);
  assert.equal(alias.project_id, pidB);

  const relayFile = path.join(B, "alias-relay.memsync");
  syncExport.exportBundle({ filePath: relayFile, groupKey: keyB, full: true });
  const relayed = bundle.readBundleFile(relayFile, keyB);
  const memoryOp = relayed.ops.find((op) => op.entity === "memory");
  assert.equal(memoryOp.payload.projectUid, projectB.uid, "relay harus memakai UID proyek lokal");

  const C = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-m2-C-"));
  const keyC = joinSource(C, A.recovery, "C");
  syncApply.applyBundleFile(relayFile, keyC);
  assert.equal(Number(dbmod.getDb().prepare("SELECT COUNT(*) AS c FROM projects").get().c), 1);
  assert.equal(dbmod.allMemories()[0].projectId, dbmod.getDb().prepare("SELECT id FROM projects").get().id);
  dbmod.closeDb();
  for (const dir of [A.dir, B, C]) fs.rmSync(dir, { recursive: true, force: true });
});
