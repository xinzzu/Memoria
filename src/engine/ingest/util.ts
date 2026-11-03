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

/**
 * Normalisasi path proyek untuk pencocokan lintas tool:
 * resolve + realpath (lepas symlink seperti /tmp -> /private/tmp di macOS)
 * + lowercase di Windows (filesystem case-insensitive).
 * Dipakai agar satu proyek fisik dari Claude/Codex/opencode dkk. tergabung
 * menjadi satu record proyek meski string cwd yang dilaporkan tiap tool berbeda.
 */
export function canonicalPath(p?: string): string | undefined {
  if (!p || !p.trim()) return undefined;
  let resolved = path.resolve(p.trim());
  try {
    resolved = fs.realpathSync(resolved);
  } catch {
    // path belum ada di disk — cukup pakai hasil resolve
  }
  if (process.platform === "win32") resolved = resolved.toLowerCase();
  return resolved;
}

/**
 * Apakah string ini terlihat seperti path filesystem (bukan sekadar nama proyek)?
 * Hanya input ber-bentuk path yang boleh dipakai sebagai kandidat path proyek —
 * nama seperti "smoke-proj" di-resolve menjadi <cwd>/smoke-proj yang menyesatkan.
 */
export function looksLikePath(p?: string): boolean {
  if (!p) return false;
  const s = p.trim();
  if (!s) return false;
  if (s.startsWith("/") || s.startsWith("\\") || s.startsWith("~")) return true;
  if (/^[a-zA-Z]:[/\\]/.test(s)) return true; // C:\... atau C:/... (Windows)
  return s.includes("/") || s.includes("\\");
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
