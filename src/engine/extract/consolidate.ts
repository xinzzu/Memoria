/* PR-B: Konsolidasi berkala (ala mcp-memory-service / "Dream"-nya mem0,
 * versi zero-LLM): memori nyaris-duplikat di-cluster per proyek + kind →
 * digabung ke yang terbaik (konten terpanjang, importance maksimum, tag
 * gabungan), sisanya dihapus (tombstone sinkron). Vektor dihitung lokal via
 * provider hash-embed bila belum ada — nol biaya, nol network.
 *
 * Guard konservatif: hanya kandidat proyek sama + kind sama + cosine ≥ 0.85
 * (ambang hash-dialek yang sama dengan dedupe). Brief proyek dikecualikan. */
import { deleteMemory, replaceMemoryTags, tagsForMemory, updateMemory } from "../store/db";
import { cosine } from "../vecindex";
import { getEmbedProvider, embedManyVia } from "./provider";

export interface ConsolidateResult {
  clusters: number;
  removed: number;
}

const THRESHOLD = 0.85;
const CAP = 400;

export async function consolidateMemories(limit = CAP): Promise<ConsolidateResult> {
  const d = (await import("../store/db")).getDb();
  const rows = d
    .prepare(
      `SELECT id, project_id, kind, content, importance FROM memories
       WHERE archived = 0 AND status = 'active' AND content NOT LIKE 'Project brief:%'
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(limit) as Array<{ id: number; project_id: number | null; kind: string; content: string; importance: number }>;
  if (rows.length < 2) return { clusters: 0, removed: 0 };

  const eprov = await getEmbedProvider();
  const embs = await embedManyVia(eprov, rows.map((r) => r.content));

  type Item = { mem: (typeof rows)[number]; emb: number[] };
  const groups = new Map<string, Item[]>();
  for (let i = 0; i < rows.length; i++) {
    const emb = embs[i];
    if (!emb || !emb.length) continue;
    const key = `${rows[i].project_id ?? "_"}|${rows[i].kind}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ mem: rows[i], emb });
  }

  let clusters = 0;
  let removed = 0;
  for (const items of groups.values()) {
    // Greedy clustering per grup: item gabung ke cluster pertama yang
    // representatifnya mirip; kalau tidak ada, jadi cluster baru.
    const groupsInGroup: Item[][] = [];
    for (const it of items) {
      let placed = false;
      for (const cluster of groupsInGroup) {
        if (cosine(it.emb, cluster[0].emb) >= THRESHOLD) {
          cluster.push(it);
          placed = true;
          break;
        }
      }
      if (!placed) groupsInGroup.push([it]);
    }
    for (const cluster of groupsInGroup) {
      if (cluster.length < 2) continue;
      const sorted = [...cluster].sort(
        (a, b) => b.mem.content.length - a.mem.content.length || b.mem.importance - a.mem.importance
      );
      const survivor = sorted[0].mem;
      const others = sorted.slice(1).map((x) => x.mem);
      // Tag gabungan: tidak ada tag yang hilang saat penggabungan.
      const tags = new Set<string>();
      for (const m of [survivor, ...others]) {
        for (const t of tagsForMemory(m.id)) tags.add(t);
      }
      replaceMemoryTags(survivor.id, [...tags]);
      const maxImp = Math.max(survivor.importance, ...others.map((o) => o.importance));
      if (maxImp > survivor.importance) updateMemory(survivor.id, { importance: maxImp });
      for (const o of others) {
        if (deleteMemory(o.id)) removed++;
      }
      clusters++;
    }
  }
  return { clusters, removed };
}
