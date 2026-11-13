/* PR-G: Obsidian dua arah — sisi IMPORT. Ekspor .md sudah ada
 * (POST /api/export/obsidian); kini folder catatan markdown (vault Obsidian,
 * memory-bank Cline, catatan lain) bisa diimpor jadi memori: judul = heading
 * pertama atau nama file, isi dibatasi 1200 char. Idempoten: impor ulang
 * folder yang sama ter-merge via dedupe (Jaccard), bukan menumpuk. */
import * as fs from "node:fs";
import * as path from "node:path";
import { addMemoryWithDedupe } from "../extract/dedupe";
import { getEmbedProvider } from "../extract/provider";
import { projectSlugFromCwd, looksLikePath } from "../ingest/util";
import { effectiveStatus, ensureProject, getDb } from "../store/db";

export interface ImportMdResult {
  imported: number;
  merged: number;
  skipped: number;
}

const MAX_FILES = 500;
const MIN_CHARS = 20;
const MAX_CHARS = 1200;

function walkMd(folder: string, out: string[] = [], depth = 0): string[] {
  if (depth > 2) return out; // vault besar: cukup 2 tingkat
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(folder, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (out.length >= MAX_FILES) break;
    const full = path.join(folder, e.name);
    if (e.isDirectory()) {
      if (!e.name.startsWith(".")) walkMd(full, out, depth + 1);
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

/** Import semua .md dalam folder sebagai memori. project: path atau nama
 * proyek (opsional). Idempoten berkat dedupe konten. */
export async function importMarkdownNotes(folder: string, project?: string): Promise<ImportMdResult> {
  const result: ImportMdResult = { imported: 0, merged: 0, skipped: 0 };
  const stat = fs.existsSync(folder) && fs.statSync(folder).isDirectory();
  if (!stat) throw new Error(`Folder not found or not a directory: ${folder}`);

  const projectId = project && project !== "_unknown"
    ? (() => {
        const db = getDb();
        const slug = projectSlugFromCwd(looksLikePath(project) ? project : `${project}`);
        const existing = db.prepare("SELECT id FROM projects WHERE slug = ?").get(slug) as { id: number } | undefined;
        return existing ? existing.id : ensureProject(slug, looksLikePath(project) ? project : undefined);
      })()
    : null;

  const eprov = await getEmbedProvider();
  const files = walkMd(folder);
  for (const file of files) {
    let text = "";
    try {
      text = fs.readFileSync(file, "utf-8").trim();
    } catch {
      result.skipped++;
      continue;
    }
    if (text.length < MIN_CHARS) {
      result.skipped++;
      continue;
    }
    // Judul: heading pertama, fallback nama file.
    const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
    const title = heading || path.basename(file, ".md");
    const body = text.slice(0, MAX_CHARS);
    const content = `${title}\n${body}`.slice(0, MAX_CHARS + 200);

    const embedding = await eprov.embed(content);
    const r = addMemoryWithDedupe({
      projectId,
      kind: "context",
      content,
      importance: 0.6,
      createdAt: Date.now(),
      lastAccessed: 0,
      accessCount: 0,
      sourceTool: "obsidian-import",
      embedding: embedding ?? null,
      status: effectiveStatus(),
      origin: "user",
      embedModel: embedding ? eprov.embedModel : "",
    });
    if (r.inserted) result.imported++;
    else result.merged++;
    if (result.imported + result.merged + result.skipped >= MAX_FILES) break;
  }
  return result;
}
