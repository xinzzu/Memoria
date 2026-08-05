import * as fs from "node:fs";
import * as path from "node:path";
import { getConfig } from "../config";
import { allMemories, allTags, getSetting, setSetting, projectSlugById } from "../store/db";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const DIGEST_FILE = "weekly-digest.md";

export interface WeeklyDigest {
  ok: boolean;
  since: number;
  until: number;
  path: string;
  text: string;
  memories: number;
  perTool: Array<{ tool: string; count: number }>;
  perKind: Array<{ kind: string; count: number }>;
  topProjects: Array<{ slug: string; count: number }>;
  topTags: Array<{ tag: string; count: number }>;
}

function topBy(map: Map<string, number>, n: number): Array<{ key: string; count: number }> {
  return [...map.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, n);
}

export function generateWeeklyDigest(): WeeklyDigest {
  const cfg = getConfig();
  const until = Date.now();
  const since = until - WEEK_MS;
  const mems = allMemories().filter((m) => {
    const c = m.createdAt || 0;
    return c >= since && c <= until && (m.status || "active") === "active";
  });

  const perTool = new Map<string, number>();
  const perKind = new Map<string, number>();
  const perProject = new Map<string, number>();
  for (const m of mems) {
    perTool.set(m.sourceTool || "unknown", (perTool.get(m.sourceTool || "unknown") || 0) + 1);
    perKind.set(m.kind || "context", (perKind.get(m.kind || "context") || 0) + 1);
    const slug = projectSlugById(m.projectId) || "global";
    perProject.set(slug, (perProject.get(slug) || 0) + 1);
  }

  const topTool = topBy(perTool, 6);
  const topKind = topBy(perKind, 6);
  const topProj = topBy(perProject, 6);
  const topTags = allTags(1).sort((a, b) => b.count - a.count).slice(0, 6).map((t) => ({ key: t.tag, count: t.count }));
  const topMems = mems.slice().sort((a, b) => b.importance - a.importance).slice(0, 10);

  const dateFmt = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" });
  const tf = (ms: number) => dateFmt.format(new Date(ms));
  const lines: string[] = [];
  lines.push(`# Ringkasan Mingguan Memoria`);
  lines.push(``);
  lines.push(`Periode: ${tf(since)} — ${tf(until)}`);
  lines.push(`Total memori baru: **${mems.length}**`);
  lines.push(``);
  lines.push(`## Statistik alat`);
  for (const t of topTool) lines.push(`- **${t.key}**: ${t.count}`);
  if (!topTool.length) lines.push(`- (tidak ada)`);
  lines.push(``);
  lines.push(`## Jenis memori`);
  for (const k of topKind) lines.push(`- **${k.key}**: ${k.count}`);
  if (!topKind.length) lines.push(`- (tidak ada)`);
  lines.push(``);
  lines.push(`## Proyek aktif`);
  for (const p of topProj) lines.push(`- **${p.key}**: ${p.count} memori`);
  if (!topProj.length) lines.push(`- (tidak ada)`);
  lines.push(``);
  lines.push(`## Topik teratas`);
  for (const t of topTags) lines.push(`- **${t.key}**: ${t.count}`);
  if (!topTags.length) lines.push(`- (belum ada tag topik)`);
  lines.push(``);
  if (topMems.length) {
    lines.push(`## Memori terpenting`);
    for (const m of topMems) {
      const slug = projectSlugById(m.projectId) || "global";
      const snippet = m.content.replace(/\s+/g, " ").trim().slice(0, 140);
      lines.push(`- **[${m.kind}]** ${snippet}${snippet.length >= 140 ? "…" : ""} _(${slug}, ${tf(m.createdAt)})_`);
    }
    lines.push(``);
  }
  lines.push(`_Dibuat otomatis oleh Memoria._`);

  const text = lines.join("\n");
  const filePath = path.join(cfg.dataDir, DIGEST_FILE);
  fs.writeFileSync(filePath, text, "utf-8");
  setSetting("weeklyDigestLast", String(until));
  setSetting("weeklyDigestText", text);

  return {
    ok: true,
    since,
    until,
    path: filePath,
    text,
    memories: mems.length,
    perTool: topTool.map((t) => ({ tool: t.key, count: t.count })),
    perKind: topKind.map((k) => ({ kind: k.key, count: k.count })),
    topProjects: topProj.map((p) => ({ slug: p.key, count: p.count })),
    topTags: topTags.map((t) => ({ tag: t.key, count: t.count })),
  };
}

export function nextWeeklyDigestDue(): boolean {
  const last = Number(getSetting("weeklyDigestLast", "0"));
  return !last || Date.now() - last >= WEEK_MS;
}

export function latestDigestText(): string {
  return getSetting("weeklyDigestText", "");
}