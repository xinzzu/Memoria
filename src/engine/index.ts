import { getConfig } from "./config";
import { scanAll, stats, ensureDb } from "./ingest/manager";
import { startWatcher, stopWatcher } from "./ingest/watcher";
import { runMcpServer } from "./mcp/server";
import { startHttpServer } from "./http";
import { searchMemories } from "./retrieve/search";
import { getEmbedProvider } from "./extract/provider";
import { extractQueue } from "./extract/extractor";
import { getDb } from "./store/db";

async function main(): Promise<void> {
  const cmd = process.argv[2] || "status";

  switch (cmd) {
    case "scan": {
      const start = Date.now();
      const results = await scanAll((m) => console.log(m));
      console.table(results.map((r) => ({ tool: r.tool, status: r.ok ? "ok" : "failed", new: r.count, detail: r.detail })));
      const s = stats();
      console.log(`Transcripts: ${s.transcripts} | Memories: ${s.memories} | Time: ${((Date.now() - start) / 1000).toFixed(1)}s`);
      break;
    }
    case "extract": {
      ensureDb();
      const n = await extractQueue(true);
      console.log(`Extraction finished: ${n} new memories`);
      break;
    }
    case "recall": {
      const q = process.argv.slice(3).join(" ");
      if (!q) {
        console.log('Usage: node dist/engine/index.js recall "keywords"');
        process.exit(1);
      }
      ensureDb();
      const eprov = await getEmbedProvider();
      const qEmb = await eprov.embed(q);
      const hits = searchMemories(q, { limit: 8, embedModel: eprov.embedModel }, qEmb);
      for (const h of hits) {
        console.log(`[${h.kind}] (${h.projectSlug ?? "global"} · ${h.sourceTool} · ${h.score.toFixed(2)})`);
        console.log(`  ${h.content}`);
        console.log("");
      }
      if (!hits.length) console.log("No matching memories.");
      break;
    }
    case "mcp": {
      await runMcpServer();
      break;
    }
    case "backup": {
      ensureDb();
      const { manualBackupNow } = await import("./lifecycle");
      const p = manualBackupNow();
      console.log(p ? `Backup saved: ${p}` : "Backup failed.");
      break;
    }
    case "handoff": {
      const slug = process.argv[3];
      if (!slug) {
        console.log('Usage: node dist/engine/index.js handoff <slug>');
        process.exit(1);
      }
      ensureDb();
      const { generateHandoff, injectHandoff } = await import("./handoff");
      const md = await generateHandoff(slug);
      console.log(md);
      if (process.argv.includes("--inject")) {
        const r = await injectHandoff(slug);
        console.log("");
        console.log(`Inject to ${r.file}: ${r.ok ? "ok" : "failed"}`);
      }
      break;
    }
    case "integrate": {
      const tool = process.argv[3];
      if (!tool) {
        console.log('Usage: node dist/engine/index.js integrate <claude|codex|opencode|gemini>');
        process.exit(1);
      }
      const { registerIntegration } = await import("./integrate");
      const r = registerIntegration(tool);
      console.log(`${tool}: ${r.message}`);
      break;
    }
    case "sync": {
      ensureDb();
      const { runSyncCommand } = await import("./sync/cli");
      await runSyncCommand(process.argv.slice(3));
      break;
    }
    case "server": {
      ensureDb();
      await startHttpServer();
      startWatcher();
      const { startBackgroundJobs, stopBackgroundJobs } = await import("./lifecycle");
      startBackgroundJobs();
      console.log("[memoria] Watcher aktif. Tekan Ctrl+C untuk berhenti.");
      process.on("SIGINT", () => {
        stopWatcher();
        stopBackgroundJobs();
        process.exit(0);
      });
      await new Promise(() => {});
      break;
    }
    case "status":
    default: {
      ensureDb();
      const s = stats();
      const cfg = getConfig();
      console.log(`Data dir   : ${cfg.dataDir}`);
      console.log(`Transcript : ${s.transcripts}`);
      console.log(`Memori     : ${s.memories}`);
      console.log(`Ollama     : http://localhost:11434 (extract model: ${cfg.ollamaExtractModel})`);
      const db = getDb();
      const perTool = db.prepare("SELECT tool, COUNT(*) AS c FROM transcripts GROUP BY tool").all() as Array<{ tool: string; c: number }>;
      for (const t of perTool) console.log(`  - ${t.tool}: ${t.c}`);
      break;
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
