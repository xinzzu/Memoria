import {
  compareHlc,
  getDb,
  getDeviceId,
  getEntityClock,
  getSyncState,
  getTombstone,
  linkSyncPayload,
  memorySyncPayload,
  nextHlc,
  projectSyncPayload,
  recordEntityClock,
  setSyncState,
  sortLinkUids,
  type SyncEntity,
  type SyncOp,
} from "../store/db";
import { writeBundleFile, type BundleOp } from "./bundle";

export interface ExportOptions {
  filePath: string;
  groupKey: Buffer;
  full?: boolean;
}

export interface ExportResult {
  filePath: string;
  fileId: string;
  opCount: number;
  hlcMin: string;
  hlcMax: string;
  bytes: number;
}

function pushOp(
  ops: BundleOp[],
  seen: Set<string>,
  opId: string,
  hlc: string,
  entity: SyncEntity,
  entityUid: string,
  op: SyncOp,
  payload: unknown
): void {
  const key = `${entity}\u0000${entityUid}\u0000${hlc}`;
  if (seen.has(key)) return;
  seen.add(key);
  ops.push({ opId, hlc, entity, entityUid, op, payload });
}

/** Full snapshot dibangun dari state DB saat ini, bukan replay outbox, agar
 * peer ketiga bisa menerima data yang berasal dari peer lain (relay). Entity
 * clock dipakai sebagai HLC; entitas lama tanpa clock diberi HLC baru. */
function buildFullSnapshotOps(): BundleOp[] {
  const d = getDb();
  const ops: BundleOp[] = [];
  const seen = new Set<string>();

  const latestTombstone = (entity: SyncEntity, uid: string): string | null => {
    const tomb = getTombstone(entity, uid);
    const clock = getEntityClock(entity, uid);
    if (!tomb) return null;
    if (clock && compareHlc(clock.hlc, tomb.hlc) > 0) return null;
    return tomb.hlc;
  };
  const clockFor = (entity: SyncEntity, uid: string, op: SyncOp): string => {
    const clock = getEntityClock(entity, uid);
    if (clock) return clock.hlc;
    const hlc = nextHlc();
    recordEntityClock(entity, uid, hlc, op);
    return hlc;
  };

  const projects = d.prepare("SELECT id, uid FROM projects ORDER BY id").all() as Array<{ id: number; uid: string | null }>;
  for (const row of projects) {
    if (!row.uid) continue;
    if (latestTombstone("project", row.uid)) continue;
    if (getEntityClock("project", row.uid)?.op === "delete") continue;
    const snap = projectSyncPayload(row.id);
    if (!snap) continue;
    const hlc = clockFor("project", snap.uid, "upsert");
    pushOp(ops, seen, `full:project:${snap.uid}:${hlc}`, hlc, "project", snap.uid, "upsert", snap.payload);
  }

  const memories = d.prepare("SELECT id, uid FROM memories ORDER BY id").all() as Array<{ id: number; uid: string | null }>;
  for (const row of memories) {
    if (!row.uid) continue;
    if (latestTombstone("memory", row.uid)) continue;
    if (getEntityClock("memory", row.uid)?.op === "delete") continue;
    const snap = memorySyncPayload(row.id);
    if (!snap) continue;
    const hlc = clockFor("memory", snap.uid, "upsert");
    pushOp(ops, seen, `full:memory:${snap.uid}:${hlc}`, hlc, "memory", snap.uid, "upsert", snap.payload);
  }

  const links = d
    .prepare(
      `SELECT l.from_memory_id AS from_id, l.to_memory_id AS to_id, l.kind, l.weight,
              a.uid AS from_uid, b.uid AS to_uid
       FROM memory_links l
       JOIN memories a ON a.id = l.from_memory_id
       JOIN memories b ON b.id = l.to_memory_id
       ORDER BY l.id`
    )
    .all() as Array<{
    from_id: number;
    to_id: number;
    kind: string;
    weight: number;
    from_uid: string | null;
    to_uid: string | null;
  }>;
  for (const row of links) {
    if (!row.from_uid || !row.to_uid) continue;
    const [fromUid, toUid] = sortLinkUids(row.from_uid, row.to_uid);
    const uid = `${fromUid}|${toUid}`;
    if (latestTombstone("link", uid)) continue;
    if (getEntityClock("link", uid)?.op === "delete") continue;
    const snap = linkSyncPayload(row.from_id, row.to_id);
    if (!snap) continue;
    const hlc = clockFor("link", uid, "upsert");
    pushOp(ops, seen, `full:link:${uid}:${hlc}`, hlc, "link", uid, "upsert", snap.payload);
  }

  const tombstones = d
    .prepare("SELECT entity, entity_uid, hlc FROM sync_tombstones ORDER BY deleted_at")
    .all() as Array<{ entity: string; entity_uid: string; hlc: string }>;
  for (const row of tombstones) {
    if (row.entity !== "project" && row.entity !== "memory" && row.entity !== "link") continue;
    const entity = row.entity as SyncEntity;
    if (latestTombstone(entity, row.entity_uid) !== row.hlc) continue;
    pushOp(ops, seen, `full:${entity}:${row.entity_uid}:${row.hlc}`, row.hlc, entity, row.entity_uid, "delete", {});
  }

  return ops;
}

function buildDeltaOps(): BundleOp[] {
  const last = getSyncState("last_export_hlc");
  const rows = getDb()
    .prepare(
      `SELECT op_id, hlc, entity, entity_uid, op, payload
       FROM sync_outbox WHERE hlc > ? ORDER BY hlc, id`
    )
    .all(last) as Array<{
    op_id: string;
    hlc: string;
    entity: string;
    entity_uid: string;
    op: string;
    payload: string;
  }>;
  const ops: BundleOp[] = [];
  for (const row of rows) {
    if (row.entity !== "project" && row.entity !== "memory" && row.entity !== "link") continue;
    let payload: unknown = {};
    try {
      payload = JSON.parse(row.payload) as unknown;
    } catch {
      continue;
    }
    ops.push({
      opId: row.op_id,
      hlc: row.hlc,
      entity: row.entity,
      entityUid: row.entity_uid,
      op: row.op === "delete" ? "delete" : "upsert",
      payload,
    });
  }
  return ops;
}

export function exportBundle(opts: ExportOptions): ExportResult {
  const ops = opts.full ? buildFullSnapshotOps() : buildDeltaOps();
  if (!ops.length) {
    throw new Error(opts.full ? "Nothing to export: database is empty" : "Nothing to export since last bundle");
  }
  let hlcMin = ops[0].hlc;
  let hlcMax = ops[0].hlc;
  for (const op of ops) {
    if (compareHlc(op.hlc, hlcMin) < 0) hlcMin = op.hlc;
    if (compareHlc(op.hlc, hlcMax) > 0) hlcMax = op.hlc;
  }
  const written = writeBundleFile(opts.filePath, ops, opts.groupKey, getDeviceId());
  const last = getSyncState("last_export_hlc");
  if (!last || compareHlc(hlcMax, last) > 0) setSyncState("last_export_hlc", hlcMax);
  setSyncState("last_export_at", String(Date.now()));
  setSyncState("last_export_file", written.filePath);
  return { ...written, opCount: ops.length, hlcMin, hlcMax };
}
