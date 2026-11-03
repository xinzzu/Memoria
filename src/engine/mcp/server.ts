import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ensureDb } from "../ingest/manager";
import { searchMemories, projectContext } from "../retrieve/search";
import { ensureProject, memoryById, effectiveStatus, getDb, resolveProject } from "../store/db";
import { looksLikePath, projectSlugFromCwd } from "../ingest/util";
import { getEmbedProvider } from "../extract/provider";
import { relatedMemories } from "../graph";
import { addMemoryWithDedupe } from "../extract/dedupe";

const TOOL_DESC = `
You have access to persistent memory (a second brain) from every AI coding tool the user has used (Claude, Codex, opencode, Gemini, Copilot, Antigravity).
USE these tools at the START of a new session to retrieve context about previous work, and whenever the user asks about prior work.

How to use:
1. At session start, call recall with keywords relevant to the user's task.
2. Before changing code, recall project context: decisions, pending tasks, fixed errors, preferences.
3. After finishing a task, call remember to store new memories.
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
        return { content: [{ type: "text", text }] };
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
        addMemoryWithDedupe({
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
        return { content: [{ type: "text", text: `Memory saved: [${kind}] ${content}` }] };
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
