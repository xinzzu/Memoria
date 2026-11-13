import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { compareHlc, type SyncEntity, type SyncOp } from "../store/db";
import {
  compressPayload,
  decompressPayload,
  groupIdFor,
  packBundle,
  unpackBundle,
  type BundleHeader,
} from "./crypto";

export interface BundleOp {
  opId: string;
  hlc: string;
  entity: SyncEntity;
  entityUid: string;
  op: SyncOp;
  payload: unknown;
}

export interface SyncBundle {
  header: BundleHeader;
  ops: BundleOp[];
}

const MAX_OPS = 200_000;
const MAX_FILE_BYTES = 150 * 1024 * 1024;

function validateOp(raw: unknown): BundleOp {
  if (!raw || typeof raw !== "object") throw new Error("Bundle contains an invalid operation");
  const row = raw as Record<string, unknown>;
  if (typeof row.opId !== "string" || !row.opId) throw new Error("Bundle operation has no opId");
  if (typeof row.hlc !== "string" || !row.hlc) throw new Error("Bundle operation has no HLC");
  if (row.entity !== "project" && row.entity !== "memory" && row.entity !== "link") {
    throw new Error(`Bundle operation has unknown entity: ${String(row.entity)}`);
  }
  if (typeof row.entityUid !== "string" || !row.entityUid) throw new Error("Bundle operation has no entity UID");
  if (row.op !== "upsert" && row.op !== "delete") throw new Error(`Bundle operation has unknown op: ${String(row.op)}`);
  return {
    opId: row.opId,
    hlc: row.hlc,
    entity: row.entity,
    entityUid: row.entityUid,
    op: row.op,
    payload: row.payload ?? {},
  };
}

export function serializeOps(ops: BundleOp[]): Buffer {
  const lines = ops.map((op) => JSON.stringify(op));
  return Buffer.from(lines.join("\n") + "\n", "utf8");
}

export function parseOps(payload: Buffer): BundleOp[] {
  let text: string;
  try {
    text = payload.toString("utf8");
  } catch {
    throw new Error("Bundle payload is not valid UTF-8");
  }
  const ops: BundleOp[] = [];
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    if (ops.length >= MAX_OPS) throw new Error(`Bundle exceeds ${MAX_OPS} operations`);
    let raw: unknown;
    try {
      raw = JSON.parse(line) as unknown;
    } catch {
      throw new Error("Bundle contains a corrupt operation");
    }
    const op = validateOp(raw);
    if (seen.has(op.opId)) throw new Error(`Bundle contains duplicate operation id: ${op.opId}`);
    seen.add(op.opId);
    ops.push(op);
  }
  return ops;
}

export interface WriteBundleResult {
  filePath: string;
  fileId: string;
  bytes: number;
}

export function writeBundleFile(filePath: string, ops: BundleOp[], groupKey: Buffer, deviceId: string): WriteBundleResult {
  if (!ops.length) throw new Error("Nothing to export");
  if (ops.length > MAX_OPS) throw new Error(`Bundle exceeds ${MAX_OPS} operations`);
  let hlcMin = ops[0].hlc;
  let hlcMax = ops[0].hlc;
  for (const op of ops) {
    if (compareHlc(op.hlc, hlcMin) < 0) hlcMin = op.hlc;
    if (compareHlc(op.hlc, hlcMax) > 0) hlcMax = op.hlc;
  }
  const fileId = randomUUID();
  const headerInput = {
    groupId: groupIdFor(groupKey),
    fileId,
    deviceId,
    createdAt: Date.now(),
    opCount: ops.length,
    hlcMin,
    hlcMax,
  };
  const compressed = compressPayload(serializeOps(ops));
  const file = packBundle(headerInput, compressed, groupKey);
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const tmp = `${resolved}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, file, { mode: 0o600 });
  fs.renameSync(tmp, resolved);
  return { filePath: resolved, fileId, bytes: file.length };
}

export function readBundleFile(filePath: string, groupKey: Buffer): SyncBundle {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_BYTES) throw new Error("Bundle file is too large");
  const file = fs.readFileSync(filePath);
  const { header, payload } = unpackBundle(file, groupKey);
  if (header.groupId !== groupIdFor(groupKey)) throw new Error("Bundle belongs to a different sync group");
  const ops = parseOps(decompressPayload(payload));
  if (ops.length !== header.opCount) throw new Error("Bundle operation count does not match its header");
  return { header, ops };
}
