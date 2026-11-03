/* Penyimpanan rahasia: api_key dienkripsi via Electron safeStorage
 * (Keychain/DPAPI/kwallet) saat berjalan di dalam aplikasi. Di CLI murni
 * fallback plaintext dengan penanda jelas. Format: "enc1:<base64>". */
let electronMod: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  electronMod = require("electron");
} catch {
  // di luar Electron (CLI/MCP murni)
}

export function encryptionAvailable(): boolean {
  try {
    return !!electronMod?.safeStorage?.isEncryptionAvailable?.();
  } catch {
    return false;
  }
}

export function encryptSecret(plain: string): string | null {
  try {
    const ss = electronMod?.safeStorage;
    if (ss?.isEncryptionAvailable?.()) {
      return "enc1:" + Buffer.from(ss.encryptString(plain)).toString("base64");
    }
  } catch {
    // fallback plaintext
  }
  return null;
}

export function decryptSecret(stored: string): string | null {
  try {
    if (!stored.startsWith("enc1:")) return stored; // plaintext legacy
    const ss = electronMod?.safeStorage;
    if (ss?.isEncryptionAvailable?.()) {
      return Buffer.from(stored.slice(5), "base64").toString("utf8");
    }
  } catch {
    // tidak bisa didekripsi di konteks ini
  }
  return null;
}
