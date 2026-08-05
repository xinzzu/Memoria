import { scanAll } from "../engine/ingest/manager";

export async function scanAndNotify(): Promise<{ totalNew: number }> {
  const results = await scanAll();
  const totalNew = results.reduce((acc, r) => acc + (r.ok ? r.count : 0), 0);
  return { totalNew };
}
