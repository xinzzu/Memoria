import { getDb, allMemories, projectSlugById, readMemories, Memory } from "../store/db";
import { vecCandidates } from "../vecfind";
import { cosine as vecCosine } from "../vecindex";

export interface SearchHit {
  id: number;
  kind: string;
  content: string;
  importance: number;
  createdAt: number;
  sourceTool: string;
  projectSlug: string | null;
  score: number;
}

function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 2;
  const n = a.length;
  const m = b.length;
  const dp = new Uint8Array(m + 1);
  for (let j = 0; j <= m; j++) dp[j] = j;
  for (let i = 1; i <= n; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= m; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[m];
}

const TOKEN_RE = /[\s,.;:!?()[\]{}"'/\\-]+/;

export function keywordScore(content: string, query: string): number {
  const tokens = query.toLowerCase().split(TOKEN_RE).filter((t) => t.length > 2);
  if (!tokens.length) return 0;
  const text = content.toLowerCase();
  const words = new Set(text.split(TOKEN_RE).filter((w) => w.length > 2));
  let hits = 0;
  for (const t of tokens) {
    if (text.includes(t)) {
      hits++;
      continue;
    }
    if (t.length >= 4) {
      for (const w of words) {
        if (w.startsWith(t) || t.startsWith(w) || editDistance(t, w) <= 1) {
          hits++;
          break;
        }
      }
    }
  }
  return hits / tokens.length;
}

/* ---------- Kandidat keyword via FTS5 (F1C 5.1) ----------
 * Dulu: keywordScore dijalankan atas SEMUA memori aktif (allMemories()).
 * Kini FTS5 memilih kandidat (bm25, maks 200), lalu keywordScore yang sama
 * dirun ulang HANYA di atas kandidat sebagai rerank — formula blend final
 * tidak berubah. Tokenizer trigram dipilih agar MATCH '"tok"' bersifat
 * substring — setara text.includes() di keywordScore; token legacy difilter
 * length > 2 sehingga selalu ≥3 char (syarat minimum trigram). */

function ftsQuery(query: string, mode: "and" | "or"): string {
  const tokens = query.toLowerCase().split(TOKEN_RE).filter((t) => t.length > 2);
  if (!tokens.length) return "";
  // Quote tiap token (escape " ganda) agar karakter spesial FTS diabaikan.
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(mode === "and" ? " " : " OR ");
}

function ftsSelect(match: string, kind?: string): Memory[] {
  const where = [
    "id IN (SELECT rowid FROM memories_fts WHERE memories_fts MATCH ? ORDER BY bm25(memories_fts) LIMIT 200)",
    "archived = 0",
    "status = 'active'",
  ];
  const params: Array<string | number> = [match];
  if (kind) {
    where.push("kind = ?");
    params.push(kind);
  }
  return readMemories(`WHERE ${where.join(" AND ")}`, params);
}

/** null = fallback ke jalur legacy (token kosong / query FTS error / FTS tak
 * menemukan apa pun — menjaga recall typo fuzzy editDistance yang tak bisa
 * dilakukan FTS, dengan biaya scan penuh hanya pada query yang kosong). */
function ftsCandidates(query: string, kind?: string): Memory[] | null {
  const qAnd = ftsQuery(query, "and");
  const qOr = ftsQuery(query, "or");
  if (!qAnd && !qOr) return null;
  try {
    if (qAnd) {
      const rows = ftsSelect(qAnd, kind);
      if (rows.length) return rows;
    }
    // Semua token wajib hadir terlalu ketat → longgarkan ke OR.
    if (qOr) {
      const rows = ftsSelect(qOr, kind);
      if (rows.length) return rows;
    }
    return null;
  } catch {
    return null;
  }
}

export function searchMemories(
  query: string,
  opts: { limit?: number; projectSlug?: string; kind?: string; embedModel?: string } = {},
  queryEmbedding?: number[] | null
): SearchHit[] {
  const limit = opts.limit ?? 10;
  // Kandidat dari FTS5; null (token kosong/query error) → scan legacy penuh,
  // jadi hasil tidak pernah lebih buruk dari implementasi lama.
  const memories = ftsCandidates(query, opts.kind) ?? allMemories();
  const hits: SearchHit[] = [];
  const now = Date.now();
  const centrality = loadCentrality();
  const qEmb = queryEmbedding && queryEmbedding.length ? queryEmbedding : null;
  // Guard dialek: vektor dari model berbeda tidak boleh dibandingkan silang.
  const qModel = opts.embedModel || "";
  const semCands = qEmb ? vecCandidates(qEmb, limit, qModel) : null;

  for (const m of memories) {
    if (opts.projectSlug) {
      const slug = projectSlugById(m.projectId);
      if (slug !== opts.projectSlug) continue;
    }
    if (opts.kind && m.kind !== opts.kind) continue;
    const kw = keywordScore(m.content, query);
    const sem = m.embedding && qEmb && (m.embedModel || "") === qModel && (!semCands || semCands.has(m.id!))
      ? vecCosine(m.embedding, qEmb)
      : 0;
    const ageDays = (now - m.createdAt) / 86400000;
    const recency = Math.exp(-ageDays / 30);
    const degree = centrality.get(m.id!) || 0;
    const centralityNorm = Math.min(1, degree / 6);
    const score = kw * 0.5 + sem * 0.3 + m.importance * 0.05 * Math.max(kw, 0.1) + recency * 0.08 + centralityNorm * 0.07;
    if (score > 0.02 || sem > 0.25) {
      hits.push({
        id: m.id!,
        kind: m.kind,
        content: m.content,
        importance: m.importance,
        createdAt: m.createdAt,
        sourceTool: m.sourceTool,
        projectSlug: projectSlugById(m.projectId),
        score,
      });
    }
  }
  const ranked = hits.sort((a, b) => b.score - a.score).slice(0, limit);
  for (const h of ranked) {
    getDb().prepare("UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?").run(now, h.id);
  }
  return ranked;
}

let centralityCache: Map<number, number> | null = null;

function loadCentrality(): Map<number, number> {
  if (centralityCache) return centralityCache;
  const rows = getDb()
    .prepare(
      `SELECT from_memory_id AS a, to_memory_id AS b FROM memory_links`
    )
    .all() as Array<{ a: number; b: number }>;
  const map = new Map<number, number>();
  for (const r of rows) {
    map.set(r.a, (map.get(r.a) || 0) + 1);
    map.set(r.b, (map.get(r.b) || 0) + 1);
  }
  centralityCache = map;
  return map;
}

export function invalidateCentrality(): void {
  centralityCache = null;
}

export function projectContext(projectSlug: string, limit = 8): SearchHit[] {
  const memories = allMemories();
  const now = Date.now();
  const hits: SearchHit[] = [];
  for (const m of memories) {
    if (projectSlugById(m.projectId) !== projectSlug) continue;
    const ageDays = (now - m.createdAt) / 86400000;
    const recency = Math.exp(-ageDays / 14);
    const score = m.importance * 0.7 + recency * 0.3;
    hits.push({
      id: m.id!,
      kind: m.kind,
      content: m.content,
      importance: m.importance,
      createdAt: m.createdAt,
      sourceTool: m.sourceTool,
      projectSlug,
      score,
    });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
