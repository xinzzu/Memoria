import * as fs from "node:fs";
import {
  getSourceOffset,
  setSourceOffset,
  insertTranscript,
  ensureProject,
} from "../store/db";
import { walkFiles, projectSlugFromCwd } from "./util";

export function scanAntigravity(root: string): { files: number; lines: number } {
  if (!fs.existsSync(root)) return { files: 0, lines: 0 };
  const files = walkFiles(root, [".log", ".jsonl", ".txt"]);
  let total = 0;
  for (const file of files) {
    let offset = getSourceOffset("antigravity", file);
    const mtime = fs.statSync(file).mtimeMs;
    let size = 0;
    try {
      size = fs.statSync(file).size;
    } catch {
      continue;
    }
    if (size < offset) offset = 0;
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(size - offset);
      if (buf.length === 0) {
        setSourceOffset("antigravity", file, size, mtime);
        continue;
      }
      fs.readSync(fd, buf, 0, buf.length, offset);
      const text = buf.toString("utf8");
      if (!text.trim()) {
        setSourceOffset("antigravity", file, size, mtime);
        continue;
      }
      const projectId = ensureProject(projectSlugFromCwd(file));
      insertTranscript({
        tool: "antigravity",
        sessionId: file,
        projectId,
        role: "system",
        content: text.slice(0, 8000),
        ts: Date.now(),
        seq: 0,
      });
      total++;
    } finally {
      fs.closeSync(fd);
    }
    setSourceOffset("antigravity", file, size, mtime);
  }
  return { files: files.length, lines: total };
}
