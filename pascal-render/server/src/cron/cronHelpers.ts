// ============================================================================
// CRON HELPERS
// Every cron entry point wraps its main() with runCron() so failures land
// as activity_log rows the operator morning brief already surfaces. Silent
// cron failures were the biggest visibility gap; this closes it.
// ============================================================================

import { pool } from "../db/pool.js";
import { notifyRoger } from "../services/rogerNotify.js";

export async function runCron(name: string, main: () => Promise<void>): Promise<never> {
  const startedAtIso = new Date().toISOString();
  try {
    console.log(`[cron:${name}] started at ${startedAtIso}`);
    await main();
    await pool.query(
      `INSERT INTO activity_log (event_type, message, metadata) VALUES ($1, $2, $3::jsonb)`,
      [`cron_success:${name}`, `${name} completed successfully`, JSON.stringify({ startedAtIso })],
    );
    await pool.end();
    process.exit(0);
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    console.error(`[cron:${name}] failed:`, err);
    try {
      await pool.query(
        `INSERT INTO activity_log (event_type, message, metadata) VALUES ($1, $2, $3::jsonb)`,
        [`cron_failure:${name}`, `${name} failed: ${errMessage.slice(0, 500)}`, JSON.stringify({ startedAtIso, error: errMessage })],
      );
      void notifyRoger({
        channel: "email",
        subject: `[Cron failure] ${name}`,
        message: `Cron ${name} failed at ${new Date().toISOString()}.\n\n${errMessage.slice(0, 1500)}`,
      }).catch(() => undefined);
    } catch (logErr) {
      console.error("Failed to log cron failure:", logErr);
    }
    try { await pool.end(); } catch { /* pool may already be ending */ }
    process.exit(1);
  }
}
