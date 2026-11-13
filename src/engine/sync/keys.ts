import * as os from "node:os";
import { getDb, getDeviceId, getSetting, getSyncState, setSetting } from "../store/db";
import { decryptSecret, encryptSecret, encryptionAvailable } from "../store/secure";
import {
  assertSyncKey,
  decodeRecoveryCode,
  encodeRecoveryCode,
  generateGroupKey,
  groupIdFor,
  unwrapKeyWithPassphrase,
  wrapKeyWithPassphrase,
} from "./crypto";

const KEY_SETTING = "sync.groupKey";
const DEVICE_NAME_SETTING = "sync.deviceName";

export interface UnlockOptions {
  passphrase?: string;
}

export interface SetupOptions extends UnlockOptions {
  joinCode?: string;
  deviceName?: string;
  force?: boolean;
}

export interface SetupResult {
  groupId: string;
  recoveryCode: string | null;
  joined: boolean;
}

export type KeyStorage = "env" | "safeStorage" | "passphrase" | "none";

export function getDeviceName(): string {
  return getSetting(DEVICE_NAME_SETTING, "") || os.hostname() || "local";
}

export function setDeviceName(name: string): void {
  const clean = String(name || "").trim();
  if (!clean) return;
  setSetting(DEVICE_NAME_SETTING, clean);
  getDb()
    .prepare("UPDATE sync_devices SET name = ?, last_seen = ? WHERE device_id = ?")
    .run(clean, Date.now(), getDeviceId());
}

export function keyStorage(): KeyStorage {
  if (process.env.MEMORIA_SYNC_KEY) return "env";
  const stored = getSetting(KEY_SETTING, "");
  if (!stored) return "none";
  if (stored.startsWith("pass1:")) return "passphrase";
  if (stored.startsWith("enc1:")) return "safeStorage";
  return "none";
}

export function isSyncConfigured(): boolean {
  return keyStorage() !== "none";
}

export function loadGroupKey(opts: UnlockOptions = {}): Buffer {
  const env = process.env.MEMORIA_SYNC_KEY;
  if (env) return decodeRecoveryCode(env);

  const stored = getSetting(KEY_SETTING, "");
  if (!stored) {
    throw new Error("Sync is not configured. Run: node dist/engine/index.js sync setup");
  }
  if (stored.startsWith("pass1:")) {
    const passphrase = opts.passphrase || process.env.MEMORIA_SYNC_PASSPHRASE || "";
    if (!passphrase) {
      throw new Error("Sync key is locked; pass --passphrase or set MEMORIA_SYNC_PASSPHRASE");
    }
    return unwrapKeyWithPassphrase(stored, passphrase);
  }
  if (stored.startsWith("enc1:")) {
    if (!encryptionAvailable()) {
      throw new Error(
        "Sync key is protected by the OS keychain, which is unavailable in this CLI. Unlock it from the desktop app or reconfigure with sync setup --passphrase."
      );
    }
    const plain = decryptSecret(stored);
    if (!plain) throw new Error("Cannot unlock sync key from the OS keychain");
    try {
      return assertSyncKey(Buffer.from(plain, "base64"));
    } catch {
      throw new Error("Stored sync key is corrupt");
    }
  }
  throw new Error("Stored sync key format is unsupported; run sync setup --force");
}

export function setupSync(opts: SetupOptions = {}): SetupResult {
  if (isSyncConfigured() && !opts.force) {
    throw new Error("Sync is already configured. Use --force to replace the group key.");
  }
  const joined = !!opts.joinCode;
  const key = opts.joinCode ? decodeRecoveryCode(opts.joinCode) : generateGroupKey();
  const passphrase = opts.passphrase || process.env.MEMORIA_SYNC_PASSPHRASE || "";
  if (passphrase) {
    setSetting(KEY_SETTING, wrapKeyWithPassphrase(key, passphrase));
  } else {
    const encrypted = encryptSecret(key.toString("base64"));
    if (!encrypted) {
      throw new Error("safeStorage is unavailable (CLI). Re-run with --passphrase or set MEMORIA_SYNC_PASSPHRASE.");
    }
    setSetting(KEY_SETTING, encrypted);
  }
  setDeviceName(opts.deviceName || getDeviceName());
  return {
    groupId: groupIdFor(key),
    recoveryCode: joined ? null : encodeRecoveryCode(key),
    joined,
  };
}

export interface SyncStatus {
  configured: boolean;
  storage: KeyStorage;
  groupId: string | null;
  deviceId: string;
  deviceName: string;
  pendingOutbox: number;
  pendingSinceExport: number;
  tombstones: number;
  conflicts: number;
  embeddingsQueued: number;
  lastExportHlc: string;
  lastExportAt: string;
  lastImportHlc: string;
  lastImportAt: string;
  locked: boolean;
}

export function syncStatus(opts: UnlockOptions = {}): SyncStatus {
  const d = getDb();
  const count = (sql: string, ...params: string[]): number => {
    const row = d.prepare(sql).get(...params) as { c: number };
    return Number(row.c);
  };
  let groupId: string | null = null;
  let locked = false;
  try {
    groupId = groupIdFor(loadGroupKey(opts));
  } catch (err) {
    locked = isSyncConfigured() && !process.env.MEMORIA_SYNC_KEY && !String((err as Error).message).includes("not configured");
  }
  const lastExportHlc = getSyncState("last_export_hlc");
  return {
    configured: isSyncConfigured(),
    storage: keyStorage(),
    groupId,
    deviceId: getDeviceId(),
    deviceName: getDeviceName(),
    pendingOutbox: count("SELECT COUNT(*) AS c FROM sync_outbox"),
    pendingSinceExport: count("SELECT COUNT(*) AS c FROM sync_outbox WHERE hlc > ?", lastExportHlc),
    tombstones: count("SELECT COUNT(*) AS c FROM sync_tombstones"),
    conflicts: count("SELECT COUNT(*) AS c FROM sync_conflicts"),
    embeddingsQueued: count("SELECT COUNT(*) AS c FROM sync_embed_queue"),
    lastExportHlc,
    lastExportAt: getSyncState("last_export_at"),
    lastImportHlc: getSyncState("last_import_hlc"),
    lastImportAt: getSyncState("last_import_at"),
    locked,
  };
}
