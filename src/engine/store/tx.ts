import { getDb } from "./db";

export function withTx(fn: () => void): void {
  const d = getDb();
  d.exec("BEGIN");
  try {
    fn();
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}
