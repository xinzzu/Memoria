import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import {
  insertTranscript,
  seqAllocator,
  ensureProject,
  getSourceOffset,
  setSourceOffset,
} from "../store/db";
import { projectSlugFromCwd } from "./util";

export function scanOpencode(dbPath: string): { messages: number } {
  if (!fs.existsSync(dbPath)) return { messages: 0 };
  const offset = getSourceOffset("opencode", dbPath);
  const src = new DatabaseSync(dbPath, { readOnly: true });

  try {
    const sessions = src
      .prepare("SELECT id, directory, title, time_created FROM session ORDER BY time_created")
      .all() as Array<{ id: string; directory: string | null; title: string | null; time_created: number }>;

    let total = 0;
    let maxTs = 0;
    for (const sess of sessions) {
      const cwd = sess.directory || undefined;
      const projectId = ensureProject(projectSlugFromCwd(cwd), cwd);
      const messages = src
        .prepare("SELECT id, time_created, data FROM message WHERE session_id = ? AND time_created > ? ORDER BY time_created")
        .all(sess.id, offset) as Array<{ id: string; time_created: number; data: string }>;

      const nextSeq = seqAllocator("opencode");
      for (const msg of messages) {
        maxTs = Math.max(maxTs, msg.time_created);
        let data: any;
        try {
          data = JSON.parse(msg.data);
        } catch {
          continue;
        }
        const role = data.role === "user" ? "user" : data.role === "assistant" ? "assistant" : "system";
        const parts = src
          .prepare("SELECT data FROM part WHERE message_id = ? ORDER BY time_created")
          .all(msg.id) as Array<{ data: string }>;

        let textParts: string[] = [];
        for (const p of parts) {
          let pd: any;
          try {
            pd = JSON.parse(p.data);
          } catch {
            continue;
          }
          if (pd.type === "text" && typeof pd.text === "string") {
            textParts.push(pd.text);
          } else if (pd.type === "tool" && pd.tool === "bash") {
            const cmd = pd.state?.metadata?.command || pd.state?.input?.command;
            if (cmd) textParts.push(`[command] ${cmd}`);
          }
        }
        const content = textParts.join("\n").trim();
        if (content) {
          insertTranscript({
            tool: "opencode",
            sessionId: sess.id,
            projectId,
            role,
            content,
            ts: msg.time_created || Date.now(),
            seq: nextSeq(sess.id),
          });
          total++;
        }
      }
    }
    if (total > 0) setSourceOffset("opencode", dbPath, Math.max(offset, maxTs), fs.statSync(dbPath).mtimeMs);
    return { messages: total };
  } finally {
    src.close();
  }
}
