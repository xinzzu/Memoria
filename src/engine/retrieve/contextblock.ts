/* A3 — Blok konteks siap-tempel (ala Basic Memory build_context / Zep context
 * string): rakit project brief + memori kunci + hasil query + relasi 1-hop
 * menjadi SATU markdown dengan budget karakter, siap dipakai agent langsung
 * tanpa merakit sendiri. Ekspor murni agar mudah diuji. */
import { projectContext, searchMemories } from "./search";
import { relatedMemories } from "../graph";
import { resolveProject, getProjectBrief } from "../store/db";

export interface BuildContextOpts {
  project: string;
  query?: string;
  limit?: number;
  maxChars?: number;
  embedModel?: string;
  queryEmbedding?: number[] | null;
}

export function buildContextBlock(o: BuildContextOpts): string {
  const maxChars = Math.max(500, Math.min(20000, o.maxChars || 6000));
  const proj = resolveProject(o.project);
  if (!proj) return `No project found matching "${o.project}".`;

  const parts: string[] = [];
  const brief = getProjectBrief(proj.id);
  if (brief) {
    parts.push(`## Project brief (${proj.slug})\n${brief.content}`);
  }
  const ctx = projectContext(proj.slug, o.limit ?? 12).filter((h) => h.kind !== "brief");
  if (ctx.length) {
    parts.push(
      "## Key memories\n" + ctx.map((h) => `- [${h.kind}] ${h.content.replace(/\s+/g, " ")}`).join("\n")
    );
  }
  if (o.query) {
    const hits = searchMemories(
      o.query,
      { limit: 5, projectSlug: proj.slug, embedModel: o.embedModel },
      o.queryEmbedding ?? null
    );
    if (hits.length) {
      parts.push(
        `## Matching "${o.query}"\n` +
          hits.map((h) => `- [${h.kind}] ${h.content.replace(/\s+/g, " ")}`).join("\n")
      );
      // Traversal 1-hop dari hit teratas — murah dan menambah konteks nyata.
      const rel = relatedMemories(hits[0].id, 3);
      if (rel.length) {
        parts.push(
          "## Related (1-hop)\n" +
            rel
              .map((r) => `- [${r.linkKind}] ${r.memory.content.replace(/\s+/g, " ").slice(0, 120)}`)
              .join("\n")
        );
      }
    }
  }

  let block = `# Memoria context — ${proj.slug}\n\n${parts.join("\n\n")}`;
  if (block.length > maxChars) block = block.slice(0, maxChars - 1) + "…";
  return block;
}
