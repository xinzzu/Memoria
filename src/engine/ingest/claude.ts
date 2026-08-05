import * as fs from "node:fs";
import {
  getSourceOffset,
  setSourceOffset,
  insertTranscript,
  ensureProject,
} from "../store/db";
import { withTx } from "../store/tx";
import { walkFiles, safeJson, textFromContent, projectSlugFromCwd, readLinesIncremental } from "./util";

export async function scanClaude(root: string, log?: (msg: string) => void): Promise<{ files: number; lines: number }> {
  const files = walkFiles(root, [".jsonl"]);
  let totalLines = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const mtime = fs.statSync(file).mtimeMs;
    const stored = getSourceOffset("claude", file);
    const { lines, finalOffset } = await readLinesIncremental(file, stored);
    if (!lines.length) {
      if (finalOffset > stored) setSourceOffset("claude", file, finalOffset, mtime);
      continue;
    }
    let seq = 0;
    withTx(() => {
      for (const line of lines) {
        const j = safeJson(line);
        if (!j) continue;
        if (j.type !== "user" && j.type !== "assistant") continue;
        const ts = Date.parse(j.timestamp || "") || 0;
        const cwd = j.cwd || j.project_path;
        const sessionId = j.sessionId || j.session_id || "n/a";
        const projectId = ensureProject(projectSlugFromCwd(cwd), cwd);
        const content = textFromContent(j.message?.content);
        if (content) {
          insertTranscript({
            tool: "claude",
            sessionId,
            projectId,
            role: j.type,
            content,
            ts: ts || Date.now(),
            seq: seq++,
          });
          totalLines++;
        }
      }
    });
    setSourceOffset("claude", file, finalOffset, mtime);
    if (log && (i % 10 === 0 || i === files.length - 1)) {
      log(`claude: ${i + 1}/${files.length} file, ${totalLines} pesan`);
    }
  }
  return { files: files.length, lines: totalLines };
}
