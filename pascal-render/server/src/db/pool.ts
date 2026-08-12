// ============================================================================
// DATABASE CONNECTION
// Real Postgres connection pool via `pg`. Requires DATABASE_URL — the app
// fails loudly at boot rather than silently falling back to in-memory
// storage, since that would make data loss a silent runtime surprise
// instead of a deploy-time failure.
// ============================================================================

import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("FATAL: DATABASE_URL is not set. Facility, commodity, exception, and POA data cannot persist without it.");
  process.exit(1);
}

export const pool = new Pool({
  connectionString,
  // Render's managed Postgres requires TLS; rejectUnauthorized: false
  // matches Render's own documented connection guidance for their
  // certificate chain.
  ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle database client:", err);
});

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
