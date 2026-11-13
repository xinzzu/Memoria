import { insertMemory, updateMemory, Memory, effectiveStatus, getDb, decodeEmbedding } from "../store/db";
import { emitEvent } from "../events";

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
  /** id memori yang kontennya DIGANTI (smart remember UPDATE). */
  updated?: number;
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

/** Kandidat dedupe via SQL (F1C 5.4) — dulu full-scan allMemories() lalu
 * filter di JS. Catatan: pada jalur teks kandidat project_id NULL ikut
 * dibandingkan (perilaku filter lama dipertahankan persis). */
function dedupeCandidates(m: Memory, hasEmb: boolean): Memory[] {
  const where = ["archived = 0", "status = 'active'"];
  const params: Array<string | number> = [];
  if (m.projectId != null) {
    where.push("(project_id IS NULL OR project_id = ?)");
    params.push(m.projectId);
  }
  if (hasEmb) {
    where.push("embedding IS NOT NULL", "length(embedding) > 0", "COALESCE(embed_model, '') = ?");
    params.push(m.embedModel || "");
  }
  params.push(500); // kandidat terbaru saja; duplikat realistis berasal dari sesi terkini
  return (getDb()
    .prepare(`SELECT * FROM memories WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ?`)
    .all(...params) as Array<Record<string, unknown>>)
    .map((r) => ({
      id: r.id as number,
      projectId: (r.project_id as number | null) ?? null,
      kind: r.kind as string,
      content: r.content as string,
      importance: r.importance as number,
      createdAt: r.created_at as number,
      lastAccessed: 0,
      accessCount: 0,
      sourceTool: (r.source_tool as string) ?? "",
      embedding: decodeEmbedding(r.embedding),
      status: (r.status as string) || "active",
      origin: (r.origin as string) || "user",
      embedModel: (r.embed_model as string) || "",
    }));
}

export function addMemoryWithDedupe(m: Memory): DedupeResult {
  if (!m.status) m.status = effectiveStatus();
  const hasEmb = !!(m.embedding && m.embedding.length);
  const threshold = simThreshold(m.embedModel || "");
  const candidates = dedupeCandidates(m, hasEmb);
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
  // Smart remember (mem0-style ADD/UPDATE/NOOP, versi zero-LLM): konten baru
  // yang LEBIH PANJANG dan masih overlap token kuat (subjek sama, informasi
  // bertambah) MENGGANTIKAN konten lama — memori berkembang, bukan menumpuk.
  // Vektor baru ikut ditulis bila ada (updateMemory menulis embedding +
  // embed_model bersamaan). Selain itu: NOOP + importance bump (perilaku lama).
  const tryUpdate = (existing: (typeof candidates)[number]): DedupeResult | null => {
    // Jaccard 0.55: 6/10 token sama jatuh di 0.6 float (0.5999...) — pakai
    // ambang yang aman untuk kasus "perpanjangan kalimat".
    const overlap = textSimilarity(m.content, existing.content);
    if (m.content.length > existing.content.length && overlap >= 0.55) {
      updateMemory(best, {
        content: m.content,
        importance: Math.max(existing.importance, m.importance),
        ...(m.embedding && m.embedding.length ? { embedding: m.embedding, embedModel: m.embedModel } : {}),
      });
      return { inserted: false, mergedInto: best, updated: best };
    }
    return null;
  };
  const updateSim = hasEmb ? 0.6 : 0.75; // jalur teks lebih ketat (rawan false-positive)
  if (best >= 0 && bestSim >= mergeAt) {
    const existing = candidates.find((c) => c.id === best)!;
    const updated = tryUpdate(existing);
    if (updated) return updated;
    updateMemory(best, {
      importance: Math.max(existing.importance, m.importance),
    });
    return { inserted: false, mergedInto: best };
  }
  if (best >= 0 && bestSim >= updateSim) {
    // Di bawah ambang merge: UPDATE hanya bila jelas perpanjangan fakta sama.
    const existing = candidates.find((c) => c.id === best)!;
    const updated = tryUpdate(existing);
    if (updated) return updated;
  }
  const newId = insertMemory(m);
  if (newId != null) linkNew(newId);
  emitEvent("memory", { kind: m.kind });
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


function cosineSimilarity(a: number[], b: number[]): number {
  return cosine(a, b);
}