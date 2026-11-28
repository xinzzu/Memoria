/* Tasks tab: tasks the agent completed (kind task_done, from its todo list or
 * a commit) show as done, and reopening one makes it an open task again. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
const require = createRequire(import.meta.url);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "memoria-tasks-"));
process.env.MEMORIA_DATA_DIR = dir;
const db = require("../dist/engine/store/db.js");
db.initDb(dir);

test("agent-completed tasks are listed as done; reopening turns them into open tasks", () => {
  const pid = db.ensureProject("demo", path.join(dir, "proj"));
  const add = (kind, content) => db.insertMemory({ projectId: pid, kind, content, importance: 0.6, createdAt: Date.now(), sourceTool: "claude", status: "active", origin: "heuristic" });
  const open = add("task_pending", "Verify webhook signatures");
  const byAgent = add("task_done", "Add rate limiter");
  const byHand = add("task_pending", "Write README");
  db.setTaskResolved(byHand, true);
  let r = db.listTasks(pid);
  assert.deepEqual(r.open.map((m) => m.id), [open]);
  assert.deepEqual(new Set(r.done.map((m) => m.id)), new Set([byAgent, byHand]));
  db.setTaskResolved(byAgent, false);
  r = db.listTasks(pid);
  assert.ok(r.open.some((m) => m.id === byAgent), "reopened task is open");
  assert.ok(!r.done.some((m) => m.id === byAgent));
  assert.equal(db.getDb().prepare("SELECT kind FROM memories WHERE id = ?").get(byAgent).kind, "task_pending");
});
