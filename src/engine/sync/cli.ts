import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { applyBundleFile } from "./apply";
import { exportBundle } from "./export";
import { loadGroupKey, setupSync, syncStatus } from "./keys";
import { embeddingBackfillCount, processEmbeddingBackfill } from "./embed";
import { getFolderStatus, listRecentConflicts, scanAndApplyFolder, setSharedFolder } from "./folder";

const VALUE_FLAGS = new Set(["passphrase", "out", "in", "device-name", "join", "limit"]);

interface ParsedArgs {
  positional: string[];
  flags: Map<string, string | true>;
}

function parseArgs(args: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq >= 0) {
      flags.set(body.slice(0, eq), body.slice(eq + 1));
      continue;
    }
    if (VALUE_FLAGS.has(body)) {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(body, next);
        i++;
      } else {
        flags.set(body, true);
      }
      continue;
    }
    flags.set(body, true);
  }
  return { positional, flags };
}

function flag(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function has(parsed: ParsedArgs, name: string): boolean {
  return parsed.flags.has(name);
}

function defaultExportPath(): string {
  return path.resolve(process.cwd(), `memoria-${randomUUID()}.memsync`);
}

function formatAt(ms: string): string {
  const n = Number(ms);
  return n > 0 ? new Date(n).toISOString() : "-";
}

export async function runSyncCommand(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const cmd = parsed.positional[0] || "status";

  if (cmd === "setup") {
    const result = setupSync({
      joinCode: flag(parsed, "join"),
      passphrase: flag(parsed, "passphrase"),
      deviceName: flag(parsed, "device-name"),
      force: has(parsed, "force"),
    });
    console.log(result.joined ? "Joined sync group." : "Sync group created.");
    console.log(`Group ID : ${result.groupId}`);
    if (result.recoveryCode) {
      console.log(`Recovery : ${result.recoveryCode}`);
      console.log("Store this code offline. It is the only way to add another device.");
    }
    if (flag(parsed, "passphrase") || process.env.MEMORIA_SYNC_PASSPHRASE) {
      console.log("Key storage: passphrase-protected (scrypt + AES-256-GCM).");
    } else {
      console.log("Key storage: OS keychain (safeStorage).");
    }
    return;
  }

  if (cmd === "status") {
    const status = syncStatus({ passphrase: flag(parsed, "passphrase") });
    if (!status.configured) {
      console.log("Sync is not configured. Run: node dist/engine/index.js sync setup");
      return;
    }
    console.log(`Configured  : yes (${status.storage})`);
    console.log(`Group       : ${status.groupId ?? (status.locked ? "locked" : "-")}`);
    console.log(`Device      : ${status.deviceName} (${status.deviceId})`);
    console.log(`Outbox      : ${status.pendingOutbox} pending (${status.pendingSinceExport} since last export)`);
    console.log(`Tombstones  : ${status.tombstones}`);
    console.log(`Conflicts   : ${status.conflicts}`);
    console.log(`Embed queue : ${status.embeddingsQueued}`);
    console.log(`Last export : ${status.lastExportHlc || "-"} (${formatAt(status.lastExportAt)})`);
    console.log(`Last import : ${status.lastImportHlc || "-"} (${formatAt(status.lastImportAt)})`);
    return;
  }

  if (cmd === "export") {
    const groupKey = loadGroupKey({ passphrase: flag(parsed, "passphrase") });
    const out = flag(parsed, "out") || defaultExportPath();
    const result = exportBundle({ filePath: out, groupKey, full: has(parsed, "full") });
    console.log(`Bundle : ${result.filePath}`);
    console.log(`File ID: ${result.fileId}`);
    console.log(`Ops    : ${result.opCount}`);
    console.log(`HLC    : ${result.hlcMin} -> ${result.hlcMax}`);
    console.log(`Size   : ${(result.bytes / 1024).toFixed(1)} KiB`);
    return;
  }

  if (cmd === "import") {
    const input = flag(parsed, "in");
    if (!input) throw new Error("Usage: sync import --in <file.memsync> [--passphrase ...] [--embed]");
    const groupKey = loadGroupKey({ passphrase: flag(parsed, "passphrase") });
    const result = applyBundleFile(path.resolve(input), groupKey);
    console.log(`Bundle : ${result.fileId}`);
    if (result.alreadyApplied) {
      console.log("Already applied; nothing changed.");
      return;
    }
    console.log(`Applied: ${result.applied} | Skipped: ${result.skipped} | Conflicts: ${result.conflicts}`);
    console.log(`Embed  : ${result.deferredEmbeddings} queued`);
    if (has(parsed, "embed")) {
      let done = 0;
      for (let i = 0; i < 20; i++) {
        const n = await processEmbeddingBackfill(100);
        done += n;
        if (!n || embeddingBackfillCount() === 0) break;
      }
      console.log(`Embedded: ${done} | Remaining: ${embeddingBackfillCount()}`);
    }
    return;
  }

  if (cmd === "folder") {
    const sub = parsed.positional[1] || "status";
    if (sub === "set") {
      const target = parsed.positional[2] || (has(parsed, "clear") ? "--clear" : "");
      if (!target) throw new Error("Usage: sync folder set <path> | --clear");
      const st = setSharedFolder(target, { passphrase: flag(parsed, "passphrase") });
      console.log(st.path ? `Folder: ${st.path}` : "Folder sync disabled.");
      if (st.path) {
        const scan = await scanAndApplyFolder({ passphrase: flag(parsed, "passphrase") });
        if (scan.scanned || scan.applied || scan.failed) {
          console.log(`Scan   : ${scan.scanned} files, applied ${scan.applied}, skipped ${scan.skipped}, failed ${scan.failed}`);
        }
      }
      return;
    }
    if (sub === "status") {
      const st = getFolderStatus();
      if (!st.path) {
        console.log("Folder sync: not configured.");
        return;
      }
      console.log(`Folder      : ${st.path}`);
      console.log(`Available   : ${st.available ? "yes" : "no"}${st.writable ? " (writable)" : ""}`);
      console.log(`Watching    : ${st.watching ? "yes" : "no"}`);
      console.log(`Pending     : ${st.pendingSinceExport} since folder export`);
      console.log(`Last export : ${st.lastExportHlc || "-"} (${formatAt(st.lastExportAt)})`);
      console.log(`Last import : ${st.lastImportHlc || "-"} (${formatAt(st.lastImportAt)})`);
      if (st.lastError) console.log(`Last error  : ${st.lastError}`);
      return;
    }
    throw new Error(`Unknown sync folder command: ${sub}. Use set or status.`);
  }

  if (cmd === "conflicts") {
    const lim = Number(flag(parsed, "limit") || "50") || 50;
    const rows = listRecentConflicts(lim);
    if (!rows.length) {
      console.log("No sync conflicts.");
      return;
    }
    for (const r of rows) {
      const when = formatAt(String(r.createdAt));
      console.log(`[${r.id}] ${when} ${r.entity} ${r.entityUid}`);
      console.log(`  winner: ${r.winnerHlc}`);
      console.log(`  loser : ${r.loserHlc}`);
    }
    return;
  }

  throw new Error(`Unknown sync command: ${cmd}. Use setup, status, export, import, folder, or conflicts.`);
}
