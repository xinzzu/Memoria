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

// Ambang kemiripan per dialek: hash-256 lebih kasar → threshold lebih longgar.
function simThreshold(embedModel: string): number {
  return embedModel.startsWith("hash-") ? 0.85 : 0.92;
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[\s,.;:!?"'()[\]{}<>\\/|@#$%^&*+=~`-]+/)
      .filter((t) => t.length > 2)
  );
}

/** Kemiripan teks tanpa embedding (Jaccard token) — jalur dedupe untuk mode tanpa model. */
export function textSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export function addMemoryWithDedupe(m: Memory): DedupeResult {
  if (!m.status) m.status = effectiveStatus();
  const hasEmb = !!(m.embedding && m.embedding.length);
  const threshold = simThreshold(m.embedModel || "");
  const candidates = allMemories().filter((x) => {
    if (m.projectId != null && x.projectId != null && x.projectId !== m.projectId) return false;
    if (hasEmb) return !!(x.embedding && x.embedding.length) && (x.embedModel || "") === (m.embedModel || "");
    return true; // jalur teks: bandingkan dengan semua kandidat proyek sama
  });
  let best = -1;
  let bestSim = 0;
  for (const cand of candidates) {
    const sim = hasEmb && cand.embedding ? cosine(m.embedding!, cand.embedding) : textSimilarity(m.content, cand.content);
    if (sim > bestSim && sim > 0.5) {
      bestSim = sim;
      best = cand.id!;
    }
  }
  // Tanpa embedding pakai threshold lebih ketat (teks lebih mudah false-positive).
  const mergeAt = hasEmb ? threshold : 0.85;
  if (best >= 0 && bestSim >= mergeAt) {
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