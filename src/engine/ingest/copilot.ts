import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import {
  insertTranscript,
  ensureProject,
  getSourceOffset,
  setSourceOffset,
} from "../store/db";
import { projectSlugFromCwd } from "./util";

export function scanCopilot(dbPath: string): { messages: number } {
  if (!fs.existsSync(dbPath)) return { messages: 0 };
  const offset = getSourceOffset("copilot", dbPath);
  const src = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const tables = src
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    const msgTable = names.find((n) => /message|chat|conversation/i.test(n));
    if (!msgTable) return { messages: 0 };
    const cols = (src.prepare(`PRAGMA table_info(${msgTable})`).all() as Array<{ name: string }>).map((c) => c.name);
    const contentCol = cols.find((c) => /content|text|body|message/i.test(c)) || cols[0];
    const roleCol = cols.find((c) => /role|sender|type|author/i.test(c));
    const timeCol = cols.find((c) => /time|created|date|ts/i.test(c));
    const idCol = cols.find((c) => /id|session/i.test(c));
    if (!contentCol) return { messages: 0 };

    let rows: any[] = [];
    try {
      rows = src.prepare(`SELECT * FROM ${msgTable} LIMIT 5000`).all();
    } catch {
      return { messages: 0 };
    }

    let total = 0;
    for (const row of rows as any[]) {
      const content = typeof row[contentCol] === "string" ? row[contentCol] : JSON.stringify(row[contentCol] ?? "");
      if (!content || content === "{}" || content === "[]") continue;
      const roleRaw = roleCol ? String(row[roleCol] ?? "").toLowerCase() : "";
      const role = roleRaw.includes("user") || roleRaw.includes("human")
        ? "user"
        : roleRaw.includes("assistant") || roleRaw.includes("model") || roleRaw.includes("bot")
          ? "assistant"
          : roleRaw.includes("tool")
            ? "tool"
            : "system";
      if (role === "system" || role === "tool") continue;
      const sessionId = idCol ? String(row[idCol]) : "copilot";
      const ts = timeCol ? (typeof row[timeCol] === "number" ? row[timeCol] * 1000 : Date.parse(String(row[timeCol])) || Date.now()) : Date.now();
      const projectId = ensureProject(projectSlugFromCwd(undefined));
      insertTranscript({
        tool: "copilot",
        sessionId,
        projectId,
        role,
        content: content.slice(0, 10000),
        ts,
        seq: total,
      });
      total++;
    }
    setSourceOffset("copilot", dbPath, Date.now(), fs.statSync(dbPath).mtimeMs);
    return { messages: total };
  } finally {
    src.close();
  }
}
