// ============================================================================
// LEGACY CARRIER TRACKING WORKER (Tier 1 of 3)
// Headless-browser polling for carriers without a tracking API. Scrapes the
// public tracking page, normalizes the raw status text into a system enum,
// and detects anti-bot blocks (CAPTCHA challenges, WAF interstitials).
//
// HONEST LIMITATION — two things this module deliberately does NOT do:
//   1. It never attempts to solve, bypass, or automate around a CAPTCHA or
//      other anti-bot challenge. Detecting one is exactly where this
//      module's job ends; Tier 2 (email) and Tier 3 (human operator) pick
//      up from there. That boundary is intentional, not a gap to "fix."
//   2. Tier 2's actual email dispatch needs a real mail-sending
//      integration (the same one every other outbound message in this
//      platform depends on) — `dispatchTier2EmailFallback` is a real,
//      typed interface, but its body is a stub pending that credential.
// ============================================================================

import { chromium, type Browser } from "playwright";
import type { CarrierMilestone, LegacyTrackingRequest, LegacyTrackingResult } from "../types/shipment.js";
import { sendOperationalEmail } from "../services/agentMailDispatch.js";

const NAVIGATION_TIMEOUT_MS = 20_000;
const STATUS_TEXT_SELECTOR_CANDIDATES = [
  "[data-testid*='status']",
  ".tracking-status",
  ".shipment-status",
  "#trackingStatus",
  "main",
];

const CAPTCHA_INDICATORS = [
  /captcha/i,
  /are you a robot/i,
  /verify you are human/i,
  /cf-challenge/i, // Cloudflare
  /access denied/i,
  /unusual traffic/i,
];

const MILESTONE_KEYWORDS: [RegExp, CarrierMilestone][] = [
  [/deliver(ed)?\s*[-–]?\s*clean|proof of delivery signed/i, "DELIVERED_CLEAN"],
  [/out for delivery/i, "OUT_FOR_DELIVERY"],
  [/in transit|en route|departed/i, "IN_TRANSIT"],
  [/picked up|pickup complete|origin scan/i, "PICKED_UP"],
  [/exception|delay|damage|refused/i, "EXCEPTION"],
];

function normalizeMilestone(rawText: string): CarrierMilestone {
  for (const [pattern, milestone] of MILESTONE_KEYWORDS) {
    if (pattern.test(rawText)) return milestone;
  }
  return "UNKNOWN";
}

function detectBlock(pageText: string, httpStatus: number | null): { blocked: boolean; reason?: string } {
  if (httpStatus && [403, 429, 503].includes(httpStatus)) {
    return { blocked: true, reason: `Carrier site returned HTTP ${httpStatus} — likely rate-limited or blocked.` };
  }
  const matched = CAPTCHA_INDICATORS.find((pattern) => pattern.test(pageText));
  if (matched) {
    return { blocked: true, reason: `Anti-bot challenge detected on page (matched pattern: ${matched.source}).` };
  }
  return { blocked: false };
}

function buildTrackingUrl(template: string, trackingNumber: string): string {
  if (!template.includes("{trackingNumber}")) {
    throw new Error("trackingUrlTemplate must contain a {trackingNumber} placeholder.");
  }
  return template.replace("{trackingNumber}", encodeURIComponent(trackingNumber));
}

export async function checkLegacyCarrierStatus(request: LegacyTrackingRequest, browserInstance?: Browser): Promise<LegacyTrackingResult> {
  const url = buildTrackingUrl(request.trackingUrlTemplate, request.trackingNumber);
  const checkedAtIso = new Date().toISOString();
  const browser = browserInstance ?? (await chromium.launch({ headless: true }));
  const ownsBrowser = !browserInstance;

  try {
    const page = await browser.newPage({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    });
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);

    let httpStatus: number | null = null;
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    httpStatus = response?.status() ?? null;

    const bodyText = await page.textContent("body").catch(() => "");
    const blockCheck = detectBlock(bodyText ?? "", httpStatus);

    if (blockCheck.blocked) {
      await dispatchTier2EmailFallback(request);
      return {
        carrierName: request.carrierName,
        trackingNumber: request.trackingNumber,
        milestone: "UNKNOWN",
        blocked: true,
        blockReason: blockCheck.reason,
        checkedAtIso,
      };
    }

    let statusText = "";
    for (const selector of STATUS_TEXT_SELECTOR_CANDIDATES) {
      const text = await page.locator(selector).first().textContent({ timeout: 2000 }).catch(() => null);
      if (text && text.trim().length > 0) {
        statusText = text.trim();
        break;
      }
    }

    const milestone = normalizeMilestone(statusText || bodyText || "");

    return {
      carrierName: request.carrierName,
      trackingNumber: request.trackingNumber,
      milestone,
      rawStatusText: statusText || undefined,
      blocked: false,
      checkedAtIso,
    };
  } catch (err) {
    // Navigation failures (DNS, timeout, TLS) are treated as a soft block
    // so Tier 2 still fires rather than silently losing the update.
    await dispatchTier2EmailFallback(request);
    return {
      carrierName: request.carrierName,
      trackingNumber: request.trackingNumber,
      milestone: "UNKNOWN",
      blocked: true,
      blockReason: err instanceof Error ? `Navigation failed: ${err.message}` : "Navigation failed with an unknown error.",
      checkedAtIso,
    };
  } finally {
    if (ownsBrowser) await browser.close();
  }
}

/**
 * Tier 2 fallback: Agent 6 (operations@pascallogistics.com) dispatches a
 * structured status-inquiry email to the carrier's dispatch inbox with the
 * PRO/tracking number in the subject line. Now sends via the real
 * AgentMail module (see agentMailDispatch.ts) — falls back to a logged
 * simulation only when no AGENTMAIL_API_KEY is configured.
 */
async function dispatchTier2EmailFallback(request: LegacyTrackingRequest): Promise<void> {
  console.warn(`[LEGACY_CARRIER_PING_REQUIRED] Tier 1 scrape blocked for ${request.carrierName} / ${request.trackingNumber}. Dispatching Tier 2 status inquiry.`);
  const carrierDispatchEmail = `dispatch@${request.carrierName.toLowerCase().replace(/\s+/g, "")}.com`; // HONEST LIMITATION: real carrier dispatch addresses need to come from the carrier-accounts table, not derived from the carrier name
  await sendOperationalEmail(
    carrierDispatchEmail,
    `Status Inquiry — PRO ${request.trackingNumber}`,
    `Please provide the current delivery status for PRO/tracking number ${request.trackingNumber}. Our tracking page lookup was unable to retrieve status automatically.\n\nPascal Logistics Operations\noperations@pascallogistics.com`,
  );
}

/**
 * Polls a batch of legacy carriers 3x/day. Intended to be invoked by a
 * Render Cron Job (see render.yaml) rather than run in-process on the web
 * service — background polling and the request-serving API should scale
 * independently.
 */
export async function pollLegacyCarrierBatch(requests: LegacyTrackingRequest[]): Promise<LegacyTrackingResult[]> {
  const browser = await chromium.launch({ headless: true });
  try {
    const results: LegacyTrackingResult[] = [];
    for (const request of requests) {
      // Sequential, not Promise.all — deliberately throttles load against
      // carrier sites rather than hammering all of them simultaneously.
      results.push(await checkLegacyCarrierStatus(request, browser));
    }
    return results;
  } finally {
    await browser.close();
  }
}
