/* PR-K: MCP over HTTP (streamable) — JEMBATAN ANTAR-AI.
 * Dulu MCP hanya stdio (satu config file per tool AI). Kini engine juga
 * melayani MCP di HTTP port yang sama: AI tool manapun (Claude, Codex,
 * Gemini, opencode, agent LAN dengan token) tinggal mengarah ke
 * http://127.0.0.1:48210/mcp — tanpa path/path config yang berbeda-beda.
 *
 * Pola stateless resmi SDK 1.30: server + transport DIBUAT PER REQUEST
 * (sessionIdGenerator: undefined) — tiap POST mandiri, tidak ada sesi yang
 * harus dikelola/dibersihkan. Dipanggil dari pipeline http.ts SETELAH guard
 * host/origin/token, jadi mewarisi seluruh lapisan keamanan API. */
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { IncomingMessage, ServerResponse } from "node:http";
import { createMcpServer } from "./server";

export async function handleMcpHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true, // balas JSON tunggal (bukan SSE stream) — cocok untuk curl & tool
    });
    const server = createMcpServer();
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (e) {
    // JSON-RPC error standar bila request bukan MCP yang valid.
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: String((e as Error).message || e) }, id: null }));
    } else {
      res.end();
    }
  }
}
