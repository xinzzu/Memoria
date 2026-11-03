import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ensureDb } from "../ingest/manager";
import { searchMemories, projectContext } from "../retrieve/search";
import { ensureProject, memoryById, effectiveStatus, getDb, projectRecord } from "../store/db";
import { canonicalPath, projectSlugFromCwd } from "../ingest/util";
import { embed } from "../extract/ollama";
import { relatedMemories } from "../graph";
import { addMemoryWithDedupe } from "../extract/dedupe";

const TOOL_DESC = `
Kamu punya akses ke memori persisten (second brain) dari semua AI coding tool yang pernah dipakai user (Claude, Codex, opencode, Gemini, Copilot, Antigravity).
GUNAKAN tool ini di AWAL sesi baru untuk mengambil konteks pekerjaan yang sudah pernah dikerjakan, lalu pakai saat user bertanya tentang pekerjaan sebelumnya.

Cara pakai yang benar:
1. Saat sesi dimulai, panggil recall dengan kata kunci yang relevan dengan tugas user.
2. Sebelum mengubah kode, recall konteks proyek: decision, task_pending, error_fixed, preference.
3. Setelah tugas selesai, panggil remember untuk menyimpan memori baru.
`;

/**
 * Resolve input proyek dari agent (bisa path, slug, atau nama) ke record proyek.
 * Urutan: slug persis -> slug hasil slugify path -> path kanonik -> LIKE nama/slug.
 * Tanpa ini, agent yang mem-passing path dengan format sedikit berbeda selalu
 * mendapat "Belum ada memori" padahal datanya ada.
 */
export function resolveProject(input: string): { id: number; slug: string } | null {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const db = getDb();

  for (const cand of [raw.toLowerCase(), projectSlugFromCwd(raw)]) {
    const bySlug = db.prepare("SELECT id, slug FROM projects WHERE slug = ?").get(cand) as
      | { id: number; slug: string }
      | undefined;
    if (bySlug) return bySlug;
  }

  const canon = canonicalPath(raw);
  if (canon) {
    const rows = db.prepare("SELECT id, slug, path FROM projects WHERE path IS NOT NULL AND path != ''").all() as
      Array<{ id: number; slug: string; path: string }>;
    for (const r of rows) {
      if (canonicalPath(r.path) === canon) return { id: r.id, slug: r.slug };
    }
  }

  const like = `%${raw.toLowerCase()}%`;
  const byLike = db
    .prepare("SELECT id, slug FROM projects WHERE lower(name) LIKE ? OR lower(slug) LIKE ? ORDER BY last_seen DESC LIMIT 1")
    .get(like, like) as { id: number; slug: string } | undefined;
  return byLike ?? null;
}

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
          "Cari memori pekerjaan sebelumnya berdasarkan kata kunci/pertanyaan. Hasil termasuk fakta, keputusan, task, error yang sudah diperbaiki. Panggil di awal sesi!",
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
        description: "Ambil konteks terbaru sebuah proyek: keputusan, task pending, hal yang sudah dikerjakan.",
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
        description: "Simpan memori penting (keputusan, fakta, preferensi user, task yang selesai/pending) agar diingat di semua tool.",
        inputSchema: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: ["fact", "decision", "task_done", "task_pending", "error_fixed", "preference", "context"],
            },
            content: { type: "string", description: "Isi memori, singkat dan padat" },
            project: { type: "string", description: "Path proyek (opsional)" },
            importance: { type: "number", default: 0.5 },
          },
          required: ["kind", "content"],
        },
      },
      {
        name: "related",
        description:
          "Ambil memori yang terhubung (backlink/similarity) dari sebuah memori. Pakai saat konteks dari recall kurang lengkap atau ingin menggali detail terkait. Beri id memori atau query teks.",
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
        const qEmb = await embed(query);
        const results = searchMemories(query, { limit: Number(a.limit || 8) }, qEmb);
        if (!results.length) {
          return {
            content: [{ type: "text", text: "Tidak ada memori yang cocok. Ini sesi baru, lanjutkan tugas user seperti biasa." }],
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
          return { content: [{ type: "text", text: `Belum ada memori tersimpan untuk proyek "${a.project}".` }] };
        }
        const text = results
          .map((r) => `[${r.kind}] ${r.content}`)
          .join("\n\n");
        return { content: [{ type: "text", text }] };
      }
      case "related": {
        let memId = Number(a.id || 0);
        if (!memId && a.query) {
          const qEmb = await embed(String(a.query));
          const hits = searchMemories(String(a.query), { limit: 1 }, qEmb);
          memId = hits[0]?.id ?? 0;
        }
        if (!memId) {
          return { content: [{ type: "text", text: "Memori tidak ditemukan. Coba recall dulu untuk mendapat id, atau sertakan query." }] };
        }
        const me = memoryById(memId);
        const rel = relatedMemories(memId, 8);
        if (!rel.length) {
          return { content: [{ type: "text", text: `Memori tidak memiliki koneksi terkait (id ${memId}).` }] };
        }
        const head = me ? `Memori asal (${me.id}): ${me.content}\n\nMemori terhubung:\n` : `Memori terhubung (id ${memId}):\n`;
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
          return { content: [{ type: "text", text: "content kosong." }] };
        }
        const project = String(a.project || "");
        const resolved = resolveProject(project);
        const projectId = resolved
          ? resolved.id
          : project && project !== "_unknown"
            ? ensureProject(projectSlugFromCwd(project), project)
            : null;
        const embedding = await embed(content);
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
        });
        return { content: [{ type: "text", text: `Memori tersimpan: [${kind}] ${content}` }] };
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
