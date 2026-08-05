import { VecIndex } from "./vecindex";
import { getDb } from "./store/db";

let vecIndex: VecIndex | null = null;
let indexCount = -1;

export function ensureVecIndex(): VecIndex | null {
  const cntRow = getDb()
    .prepare(
      "SELECT COUNT(*) AS c FROM memories WHERE archived = 0 AND status = 'active' AND embedding IS NOT NULL AND embedding != ''"
    )
    .get() as { c: number };
  if (vecIndex && indexCount === cntRow.c) return vecIndex;

  vecIndex = null;
  indexCount = cntRow.c;
  if (cntRow.c === 0) return null;

  const rows = getDb()
    .prepare(
      "SELECT id, embedding FROM memories WHERE archived = 0 AND status = 'active' AND embedding IS NOT NULL AND embedding != ''"
    )
    .all() as Array<{ id: number; embedding: string }>;
  let dim = 0;
  for (const r of rows) {
    try {
      const emb = JSON.parse(r.embedding) as number[];
      if (!dim) dim = emb.length;
      if (!vecIndex) vecIndex = new VecIndex(dim);
      vecIndex.add(r.id, emb);
    } catch {
      continue;
    }
  }
  return vecIndex;
}

export function invalidateVecIndex(): void {
  vecIndex = null;
  indexCount = -1;
}

export function vecCandidates(emb: number[], need: number): Set<number> {
  const idx = ensureVecIndex();
  const set = new Set<number>();
  if (!idx || idx.isEmpty) return set;
  for (const id of idx.search(emb, need)) set.add(id);
  return set;
}