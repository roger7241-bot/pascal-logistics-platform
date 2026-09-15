// ============================================================================
// AGENT 9 — MARKETING OPERATOR  (display slot #13)
// Weekly newsletter drafts, LinkedIn post drafts, personalized cold-outreach
// drafts per prospect (industry / freight volume / current pain), SEO angle
// suggestions. Roger reviews every send.
//
// Anti-hype rule: no "revolutionary", "AI-powered" (in copy — internal
// framing only), no fake urgency, no exclamation stacks. Ground every
// claim in something real: a tariff change, a border wait time, a client
// win, an FX move.
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { pool } from "../db/pool.js";
import { PASCAL_SYSTEM_PREFIX } from "./pascalContext.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : undefined;

export type MarketingFormat =
  | "newsletter"
  | "linkedin_post"
  | "cold_email"
  | "seo_angle"
  | "other";

export interface MarketingBrief {
  format: MarketingFormat;
  audience: string;                // "US manufacturers with cross-border freight" | "BC importers" | ...
  topic: string;
  keyPoints: string[];             // 1-5 short bullets the draft must cover
  prospectName?: string;           // for cold_email personalization
  prospectCompany?: string;
  prospectRole?: string;
  currentPainSignal?: string;      // "just posted job for logistics coordinator" | "moved warehouses" | ...
  desiredCta: string;              // "book a 20-min call" | "reply if this is a fit" | ...
}

export interface MarketingOutput {
  category: MarketingFormat;
  priority: "urgent" | "normal" | "low";
  summary: string;
  suggestedActions: string[];
  draftResponseSubject: string;
  draftResponseBody: string;
  hashtags: string[];              // for LinkedIn / newsletter only
  recipientRole: "external" | "internal";
  simulated: boolean;
}

const PERSONA = `You write as a seasoned digital marketing operator: 15+ years in B2B — most of it in logistics, freight, and supply chain. Not a "content person" — a growth practitioner. You've run performance email, cold outbound, LinkedIn org page + founder-led posting, SEO topical maps, and lifecycle nurture flows for companies with real freight P&Ls. You know what actually converts vs what only looks good in a portfolio:
- Cold email: personalization to a real trigger event, one specific value line, one soft ask. Not "quick question", not "hope this finds you well". Reply rate over open rate.
- LinkedIn: single-idea posts, tight hook, no thread-boys. Founder voice > brand voice. No emoji ladders. No "🚀 excited to share".
- Newsletter: one topical hook grounded in a real change (tariff / border / rate / FX), two data points, one line of "what this means for you". 3-minute read max.
- SEO: cluster-and-pillar thinking, long-tail commercial-intent keywords, freight-lane-specific ("Blaine LTL rates 2026", "USMCA certificate of origin small shipments"). Never generic "logistics services".

You know Pascal Logistics is a fractional supply-chain firm run out of Blaine, WA and South Surrey, BC — cross-border NA specialty, land / ocean / rail / air incl. DG, not a licensed customs broker (we coordinate with the client's broker of record). You know the ICP: US and Canadian manufacturers / importers / distributors doing 5-100 cross-border loads per month who don't have a full-time supply-chain manager but need one. Retainer tiers exist ($ redacted here — Roger sets pricing). Break-even is internal, never in copy.`;

const TONE = `Tone: precise operator voice with a digital marketer's ear for what performs. Never "revolutionary", "AI-powered" in copy (internal framing only), "unleash", "10x", "game-changer". Never fake urgency. Never stacked exclamation points. Never open with "Hope this email finds you well" or "Quick question". Concrete numbers, real events, and real client language over vague claims. Sign the draft "— Roger, Pascal Logistics" when it goes out under his name, or leave unsigned for a newsletter body that gets wrapped in a template.`;

export async function categorizeAndDraft(brief: MarketingBrief): Promise<MarketingOutput> {
  if (!client) {
    return {
      category: brief.format,
      priority: brief.format === "cold_email" ? "normal" : "low",
      summary: `[Simulated] ${brief.format} for ${brief.audience} on "${brief.topic}". This is a simulated summary because no ANTHROPIC_API_KEY is configured.`,
      suggestedActions: ["Configure ANTHROPIC_API_KEY on the server to enable live drafts."],
      draftResponseSubject: draftSubject(brief),
      draftResponseBody: draftBody(brief),
      hashtags: brief.format === "linkedin_post" || brief.format === "newsletter" ? ["#supplychain", "#crossborder", "#logistics"] : [],
      recipientRole: brief.format === "cold_email" ? "external" : "internal",
      simulated: true,
    };
  }

  const systemPrompt = `${PASCAL_SYSTEM_PREFIX}${PERSONA}

ROLE — You are the Marketing Operator (Agent 13). You draft outbound marketing content across four formats: weekly newsletter, LinkedIn post, personalized cold email, and SEO angle idea.

Formats:
- newsletter: 200-350 words, one topical hook + two data points + one client-oriented takeaway. No template chrome (subject line + body only).
- linkedin_post: 80-140 words, single-idea, one hook line, uses 2-3 short paragraphs, ends with a light question. No emojis. 3-5 relevant hashtags.
- cold_email: 60-100 words, personalized to prospect (their company / role / pain), one-sentence intro / one-sentence value / one-sentence CTA. Subject line 4-7 words.
- seo_angle: internal only, one paragraph explaining the angle + 3-5 keyword targets + suggested title. Roger uses this to brief a writer.

${TONE}

Return only a JSON object with keys: category (the format), priority, summary, suggestedActions (array 1-4), draftResponseSubject, draftResponseBody, hashtags (array, empty for cold_email / seo_angle), recipientRole ("external" if this goes to a prospect / audience, "internal" if this is for Roger's later use).`;

  const userPrompt = `Marketing brief:
Format: ${brief.format}
Audience: ${brief.audience}
Topic: ${brief.topic}
Key points to cover:
${brief.keyPoints.map((p) => `- ${p}`).join("\n")}
${brief.prospectName ? `Prospect: ${brief.prospectName}${brief.prospectRole ? `, ${brief.prospectRole}` : ""}${brief.prospectCompany ? ` at ${brief.prospectCompany}` : ""}` : ""}
${brief.currentPainSignal ? `Pain signal to reference: ${brief.currentPainSignal}` : ""}
Call to action: ${brief.desiredCta}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 900,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textBlock) throw new Error("Marketing: no text response from Anthropic");

  const parsed = extractJson(textBlock.text);
  return {
    category: normalizeFormat(parsed.category, brief.format),
    priority: normalizePriority(parsed.priority),
    summary: String(parsed.summary ?? ""),
    suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions.map(String) : [],
    draftResponseSubject: String(parsed.draftResponseSubject ?? draftSubject(brief)),
    draftResponseBody: String(parsed.draftResponseBody ?? ""),
    hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.map(String) : [],
    recipientRole: parsed.recipientRole === "internal" ? "internal" : "external",
    simulated: false,
  };
}

export async function persistDraft(brief: MarketingBrief, output: MarketingOutput, sourceRef?: string) {
  const payload = { brief, output };
  const result = await pool.query(
    `INSERT INTO agent_drafts (agent_key, kind, category, subject, source_ref, payload)
     VALUES ('agent9_marketing', $1, $2, $3, $4, $5::jsonb)
     RETURNING *`,
    [brief.format, output.category, `${brief.format}: ${brief.topic}`, sourceRef ?? null, JSON.stringify(payload)],
  );
  await pool.query(
    `UPDATE agent_registry SET last_run_at = now(), last_run_status = 'draft_created', updated_at = now()
     WHERE agent_key = 'agent9_marketing'`,
  );
  return result.rows[0];
}

function draftSubject(b: MarketingBrief): string {
  if (b.format === "cold_email") return b.topic.slice(0, 60);
  if (b.format === "newsletter") return `Pascal weekly — ${b.topic}`;
  if (b.format === "linkedin_post") return `LinkedIn draft — ${b.topic}`;
  return `SEO angle — ${b.topic}`;
}

function draftBody(b: MarketingBrief): string {
  if (b.format === "cold_email") {
    const opener = b.prospectName ? `Hi ${b.prospectName.split(" ")[0]},` : "Hi,";
    const context = b.currentPainSignal ? `Noticed ${b.currentPainSignal.toLowerCase()} — one thing that comes up a lot for ${b.prospectRole ? b.prospectRole + "s" : "teams"} in that spot: ` : "One thing that comes up a lot for teams like yours: ";
    return `${opener}\n\n${context}${b.topic}. We're a fractional supply-chain team based in Blaine, WA / S. Surrey, BC — we run the freight + customs coordination side without you hiring a full-time person.\n\n${b.desiredCta}?\n\n— Roger, Pascal Logistics`;
  }
  if (b.format === "linkedin_post") {
    return `${b.topic}\n\n${b.keyPoints.map((p) => `— ${p}`).join("\n")}\n\n${b.desiredCta}?`;
  }
  if (b.format === "newsletter") {
    return `${b.topic}\n\n${b.keyPoints.map((p) => `${p}`).join("\n\n")}\n\n${b.desiredCta}.`;
  }
  return `Angle: ${b.topic}\n\nKey points:\n${b.keyPoints.map((p) => `- ${p}`).join("\n")}\n\nCTA: ${b.desiredCta}`;
}

function normalizeFormat(v: unknown, fallback: MarketingFormat): MarketingFormat {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  const allowed: MarketingFormat[] = ["newsletter", "linkedin_post", "cold_email", "seo_angle", "other"];
  return (allowed as string[]).includes(s) ? (s as MarketingFormat) : fallback;
}

function normalizePriority(v: unknown): "urgent" | "normal" | "low" {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  return s === "urgent" || s === "low" ? s : "normal";
}

function extractJson(text: string): Record<string, unknown> {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return {};
  }
}
