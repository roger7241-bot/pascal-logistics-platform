// ============================================================================
// Cron entry point — 07:00 AM Executive Morning Brief. Same pattern as
// cronPoll.ts: invoked by a dedicated Render Cron Job (see render.yaml),
// not an in-process scheduler. Generates the digest for every active org
// and dispatches it via the org's Slack/Teams webhook if one is on file.
// ============================================================================

import { pool } from "./db/pool.js";
import { generateMorningDigest } from "./services/morningBrief.js";
import { dispatchSlackTeamsAlert } from "./services/alertWebhook.js";

async function main() {
  const accounts = await pool.query("SELECT org_id, slack_webhook_url FROM accounts WHERE account_status = 'active'");
  if (accounts.rowCount === 0) {
    console.log("No active accounts on file — nothing to brief.");
    return;
  }

  for (const account of accounts.rows) {
    const narrative = await generateMorningDigest(account.org_id);
    console.log(`--- Morning brief for ${account.org_id} ---\n${narrative}\n`);

    const delivered = await dispatchSlackTeamsAlert({
      orgId: account.org_id,
      platform: "slack",
      webhookUrl: account.slack_webhook_url ?? "",
      severity: "info",
      title: "Your 07:00 Morning Brief",
      message: narrative,
    });
    console.log(delivered ? "Delivered via Slack webhook." : "No Slack webhook on file — logged only.");
  }

  await pool.end();
}

main().catch((err) => {
  console.error("Morning brief cron failed:", err);
  process.exit(1);
});
