import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";

export function walkFiles(dir: string, exts: string[], out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walkFiles(full, exts, out);
    } else if (e.isFile() && exts.some((x) => e.name.endsWith(x))) {
      out.push(full);
    }
  }
  return out;
}

export function safeJson(line: string): any | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

export function textFromContent(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b === "string") return b;
        if (b && typeof b === "object") {
          const c = b as any;
          if (typeof c.text === "string") return c.text;
          if (typeof c.content === "string") return c.content;
          if (c.type === "tool_result" && c.content) return textFromContent(c.content);
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export function projectSlugFromCwd(cwd?: string): string {
  if (!cwd) return "_unknown";
  return cwd.replace(/[\\/:]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "_unknown";
}

export async function readLinesIncremental(file: string, startOffset: number): Promise<{ lines: string[]; finalOffset: number }> {
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return { lines: [], finalOffset: startOffset };
  }
  if (startOffset > size) startOffset = 0;
  const lines: string[] = [];
  const stream = fs.createReadStream(file, { start: startOffset, encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim()) lines.push(line);
  }
  return { lines, finalOffset: size };
}
