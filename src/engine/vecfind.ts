import { VecIndex } from "./vecindex";
import { getDb, decodeEmbedding } from "./store/db";

/* Index vektor per-DIALEK: vektor dari model berbeda (nomic vs hash-256 vs
 * embedding LM Studio) tidak boleh dicampur dalam satu ruang pencarian. */

interface DialectIndex {
  index: VecIndex | null;
  count: number;
}

const indexes = new Map<string, DialectIndex>();

function dialectCount(model: string): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM memories
       WHERE archived = 0 AND status = 'active' AND embedding IS NOT NULL AND length(embedding) > 0
         AND COALESCE(embed_model, '') = ?`
    )
    .get(model) as { c: number };
  return row.c;
}

export function ensureVecIndex(model: string): VecIndex | null {
  const target = dialectCount(model);
  const cached = indexes.get(model);
  if (cached && cached.count === target) return cached.index;

  indexes.set(model, { index: null, count: target });
  if (target === 0) return null;

  const rows = getDb()
    .prepare(
      `SELECT id, embedding FROM memories
       WHERE archived = 0 AND status = 'active' AND embedding IS NOT NULL AND length(embedding) > 0
         AND COALESCE(embed_model, '') = ?`
    )
    .all(model) as Array<{ id: number; embedding: Buffer }>;
  let index: VecIndex | null = null;
  let dim = 0;
  for (const r of rows) {
    try {
      const emb = decodeEmbedding(r.embedding) as number[];
      if (!emb || !emb.length) continue;
      if (!dim) dim = emb.length;
      if (!index) index = new VecIndex(dim);
      index.add(r.id, emb);
    } catch {
      continue;
    }
  }
  indexes.set(model, { index, count: target });
  return index;
}

export function invalidateVecIndex(): void {
  indexes.clear();
}

export function vecCandidates(emb: number[], need: number, model = ""): Set<number> {
  const idx = ensureVecIndex(model);
  const set = new Set<number>();
  if (!idx || idx.isEmpty) return set;
  for (const id of idx.search(emb, need)) set.add(id);
  return set;
}