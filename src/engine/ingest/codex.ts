import * as fs from "node:fs";
import {
  getSourceOffset,
  setSourceOffset,
  insertTranscript,
  seqAllocator,
  ensureProject,
} from "../store/db";
import { withTx } from "../store/tx";
import { walkFiles, safeJson, textFromContent, projectSlugFromCwd, readLinesIncremental } from "./util";

function contentFromBlock(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b === "string") return b;
        if (!b || typeof b !== "object") return "";
        if (typeof b.text === "string") return b.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function cleanContent(text: string): string {
  return text
    .replace(/<permissions instructions>[\s\S]*?<\/permissions instructions>/gi, "")
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function scanCodex(root: string, log?: (msg: string) => void): Promise<{ files: number; lines: number }> {
  const files = walkFiles(root, [".jsonl"]);
  let totalLines = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const mtime = fs.statSync(file).mtimeMs;
    const stored = getSourceOffset("codex", file);
    const { lines, finalOffset } = await readLinesIncremental(file, stored);
    if (!lines.length) {
      if (finalOffset > stored) setSourceOffset("codex", file, finalOffset, mtime);
      continue;
    }
    let cwd: string | undefined;
    const nextSeq = seqAllocator("codex");
    withTx(() => {
      for (const line of lines) {
        const j = safeJson(line);
        if (!j) continue;
        const ts = Date.parse(j.timestamp || "") || 0;
        const payload = j.payload;

        if (j.type === "session_meta") {
          cwd = payload?.cwd;
          continue;
        }

        if (j.type === "event_msg" && payload?.type === "user_message") {
          const raw = typeof payload.message === "string" ? payload.message : textFromContent(payload.message);
          const content = cleanContent(raw);
          if (!content) continue;
          const projectId = ensureProject(projectSlugFromCwd(cwd), cwd);
          insertTranscript({ tool: "codex", sessionId: j.session_id || file, projectId, role: "user", content, ts, seq: nextSeq(j.session_id || file) });
          totalLines++;
          continue;
        }

        if (j.type === "response_item" && payload?.type === "message") {
          const role: string = payload.role || "";
          const clean = cleanContent(contentFromBlock(payload.content));
          if (!clean) continue;
          const normalized: "user" | "assistant" =
            role === "user" ? "user" : role === "assistant" ? "assistant" : "assistant";
          const projectId = ensureProject(projectSlugFromCwd(cwd), cwd);
          insertTranscript({
            tool: "codex",
            sessionId: j.session_id || payload.session_id || file,
            projectId,
            role: normalized,
            content: clean,
            ts,
            seq: nextSeq(j.session_id || payload.session_id || file),
          });
          totalLines++;
        }
      }
    });
    setSourceOffset("codex", file, finalOffset, mtime);
    if (log && (i % 10 === 0 || i === files.length - 1)) {
      log(`codex: ${i + 1}/${files.length} file, ${totalLines} pesan`);
    }
  }
  return { files: files.length, lines: totalLines };
}
