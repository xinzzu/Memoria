/* Test batch embedding OpenAI-compatible (F1B sisa) — dijalankan terhadap dist/.
 * Receiver = node:http lokal 127.0.0.1 (port ephemeral); DB sementara. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
const require = createRequire(import.meta.url);

process.env.MEMORIA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-embed-"));
const dbmod = require("../dist/engine/store/db.js");
const compat = require("../dist/engine/extract/openai-compat.js");
const { openaiProvider, embedManyVia } = require("../dist/engine/extract/provider.js");

dbmod.initDb(process.env.MEMORIA_DATA_DIR);

function startEmbedServer(responseFor) {
  return new Promise((resolve) => {
    const requests = [];
    const srv = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}");
        requests.push({ url: req.url, headers: req.headers, body: parsed });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(responseFor(parsed, requests.length)));
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve({ srv, port: srv.address().port, requests }));
  });
}

test("openaiEmbedMany: satu request batch, urutan mengikuti index respons", async () => {
  const { srv, port, requests } = await startEmbedServer((body) => ({
    data: body.input.map((_t, i) => ({ index: i, embedding: [i + 1, 0, 0] })).reverse(),
  }));
  dbmod.setSetting("openaiBaseUrl", `http://127.0.0.1:${port}/v1`);
  const texts = ["alpha", "beta", "gamma"];
  const embs = await compat.openaiEmbedMany(texts);
  srv.close();
  assert.equal(requests.length, 1, "semua teks harus dalam satu request batch");
  assert.equal(requests[0].url, "/v1/embeddings");
  assert.deepEqual(requests[0].body.input, texts);
  assert.equal(requests[0].body.model, "text-embedding-3-small");
  assert.deepEqual(embs, [[1, 0, 0], [2, 0, 0], [3, 0, 0]], "index respons harus memetakan urutan input");
});

test("openaiEmbedMany: batch >64 dipecah, semua item tetap terisi", async () => {
  const { srv, port, requests } = await startEmbedServer((body) => ({
    data: body.input.map((_t, i) => ({ index: i, embedding: [requests.length, i] })),
  }));
  dbmod.setSetting("openaiBaseUrl", `http://127.0.0.1:${port}`);
  const texts = Array.from({ length: 70 }, (_x, i) => `teks-${i}`);
  const embs = await compat.openaiEmbedMany(texts);
  srv.close();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].body.input.length, 64);
  assert.equal(requests[1].body.input.length, 6);
  assert.equal(embs.length, 70);
  assert.ok(embs.every((e) => Array.isArray(e) && e.length === 2));
  assert.deepEqual(embs[69], [2, 5]);
});

test("openaiEmbedMany: item yang tidak dikembalikan server menjadi null", async () => {
  const { srv, port } = await startEmbedServer(() => ({ data: [{ index: 1, embedding: [9, 9] }] }));
  dbmod.setSetting("openaiBaseUrl", `http://127.0.0.1:${port}`);
  const embs = await compat.openaiEmbedMany(["a", "b", "c"]);
  srv.close();
  assert.equal(embs[0], null);
  assert.deepEqual(embs[1], [9, 9]);
  assert.equal(embs[2], null);
});

test("embedManyVia: provider openai memakai embedMany (1 request, bukan loop)", async () => {
  const { srv, port, requests } = await startEmbedServer((body) => ({
    data: body.input.map((_t, i) => ({ index: i, embedding: [1, i] })),
  }));
  dbmod.setSetting("openaiBaseUrl", `http://127.0.0.1:${port}`);
  const embs = await embedManyVia(openaiProvider, ["satu", "dua", "tiga"]);
  srv.close();
  assert.equal(requests.length, 1);
  assert.equal(embs.length, 3);
  assert.ok(embs.every((e) => e && e.length === 2));
});

test("openaiEmbedMany: array kosong = tanpa request; provider tanpa baseUrl = null", async () => {
  dbmod.setSetting("openaiBaseUrl", "");
  assert.deepEqual(await compat.openaiEmbedMany([]), []);
  assert.deepEqual(await embedManyVia(openaiProvider, ["x", "y"]), [null, null]);
});
