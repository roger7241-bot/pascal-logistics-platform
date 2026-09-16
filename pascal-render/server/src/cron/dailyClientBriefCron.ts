// ============================================================================
// CRON — Daily Client Brief (07:00 America/Los_Angeles)
// One brief per active account. Chief of Staff persona composes a short
// (150-250 word) morning message: what happened overnight on their freight,
// what's landing today, what needs their input. Lands as a pending draft
// under agent6_chief_of_staff labelled 'daily_client_brief:<orgId>' so
// Roger sees each per-client brief and can push send in bulk. No brief
// leaves without his approval.
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { pool } from "../db/pool.js";
import { PASCAL_SYSTEM_PREFIX } from "../services/pascalContext.js";
import { sendOperationalEmail } from "../services/agentMailDispatch.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : undefined;

async function main() {
  const accounts = await pool.query<{ org_id: string; company_name: string; primary_contact_name: string | null; primary_contact_email: string | null; notification_preferences: Record<string, boolean> }>(
    "SELECT org_id, company_name, primary_contact_name, primary_contact_email, notification_preferences FROM accounts WHERE account_status = 'active'",
  );
  if (accounts.rowCount === 0) {
    console.log("No active accounts — skipping daily client briefs.");
    return;
  }

  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  let drafted = 0;

  for (const account of accounts.rows) {
    const orgId = account.org_id as string;
    const clientName = account.company_name as string;
    const contactFirst = (account.primary_contact_name as string | null)?.split(" ")[0] ?? "team";

    const [tasks, tariffs] = await Promise.all([
      pool.query(
        `SELECT task_type, subject, current_agent_key, status FROM agent_tasks
         WHERE client_org_id = $1 AND updated_at >= $2
         ORDER BY updated_at DESC LIMIT 10`,
        [orgId, since],
      ),
      pool.query(
        `SELECT headline, hs_code, severity, effective_date FROM tariff_updates
         WHERE published_at >= $1 AND severity IN ('critical', 'notice')
         ORDER BY severity ASC, published_at DESC LIMIT 4`,
        [since],
      ),
    ]);

    // Skip clients with nothing to say — silence beats noise.
    const hasNews = (tasks.rowCount ?? 0) > 0 || (tariffs.rowCount ?? 0) > 0;
    if (!hasNews) {
      console.log(`No news for ${clientName} — skipping.`);
      continue;
    }

    const context = `Client: ${clientName}
Contact: ${contactFirst}

Cross-agent tasks touching this client in last 24h:
${tasks.rows.map((r) => `  ${r.status.toUpperCase()} - ${r.task_type}: ${r.subject} (with ${r.current_agent_key})`).join("\n") || "  (none)"}

Overnight tariff moves that may affect them:
${tariffs.rows.map((r) => `  [${r.severity}] HS ${r.hs_code}: ${r.headline}${r.effective_date ? ` — effective ${r.effective_date}` : ""}`).join("\n") || "  (none)"}`;

    let body = "";
    if (client) {
      const systemPrompt = `${PASCAL_SYSTEM_PREFIX}ROLE — You are the Chief of Staff (Agent 10) composing a client-facing daily morning brief. This goes OUT to the client (through Roger's sign-off).

Structure (150-250 words):
- Warm one-line hello using their first name
- 2-3 line summary of what happened on their freight overnight
- Any tariff / border item they should know about
- One line on what's landing today OR what you need from them
- Sign-off "— Roger, Pascal Logistics"

Rules:
- Never mention other clients or aggregate numbers.
- Never reference internal agents by name to the client. Say "we".
- If nothing meaningful happened, say so and keep it short — don't manufacture news.
- Never quote pricing or promise a rate.`;

      const response = await client.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 700,
        system: systemPrompt,
        messages: [{ role: "user", content: `Compose ${clientName}'s daily brief.\n\n${context}` }],
      });
      body = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
    } else {
      body = `Hi ${contactFirst},\n\nQuick overnight update on your freight. [Simulated — no ANTHROPIC_API_KEY]\n\n${(tasks.rowCount ?? 0)} items touched your account; ${(tariffs.rowCount ?? 0)} tariff moves that may affect you.\n\n— Roger, Pascal Logistics`;
    }

    const payload = {
      inbound: {
        fromEmail: "internal-cron@pascallogistics.com",
        fromName: "Daily Client Brief Cron",
        subject: `Compose brief for ${clientName}`,
        body: context,
      },
      output: {
        category: "operational",
        priority: "normal",
        summary: `Client daily brief for ${clientName} — ${tasks.rowCount ?? 0} tasks, ${tariffs.rowCount ?? 0} tariff moves`,
        suggestedActions: ["Review the copy", "Hit send if it reads right"],
        draftResponseSubject: `Morning update from Pascal Logistics — ${new Date().toISOString().slice(0, 10)}`,
        draftResponseBody: body,
        simulated: !client,
      },
    };

    const draftSubject = `Morning update from Pascal Logistics — ${new Date().toISOString().slice(0, 10)}`;
    const optedIn = account.notification_preferences?.dailyBriefEmail === true;
    const contactEmail = account.primary_contact_email;
    let autoSent = false;

    // If the client opted in and we have their contact email, auto-send after
    // drafting so the brief lands in their inbox without waiting on Roger's
    // review click. Draft still gets recorded (marked sent) so it appears
    // in the review queue as history.
    if (optedIn && contactEmail && body.trim().length > 0) {
      try {
        const result = await sendOperationalEmail(contactEmail, draftSubject, body);
        autoSent = !result.simulated;
        console.log(`Auto-sent daily brief to ${clientName} <${contactEmail}> (${result.simulated ? "SIMULATED" : "delivered"}).`);
      } catch (err) {
        console.error(`Auto-send failed for ${clientName}:`, err);
      }
    }

    await pool.query(
      `INSERT INTO agent_drafts (agent_key, kind, category, subject, source_ref, payload, status, reviewed_at, operator_notes)
       VALUES ('agent6_chief_of_staff', 'daily_client_brief', 'operational', $1, $2, $3::jsonb, $4, $5, $6)`,
      [
        `Morning brief for ${clientName}`,
        `daily_brief:client:${orgId}:${new Date().toISOString().slice(0, 10)}`,
        JSON.stringify(payload),
        autoSent ? "sent" : "pending",
        autoSent ? new Date() : null,
        autoSent ? `Auto-sent to ${contactEmail} — client is opted in to dailyBriefEmail.` : (optedIn ? "Opted in but no contact email on file — draft awaits manual review." : null),
      ],
    );
    drafted += 1;
    console.log(`Daily client brief for ${clientName}: ${autoSent ? "SENT" : "drafted for review"}.`);
  }

  await pool.query(
    `UPDATE agent_registry SET last_run_at = now(), last_run_status = $1, updated_at = now()
     WHERE agent_key = 'agent6_chief_of_staff'`,
    [`daily_client_briefs: ${drafted} drafted`],
  );
  console.log(`Daily client briefs: ${drafted} drafts queued.`);
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Daily client brief cron failed:", err);
    process.exit(1);
  });
