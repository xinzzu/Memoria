import * as fs from "node:fs";
import * as path from "node:path";
import { allMemories, getDb, projectRecord, getBoolSetting, getSetting, setSetting } from "./store/db";
import { runGitLog, isGitRepo, runGitStatus, GitStatus } from "./git";

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

/* ---------- Resume Engine: blok "LANJUTAN SESI" ----------
 * Menjawab skenario limit-hopping: user pindah tool di tengah tugas,
 * tool baru harus langsung tahu apa yang sedang dikerjakan.
 * Semua bahan diambil TANPA LLM (murah & cepat):
 *   1. Sesi transkrip terakhir (tool + waktu + pesan penutup)
 *   2. task_pending yang belum selesai (tasklife)
 *   3. decision terbaru (keputusan "terkunci")
 *   4. git status: branch + file yang sedang berubah
 * --------------------------------------------------------- */

interface ResumeData {
  lastTool: string | null;
  lastTs: number;
  tasks: Array<{ content: string; importance: number }>;
  decisions: Array<{ content: string; importance: number }>;
  git: GitStatus | null;
  lastMessages: Array<{ role: string; content: string }>;
}

export async function collectResumeData(slug: string, opts: { slim?: boolean } = {}): Promise<ResumeData | null> {
  const proj = projectRecord(slug);
  if (!proj) return null;
  const db = getDb();
  const maxTasks = opts.slim ? 3 : 5;
  const maxDecisions = opts.slim ? 2 : 3;
  const maxMsgs = opts.slim ? 1 : 3;

  const lastSession = db
    .prepare(
      `SELECT session_id AS sid, tool, MAX(ts) AS m FROM transcripts
       WHERE project_id = ? GROUP BY session_id ORDER BY m DESC LIMIT 1`
    )
    .get(proj.id) as { sid: string; tool: string; m: number } | undefined;

  const tasks = db
    .prepare(
      `SELECT content, importance FROM memories
       WHERE project_id = ? AND kind = 'task_pending' AND archived = 0 AND status = 'active'
         AND COALESCE(resolved_at, 0) = 0
       ORDER BY created_at DESC LIMIT ${maxTasks}`
    )
    .all(proj.id) as Array<{ content: string; importance: number }>;

  const decisions = db
    .prepare(
      `SELECT content, importance FROM memories
       WHERE project_id = ? AND kind = 'decision' AND archived = 0 AND status = 'active'
       ORDER BY created_at DESC LIMIT ${maxDecisions}`
    )
    .all(proj.id) as Array<{ content: string; importance: number }>;

  const lastMessages = lastSession
    ? (
        db
          .prepare(
            `SELECT role, content FROM transcripts
             WHERE project_id = ? AND session_id = ?
             ORDER BY ts DESC, seq DESC LIMIT ${maxMsgs}`
          )
          .all(proj.id, lastSession.sid) as Array<{ role: string; content: string }>
      ).reverse()
    : [];

  const git = proj.path && fs.existsSync(proj.path) ? await runGitStatus(proj.path) : null;

  return {
    lastTool: lastSession?.tool ?? null,
    lastTs: lastSession?.m ?? 0,
    tasks,
    decisions,
    git,
    lastMessages,
  };
}

function hhmm(ts: number): string {
  return new Date(ts).toTimeString().slice(0, 5);
}

function shortText(s: string, max = 140): string {
  return s.replace(/\s+/g, " ").trim().slice(0, max) + (s.length > max ? "…" : "");
}

/** Baris-baris section "⏸️ LANJUTAN SESI" — kosong bila tidak ada data sama sekali. */
export function resumeSectionLines(d: ResumeData): string[] {
  const hasAny = d.lastTool || d.tasks.length || d.decisions.length || (d.git?.dirty.length ?? 0);
  if (!hasAny) return [];
  const lines: string[] = [];
  const head = [
    "## SESSION RESUME",
    `> ${d.lastTool ?? "tool tidak diketahui"}${d.lastTs ? ` · ${hhmm(d.lastTs)}` : ""}${
      d.git?.branch ? ` · branch: ${d.git.branch}` : ""
    }`,
  ];
  lines.push(...head);
  if (d.tasks.length) {
    lines.push("", "**Task terbuka:**");
    for (const t of d.tasks) lines.push(`- [ ] ${shortText(t.content, 160)}`);
  }
  if (d.decisions.length) {
    lines.push("", "**Keputusan terkunci (jangan diulang):**");
    for (const c of d.decisions) lines.push(`- ${shortText(c.content, 160)}`);
  }
  if (d.git?.dirty.length) {
    const extra = Math.max(0, d.git.dirty.length - 8);
    lines.push("", `**File sedang berubah (git):** ${d.git.dirty.slice(0, 8).join(", ")}${extra > 0 ? ` (+${extra} lainnya)` : ""}`);
  }
  if (d.lastMessages.length) {
    lines.push("", "**Pesan terakhir sesi:**");
    for (const m of d.lastMessages) lines.push(`- (${m.role}) ${shortText(m.content, 180)}`);
  }
  lines.push("", "_Lanjutkan pekerjaan di atas — jangan ulangi keputusan yang sudah terkunci._");
  return lines;
}

/** Prompt ringkas siap-paste ke tool mana pun — plan B bila injeksi file tidak terbaca. */
export async function generateResumePrompt(slug: string): Promise<string> {
  const d = await collectResumeData(slug, { slim: true });
  if (!d) return `(Tidak ada data proyek "${slug}")`;
  const lines: string[] = [];
  lines.push(
    `Lanjutkan pekerjaan sebelumnya di proyek ini. Konteks dari Memoria (sesi terakhir: ${
      d.lastTool ?? "?"
    }${d.lastTs ? `, ${hhmm(d.lastTs)}` : ""}):`
  );
  if (d.git?.branch) {
    lines.push(`- Branch: ${d.git.branch}${d.git.dirty.length ? ` — file berubah: ${d.git.dirty.slice(0, 5).join(", ")}` : ""}`);
  }
  if (d.tasks.length) {
    lines.push("- Task terbuka:");
    d.tasks.forEach((t, i) => lines.push(`  ${i + 1}) ${shortText(t.content, 130)}`));
  }
  if (d.decisions.length) {
    lines.push(`- Keputusan terkunci: ${d.decisions.map((c) => shortText(c.content, 80)).join("; ")}`);
  }
  if (d.lastMessages.length) {
    lines.push(`- Pesan terakhir: (${d.lastMessages[0].role}) ${shortText(d.lastMessages[0].content, 120)}`);
  }
  lines.push("Lanjutkan dari situ. Jangan ulangi keputusan di atas.");
  return lines.join("\n");
}

export async function generateHandoff(slug: string, opts: HandoffOptions = {}): Promise<string> {
  const proj = projectRecord(slug);
  if (!proj) return `# Handoff — ${slug}\n\n(Tidak ada data proyek)`;

  const lines: string[] = [];
  lines.push(`# Handoff Proyek: ${proj.name || slug}`);
  lines.push(`> Dibuat oleh Memoria — ${new Date().toISOString().slice(0, 16)}`);

  // Blok resume di PALING ATAS: bagian pertama yang dibaca agent saat sesi baru dibuka.
  try {
    const resume = await collectResumeData(slug, { slim: !!opts.slim });
    const resumeLines = resume ? resumeSectionLines(resume) : [];
    if (resumeLines.length) lines.push("", ...resumeLines);
  } catch {
    // resume section best-effort — jangan blokir handoff utama
  }

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

/* ---------- Multi-file injection ----------
 * Tiap tool membaca file konteks berbeda: Codex/opencode -> AGENTS.md,
 * Claude Code -> CLAUDE.md, Gemini CLI -> GEMINI.md. Blok ber-marker yang sama
 * diinjeksi ke tiap file target. Duplikasi blok (bukan symlink) dipilih agar
 * aman di Windows tanpa privilege khusus. Tiap target bisa dimatikan lewat
 * setting `injectFile:<nama-file>`.
 * ------------------------------------------- */

export const INJECTION_FILES = ["AGENTS.md", "CLAUDE.md", "GEMINI.md"] as const;

export function injectionTargets(): string[] {
  return INJECTION_FILES.filter((f) => getBoolSetting(`injectFile:${f}`, true));
}

export async function injectHandoffAll(slug: string, opts: HandoffOptions = {}): Promise<Array<{ file: string; ok: boolean }>> {
  const results: Array<{ file: string; ok: boolean }> = [];
  for (const file of injectionTargets()) {
    const r = await injectHandoff(slug, file, opts);
    results.push({ file: r.file, ok: r.ok });
  }
  return results;
}

export function removeInjectAll(slug: string): Array<{ file: string; ok: boolean }> {
  return injectionTargets().map((file) => {
    const r = removeInject(slug, file);
    return { file: r.file, ok: r.ok };
  });
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
      // File baru: jangan tambahkan baris kosong di awal.
      existing = existing.trimEnd() ? existing.trimEnd() + "\n\n" + block : block;
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
        const rs = await injectHandoffAll(p.slug, { slim: true });
        if (rs.some((r) => r.ok)) {
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