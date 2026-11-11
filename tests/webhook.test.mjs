/* Test modul notifikasi webhook (F3) — dijalankan terhadap dist/ hasil build.
 * Receiver = node:http server lokal 127.0.0.1 (port ephemeral); DB sementara
 * via MEMORIA_DATA_DIR. Test network pertama di repo (zero-dep tetap terjaga). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
const require = createRequire(import.meta.url);

process.env.MEMORIA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-notify-"));
const dbmod = require("../dist/engine/store/db.js");
const webhook = require("../dist/engine/notify/webhook.js");

dbmod.initDb(process.env.MEMORIA_DATA_DIR);

/** Receiver HTTP lokal: rekam request terakhir, balas 200 (atau 500 utk flag). */
function startReceiver(status = 200) {
  return new Promise((resolve) => {
    const received = [];
    const srv = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push({ url: req.url, headers: req.headers, body });
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: status === 200 }));
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve({ srv, port: srv.address().port, received }));
  });
}

test("webhook: generic — payload JSON tertangkap receiver", async () => {
  const { srv, port, received } = await startReceiver();
  dbmod.setSetting("notifyGenericUrl", `http://127.0.0.1:${port}/hook`);
  const r = await webhook.sendNotification({
    event: "digest",
    title: "Memoria weekly digest is ready",
    body: "5 memories created in the last 7 days.",
    details: { memories: 5 },
  });
  srv.close();
  assert.equal(r.length, 1);
  assert.equal(r[0].platform, "generic");
  assert.equal(r[0].ok, true, `kirim gagal: ${r[0].error}`);
  assert.equal(received.length, 1);
  const sent = JSON.parse(received[0].body);
  assert.equal(sent.app, "memoria");
  assert.equal(sent.event, "digest");
  assert.equal(sent.details.memories, 5);
  assert.ok(sent.ts > 0);
});

test("webhook: tanpa konfigurasi = no-op (bukan error)", async () => {
  const r = await webhook.sendNotification({ event: "scan", title: "x", body: "y" }, "discord");
  assert.equal(r.length, 0, "tanpa URL discord, tidak ada target yang dikirim");
});

test("webhook: HTTP error dilaporkan sebagai { ok:false }, tidak melempar", async () => {
  const { srv, port } = await startReceiver(500);
  dbmod.setSetting("notifyGenericUrl", `http://127.0.0.1:${port}/fail`);
  const r = await webhook.sendNotification({ event: "scan", title: "x", body: "y" });
  srv.close();
  assert.equal(r.length, 1);
  assert.equal(r[0].ok, false);
  assert.match(r[0].error, /HTTP 500/);
});

test("webhook: event toggle — listener hanya kirim event yang diaktifkan", async () => {
  const { srv, port, received } = await startReceiver();
  dbmod.setSetting("notifyGenericUrl", `http://127.0.0.1:${port}/hook`);
  dbmod.setSetting("notifyScan", "0"); // scan mati
  dbmod.setSetting("notifyDrafts", "1"); // drafts nyala

  webhook.registerWebhooks();
  const { emitEvent } = require("../dist/engine/events.js");
  // beri jeda agar registerWebhooks listener pasti terpasang (sync fan-out,
  // aman langsung dipanggil berurutan)
  emitEvent("scan", { tools: ["claude+3"], newTranscripts: 3, newMemories: 1 });
  emitEvent("drafts_pending", { count: 4 });
  await new Promise((r) => setTimeout(r, 100));
  srv.close();
  assert.equal(received.length, 1, "event dengan toggle off tidak boleh terkirim");
  const sent = JSON.parse(received[0].body);
  assert.equal(sent.event, "drafts_pending");
  assert.match(sent.body, /4 drafts/);
});

test("webhook: payloadFromEvent — format English & abaikan event tak dikenal", () => {
  assert.equal(webhook.payloadFromEvent("tasks", {}), null);
  const scan = webhook.payloadFromEvent("scan", { tools: ["claude+3"], newTranscripts: 3, newMemories: 1 });
  assert.match(scan.body, /3 new transcripts/);
  assert.match(scan.body, /1 new memory\b/);
  const approve = webhook.payloadFromEvent("memory_approved", { count: 2, batch: true });
  assert.match(approve.body, /2 memories approved/);
  const one = webhook.payloadFromEvent("memory_approved", { count: 1, items: [{ kind: "decision", project: "memoria", content: "pakai pnpm  " }] });
  assert.match(one.body, /decision · memoria/);
  assert.equal(webhook.payloadFromEvent("memory_approved", { count: 0 }), null);
});
