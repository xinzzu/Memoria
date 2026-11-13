/* PR-G: Import Markdown folder — idempoten (impor ulang ter-merge),
 * file kecil di-skip, proyek dikenali. Dijalankan terhadap dist/ (npm test). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
const require = createRequire(import.meta.url);

process.env.MEMORIA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-md-"));
const dbmod = require("../dist/engine/store/db.js");
const { importMarkdownNotes } = require("../dist/engine/import/markdown.js");

dbmod.initDb(process.env.MEMORIA_DATA_DIR);

const vault = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"));
fs.writeFileSync(
  path.join(vault, "deploy-auth.md"),
  "# Deploy auth\n\nAuth service dideploy ke staging dengan canary rollout. Rollback plan ada di runbook."
);
fs.writeFileSync(
  path.join(vault, "notes.md"),
  "# Meeting notes\n\nKeputusan arsitektur: pakai queue untuk ingest, bukan polling langsung ke file."
);
fs.writeFileSync(path.join(vault, "tiny.md"), "x"); // terlalu kecil → skip
fs.mkdirSync(path.join(vault, "sub"));
fs.writeFileSync(
  path.join(vault, "sub", "preferences.md"),
  "# Preferences\n\nSelalu jalankan npm test sebelum commit perubahan engine."
);

test("import markdown: 3 catatan terimpor, tiny di-skip", async () => {
  const r = await importMarkdownNotes(vault, "/tmp/md-import-project");
  assert.equal(r.imported, 3, `3 file harus terimpor (${JSON.stringify(r)})`);
  assert.equal(r.skipped, 1, "file <20 char harus di-skip");
  const mems = dbmod.allMemories().filter((m) => m.sourceTool === "obsidian-import");
  assert.equal(mems.length, 3);
  const deploy = mems.find((m) => m.content.startsWith("Deploy auth"));
  assert.ok(deploy, "judul dari heading # harus jadi baris pertama");
  assert.match(deploy.content, /canary rollout/);
  assert.ok(deploy.projectId != null, "proyek harus ter-resolve dari path");
  const prefs = mems.find((m) => m.content.startsWith("Preferences"));
  assert.ok(prefs, "file di subfolder harus terbaca");
});

test("import markdown: impor ulang idempoten — ter-merge bukan menumpuk", async () => {
  const r = await importMarkdownNotes(vault, "/tmp/md-import-project");
  assert.equal(r.imported, 0, "impor ulang tidak boleh menambah baru");
  assert.equal(r.merged, 3, "semua harus ter-merge ke memori lama");
  const mems = dbmod.allMemories().filter((m) => m.sourceTool === "obsidian-import");
  assert.equal(mems.length, 3, "jumlah tetap 3 setelah impor ulang");
});

test("import markdown: folder tidak ada → error jelas", async () => {
  await assert.rejects(
    () => importMarkdownNotes("/tidak/ada/folder-ini", undefined),
    /Folder not found/
  );
});
