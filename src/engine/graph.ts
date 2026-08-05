import { allMemories, Memory, insertMemoryLink, clearMemoryLinks, projectSlugById, projectRecord, getDb, linksForMemory, allMemoryLinks } from "./store/db";
import { cosine } from "./extract/dedupe";
import { invalidateCentrality } from "./retrieve/search";

const SIM_THRESHOLD = 0.72;
const KEYWORD_THRESHOLD = 0.8;

function keywords(m: Memory): string[] {
  const stop = new Set([
    "yang", "dan", "atau", "untuk", "dengan", "dari", "pada", "ke", "di", "ini", "itu", "agar",
    "the", "and", "for", "with", "from", "that", "this", "project", "user", "a", "an", "to", "of", "in", "on",
  ]);
  const words = m.content.toLowerCase().match(/[a-z0-9_\-\.]+/g) || [];
  const freq = new Map<string, number>();
  for (const w of words) {
    if (w.length < 4 || stop.has(w)) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w);
}

function keywordOverlap(a: Memory, b: Memory): number {
  const ka = keywords(a);
  const kb = keywords(b);
  if (!ka.length || !kb.length) return 0;
  const set = new Set(kb);
  let hit = 0;
  for (const k of ka) if (set.has(k)) hit++;
  return hit / Math.max(1, Math.min(ka.length, kb.length));
}

export function linkMemory(id: number, sampleLimit = 600): void {
  const mems = allMemories();
  const me = mems.find((m) => m.id === id);
  if (!me) return;

  let candidates = mems.filter((m) => m.id !== id);
  candidates.sort((a, b) => {
    const score = (x: Memory) => (x.projectId != null && x.projectId === me.projectId ? 1 : 0);
    return score(b) - score(a);
  });
  if (candidates.length > sampleLimit) candidates = candidates.slice(0, sampleLimit);

  for (const other of candidates) {
    let kind = "";
    let weight = 0;

    if (me.embedding && other.embedding && me.embedding.length && other.embedding.length) {
      const sim = cosine(me.embedding, other.embedding);
      if (sim >= SIM_THRESHOLD) {
        kind = "similar";
        weight = sim;
      }
    }
    if (!kind) {
      const kov = keywordOverlap(me, other);
      if (kov >= KEYWORD_THRESHOLD) {
        kind = "keyword";
        weight = kov;
      }
    }
    if (!kind && me.projectId != null && me.projectId === other.projectId && me.kind === other.kind) {
      kind = "cohort";
      weight = 0.4;
    }
    if (kind) insertMemoryLink(id, other.id!, kind, weight);
  }
  invalidateCentrality();
}

export function rebuildAllLinks(): number {
  clearMemoryLinks();
  const mems = allMemories();
  for (const m of mems) {
    if (m.id == null) continue;
    linkMemory(m.id, 600);
  }
  const row = getDb().prepare("SELECT COUNT(*) AS c FROM memory_links").get() as { c: number };
  return row.c;
}

export interface GraphNode {
  id: number;
  kind: string;
  content: string;
  importance: number;
  projectSlug: string | null;
  sourceTool: string;
  createdAt: number;
}

export function graphSnapshot(project?: string, nodeLimit = 250): { nodes: GraphNode[]; edges: Array<{ fromId: number; toId: number; kind: string; weight: number }> } {
  let mems = allMemories();
  const projId = project ? projectRecord(project)?.id ?? null : null;
  if (projId != null) mems = mems.filter((m) => m.projectId === projId);

  const sorted = [...mems].sort((a, b) => b.importance - a.importance || b.createdAt - a.createdAt);
  const selected = sorted.slice(0, nodeLimit);
  const ids = new Set(selected.map((m) => m.id));
  const edges = allMemoryLinks(1200).filter((e) => ids.has(e.fromId) && ids.has(e.toId));

  const nodes: GraphNode[] = selected.map((m) => ({
    id: m.id!,
    kind: m.kind,
    content: m.content.length > 90 ? m.content.slice(0, 90) + "…" : m.content,
    importance: m.importance,
    projectSlug: projectSlugById(m.projectId),
    sourceTool: m.sourceTool,
    createdAt: m.createdAt,
  }));
  return { nodes, edges };
}

export function relatedMemories(id: number, limit = 8): Array<{ memory: Memory; linkKind: string; weight: number }> {
  const links = linksForMemory(id, 20);
  const byId = new Map(allMemories().map((m) => [m.id!, m]));
  return links
    .map((l) => ({ memory: byId.get(l.memoryId), linkKind: l.kind, weight: l.weight }))
    .filter((x): x is { memory: Memory; linkKind: string; weight: number } => !!x.memory)
    .slice(0, limit);
}