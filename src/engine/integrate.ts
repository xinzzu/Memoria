import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getConfig } from "./config";

export function engineScriptPath(): string {
  if (process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, "app.asar.unpacked", "dist", "engine", "index.js");
    if (fs.existsSync(packaged)) return packaged;
  }
  const dev = path.join(__dirname, "index.js");
  return fs.existsSync(dev) ? dev : "dist/engine/index.js";
}

function home(): string {
  return os.homedir();
}

function nodeCommand(): string {
  const probe = spawnSync("node", ["-v"], { windowsHide: true, timeout: 5000 });
  if (probe.status === 0) return "node";
  return process.execPath;
}

function quote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

interface ToolTarget {
  key: string;
  display: string;
  configPath: () => string;
  configured: () => boolean;
  register: (cmd: string, script: string) => string;
}

function claudeTarget(): ToolTarget {
  return {
    key: "claude",
    display: "Claude Code",
    configPath: () => path.join(home(), ".claude.json"),
    configured: () => fs.existsSync(path.join(home(), ".claude.json")),
    register: (cmd) => {
      const r = spawnSync("claude", ["mcp", "add", "--scope", "user", "memoria", "--transport", "stdio", "--", cmd, "mcp"], {
        timeout: 20000,
        windowsHide: true,
        encoding: "utf8",
      });
      if (r.status === 0) return "ok";
      return r.stderr?.toString() || "gagal (pastikan claude CLI terinstal)";
    },
  };
}

function codexTarget(): ToolTarget {
  return {
    key: "codex",
    display: "Codex CLI",
    configPath: () => path.join(home(), ".codex", "config.toml"),
    configured: () => fs.existsSync(path.join(home(), ".codex", "config.toml")),
    register: (_cmd, script) => {
      const cfgPath = path.join(home(), ".codex", "config.toml");
      fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
      let toml = "";
      if (fs.existsSync(cfgPath)) toml = fs.readFileSync(cfgPath, "utf8");
      const marker = "[mcp_servers.memoria]";
      if (toml.includes(marker)) return "ok";
      const block = `${marker}\ncommand = ${quote(_cmd)}\nargs = [${quote(script)}, "mcp"]\n`;
      fs.writeFileSync(cfgPath, toml.trimEnd() + "\n" + block, "utf8");
      return "ok";
    },
  };
}

function opencodeTarget(): ToolTarget {
  return {
    key: "opencode",
    display: "opencode",
    configPath: () => path.join(home(), ".config", "opencode", "opencode.json"),
    configured: () => fs.existsSync(path.join(home(), ".config", "opencode", "opencode.json")),
    register: (_cmd, script) => {
      const cfgPath = path.join(home(), ".config", "opencode", "opencode.json");
      fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
      let cfg: Record<string, any> = {};
      if (fs.existsSync(cfgPath)) {
        try {
          cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        } catch {
          cfg = {};
        }
      }
      cfg.mcp = cfg.mcp || {};
      cfg.mcp["memoria"] = {
        type: "local",
        command: [_cmd, script, "mcp"],
        enabled: true,
      };
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), "utf8");
      return "ok";
    },
  };
}

function geminiTarget(): ToolTarget {
  return {
    key: "gemini",
    display: "Gemini CLI",
    configPath: () => path.join(home(), ".gemini", "settings.json"),
    configured: () => fs.existsSync(path.join(home(), ".gemini", "settings.json")),
    register: (_cmd, script) => {
      const cfgPath = path.join(home(), ".gemini", "settings.json");
      fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
      let cfg: Record<string, any> = {};
      if (fs.existsSync(cfgPath)) {
        try {
          cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        } catch {
          cfg = {};
        }
      }
      cfg.mcpServers = cfg.mcpServers || {};
      cfg.mcpServers["memoria"] = {
        command: [_cmd, script, "mcp"],
        type: "stdio",
      };
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), "utf8");
      return "ok";
    },
  };
}

function copilotTarget(): ToolTarget {
  return {
    key: "copilot",
    display: "Copilot CLI",
    configPath: () => path.join(home(), ".copilot", "mcp-config.json"),
    configured: () => fs.existsSync(path.join(home(), ".copilot", "mcp-config.json")),
    register: (_cmd, script) => {
      const cfgPath = path.join(home(), ".copilot", "mcp-config.json");
      fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
      let cfg: Record<string, any> = {};
      if (fs.existsSync(cfgPath)) {
        try {
          cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        } catch {
          cfg = {};
        }
      }
      cfg.mcpServers = cfg.mcpServers || {};
      cfg.mcpServers["memoria"] = {
        type: "local",
        command: _cmd,
        args: [script, "mcp"],
        tools: ["*"],
      };
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), "utf8");
      return "ok";
    },
  };
}

function antigravityTarget(): ToolTarget {
  return {
    key: "antigravity",
    display: "Antigravity (Gemini IDE)",
    configPath: () => path.join(home(), ".gemini", "config", "mcp_config.json"),
    configured: () => fs.existsSync(path.join(home(), ".gemini", "config", "mcp_config.json")),
    register: (_cmd, script) => {
      const cfgPath = path.join(home(), ".gemini", "config", "mcp_config.json");
      fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
      let cfg: Record<string, any> = {};
      if (fs.existsSync(cfgPath)) {
        try {
          cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        } catch {
          cfg = {};
        }
      }
      cfg.mcpServers = cfg.mcpServers || {};
      cfg.mcpServers["memoria"] = {
        command: _cmd,
        args: [script, "mcp"],
      };
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), "utf8");
      return "ok";
    },
  };
}

/* ---------- Target tambahan (docs resmi MCP: modelcontextprotocol.io/clients
 * + docs tiap editor). Semua merge JSON (bukan overwrite) agar config user
 * yang sudah ada tetap utuh. Cursor & VS Code memakai HTTP bridge
 * (http://127.0.0.1:<port>/mcp) — resmi didukung keduanya ("url"/"type":
 * "http"); sisanya stdio agar engine di-spawn on-demand. ---------- */

function httpUrl(): string {
  return `http://127.0.0.1:${getConfig().httpPort}/mcp`;
}

function mergeJsonConfig(cfgPath: string, apply: (cfg: Record<string, any>) => void): string {
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  let cfg: Record<string, any> = {};
  if (fs.existsSync(cfgPath)) {
    try {
      cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    } catch {
      cfg = {};
    }
  }
  apply(cfg);
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), "utf8");
  return "ok";
}

function claudeDesktopTarget(): ToolTarget {
  const cfgPath = () =>
    process.platform === "win32"
      ? path.join(process.env.APPDATA || path.join(home(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json")
      : path.join(home(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  return {
    key: "claude-desktop",
    display: "Claude Desktop",
    configPath: cfgPath,
    configured: () => fs.existsSync(cfgPath()),
    register: (_cmd, script) =>
      mergeJsonConfig(cfgPath(), (cfg) => {
        cfg.mcpServers = cfg.mcpServers || {};
        cfg.mcpServers["memoria"] = { command: _cmd, args: [script, "mcp"] };
      }),
  };
}

function cursorTarget(): ToolTarget {
  const cfgPath = () => path.join(home(), ".cursor", "mcp.json");
  return {
    key: "cursor",
    display: "Cursor",
    configPath: cfgPath,
    configured: () => fs.existsSync(cfgPath()),
    register: () =>
      mergeJsonConfig(cfgPath(), (cfg) => {
        cfg.mcpServers = cfg.mcpServers || {};
        // HTTP bridge (docs Cursor: server remote = field "url")
        cfg.mcpServers["memoria"] = { url: httpUrl() };
      }),
  };
}

function windsurfTarget(): ToolTarget {
  const cfgPath = () => path.join(home(), ".codeium", "windsurf", "mcp_config.json");
  return {
    key: "windsurf",
    display: "Windsurf",
    configPath: cfgPath,
    configured: () => fs.existsSync(cfgPath()),
    register: (_cmd, script) =>
      mergeJsonConfig(cfgPath(), (cfg) => {
        cfg.mcpServers = cfg.mcpServers || {};
        cfg.mcpServers["memoria"] = { command: _cmd, args: [script, "mcp"] };
      }),
  };
}

function vscodeTarget(): ToolTarget {
  const cfgPath = () => path.join(home(), ".vscode", "mcp.json");
  return {
    key: "vscode",
    display: "VS Code (Copilot)",
    configPath: cfgPath,
    configured: () => fs.existsSync(cfgPath()),
    register: () =>
      mergeJsonConfig(cfgPath(), (cfg) => {
        cfg.servers = cfg.servers || {};
        // docs VS Code: server remote = { "type": "http", "url": ... }
        cfg.servers["memoria"] = { type: "http", url: httpUrl() };
      }),
  };
}

function clineTarget(): ToolTarget {
  const cfgPath = () =>
    process.platform === "darwin"
      ? path.join(home(), "Library", "Application Support", "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json")
      : process.platform === "win32"
        ? path.join(process.env.APPDATA || path.join(home(), "AppData", "Roaming"), "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json")
        : path.join(home(), ".config", "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json");
  return {
    key: "cline",
    display: "Cline",
    configPath: cfgPath,
    configured: () => fs.existsSync(cfgPath()),
    register: (_cmd, script) =>
      mergeJsonConfig(cfgPath(), (cfg) => {
        cfg.mcpServers = cfg.mcpServers || {};
        cfg.mcpServers["memoria"] = { command: _cmd, args: [script, "mcp"], disabled: false };
      }),
  };
}

function zedTarget(): ToolTarget {
  const cfgPath = () => path.join(home(), ".config", "zed", "settings.json");
  return {
    key: "zed",
    display: "Zed",
    configPath: cfgPath,
    configured: () => fs.existsSync(cfgPath()),
    register: (_cmd, script) =>
      mergeJsonConfig(cfgPath(), (cfg) => {
        cfg.context_servers = cfg.context_servers || {};
        cfg.context_servers["memoria"] = { source: "custom", command: _cmd, args: [script, "mcp"] };
      }),
  };
}

const TARGETS: ToolTarget[] = [claudeTarget(), codexTarget(), opencodeTarget(), geminiTarget(), copilotTarget(), antigravityTarget(), claudeDesktopTarget(), cursorTarget(), windsurfTarget(), vscodeTarget(), clineTarget(), zedTarget()];

export function registerIntegration(tool: string): { ok: boolean; message: string } {
  const t = TARGETS.find((x) => x.key === tool);
  if (!t) return { ok: false, message: `Tool tidak dikenal: ${tool}` };
  const cmd = nodeCommand();
  const script = engineScriptPath();
  const msg = t.register(cmd, script);
  return { ok: msg === "ok", message: msg };
}

export function integrationStatus(): Array<{ key: string; display: string; configured: boolean }> {
  return TARGETS.map((t) => ({ key: t.key, display: t.display, configured: t.configured() }));
}