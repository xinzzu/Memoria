import { allMemories, insertMemory, updateMemory, Memory, effectiveStatus, getDb } from "../store/db";

export function cosine(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
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

export interface DedupeResult {
  inserted: boolean;
  mergedInto?: number;
}

export function addMemoryWithDedupe(m: Memory): DedupeResult {
  if (!m.status) m.status = effectiveStatus();
  if (!m.embedding || !m.embedding.length) {
    insertMemory(m);
    const newId = lastInsertId();
    if (newId != null) linkNew(newId);
    return { inserted: true };
  }
  const candidates = allMemories().filter((x) => x.embedding && x.embedding.length);
  let best = -1;
  let bestSim = 0;
  for (const cand of candidates) {
    if (m.projectId != null && cand.projectId != null && cand.projectId !== m.projectId) continue;
    const sim = cosine(m.embedding, cand.embedding!);
    if (sim > bestSim && sim > 0.5) {
      bestSim = sim;
      best = cand.id!;
    }
  }
  if (bestSim >= 0.92) {
    const existing = candidates.find((c) => c.id === best)!;
    updateMemory(best, {
      importance: Math.max(existing.importance, m.importance),
    });
    return { inserted: false, mergedInto: best };
  }
  insertMemory(m);
  const newId = lastInsertId();
  if (newId != null) linkNew(newId);
  return { inserted: true };
}

function linkNew(id: number): void {
  try {
    const { linkMemory } = require("../graph") as typeof import("../graph");
    linkMemory(id, 600);
  } catch {
    // link bersifat opsional
  }
}

function lastInsertId(): number | null {
  try {
    const row = getDb().prepare("SELECT last_insert_rowid() AS id").get() as { id: number };
    return row.id || null;
  } catch {
    return null;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  return cosine(a, b);
}