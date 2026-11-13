import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

/* ---------- Sync M2: group key + encrypted .memsync bundle ----------
 * Kunci grup 32 byte membungkus semua operasi. Bundle memakai AES-256-GCM
 * dengan kunci per-file (HKDF SHA-256, salt=fileId) dan header JSON sebagai
 * AAD — mengganti header apa pun membuat dekripsi gagal.
 *
 * Format file:
 *   "MEMSYNC1" (8) | uint32BE(headerLen) | header JSON | ciphertext | tag (16)
 * Payload di dalam ciphertext adalah gzip(JSONL ops). Header membawa fileId,
 * deviceId, opCount, rentang HLC, nonce, dan groupId (bukan group key).
 * -------------------------------------------------------------------- */

export const BUNDLE_MAGIC = Buffer.from("MEMSYNC1", "ascii");
export const BUNDLE_VERSION = 1;
export const SYNC_KEY_BYTES = 32;

const INFO = Buffer.from("memoria-sync-v1", "utf8");
const MAX_HEADER_BYTES = 64 * 1024;
const MAX_CIPHERTEXT_BYTES = 140 * 1024 * 1024;
const MAX_PLAINTEXT_BYTES = 100 * 1024 * 1024;
const GCM_TAG_BYTES = 16;

const RECOVERY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RECOVERY_LENGTH = 52;
const SCRYPT_OPTS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export interface BundleHeader {
  v: number;
  groupId: string;
  fileId: string;
  deviceId: string;
  createdAt: number;
  opCount: number;
  hlcMin: string;
  hlcMax: string;
  nonce: string;
}

export interface BundleHeaderInput extends Omit<BundleHeader, "v" | "nonce"> {}

export function assertSyncKey(key: Buffer): Buffer {
  if (!Buffer.isBuffer(key) || key.length !== SYNC_KEY_BYTES) {
    throw new Error(`Sync key must be ${SYNC_KEY_BYTES} bytes`);
  }
  return key;
}

export function generateGroupKey(): Buffer {
  return randomBytes(SYNC_KEY_BYTES);
}

/** ID grup turunan kunci; aman ditampilkan, tidak bisa dipakai membuka bundle. */
export function groupIdFor(key: Buffer): string {
  return createHash("sha256").update(assertSyncKey(key)).digest("hex").slice(0, 32);
}

export function encodeRecoveryCode(key: Buffer): string {
  assertSyncKey(key);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of key) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += RECOVERY_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += RECOVERY_ALPHABET[(value << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)!.join("-");
}

export function decodeRecoveryCode(code: string): Buffer {
  const clean = String(code || "")
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  if (clean.length !== RECOVERY_LENGTH) {
    throw new Error(`Recovery code must contain ${RECOVERY_LENGTH} symbols`);
  }
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = RECOVERY_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("Recovery code contains an invalid symbol");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (bits > 0 && (value & ((1 << bits) - 1)) !== 0) throw new Error("Recovery code padding is invalid");
  const key = Buffer.from(out);
  assertSyncKey(key);
  return key;
}

/* ---------- Passphrase-protected key storage ----------
 * Dipakai saat safeStorage Electron tidak tersedia (CLI murni) atau user
 * memilih proteksi passphrase. Format: "pass1:<base64(JSON)>". */

export function wrapKeyWithPassphrase(key: Buffer, passphrase: string): string {
  assertSyncKey(key);
  if (!passphrase) throw new Error("Passphrase must not be empty");
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const derived = scryptSync(passphrase, salt, SYNC_KEY_BYTES, SCRYPT_OPTS);
  const cipher = createCipheriv("aes-256-gcm", derived, nonce);
  cipher.setAAD(Buffer.from("memoria-sync-key-v1", "utf8"));
  const ciphertext = Buffer.concat([cipher.update(key), cipher.final()]);
  const tag = cipher.getAuthTag();
  const body = {
    v: 1,
    salt: salt.toString("base64"),
    nonce: nonce.toString("base64"),
    tag: tag.toString("base64"),
    ct: ciphertext.toString("base64"),
  };
  return "pass1:" + Buffer.from(JSON.stringify(body), "utf8").toString("base64");
}

export function unwrapKeyWithPassphrase(stored: string, passphrase: string): Buffer {
  if (!stored.startsWith("pass1:")) throw new Error("Stored sync key is not passphrase-protected");
  if (!passphrase) throw new Error("Passphrase required");
  let body: { v?: number; salt?: string; nonce?: string; tag?: string; ct?: string };
  try {
    body = JSON.parse(Buffer.from(stored.slice(6), "base64").toString("utf8")) as typeof body;
  } catch {
    throw new Error("Stored sync key is corrupt");
  }
  if (body.v !== 1 || !body.salt || !body.nonce || !body.tag || !body.ct) {
    throw new Error("Stored sync key is corrupt");
  }
  const salt = Buffer.from(body.salt, "base64");
  const nonce = Buffer.from(body.nonce, "base64");
  const tag = Buffer.from(body.tag, "base64");
  const ct = Buffer.from(body.ct, "base64");
  const derived = scryptSync(passphrase, salt, SYNC_KEY_BYTES, SCRYPT_OPTS);
  try {
    const decipher = createDecipheriv("aes-256-gcm", derived, nonce);
    decipher.setAAD(Buffer.from("memoria-sync-key-v1", "utf8"));
    decipher.setAuthTag(tag);
    const key = Buffer.concat([decipher.update(ct), decipher.final()]);
    return assertSyncKey(key);
  } catch {
    throw new Error("Wrong passphrase or corrupt sync key");
  }
}

/* ---------- Bundle encryption ---------- */

function headerBytes(header: BundleHeader): Buffer {
  return Buffer.from(JSON.stringify(header), "utf8");
}

function deriveFileKey(groupKey: Buffer, fileId: string): Buffer {
  return Buffer.from(hkdfSync("sha256", assertSyncKey(groupKey), Buffer.from(fileId, "utf8"), INFO, SYNC_KEY_BYTES));
}

export function packBundle(headerInput: BundleHeaderInput, payload: Buffer, groupKey: Buffer): Buffer {
  if (payload.length > MAX_PLAINTEXT_BYTES) throw new Error("Bundle payload is too large");
  const nonce = randomBytes(12);
  const header: BundleHeader = { ...headerInput, v: BUNDLE_VERSION, nonce: nonce.toString("base64") };
  const rawHeader = headerBytes(header);
  if (rawHeader.length > MAX_HEADER_BYTES) throw new Error("Bundle header is too large");
  const fileKey = deriveFileKey(groupKey, header.fileId);
  const cipher = createCipheriv("aes-256-gcm", fileKey, nonce);
  cipher.setAAD(rawHeader);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();
  const length = Buffer.alloc(4);
  length.writeUInt32BE(rawHeader.length, 0);
  return Buffer.concat([BUNDLE_MAGIC, length, rawHeader, ciphertext, tag]);
}

export function unpackBundle(file: Buffer, groupKey: Buffer): { header: BundleHeader; payload: Buffer } {
  if (file.length < BUNDLE_MAGIC.length + 4 + GCM_TAG_BYTES) throw new Error("Not a .memsync bundle (truncated)");
  if (!file.subarray(0, BUNDLE_MAGIC.length).equals(BUNDLE_MAGIC)) throw new Error("Not a .memsync bundle (bad magic)");
  const headerLen = file.readUInt32BE(BUNDLE_MAGIC.length);
  if (headerLen < 2 || headerLen > MAX_HEADER_BYTES) throw new Error("Bundle header is invalid");
  const headerStart = BUNDLE_MAGIC.length + 4;
  const headerEnd = headerStart + headerLen;
  if (file.length <= headerEnd + GCM_TAG_BYTES) throw new Error("Not a .memsync bundle (truncated)");
  if (file.length > MAX_CIPHERTEXT_BYTES + headerEnd) throw new Error("Bundle file is too large");
  const rawHeader = file.subarray(headerStart, headerEnd);
  let header: BundleHeader;
  try {
    header = JSON.parse(rawHeader.toString("utf8")) as BundleHeader;
  } catch {
    throw new Error("Bundle header is corrupt");
  }
  if (header.v !== BUNDLE_VERSION) throw new Error(`Unsupported bundle version: ${String(header.v)}`);
  if (typeof header.fileId !== "string" || !header.fileId) throw new Error("Bundle fileId is missing");
  if (typeof header.deviceId !== "string" || !header.deviceId) throw new Error("Bundle deviceId is missing");
  if (typeof header.nonce !== "string" || !header.nonce) throw new Error("Bundle nonce is missing");
  if (!Number.isInteger(header.opCount) || header.opCount < 0) throw new Error("Bundle opCount is invalid");

  const ciphertext = file.subarray(headerEnd, file.length - GCM_TAG_BYTES);
  const tag = file.subarray(file.length - GCM_TAG_BYTES);
  const fileKey = deriveFileKey(groupKey, header.fileId);
  try {
    const decipher = createDecipheriv("aes-256-gcm", fileKey, Buffer.from(header.nonce, "base64"));
    decipher.setAAD(rawHeader);
    decipher.setAuthTag(tag);
    const payload = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return { header, payload };
  } catch {
    throw new Error("Cannot decrypt bundle: wrong key or tampered file");
  }
}

/** gzip dengan cek ukuran setelah dekompresi agar bundle kecil tidak bisa
 * memaksa alokasi ratusan MB (zip bomb). */
export function compressPayload(payload: Buffer): Buffer {
  if (payload.length > MAX_PLAINTEXT_BYTES) throw new Error("Bundle payload is too large");
  return gzipSync(payload, { level: 6 });
}

export function decompressPayload(compressed: Buffer): Buffer {
  const out = gunzipSync(compressed, { maxOutputLength: MAX_PLAINTEXT_BYTES });
  if (out.length > MAX_PLAINTEXT_BYTES) throw new Error("Bundle payload is too large");
  return out;
}
