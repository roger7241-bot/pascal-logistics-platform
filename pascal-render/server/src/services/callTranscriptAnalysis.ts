// ============================================================================
// CALL TRANSCRIPT ANALYSIS
// Real Claude-powered sentiment scoring and entity extraction for
// human-conducted sales calls (Desk #5/#6). Same real/fallback pattern as
// documentExtraction.ts and agent5Chat.ts — this is deliberately NOT part
// of any autodialer; it analyzes a transcript from a call a human operator
// already placed and logged.
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : undefined;

export type CallSentiment = "hot_lead" | "needs_information" | "not_interested";

export interface CallAnalysis {
  sentiment: CallSentiment;
  extractedEntities: {
    companyMentioned?: string;
    painPoints?: string[];
    objections?: string[];
    nextStepsCommitted?: string;
  };
  summary: string;
  simulated: boolean;
}

const ANALYSIS_TOOL: Anthropic.Tool = {
  name: "record_call_analysis",
  description: "Records the sentiment and key entities extracted from a sales call transcript.",
  input_schema: {
    type: "object",
    properties: {
      sentiment: { type: "string", enum: ["hot_lead", "needs_information", "not_interested"], description: "Overall prospect sentiment based on the conversation." },
      companyMentioned: { type: "string", description: "The prospect's company name, if mentioned." },
      painPoints: { type: "array", items: { type: "string" }, description: "Specific logistics pain points the prospect raised (e.g. border delays, current carrier issues)." },
      objections: { type: "array", items: { type: "string" }, description: "Objections the prospect raised." },
      nextStepsCommitted: { type: "string", description: "Any concrete next step the prospect agreed to, if any." },
      summary: { type: "string", description: "A 1-2 sentence summary of the call." },
    },
    required: ["sentiment", "summary"],
  },
};

export async function analyzeCallTranscript(transcriptText: string): Promise<CallAnalysis> {
  if (!client) {
    return {
      sentiment: "needs_information",
      extractedEntities: {},
      summary: "[Simulated — no ANTHROPIC_API_KEY configured] Sentiment analysis would run here on the real transcript.",
      simulated: true,
    };
  }

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 600,
      tools: [ANALYSIS_TOOL],
      tool_choice: { type: "tool", name: "record_call_analysis" },
      messages: [{ role: "user", content: `Analyze this sales call transcript and record the sentiment and key entities:\n\n${transcriptText}` }],
    });

    const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!toolUse) throw new Error("Model did not return the expected tool call.");

    const input = toolUse.input as {
      sentiment: CallSentiment;
      companyMentioned?: string;
      painPoints?: string[];
      objections?: string[];
      nextStepsCommitted?: string;
      summary: string;
    };

    return {
      sentiment: input.sentiment,
      extractedEntities: {
        companyMentioned: input.companyMentioned,
        painPoints: input.painPoints,
        objections: input.objections,
        nextStepsCommitted: input.nextStepsCommitted,
      },
      summary: input.summary,
      simulated: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { sentiment: "needs_information", extractedEntities: {}, summary: `Analysis failed: ${message}`, simulated: false };
  }
}
