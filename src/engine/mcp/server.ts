import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ensureDb } from "../ingest/manager";
import { searchMemories, projectContext } from "../retrieve/search";
import { ensureProject, memoryById, effectiveStatus, getDb, resolveProject, updateMemory, deleteMemory } from "../store/db";
import { looksLikePath, projectSlugFromCwd } from "../ingest/util";
import { getEmbedProvider } from "../extract/provider";
import { relatedMemories } from "../graph";
import { addMemoryWithDedupe } from "../extract/dedupe";
import { buildContextBlock } from "../retrieve/contextblock";
import { emitEvent } from "../events";

const TOOL_DESC = `
You have access to persistent memory (a second brain) from every AI coding tool the user has used (Claude, Codex, opencode, Gemini, Copilot, Antigravity).
USE these tools at the START of a new session to retrieve context about previous work, and whenever the user asks about prior work.

How to use:
1. At session start, call recall with keywords relevant to the user's task.
2. Before changing code, recall project context: decisions, pending tasks, fixed errors, preferences.
3. After finishing a task, call remember to store new memories.
4. If a stored memory is wrong or outdated, correct it with update_memory (auto re-embeds) or remove it with forget.
`;

export function createMcpServer(): Server {
  ensureDb();
  const server = new Server(
    { name: "memoria", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "recall",
        description:
          "Search memories of previous work by keywords/question. Returns facts, decisions, tasks and fixed errors. Call at session start!",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Pertanyaan atau kata kunci" },
            limit: { type: "number", default: 8 },
          },
          required: ["query"],
        },
      },
      {
        name: "project_context",
        description: "Fetch the latest context of a project: decisions, pending tasks, completed work.",
        inputSchema: {
          type: "object",
          properties: {
            project: { type: "string", description: "Path atau nama proyek" },
            limit: { type: "number", default: 10 },
          },
          required: ["project"],
        },
      },
      {
        name: "remember",
        description: "Store an important memory (decision, fact, user preference, completed/pending task) so every tool remembers it.",
        inputSchema: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: ["fact", "decision", "task_done", "task_pending", "error_fixed", "preference", "context"],
            },
            content: { type: "string", description: "Memory content, short and dense" },
            project: { type: "string", description: "Path proyek (opsional)" },
            importance: { type: "number", default: 0.5 },
          },
          required: ["kind", "content"],
        },
      },
      {
        name: "related",
        description:
          "Fetch memories connected (backlinks/similarity) to one memory. Use when recall context is incomplete or you need related detail. Pass a memory id or a text query.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "number", description: "ID memori hasil recall" },
            query: { type: "string", description: "Atau kata kunci untuk menemukan memori terdekat lalu ambil yang terhubung" },
          },
        },
      },
      {
        name: "update_memory",
        description:
          "Correct an existing memory: replace its content (auto re-embedded so semantic search stays accurate), change its kind, or adjust importance. Pass the memory id from recall.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "number", description: "Memory id from recall" },
            content: { type: "string", description: "Replacement content, short and dense" },
            kind: {
              type: "string",
              enum: ["fact", "decision", "task_done", "task_pending", "error_fixed", "preference", "context"],
            },
            importance: { type: "number" },
          },
          required: ["id"],
        },
      },
      {
        name: "forget",
        description:
          "Delete a stale or wrong memory. Pass the memory id for a direct delete, or a query: a confident match is deleted immediately, otherwise candidates are listed for you to pick an explicit id.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "number", description: "Memory id (direct delete)" },
            query: { type: "string", description: "Keywords to find the memory to forget" },
          },
        },
      },
      {
        name: "build_context",
        description:
          "One ready-to-use context block for a project: auto-maintained project brief + key memories + optional query matches + 1-hop relations, capped to maxChars. Ideal first call at session start.",
        inputSchema: {
          type: "object",
          properties: {
            project: { type: "string", description: "Path atau nama proyek" },
            query: { type: "string", description: "Fokus opsional — memori yang cocok ditambahkan ke blok" },
            maxChars: { type: "number", default: 6000 },
          },
          required: ["project"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = (args ?? {}) as Record<string, any>;

    switch (name) {
      case "recall": {
        const query = String(a.query || "");
        // Embed query agar skor semantik aktif — tanpa ini recall MCP hanya keyword.
        const eprov = await getEmbedProvider();
        const qEmb = await eprov.embed(query);
        const results = searchMemories(query, { limit: Number(a.limit || 8), embedModel: eprov.embedModel }, qEmb);
        if (!results.length) {
          return {
            content: [{ type: "text", text: "No matching memories. This is a fresh session - proceed with the user's task as usual." }],
          };
        }
        const text = results
          .map(
            (r) =>
              `[${r.kind}] (${r.projectSlug ?? "global"}, ${r.sourceTool}, importance ${r.importance.toFixed(2)})\n${r.content}`
          )
          .join("\n\n");
        // A5: lampirkan relasi 1-hop dari 2 hit teratas — konteks kaya tanpa
        // panggilan tambahan (traversal graphiti-style, dangkal & murah).
        const relLines: string[] = [];
        for (const h of results.slice(0, 2)) {
          const rel = relatedMemories(h.id, 2);
          for (const r of rel) {
            if (!results.some((x) => x.id === r.memory.id)) {
              relLines.push(`  ↳ [${r.linkKind}] (id ${r.memory.id}) ${r.memory.content.replace(/\s+/g, " ").slice(0, 110)}`);
            }
          }
        }
        const withRel = relLines.length ? `${text}\n\nRelated:\n${relLines.join("\n")}` : text;
        return { content: [{ type: "text", text: withRel }] };
      }
      case "build_context": {
        // A3: satu blok konteks siap-tempel — brief + memori kunci + query +
        // relasi 1-hop, dibatasi maxChars (ala build_context / context string).
        const project = String(a.project || "");
        if (!project) {
          return { content: [{ type: "text", text: "project is required (path atau nama proyek)." }] };
        }
        const eprov = a.query ? await getEmbedProvider() : null;
        const qEmb = eprov && a.query ? await eprov.embed(String(a.query)) : null;
        const block = buildContextBlock({
          project,
          query: a.query ? String(a.query) : undefined,
          limit: Number(a.limit || 12),
          maxChars: Number(a.maxChars || 6000),
          embedModel: eprov?.embedModel,
          queryEmbedding: qEmb,
        });
        return { content: [{ type: "text", text: block }] };
      }
      case "project_context": {
        const proj = resolveProject(String(a.project || ""));
        const results = proj ? projectContext(proj.slug, Number(a.limit || 10)) : [];
        if (!results.length) {
          return { content: [{ type: "text", text: `No memories stored for project "${a.project}".` }] };
        }
        const text = results
          .map((r) => `[${r.kind}] ${r.content}`)
          .join("\n\n");
        return { content: [{ type: "text", text }] };
      }
      case "related": {
        let memId = Number(a.id || 0);
        if (!memId && a.query) {
          const eprov = await getEmbedProvider();
          const qEmb = await eprov.embed(String(a.query));
          const hits = searchMemories(String(a.query), { limit: 1, embedModel: eprov.embedModel }, qEmb);
          memId = hits[0]?.id ?? 0;
        }
        if (!memId) {
          return { content: [{ type: "text", text: "Memory not found. Call recall first to get an id, or include a query." }] };
        }
        const me = memoryById(memId);
        const rel = relatedMemories(memId, 8);
        if (!rel.length) {
          return { content: [{ type: "text", text: `Memory has no related connections (id ${memId}).` }] };
        }
        const head = me ? `Source memory (${me.id}): ${me.content}\n\nConnected memories:\n` : `Connected memories (id ${memId}):\n`;
        const text = head + rel
          .map((r) => `- [${r.linkKind}] (id ${r.memory.id}) ${r.memory.content}`)
          .join("\n");
        return { content: [{ type: "text", text }] };
      }
      case "remember": {
        const kinds = ["fact", "decision", "task_done", "task_pending", "error_fixed", "preference", "context"];
        const kind = kinds.includes(a.kind) ? a.kind : "context";
        const content = String(a.content || "").trim();
        if (!content) {
          return { content: [{ type: "text", text: "content is empty." }] };
        }
        const project = String(a.project || "");
        const resolved = resolveProject(project);
        const projectId = resolved
          ? resolved.id
          : project && project !== "_unknown"
            ? // Hanya terima sebagai kandidat path bila bentuknya memang path —
              // nama proyek polos di-resolve jadi <cwd>/<nama> yang menyesatkan.
              ensureProject(projectSlugFromCwd(project), looksLikePath(project) ? project : undefined)
            : null;
        const eprov = await getEmbedProvider();
        const embedding = await eprov.embed(content);
        const res = addMemoryWithDedupe({
          projectId,
          kind,
          content,
          importance: Math.min(1, Math.max(0, Number(a.importance) || 0.5)),
          createdAt: Date.now(),
          lastAccessed: 0,
          accessCount: 0,
          sourceTool: "mcp",
          embedding,
          status: effectiveStatus(),
          origin: "user",
          embedModel: eprov.embedModel,
        });
        // Smart remember:laporkan apa yang sebenarnya terjadi (ADD/UPDATE/NOOP).
        const text = res.updated
          ? `Memory updated (replaced content of #${res.updated}): [${kind}] ${content}`
          : res.inserted
            ? `Memory saved: [${kind}] ${content}`
            : `Merged into existing memory #${res.mergedInto} (importance raised)`;
        return { content: [{ type: "text", text }] };
      }
      case "update_memory": {
        const id = Number(a.id || 0);
        if (!id) {
          return { content: [{ type: "text", text: "Provide the memory id (from recall)." }] };
        }
        const existing = memoryById(id);
        if (!existing) {
          return { content: [{ type: "text", text: `No memory with id ${id}.` }] };
        }
        const kinds = ["fact", "decision", "task_done", "task_pending", "error_fixed", "preference", "context"];
        const patch: { content?: string; kind?: string; importance?: number; embedding?: number[]; embedModel?: string } = {};
        if (a.content !== undefined) {
          const content = String(a.content || "").trim();
          if (!content) {
            return { content: [{ type: "text", text: "Replacement content would be empty." }] };
          }
          patch.content = content;
        }
        if (a.kind !== undefined) {
          if (!kinds.includes(String(a.kind))) {
            return { content: [{ type: "text", text: `Unknown kind "${a.kind}".` }] };
          }
          patch.kind = String(a.kind);
        }
        if (a.importance !== undefined) {
          patch.importance = Math.min(1, Math.max(0, Number(a.importance) || 0));
        }
        if (patch.content) {
          // Konten berubah → vektor lama basi; re-embed agar recall semantik tetap benar.
          const eprov = await getEmbedProvider();
          const emb = await eprov.embed(patch.content);
          if (emb && emb.length) {
            patch.embedding = emb;
            patch.embedModel = eprov.embedModel;
          }
        }
        if (!Object.keys(patch).length) {
          return { content: [{ type: "text", text: "Nothing to update — pass content, kind, or importance." }] };
        }
        const ok = updateMemory(id, patch);
        if (ok) emitEvent("memory", { kind: patch.kind ?? existing.kind });
        return {
          content: [{
            type: "text",
            text: ok
              ? `Memory ${id} updated: [${patch.kind ?? existing.kind}] ${patch.content ?? existing.content}`
              : "Update failed.",
          }],
        };
      }
      case "forget": {
        const id = Number(a.id || 0);
        if (id) {
          const existing = memoryById(id);
          if (!existing) {
            return { content: [{ type: "text", text: `No memory with id ${id}.` }] };
          }
          const ok = deleteMemory(id);
          if (ok) emitEvent("memory", { kind: "forget" });
          return {
            content: [{
              type: "text",
              text: ok
                ? `Memory ${id} deleted: "${existing.content.replace(/\s+/g, " ").slice(0, 120)}"`
                : "Delete failed.",
            }],
          };
        }
        const query = String(a.query || "").trim();
        if (!query) {
          return { content: [{ type: "text", text: "Provide a memory id, or a query to find the memory to forget." }] };
        }
        const eprov = await getEmbedProvider();
        const qEmb = await eprov.embed(query);
        const hits = searchMemories(query, { limit: 3, embedModel: eprov.embedModel }, qEmb);
        if (!hits.length) {
          return { content: [{ type: "text", text: "No matching memory to forget." }] };
        }
        const top = hits[0];
        // Hapus langsung hanya bila cocoknya yakin; kalau ragu, minta id eksplisit
        // agar agent tidak menghapus memori yang salah.
        if (top.score >= 0.45) {
          const ok = deleteMemory(top.id);
          if (ok) emitEvent("memory", { kind: "forget" });
          return {
            content: [{
              type: "text",
              text: ok
                ? `Deleted (id ${top.id}, score ${top.score.toFixed(2)}): "${top.content.replace(/\s+/g, " ").slice(0, 120)}"`
                : "Delete failed.",
            }],
          };
        }
        const list = hits
          .map((h) => `- id ${h.id} (score ${h.score.toFixed(2)}) [${h.kind}] ${h.content.replace(/\s+/g, " ").slice(0, 100)}`)
          .join("\n");
        return {
          content: [{
            type: "text",
            text: `No confident match (best score ${top.score.toFixed(2)}). Candidates:\n${list}\nCall forget again with the exact id to delete.`,
          }],
        };
      }
      default:
        return { content: [{ type: "text", text: `Tool tidak dikenal: ${name}` }] };
    }
  });

  return server;
}

export async function runMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
