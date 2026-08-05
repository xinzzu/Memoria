import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { insertTranscript, ensureProject, getSourceOffset, setSourceOffset } from "../store/db";
import { projectSlugFromCwd, walkFiles } from "./util";

interface Msg {
  role: string;
  text: string;
  ts: number;
}

function textFromBlocks(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b === "string") return b;
        if (b && typeof b === "object") {
          const c = b as any;
          if (typeof c.text === "string") return c.text;
          if (typeof c.content === "string") return c.content;
          if ((c.type === "tool_result" || c.type === "toolInvocation" || c.type === "tool") && c.content) {
            return textFromBlocks(c.content);
          }
          if (c.type === "tool_use" || c.type === "tool_call") {
            const n = c.name || c.toolName || "";
            const input = c.input ? textFromBlocks(c.input) : "";
            return `[tool] ${n}${input ? ": " + input : ""}`;
          }
        }
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

function roleOf(m: any): string {
  const role = m?.author?.role || m?.role || m?.type || m?.sender;
  if (typeof role !== "string") return "unknown";
  const r = role.toLowerCase();
  if (r === "user" || r === "human") return "user";
  if (r === "assistant" || r === "ai" || r === "model" || r === "agent" || r === "bot") return "assistant";
  if (r === "system") return "system";
  if (r === "tool" || r === "function") return "tool";
  return "unknown";
}

function isMessageLike(m: any): boolean {
  if (!m || typeof m !== "object") return false;
  const hasRole = m.author?.role || m.role || m.type || m.sender;
  const hasContent = m.content != null || typeof m.text === "string";
  return !!hasRole && hasContent;
}

function walkMessages(node: any, out: Msg[]): void {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const it of node) walkMessages(it, out);
    return;
  }
  if (typeof node !== "object") return;
  if (isMessageLike(node)) {
    const text = typeof node.text === "string" ? node.text.trim() : textFromBlocks(node.content);
    const role = roleOf(node);
    if (text && role !== "unknown") {
      const ts =
        Number(node.ts || node.timestamp || node.createdAt || node.time) || Date.now();
      out.push({ role, text, ts });
    }
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === "message" || k === "data" || k === "messages" || k === "value" || k === "conversation") {
      walkMessages(v, out);
    } else if (v && typeof v === "object") {
      walkMessages(v, out);
    }
  }
}

function extractProject(node: any): string | null {
  if (node == null) return null;
  if (typeof node === "object") {
    for (const k of ["workspace", "workspacePath", "cwd", "projectPath", "projectDir"]) {
      const v = node[k];
      if (typeof v === "string" && v) return v;
    }
    if (Array.isArray(node)) return null;
    for (const [k, v] of Object.entries(node)) {
      if (v && typeof v === "object") {
        const found = extractProject(v);
        if (found) return found;
      }
    }
  }
  return null;
}

function scanFile(tool: string, file: string): number {
  if (!fs.existsSync(file)) return 0;
  const offset = getSourceOffset(tool, file);
  let total = 0;
  let maxTs = 0;
  let src: DatabaseSync | null = null;
  try {
    src = new DatabaseSync(file, { readOnly: true });
    const tables = src
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    const item = tables.find((t) => /itemtable/i.test(t.name));
    if (!item) return 0;
    const hasKey = (src.prepare("PRAGMA table_info(ItemTable)").all() as Array<{ name: string }>).some(
      (c) => c.name.toLowerCase() === "key"
    );
    if (!hasKey) return 0;

    const rows = src
      .prepare("SELECT key, value FROM ItemTable WHERE key LIKE '%chat%' OR key LIKE '%thread%' OR key LIKE '%session%'")
      .all() as Array<{ key: string; value: string | Uint8Array }>;

    for (const row of rows) {
      let raw: string;
      if (typeof row.value === "string") {
        raw = row.value;
      } else if (row.value instanceof Uint8Array) {
        raw = new TextDecoder().decode(row.value);
      } else {
        continue;
      }
      let data: any;
      try {
        data = JSON.parse(raw);
      } catch {
        continue;
      }
      const msgs: Msg[] = [];
      walkMessages(data, msgs);
      if (!msgs.length) continue;
      msgs.sort((a, b) => a.ts - b.ts);
      const projectPath = extractProject(data);
      const projectId = ensureProject(projectSlugFromCwd(projectPath || undefined), projectPath || undefined);
      const sessionId = tool + ":" + row.key;
      let seq = 0;
      for (const m of msgs) {
        if (m.ts <= offset) continue;
        maxTs = Math.max(maxTs, m.ts);
        if (m.text.length > 5000) {
          for (let i = 0; i < m.text.length; i += 5000) {
            insertTranscript({
              tool,
              sessionId,
              projectId,
              role: m.role as TranscriptRole,
              content: m.text.slice(i, i + 5000),
              ts: m.ts + i,
              seq: seq++,
            });
            total++;
          }
        } else {
          insertTranscript({
            tool,
            sessionId,
            projectId,
            role: m.role as TranscriptRole,
            content: m.text,
            ts: m.ts,
            seq: seq++,
          });
          total++;
        }
      }
    }
    if (total > 0) setSourceOffset(tool, file, Math.max(offset, maxTs), fs.statSync(file).mtimeMs);
    return total;
  } catch {
    return total;
  } finally {
    src?.close();
  }
}

type TranscriptRole = "user" | "assistant" | "tool" | "system";

export function scanVscdb(tool: string, paths: string[]): { messages: number } {
  let total = 0;
  for (const p of paths) {
    try {
      if (!fs.existsSync(p)) continue;
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        const dbs = walkFiles(p, [".vscdb"]);
        for (const f of dbs.slice(0, 40)) total += scanFile(tool, f);
      } else if (st.isFile()) {
        total += scanFile(tool, p);
      }
    } catch {
      continue;
    }
  }
  return { messages: total };
}
