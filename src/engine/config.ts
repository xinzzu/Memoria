import { homedir } from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

export interface ToolSource {
  tool: string;
  label: string;
  enabled: boolean;
  paths: string[];
  kind: "jsonl" | "sqlite" | "leveldb" | "logs" | "vscdb";
}

export interface AppConfig {
  dataDir: string;
  ollamaUrl: string;
  ollamaPath: string;
  ollamaExtractModel: string;
  ollamaEmbedModel: string;
  watcherDebounceMs: number;
  extractChunkSize: number;
  httpPort: number;
  autoInjectProjectFiles: boolean;
  sources: ToolSource[];
}

const home = homedir();
const platform = process.platform;
const isWin = platform === "win32";
const isMac = platform === "darwin";

const appdata = isWin
  ? process.env.APPDATA || path.join(home, "AppData", "Roaming")
  : isMac
    ? path.join(home, "Library", "Application Support")
    : process.env.XDG_CONFIG_HOME || path.join(home, ".config");
const localShare = isWin
  ? process.env.LOCALAPPDATA || path.join(home, "AppData", "Local")
  : isMac
    ? path.join(home, "Library", "Application Support")
    : process.env.XDG_DATA_HOME || path.join(home, ".local", "share");

const legacyDataDir = path.join(home, ".pecut-memory");
const defaultDataDir = path.join(home, ".memoria");

export function getConfig(): AppConfig {
  const dataDir = fs.existsSync(legacyDataDir) ? legacyDataDir : defaultDataDir;
  const opencodeDataDir = isWin
    ? path.join(localShare, "opencode")
    : isMac
      ? path.join(appdata, "opencode")
      : path.join(localShare, "opencode");
  const localDataDir = fs.existsSync(path.join(opencodeDataDir, "opencode.db"))
    ? opencodeDataDir
    : path.join(home, ".local", "share", "opencode");

  return {
    dataDir,
    // Env override memungkinkan testing terisolasi (arahkan ke port mati agar
    // pipeline ekstraksi tidak menyentuh Ollama asli) dan setup power-user.
    ollamaUrl: process.env.MEMORIA_OLLAMA_URL || "http://localhost:11434",
    ollamaPath:
      process.env.OLLAMA_PATH ||
      (isWin
        ? path.join(localShare, "Programs", "Ollama", "ollama.exe")
        : isMac
          ? path.join("/", "Applications", "Ollama.app", "Contents", "Resources", "ollama")
          : "ollama"),
    ollamaExtractModel: "qwen2.5-coder:3b",
    ollamaEmbedModel: "nomic-embed-text",
    watcherDebounceMs: 8000,
    extractChunkSize: 40,
    httpPort: 48210,
    autoInjectProjectFiles: true,
    sources: [
      {
        tool: "claude",
        label: "Claude Code",
        enabled: true,
        kind: "jsonl",
        paths: [path.join(home, ".claude", "projects")],
      },
      {
        tool: "codex",
        label: "Codex CLI",
        enabled: true,
        kind: "jsonl",
        paths: [path.join(home, ".codex", "sessions")],
      },
      {
        tool: "opencode",
        label: "OpenCode",
        enabled: true,
        kind: "sqlite",
        paths: [path.join(localDataDir, "opencode.db")],
      },
      {
        tool: "gemini",
        label: "Gemini CLI",
        enabled: true,
        kind: "jsonl",
        paths: [path.join(home, ".gemini", "sessions"), path.join(home, ".gemini")],
      },
      {
        tool: "copilot",
        label: "Copilot",
        enabled: true,
        kind: "sqlite",
        paths: [path.join(home, ".copilot", "session-store.db")],
      },
      {
        tool: "antigravity",
        label: "Antigravity",
        enabled: true,
        kind: "logs",
        paths: [path.join(appdata, "Antigravity", "logs")],
      },
      {
        tool: "vscode",
        label: "VS Code",
        enabled: false,
        kind: "vscdb",
        paths: [path.join(appdata, "Code", "User", "globalStorage"), path.join(appdata, "Code", "User", "workspaceStorage")],
      },
      {
        tool: "cursor",
        label: "Cursor",
        enabled: false,
        kind: "vscdb",
        paths: [path.join(appdata, "Cursor", "User", "globalStorage"), path.join(appdata, "Cursor", "User", "workspaceStorage")],
      },
      {
        tool: "windsurf",
        label: "Windsurf",
        enabled: false,
        kind: "vscdb",
        paths: [path.join(appdata, "Windsurf", "User", "globalStorage"), path.join(appdata, "Windsurf", "User", "workspaceStorage")],
      },
    ],
  };
}
