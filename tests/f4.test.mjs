/* F4 Zero-AI Brain — snapshot sesi deterministik + deteksi pesan limit.
 * Dijalankan terhadap dist/ (npm test), DB sementara per file. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
const require = createRequire(import.meta.url);

process.env.MEMORIA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-f4-"));
const dbmod = require("../dist/engine/store/db.js");
const snap = require("../dist/engine/extract/snapshot.js");

dbmod.initDb(process.env.MEMORIA_DATA_DIR);

let seq = 0;
function addTranscript(projectId, role, content) {
  dbmod.insertTranscript({
    tool: "claude",
    sessionId: "s-f4",
    projectId,
    role,
    content,
    ts: Date.now(),
    seq: ++seq,
  });
}

/* ---- Deteksi pesan limit ---- */
test("F4: looksLikeLimitMessage — pesan kematian sesi dikenali", () => {
  const positives = [
    "Claude usage limit reached. Your limit will reset at 5pm.",
    "You've hit your weekly usage limit.",
    "You are out of free credits.",
    "Credit balance is too low — top up to continue.",
    "API quota exceeded for this organization.",
    "Upgrade to continue this conversation.",
  ];
  for (const p of positives) assert.ok(snap.looksLikeLimitMessage(p), `harus match: ${p}`);
});

test("F4: looksLikeLimitMessage — pembahasan dev TENTANG limit tidak match", () => {
  const negatives = [
    "Increase the rate limit to 100 requests per minute.",
    "The credit balance field in the ledger table is wrong.",
    "We should document the quota configuration in the README.",
    "Add a retry for 429 rate limit responses.",
    "Set usage_limit_input_tokens to a higher value.",
  ];
  for (const n of negatives) assert.ok(!snap.looksLikeLimitMessage(n), `tidak boleh match: ${n}`);
});

/* ---- Cursor scan: hanya transkrip baru yang diperiksa ---- */
test("F4: collectLimitProjects — deteksi + cursor maju", () => {
  const projId = dbmod.ensureProject("users-mac-f4proj", undefined);
  addTranscript(projId, "user", "tolong perbaiki auth flow di src/auth/login.ts");
  addTranscript(projId, "assistant", "Claude usage limit reached. Reset at 5pm.");
  addTranscript(projId, "user", "ok nanti kita lanjut besok");

  const first = snap.collectLimitProjects();
  assert.deepEqual(first, [projId], "proyek dengan pesan limit harus terdeteksi");

  // Cursor maju: transkrip sama tidak mendeteksi ulang.
  const second = snap.collectLimitProjects();
  assert.deepEqual(second, [], "cursor harus mencegah deteksi ulang");

  // Proyek lain tanpa limit tidak ikut.
  const otherId = dbmod.ensureProject("users-mac-f4clean", undefined);
  addTranscript(otherId, "user", "kerjakan fitur export");
  assert.deepEqual(snap.collectLimitProjects(), [], "transkrip biasa tidak boleh memicu");
});

/* ---- Snapshot sesi deterministik ---- */
test("F4: captureSessionSnapshot — komposisi file/cmd/last + cooldown", async () => {
  const projId = dbmod.ensureProject("users-mac-f4snap", undefined);
  addTranscript(projId, "user", "please fix the auth flow in src/auth/login.ts and update docs/README.md");
  addTranscript(projId, "assistant", "$ npm test to verify the changes");
  addTranscript(projId, "assistant", "Error: cannot connect to database pool exhausted");

  const first = await snap.captureSessionSnapshot(projId, "claude");
  assert.ok(first && first.inserted, "snapshot pertama harus ter-insert");
  const mem = dbmod.allMemories().find((m) => m.content.startsWith("Work snapshot"));
  assert.ok(mem, "memori snapshot harus ada");
  assert.match(mem.content, /login\.ts/, "file yang disentuh harus masuk");
  assert.match(mem.content, /README\.md/, "file kedua harus masuk");
  assert.match(mem.content, /npm test/, "command harus masuk");
  assert.match(mem.content, /cannot connect to database/, "error harus masuk");
  assert.match(mem.content, /auth flow/, "pesan user terakhir harus masuk");
  assert.equal(mem.kind, "context");
  assert.equal(mem.origin, "heuristic");

  // Cooldown: panggilan kedua segera di-skip.
  const second = await snap.captureSessionSnapshot(projId, "claude");
  assert.equal(second, null, "snapshot kedua harus di-cooldown");

  // Snapshot menaikkan pending extraction? Tidak — snapshot sudah memori final.
  // Dedupe: snapshot identik (setelah cooldown dipaksa lewat) harus merge.
  dbmod.setSetting(`f4snap:${projId}`, String(Date.now() - 16 * 60_000));
  const third = await snap.captureSessionSnapshot(projId, "claude");
  assert.ok(third && !third.inserted && third.mergedInto === mem.id, "snapshot sama harus merge ke yang lama");
});
