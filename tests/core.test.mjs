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
test("canonicalPath: symlink macOS ter-resolve (/tmp -> /private/tmp)", () => {
  assert.equal(canonicalPath("/tmp"), "/private/tmp");
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
