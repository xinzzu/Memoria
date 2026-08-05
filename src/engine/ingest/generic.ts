import * as fs from "node:fs";
import {
  getSourceOffset,
  setSourceOffset,
  insertTranscript,
  ensureProject,
} from "../store/db";
import { withTx } from "../store/tx";
import { walkFiles, safeJson, textFromContent, projectSlugFromCwd, readLinesIncremental } from "./util";

function pickRole(j: any): "user" | "assistant" | "system" | null {
  if (!j) return null;
  const r = String(j.role || j.type || j.sender || "").toLowerCase();
  if (r.includes("user") || r === "u" || r.includes("human")) return "user";
  if (r.includes("assistant") || r.includes("model") || r.includes("bot") || r.includes("ai")) return "assistant";
  return null;
}

export async function scanGenericJsonl(
  tool: string,
  roots: string[],
  filePatterns: string[],
  log?: (msg: string) => void
): Promise<{ files: number; lines: number }> {
  const files: string[] = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    files.push(...walkFiles(root, filePatterns));
  }
  let totalLines = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const mtime = fs.statSync(file).mtimeMs;
    const stored = getSourceOffset(tool, file);
    const { lines, finalOffset } = await readLinesIncremental(file, stored);
    if (!lines.length) {
      if (finalOffset > stored) setSourceOffset(tool, file, finalOffset, mtime);
      continue;
    }
    let seq = 0;
    withTx(() => {
      for (const line of lines) {
        const j = safeJson(line);
        if (!j) continue;
        const role = pickRole(j);
        if (!role) continue;
        const content = textFromContent(j.content ?? j.message?.content ?? j.text) || "";
        if (!content.trim()) continue;
        const cwd = j.cwd || j.directory || j.projectPath;
        const projectId = ensureProject(projectSlugFromCwd(cwd), cwd);
        const sessionId = String(j.sessionId || j.session_id || j.id || "n/a");
        const ts = Date.parse(j.timestamp || j.ts || j.createdAt || "") || Date.now();
        insertTranscript({ tool, sessionId, projectId, role, content, ts, seq: seq++ });
        totalLines++;
      }
    });
    setSourceOffset(tool, file, finalOffset, mtime);
    if (log && (i % 20 === 0 || i === files.length - 1)) {
      log(`${tool}: ${i + 1}/${files.length} file, ${totalLines} pesan`);
    }
  }
  return { files: files.length, lines: totalLines };
}
