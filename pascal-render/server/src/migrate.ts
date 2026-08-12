// ============================================================================
// Migration runner — applies schema.sql against DATABASE_URL. Runs via the
// `pg` driver directly rather than shelling out to psql, since Render's
// Node runtime image isn't guaranteed to have the Postgres client tools
// installed. Wired as render.yaml's preDeployCommand, so this runs
// automatically after build and before the new version goes live.
// ============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool } from "./db/pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const schemaPath = path.join(__dirname, "..", "schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");

  console.log(`Applying schema from ${schemaPath}...`);
  await pool.query(schema);
  console.log("Schema applied successfully.");
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
