/* Benchmark F1C (Retrieval & Skala) — acceptance ROADMAP:
 *   5.000 memori sintetis → search < 100 ms.
 * Jalankan manual setelah build (TIDAK bagian npm test):
 *   npm run build && node scripts/bench-f1c.mjs [jumlahMemori]
 * Exit 0 bila semua median < 100 ms. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const dbmod = require("../dist/engine/store/db.js");
const { searchMemories } = require("../dist/engine/retrieve/search.js");

const N = Number(process.argv[2] || 5000);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-bench-"));
dbmod.initDb(dir);

const KINDS = ["fact", "decision", "task_done", "error_fixed"];
const COMMON = ["docker", "database", "endpoint", "deploy", "cache", "test", "auth", "queue"];
const RARE = ["zephyr", "quixotic", "vortex"];

const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const words = [];
  for (let w = 0; w < 12; w++) {
    // kata umum dengan komposisi deterministik + kata unik per memori
    words.push(COMMON[(i * 7 + w * 13) % COMMON.length] + (w === 11 ? "-" + i : ""));
  }
  const content = words.join(" ") + " " + RARE[i % RARE.length];
  dbmod.insertMemory({
    projectId: null,
    kind: KINDS[i % KINDS.length],
    content,
    importance: 0.5,
    createdAt: Date.now() - i * 60000,
    sourceTool: "bench",
  });
}
const seedMs = Date.now() - t0;

const bench = (label, fn) => {
  const times = [];
  for (let r = 0; r < 5; r++) {
    const s = performance.now();
    fn();
    times.push(performance.now() - s);
  }
  times.sort((a, b) => a - b);
  const median = times[2];
  console.log(`${label}: median ${median.toFixed(1)} ms (min ${times[0].toFixed(1)}, max ${times[4].toFixed(1)})`);
  return median;
};

console.log(`Seed ${N} memori dalam ${seedMs} ms — DB: ${dir}`);
let ok = true;
ok = bench("search kata umum (banyak kandidat FTS)", () => searchMemories("docker database", { limit: 10 })) < 100 && ok;
ok = bench("search kata jarang", () => searchMemories("zephyr", { limit: 10 })) < 100 && ok;
ok = bench("search substring", () => searchMemories("zeph", { limit: 10 })) < 100 && ok;
console.log(ok ? "✅ semua median < 100 ms (acceptance F1C)" : "❌ ada median ≥ 100 ms");
process.exit(ok ? 0 : 1);
