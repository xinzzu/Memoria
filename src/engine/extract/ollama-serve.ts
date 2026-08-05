import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { getConfig } from "../config";
import { ollamaAvailable } from "./ollama";

let spawnedOnce = false;

export async function ensureOllamaRunning(): Promise<boolean> {
  if (await ollamaAvailable()) return true;
  if (spawnedOnce) return false;
  spawnedOnce = true;
  const cfg = getConfig();
  const candidates = [cfg.ollamaPath, process.env.OLLAMA_PATH || "", "ollama"];
  for (const cand of candidates) {
    if (!cand) continue;
    try {
      const isFile = fs.existsSync(cand);
      if (isFile || cand === "ollama") {
        const child = spawn(isFile ? cand : "ollama", isFile ? ["serve"] : ["serve"], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        });
        child.unref();
        for (let i = 0; i < 10; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          if (await ollamaAvailable()) return true;
        }
      }
    } catch {
      continue;
    }
  }
  return false;
}
