import * as fs from "node:fs";
import * as path from "node:path";
import { allMemories, getDb, projectRecord, getBoolSetting, getSetting, setSetting } from "./store/db";
import { runGitLog, isGitRepo } from "./git";

const KIND_LABEL: Record<string, string> = {
  fact: "Fakta / Arsitektur",
  decision: "Keputusan",
  task_done: "Tugas Selesai",
  task_pending: "Tugas Berjalan / Rencana",
  error_fixed: "Error & Solusi",
  preference: "Preferensi User",
  context: "Konteks",
};

export interface HandoffOptions {
  slim?: boolean;
  topKinds?: string[];
}

export async function generateHandoff(slug: string, opts: HandoffOptions = {}): Promise<string> {
  const proj = projectRecord(slug);
  if (!proj) return `# Handoff — ${slug}\n\n(Tidak ada data proyek)`;

  const lines: string[] = [];
  lines.push(`# Handoff Proyek: ${proj.name || slug}`);
  lines.push(`> Dibuat oleh Memoria — ${new Date().toISOString().slice(0, 16)}`);

  const memories = allMemories().filter((m) => m.projectId === proj.id);
  lines.push("", `## Memori (${memories.length})`);
  if (!memories.length) {
    lines.push("Belum ada memori untuk proyek ini.");
  } else {
    const order: string[] = opts.topKinds || ["task_pending", "decision", "error_fixed", "fact", "preference", "context", "task_done"];
    const buckets = new Map<string, typeof memories>();
    for (const m of memories) {
      if (!buckets.has(m.kind)) buckets.set(m.kind, []);
      buckets.get(m.kind)!.push(m);
    }
    let total = 0;
    const maxTotal = opts.slim ? 12 : 50;
    for (const kind of order) {
      if (total >= maxTotal) break;
      const items = buckets.get(kind);
      if (!items?.length) continue;
      lines.push("", `### ${KIND_LABEL[kind] || kind}`);
      const sorted = items.sort((a, b) => b.importance - a.importance);
      const take = opts.slim ? Math.max(1, Math.ceil((maxTotal - total) / (order.length - order.indexOf(kind)))) : sorted.length;
      for (const it of sorted.slice(0, take)) {
        lines.push(`- [${(it.importance * 100).toFixed(0)}] ${it.content}`);
        total++;
        if (total >= maxTotal) break;
      }
    }
  }

  if (!opts.slim && proj.path && fs.existsSync(proj.path)) {
    if (await isGitRepo(proj.path)) {
      const gitLog = await runGitLog(proj.path, 15);
      if (gitLog.length) {
        lines.push("", "## Aktivitas Git Terbaru");
        for (const g of gitLog) lines.push(`- ${g.date} ${g.message}`);
      }
    }
  }

  if (!opts.slim) {
    const db = getDb();
    const lastT = db
      .prepare(
        `SELECT role, content, ts FROM transcripts WHERE project_id = ? ORDER BY ts DESC LIMIT 5`
      )
      .all(proj.id) as Array<{ role: string; content: string; ts: number }>;
    if (lastT.length) {
      lines.push("", "## Aktivitas Terakhir", "");
      for (const t of lastT.reverse()) {
        const text = t.content.replace(/\s+/g, " ").slice(0, 180);
        lines.push(`- (${t.role}) ${text}`);
      }
    }
  }

  return lines.join("\n");
}

const MARK_START = "<!-- memoria:start -->";
const MARK_END = "<!-- memoria:end -->";
const MARK_RE = /<!-- (?:pecut-memory|memoria):start -->[\s\S]*?<!-- (?:pecut-memory|memoria):end -->\n?/;

export async function injectHandoff(slug: string, targetFile = "AGENTS.md", opts: HandoffOptions = {}): Promise<{ ok: boolean; file: string }> {
  const proj = projectRecord(slug);
  if (!proj || !proj.path) return { ok: false, file: targetFile };
  const md = await generateHandoff(slug, opts);
  const block = `${MARK_START}\n${md}\n${MARK_END}\n`;
  const target = path.join(proj.path, targetFile);
  try {
    let existing = "";
    if (fs.existsSync(target)) existing = fs.readFileSync(target, "utf8");
    if (existing.includes(MARK_START) && existing.includes(MARK_END)) {
      existing = existing.replace(MARK_RE, block);
    } else if (existing.includes("<!-- pecut-memory:start -->")) {
      existing = existing.replace(MARK_RE, block);
    } else {
      existing = existing.trimEnd() + "\n\n" + block;
    }
    fs.writeFileSync(target, existing, "utf8");
    return { ok: true, file: targetFile };
  } catch {
    return { ok: false, file: targetFile };
  }
}

export async function autoInjectContext(): Promise<string[]> {
  if (!getBoolSetting("autoInjectProjectFiles", true)) return [];
  const injected: string[] = [];
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT slug, id FROM projects
       WHERE last_seen >= ? AND path IS NOT NULL AND path != ''
       ORDER BY last_seen DESC LIMIT 10`
    )
    .all(Date.now() - 7 * 86400000) as Array<{ slug: string; id: number }>;
  for (const p of rows) {
    try {
      const lastTs = db
        .prepare("SELECT MAX(ts) AS m FROM transcripts WHERE project_id = ?")
        .get(p.id) as { m: number };
      const lastInject = Number(getSetting(`proj:${p.slug}:handoff_at`, "0"));
      if (lastTs.m > lastInject) {
        const r = await injectHandoff(p.slug, "AGENTS.md", { slim: true });
        if (r.ok) {
          setSetting(`proj:${p.slug}:handoff_at`, String(Date.now()));
          injected.push(p.slug);
        }
      }
    } catch {
      continue;
    }
  }
  return injected;
}

export function removeInject(slug: string, targetFile = "AGENTS.md"): { ok: boolean; file: string } {
  const proj = projectRecord(slug);
  if (!proj || !proj.path) return { ok: false, file: targetFile };
  const target = path.join(proj.path, targetFile);
  try {
    if (!fs.existsSync(target)) return { ok: false, file: targetFile };
    const content = fs.readFileSync(target, "utf8");
    const next = content.replace(MARK_RE, "");
    fs.writeFileSync(target, next, "utf8");
    return { ok: true, file: targetFile };
  } catch {
    return { ok: false, file: targetFile };
  }
}