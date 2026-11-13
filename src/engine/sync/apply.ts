import {
  compareHlc,
  getDb,
  getEntityClock,
  getTombstone,
  hlcNewer,
  isBundleApplied,
  logSyncConflict,
  markSyncOpSeen,
  observeHlc,
  recordAppliedBundle,
  recordEntityClock,
  recordTombstone,
  reindexEntities,
  setSyncState,
  sortLinkUids,
  tagsForMemory,
  type SyncEntity,
} from "../store/db";
import { readBundleFile, type BundleOp, type SyncBundle } from "./bundle";
import { embeddingBackfillCount, queueEmbeddingBackfill } from "./embed";

export interface ApplyResult {
  fileId: string;
  groupId: string;
  deviceId: string;
  opCount: number;
  applied: number;
  skipped: number;
  conflicts: number;
  deferredEmbeddings: number;
  alreadyApplied: boolean;
}

interface ProjectPayload {
  slug: string;
  name: string;
  lastSeen: number;
  updatedBy: string;
}

interface MemoryPayload {
  projectUid: string | null;
  kind: string;
  content: string;
  importance: number;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
  sourceTool: string;
  status: string;
  resolvedAt: number;
  origin: string;
  archived: number;
  tags: string[];
}

interface LinkPayload {
  fromUid: string;
  toUid: string;
  kind: string;
  weight: number;
  createdAt: number;
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${what} payload is invalid`);
  return value as Record<string, unknown>;
}

function text(value: unknown, what: string): string {
  if (typeof value !== "string") throw new Error(`${what} must be a string`);
  return value;
}

function optionalText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function number(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const MEMORY_KINDS = new Set(["fact", "decision", "task_done", "task_pending", "error_fixed", "preference", "context"]);
const MEMORY_STATUS = new Set(["active", "draft"]);
const MEMORY_ORIGINS = new Set(["llm", "heuristic", "user"]);

function validateProject(value: unknown): ProjectPayload {
  const p = record(value, "Project");
  const slug = text(p.slug, "Project slug").trim().slice(0, 300);
  if (!slug) throw new Error("Project slug is empty");
  return {
    slug,
    name: optionalText(p.name, slug).slice(0, 500) || slug,
    lastSeen: number(p.lastSeen, 0),
    updatedBy: optionalText(p.updatedBy, "").slice(0, 200),
  };
}

function validateMemory(value: unknown): MemoryPayload {
  const p = record(value, "Memory");
  const content = text(p.content, "Memory content");
  if (content.length > 1_000_000) throw new Error("Memory content is too large");
  const tags = Array.isArray(p.tags)
    ? Array.from(
        new Set(
          p.tags
            .filter((t): t is string => typeof t === "string")
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean)
        )
      ).slice(0, 200)
    : [];
  const rawStatus = optionalText(p.status, "active");
  const status = MEMORY_STATUS.has(rawStatus) ? rawStatus : "active";
  const rawKind = optionalText(p.kind, "context");
  const kind = MEMORY_KINDS.has(rawKind) ? rawKind : "context";
  const rawOrigin = optionalText(p.origin, "llm");
  const origin = MEMORY_ORIGINS.has(rawOrigin) ? rawOrigin : "llm";
  return {
    projectUid: typeof p.projectUid === "string" && p.projectUid ? p.projectUid.slice(0, 200) : null,
    kind,
    content,
    importance: clamp(number(p.importance, 0.5), 0, 1),
    createdAt: number(p.createdAt, Date.now()),
    updatedAt: number(p.updatedAt, 0),
    updatedBy: optionalText(p.updatedBy, "").slice(0, 200),
    sourceTool: optionalText(p.sourceTool, "").slice(0, 200),
    status,
    resolvedAt: number(p.resolvedAt, 0),
    origin,
    archived: p.archived === 1 || p.archived === true ? 1 : 0,
    tags,
  };
}

function validateLink(value: unknown): LinkPayload {
  const p = record(value, "Link");
  const fromUid = text(p.fromUid, "Link fromUid");
  const toUid = text(p.toUid, "Link toUid");
  const [a, b] = sortLinkUids(fromUid, toUid);
  return {
    fromUid: a,
    toUid: b,
    kind: optionalText(p.kind, "related").slice(0, 100) || "related",
    weight: clamp(number(p.weight, 0.5), 0, 1),
    createdAt: number(p.createdAt, 0),
  };
}

function normalizeOp(raw: BundleOp): BundleOp {
  if (raw.entity !== "link") return raw;
  const [rawA, rawB] = raw.entityUid.split("|");
  let from = rawA || "";
  let to = rawB || "";
  if (raw.op === "upsert" && raw.payload && typeof raw.payload === "object") {
    const p = raw.payload as Record<string, unknown>;
    if (typeof p.fromUid === "string" && typeof p.toUid === "string") {
      from = p.fromUid;
      to = p.toUid;
    }
  }
  if (!from || !to) throw new Error("Link operation has an invalid UID");
  const [a, b] = sortLinkUids(from, to);
  return {
    ...raw,
    entityUid: `${a}|${b}`,
    payload: raw.op === "upsert" ? { ...(record(raw.payload, "Link") as object), fromUid: a, toUid: b } : raw.payload,
  };
}

/** Terapkan bundle yang sudah didekripsi. Semua perubahan dalam satu transaksi:
 * file rusak/konflik fatal tidak boleh meninggalkan state setengah jadi. */
export function applySyncBundle(bundle: SyncBundle): ApplyResult {
  const d = getDb();
  const header = bundle.header;
  const base = {
    fileId: header.fileId,
    groupId: header.groupId,
    deviceId: header.deviceId,
    opCount: header.opCount,
  };
  if (isBundleApplied(header.fileId)) {
    try {
      recordAppliedBundle({
        bundleId: header.fileId,
        deviceId: header.deviceId,
        ops: header.opCount,
        hlcMax: header.hlcMax,
        source: "legacy",
      });
    } catch {
      /* best effort */
    }
    return { ...base, applied: 0, skipped: header.opCount, conflicts: 0, deferredEmbeddings: embeddingBackfillCount(), alreadyApplied: true };
  }
  if (!bundle.ops.length) throw new Error("Bundle contains no operations");
  const ops = bundle.ops.map(normalizeOp);
  for (const op of ops) {
    if (op.entity === "project" && op.op === "upsert") validateProject(op.payload);
    if (op.entity === "memory" && op.op === "upsert") validateMemory(op.payload);
    if (op.entity === "link" && op.op === "upsert") validateLink(op.payload);
  }

  const seenStmt = d.prepare("SELECT 1 AS seen FROM sync_seen_ops WHERE op_id = ?");
  const unseen = ops.filter((op) => !seenStmt.get(op.opId));
  if (!unseen.length) {
    try {
      d.prepare("INSERT OR IGNORE INTO sync_applied (file_id, device_id, applied_at, op_count) VALUES (?, ?, ?, ?)").run(
        header.fileId,
        header.deviceId,
        Date.now(),
        header.opCount
      );
      recordAppliedBundle({
        bundleId: header.fileId,
        deviceId: header.deviceId,
        ops: header.opCount,
        hlcMax: header.hlcMax,
        source: "import",
      });
    } catch {
      /* best effort */
    }
    return { ...base, applied: 0, skipped: header.opCount, conflicts: 0, deferredEmbeddings: embeddingBackfillCount(), alreadyApplied: true };
  }

  let conflicts = 0;
  let applied = 0;
  let skipped = header.opCount - unseen.length;

  const conflict = (entity: SyncEntity, uid: string, winner: string, op: BundleOp): void => {
    logSyncConflict(entity, uid, winner, op.hlc, op.payload);
    conflicts++;
  };

  const isTombstoned = (entity: SyncEntity, uid: string): boolean => {
    const tomb = getTombstone(entity, uid);
    if (!tomb) return false;
    const clock = getEntityClock(entity, uid);
    return !clock || compareHlc(tomb.hlc, clock.hlc) >= 0;
  };

  const resolveProjectId = (uid: string | null): number | null => {
    if (!uid) return null;
    if (isTombstoned("project", uid)) return null;
    const direct = d.prepare("SELECT id FROM projects WHERE uid = ?").get(uid) as { id: number } | undefined;
    if (direct) return direct.id;
    const alias = d
      .prepare(
        `SELECT a.project_id AS id FROM sync_project_alias a
         JOIN projects p ON p.id = a.project_id WHERE a.remote_uid = ?`
      )
      .get(uid) as { id: number } | undefined;
    return alias ? alias.id : null;
  };

  const rememberAlias = (remoteUid: string, projectId: number): void => {
    d.prepare(
      `INSERT INTO sync_project_alias (remote_uid, project_id, created_at) VALUES (?, ?, ?)
       ON CONFLICT(remote_uid) DO UPDATE SET project_id = excluded.project_id`
    ).run(remoteUid, projectId, Date.now());
  };

  const applyProject = (op: BundleOp): boolean => {
    const uid = op.entityUid;
    if (op.op === "delete") {
      const clock = getEntityClock("project", uid);
      if (clock && !hlcNewer(op.hlc, clock.hlc)) {
        if (clock.op === "upsert") conflict("project", uid, clock.hlc, op);
        return false;
      }
      const tomb = getTombstone("project", uid);
      if (tomb && !hlcNewer(op.hlc, tomb.hlc)) return false;
      recordTombstone("project", uid, op.hlc);
      recordEntityClock("project", uid, op.hlc, "delete");
      return true;
    }

    const payload = validateProject(op.payload);
    const direct = d
      .prepare("SELECT id, uid FROM projects WHERE uid = ?")
      .get(uid) as { id: number; uid: string | null } | undefined;
    const remoteClock = getEntityClock("project", uid);
    if (direct && remoteClock && !hlcNewer(op.hlc, remoteClock.hlc)) {
      if (hlcNewer(remoteClock.hlc, op.hlc) && remoteClock.op === "upsert") {
        conflict("project", uid, remoteClock.hlc, op);
      }
      return false;
    }

    let projectId: number;
    let localUid: string | null;
    if (direct) {
      projectId = direct.id;
      localUid = direct.uid;
    } else {
      const alias = d
        .prepare(
          `SELECT a.project_id AS id, p.uid AS uid FROM sync_project_alias a
           JOIN projects p ON p.id = a.project_id WHERE a.remote_uid = ?`
        )
        .get(uid) as { id: number; uid: string | null } | undefined;
      if (alias) {
        projectId = alias.id;
        localUid = alias.uid;
      } else {
        const bySlug = d.prepare("SELECT id, uid FROM projects WHERE slug = ?").get(payload.slug) as
          | { id: number; uid: string | null }
          | undefined;
        if (bySlug) {
          projectId = bySlug.id;
          localUid = bySlug.uid;
          rememberAlias(uid, projectId);
        } else {
          const res = d
            .prepare(
              "INSERT INTO projects (slug, path, name, last_seen, uid, updated_by) VALUES (?, NULL, ?, ?, ?, ?)"
            )
            .run(payload.slug, payload.name, payload.lastSeen || Date.now(), uid, payload.updatedBy || "");
          projectId = Number(res.lastInsertRowid);
          localUid = uid;
        }
      }
    }

    const localClock = localUid && localUid !== uid ? getEntityClock("project", localUid) : null;
    const tomb = getTombstone("project", uid);
    const times = [remoteClock?.hlc, localClock?.hlc, tomb?.hlc].filter((x): x is string => !!x);
    const latest = times.sort(compareHlc).at(-1);
    if (!latest || hlcNewer(op.hlc, latest)) {
      d.prepare(
        "UPDATE projects SET name = ?, last_seen = MAX(COALESCE(last_seen, 0), ?), updated_by = ? WHERE id = ?"
      ).run(payload.name, payload.lastSeen || 0, payload.updatedBy || "", projectId);
    }
    recordEntityClock("project", uid, op.hlc, "upsert");
    if (localUid && localUid !== uid) recordEntityClock("project", localUid, op.hlc, "upsert");
    return true;
  };

  const applyMemory = (op: BundleOp): boolean => {
    const uid = op.entityUid;
    const local = d
      .prepare("SELECT id, content, embedding, embed_model FROM memories WHERE uid = ?")
      .get(uid) as { id: number; content: string; embedding: Buffer | null; embed_model: string | null } | undefined;
    const clock = getEntityClock("memory", uid);
    const tomb = getTombstone("memory", uid);

    if (op.op === "delete") {
      if (clock && !hlcNewer(op.hlc, clock.hlc)) {
        if (local && hlcNewer(clock.hlc, op.hlc) && clock.op === "upsert") conflict("memory", uid, clock.hlc, op);
        return false;
      }
      if (tomb && !hlcNewer(op.hlc, tomb.hlc)) return false;
      if (local) {
        d.prepare("DELETE FROM memory_tags WHERE memory_id = ?").run(local.id);
        d.prepare("DELETE FROM memory_entities WHERE memory_id = ?").run(local.id);
        d.prepare("DELETE FROM memory_links WHERE from_memory_id = ? OR to_memory_id = ?").run(local.id, local.id);
        d.prepare("DELETE FROM sync_embed_queue WHERE memory_id = ?").run(local.id);
        d.prepare("DELETE FROM memories WHERE id = ?").run(local.id);
        // FTS trigger AFTER DELETE diurus memories_fts_ad.
      }
      recordTombstone("memory", uid, op.hlc);
      recordEntityClock("memory", uid, op.hlc, "delete");
      return true;
    }

    const payload = validateMemory(op.payload);
    if (tomb && !hlcNewer(op.hlc, tomb.hlc)) return false;
    if (clock && !hlcNewer(op.hlc, clock.hlc)) {
      if (local && hlcNewer(clock.hlc, op.hlc) && clock.op === "upsert") conflict("memory", uid, clock.hlc, op);
      return false;
    }

    const projectId = resolveProjectId(payload.projectUid);
    const updatedAt = payload.updatedAt || payload.createdAt || Date.now();
    if (!local) {
      const res = d
        .prepare(
          `INSERT INTO memories
           (project_id, kind, content, importance, created_at, last_accessed, access_count, source_tool,
            embedding, status, resolved_at, origin, embed_model, archived, uid, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, 0, 0, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          projectId,
          payload.kind,
          payload.content,
          payload.importance,
          payload.createdAt,
          payload.sourceTool,
          payload.status,
          payload.resolvedAt,
          payload.origin,
          "",
          payload.archived,
          uid,
          updatedAt,
          payload.updatedBy
        );
      const memoryId = Number(res.lastInsertRowid);
      const tagStmt = d.prepare("INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)");
      for (const tag of payload.tags) tagStmt.run(memoryId, tag);
      reindexEntities(memoryId, payload.content);
      queueEmbeddingBackfill(memoryId);
      recordEntityClock("memory", uid, op.hlc, "upsert");
      return true;
    }

    const contentChanged = local.content !== payload.content;
    d.prepare(
      `UPDATE memories SET project_id = ?, kind = ?, content = ?, importance = ?, created_at = ?, source_tool = ?,
        status = ?, resolved_at = ?, origin = ?, archived = ?, updated_at = ?, updated_by = ?,
        embedding = ?, embed_model = ? WHERE id = ?`
    ).run(
      projectId,
      payload.kind,
      payload.content,
      payload.importance,
      payload.createdAt,
      payload.sourceTool,
      payload.status,
      payload.resolvedAt,
      payload.origin,
      payload.archived,
      updatedAt,
      payload.updatedBy,
      contentChanged ? null : local.embedding,
      contentChanged ? "" : local.embed_model || "",
      local.id
    );
    if (contentChanged) {
      reindexEntities(local.id, payload.content);
      queueEmbeddingBackfill(local.id);
    } else if (!local.embedding) {
      queueEmbeddingBackfill(local.id);
    }
    const currentTags = tagsForMemory(local.id).sort();
    const nextTags = [...payload.tags].sort();
    if (currentTags.join("\u0000") !== nextTags.join("\u0000")) {
      d.prepare("DELETE FROM memory_tags WHERE memory_id = ?").run(local.id);
      const tagStmt = d.prepare("INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)");
      for (const tag of payload.tags) tagStmt.run(local.id, tag);
    }
    recordEntityClock("memory", uid, op.hlc, "upsert");
    return true;
  };

  const applyLink = (op: BundleOp): boolean => {
    const uid = op.entityUid;
    const [fromUid, toUid] = uid.split("|");
    if (!fromUid || !toUid) return false;
    const from = d.prepare("SELECT id FROM memories WHERE uid = ?").get(fromUid) as { id: number } | undefined;
    const to = d.prepare("SELECT id FROM memories WHERE uid = ?").get(toUid) as { id: number } | undefined;
    const local =
      from && to
        ? (d
            .prepare("SELECT from_memory_id AS from_id FROM memory_links WHERE from_memory_id = ? AND to_memory_id = ?")
            .get(Math.min(from.id, to.id), Math.max(from.id, to.id)) as { from_id: number } | undefined)
        : undefined;
    const clock = getEntityClock("link", uid);
    const tomb = getTombstone("link", uid);

    if (op.op === "delete") {
      if (clock && !hlcNewer(op.hlc, clock.hlc)) {
        if (local && hlcNewer(clock.hlc, op.hlc) && clock.op === "upsert") conflict("link", uid, clock.hlc, op);
        return false;
      }
      if (tomb && !hlcNewer(op.hlc, tomb.hlc)) return false;
      if (from && to) {
        d.prepare("DELETE FROM memory_links WHERE from_memory_id = ? AND to_memory_id = ?").run(
          Math.min(from.id, to.id),
          Math.max(from.id, to.id)
        );
      }
      recordTombstone("link", uid, op.hlc);
      recordEntityClock("link", uid, op.hlc, "delete");
      return true;
    }

    if (!from || !to) return false;
    const payload = validateLink(op.payload);
    if (tomb && !hlcNewer(op.hlc, tomb.hlc)) return false;
    if (clock && !hlcNewer(op.hlc, clock.hlc)) {
      if (local && hlcNewer(clock.hlc, op.hlc) && clock.op === "upsert") conflict("link", uid, clock.hlc, op);
      return false;
    }
    const a = Math.min(from.id, to.id);
    const b = Math.max(from.id, to.id);
    d.prepare(
      `INSERT INTO memory_links (from_memory_id, to_memory_id, kind, weight, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(from_memory_id, to_memory_id) DO UPDATE SET kind = excluded.kind, weight = excluded.weight`
    ).run(a, b, payload.kind, payload.weight, payload.createdAt || Date.now());
    recordEntityClock("link", uid, op.hlc, "upsert");
    return true;
  };

  d.exec("BEGIN IMMEDIATE");
  try {
    for (const op of unseen) markSyncOpSeen(op.opId);

    const latest = new Map<string, BundleOp>();
    for (const op of unseen) {
      const key = `${op.entity}\u0000${op.entityUid}`;
      const prev = latest.get(key);
      if (!prev || hlcNewer(op.hlc, prev.hlc) || (compareHlc(op.hlc, prev.hlc) === 0 && op.opId > prev.opId)) {
        latest.set(key, op);
      }
    }
    skipped += unseen.length - latest.size;

    const groups: Record<SyncEntity, BundleOp[]> = { project: [], memory: [], link: [] };
    for (const op of latest.values()) groups[op.entity].push(op);
    for (const op of groups.project) {
      if (applyProject(op)) applied++;
      else skipped++;
    }
    for (const op of groups.memory) {
      if (applyMemory(op)) applied++;
      else skipped++;
    }
    for (const op of groups.link) {
      if (applyLink(op)) applied++;
      else skipped++;
    }

    d.prepare("INSERT OR IGNORE INTO sync_applied (file_id, device_id, applied_at, op_count) VALUES (?, ?, ?, ?)").run(
      header.fileId,
      header.deviceId,
      Date.now(),
      header.opCount
    );
    recordAppliedBundle({
      bundleId: header.fileId,
      deviceId: header.deviceId,
      ops: header.opCount,
      hlcMax: header.hlcMax,
      source: "import",
    });
    setSyncState("last_import_at", String(Date.now()));
    setSyncState("last_import_file", header.fileId);
    setSyncState("last_import_hlc", header.hlcMax);
    observeHlc(header.hlcMax);
    d.exec("COMMIT");
  } catch (err) {
    try {
      d.exec("ROLLBACK");
    } catch {
      /* transaksi mungkin sudah batal */
    }
    throw err;
  }

  return {
    ...base,
    applied,
    skipped,
    conflicts,
    deferredEmbeddings: embeddingBackfillCount(),
    alreadyApplied: false,
  };
}

export function applyBundleFile(filePath: string, groupKey: Buffer, source = "import", filename = ""): ApplyResult {
  const bundle = readBundleFile(filePath, groupKey);
  const result = applySyncBundle(bundle);
  if (!result.alreadyApplied || source !== "import") {
    try {
      recordAppliedBundle({
        bundleId: result.fileId,
        deviceId: result.deviceId,
        filename,
        ops: result.opCount,
        hlcMax: bundle.header.hlcMax,
        source,
      });
    } catch {
      /* best effort */
    }
  }
  return result;
}
