/* Eval harness lite (PR-D) — LongEval-lite reproducible, zero-LLM.
 * Seed N topik x Q query; setiap topik = beberapa memori sintetis dengan
 * fakta khas + 1 query parafrase + 1 query typo. Ukur hit@1/hit@5 + MRR
 * atas searchMemories (blend keyword FTS + hash-embedding, tanpa model).
 * Deterministik (mulberry32 seed tetap) → angka bisa dipublikasikan.
 * Jalankan manual: npm run build && node scripts/eval-search.mjs [topik] [noise]
 * TIDAK bagian npm test. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const dbmod = require("../dist/engine/store/db.js");
const { searchMemories } = require("../dist/engine/retrieve/search.js");
const { getEmbedProvider } = require("../dist/engine/extract/provider.js");


const TOPICS = Number(process.argv[2] || 120);
const NOISE = Number(process.argv[3] || 400);

// PRNG deterministik — dataset & noise identik antar run.
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(42);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

const SUBJECTS = ["auth-service", "billing-worker", "image-resizer", "cache-layer", "sync-engine", "notify-hub", "graph-renderer", "ingest-watcher"];
const ACTIONS = ["deployed to staging", "refactored retry logic", "migrated to bun runtime", "switched to sqlite-vec index", "rewrote token refresh flow", "moved config to env vars", "split monolith endpoint", "added canary rollout"];
const DETAIL = ["after the incident review", "because the old queue leaked", "with zero-downtime cutover", "using the shared staging cluster", "as agreed in the sync meeting", "to cut p95 latency in half"];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-eval-"));
dbmod.initDb(dir);
const eprov = await getEmbedProvider();

async function insertMem(content, projectId, importance = 0.6, kind = "fact") {
  const emb = await eprov.embed(content);
  dbmod.insertMemory({
    projectId,
    kind,
    content,
    importance,
    createdAt: Date.now() - Math.floor(rnd() * 30) * 86400_000,
    lastAccessed: 0,
    sourceTool: "eval",
    embedding: emb,
    status: "active",
    embedModel: eprov.embedModel,
  });
}

// Noise: memori generik lintas topik (tekanan distractor).
const noiseSubjects = ["css theme", "coffee machine", "office lights", "keyboard shortcuts", "meeting notes", "team offsite"];
for (let i = 0; i < NOISE; i++) {
  await insertMem(`${pick(noiseSubjects)} note ${Math.floor(rnd() * 100000)} — routine entry with little signal`, null, 0.3);
}

// Topik: 3 memori per topik, 1 query parafrase + 1 query typo.
const cases = [];
for (let t = 0; t < TOPICS; t++) {
  const subject = SUBJECTS[t % SUBJECTS.length];
  const action = pick(ACTIONS);
  const detail = pick(DETAIL);
  const anchor = `${subject} was ${action} ${detail}`;
  const projId = dbmod.ensureProject(`eval-topic-${t}`);
  await insertMem(`Decision: ${anchor}`, projId, 0.8, "decision");
  await insertMem(`Context: the ${subject} rollout plan and ${detail}`, projId, 0.5);
  await insertMem(`Follow-up for ${subject}: monitor error rate after the change`, projId, 0.5);
  // Typo hanya di bagian aksi/detail — subjek (kata kunci utama) utuh, seperti
  // user nyata yang salah ketik di tengah kalimat.
  const typo = anchor.replace(/was/, "waz").replace(/the/, "teh");
  cases.push({ expectSubject: subject, query: `what happened with ${subject}?`, anchor });
  cases.push({ expectSubject: subject, query: typo, anchor });
}

// Ukur: hit@1, hit@5, MRR — target = memori DECISION dari topik yang sama.
const d = dbmod.getDb();
let hit1 = 0, hit5 = 0, mrr = 0;
const t0 = performance.now();
for (const c of cases) {
  const emb = await eprov.embed(c.query);
  const hits = searchMemories(c.query, { limit: 10, embedModel: eprov.embedModel }, emb);
  const target = hits.findIndex((h) => h.kind === "decision" && h.content.includes(c.expectSubject));
  if (target === 0) hit1++;
  if (target >= 0 && target < 5) hit5++;
  if (target >= 0) mrr += 1 / (target + 1);
}
const total = cases.length;
const ms = (performance.now() - t0) / total;

console.log(`Eval LongEval-lite (zero-LLM retrieval, hash+FTS5 blend)`);
console.log(`  topics: ${TOPICS} · queries: ${total} · noise memories: ${NOISE}`);
console.log(`  hit@1 : ${((hit1 / total) * 100).toFixed(1)}%`);
console.log(`  hit@5 : ${((hit5 / total) * 100).toFixed(1)}%`);
console.log(`  MRR   : ${(mrr / total).toFixed(3)}`);
console.log(`  avg query latency: ${ms.toFixed(1)} ms`);
console.log(hit5 / total >= 0.7 ? "✅ hit@5 ≥ 70% (lulus ambang eval lite)" : "❌ hit@5 < 70% — retrieval perlu ditinjau");
process.exit(hit5 / total >= 0.7 ? 0 : 1);
