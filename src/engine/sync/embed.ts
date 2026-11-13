import { getDb, setMemoryEmbedding } from "../store/db";
import { embedManyVia, getEmbedProvider } from "../extract/provider";

/** Vektor tidak ikut disinkronkan. Memori remote yang kontennya berubah
 * dimasukkan ke antrean ini, lalu di-embed ulang dengan dialek lokal. */
export function queueEmbeddingBackfill(memoryId: number): void {
  getDb()
    .prepare("INSERT OR IGNORE INTO sync_embed_queue (memory_id, queued_at) VALUES (?, ?)")
    .run(memoryId, Date.now());
}

export function embeddingBackfillCount(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS c FROM sync_embed_queue").get() as { c: number };
  return Number(row.c);
}

export async function processEmbeddingBackfill(limit = 50): Promise<number> {
  const d = getDb();
  const rows = d
    .prepare(
      `SELECT q.memory_id AS id, m.content
       FROM sync_embed_queue q JOIN memories m ON m.id = q.memory_id
       ORDER BY q.queued_at LIMIT ?`
    )
    .all(limit) as Array<{ id: number; content: string }>;
  if (!rows.length) return 0;

  let done = 0;
  try {
    const provider = await getEmbedProvider();
    const embeddings = await embedManyVia(provider, rows.map((r) => r.content));
    for (let i = 0; i < rows.length; i++) {
      const embedding = embeddings[i];
      if (!embedding || !embedding.length) continue;
      setMemoryEmbedding(rows[i].id, embedding, provider.embedModel);
      d.prepare("DELETE FROM sync_embed_queue WHERE memory_id = ?").run(rows[i].id);
      done++;
    }
  } catch {
    /* biarkan di antrean untuk siklus berikutnya */
  }

  // Memori yang sudah dihapus sebelum sempat di-embed tidak perlu antre.
  d.prepare("DELETE FROM sync_embed_queue WHERE memory_id NOT IN (SELECT id FROM memories)").run();
  return done;
}
