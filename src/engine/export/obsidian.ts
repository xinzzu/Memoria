import * as fs from "node:fs";
import * as path from "node:path";
import { allMemories, projectSlugById, linksForMemory, tagsForMemory, entitiesForMemory } from "../store/db";

const KIND_LABEL: Record<string, string> = {
  fact: "Fakta",
  decision: "Keputusan",
  task_done: "Tugas selesai",
  task_pending: "Tugas pending",
  error_fixed: "Error diperbaiki",
  preference: "Preferensi",
  context: "Konteks",
};

function slugify(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return base || "memori";
}

export function exportObsidianVault(dir: string): { ok: boolean; dir: string; notes: number; error?: string } {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const mems = allMemories();
    const used = new Map<number, string>();
    let notes = 0;

    for (const m of mems) {
      const file = `m${m.id}-${slugify(m.content)}.md`;
      used.set(m.id!, file);
    }

    const index: string[] = ["# Pustaka Memori — Memoria", "", "> Diekspor otomatis dari Memoria. Jangan edit langsung — kembali ke aplikasi untuk perubahan.", ""];

    for (const m of mems) {
      const tags = tagsForMemory(m.id!);
      const entities = entitiesForMemory(m.id!);
      const rels = linksForMemory(m.id!, 10);
      const file = `m${m.id}-${slugify(m.content)}.md`;
      const lines: string[] = [];
      lines.push("---");
      lines.push(`kind: ${m.kind}`);
      lines.push(`jenis: ${KIND_LABEL[m.kind] || m.kind}`);
      lines.push(`kepentingan: ${Math.round(m.importance * 100)}`);
      lines.push(`proyek: ${projectSlugById(m.projectId) || "global"}`);
      lines.push(`sumber: ${m.sourceTool}`);
      lines.push(`dibuat: ${new Date(m.createdAt).toISOString()}`);
      if (tags.length) lines.push(`tags:\n${tags.map((t) => `  - ${t}`).join("\n")}`);
      lines.push("---");
      lines.push("");
      lines.push(m.content);
      if (entities.length) {
        lines.push("", "## Entitas");
        for (const e of entities) lines.push(`- \`${e.text}\` (${e.type})`);
      }
      if (rels.length) {
        lines.push("", "## Terhubung");
        for (const r of rels) {
          const file = used.get(r.memoryId);
          if (file) lines.push(`- [[${file.replace(/\.md$/, "")}]] — ${r.kind}`);
        }
      }
      lines.push("");
      fs.writeFileSync(path.join(dir, file), lines.join("\n"), "utf8");
      notes++;
      const slug = file.replace(/\.md$/, "");
      index.push(`- [[${slug}]] — ${KIND_LABEL[m.kind] || m.kind} · ${projectSlugById(m.projectId) || "global"}`);
    }

    index.push("", `---`, `_${notes} catatan diekspor._`);
    fs.writeFileSync(path.join(dir, "Index.md"), index.join("\n"), "utf8");
    return { ok: true, dir, notes };
  } catch (e) {
    return { ok: false, dir, notes: 0, error: String(e) };
  }
}
