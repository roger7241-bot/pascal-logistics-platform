// ============================================================================
// Priority1 Quote Comparison — end-to-end smoke test
//
// Verifies the full CRUD + compare flow against a running server. Run
// this locally right after wiring the feature in, and again against the
// deployed Render URL after deploy. Node 18+ only (native fetch).
//
// Usage:
//   BASE_URL=http://localhost:4000 \
//   AUTH_COOKIE="pascal_session=<paste from browser after logging in>" \
//   TEST_ORG_ID=org_meridian \
//   node scripts/priority1-smoke-test.js
//
// The AUTH_COOKIE is the easy way to reuse a real logged-in operator
// session without wiring a full login inside this script. Grab it from
// your browser's dev tools (Application → Cookies) after logging in as
// an operator user. If AUTH_COOKIE is missing, the script prints a loud
// warning and continues (calls will 401, which the script surfaces
// clearly instead of silently failing).
// ============================================================================

const BASE_URL = process.env.BASE_URL || "http://localhost:4000";
const AUTH_COOKIE = process.env.AUTH_COOKIE || "";
const TEST_ORG_ID = process.env.TEST_ORG_ID || "org_meridian";

if (!AUTH_COOKIE) {
  console.warn("\n⚠️  AUTH_COOKIE not set — every request will 401.");
  console.warn("    Log into the portal as an operator, copy the pascal_session cookie value,");
  console.warn("    then re-run with AUTH_COOKIE=\"pascal_session=<value>\"\n");
}

const headers = {
  "Content-Type": "application/json",
  ...(AUTH_COOKIE ? { Cookie: AUTH_COOKIE } : {}),
};

let created = null;
let passes = 0;
let failures = 0;

function log(label, ok, detail) {
  const badge = ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
  console.log(`  ${badge} ${label}${detail ? ` — ${detail}` : ""}`);
  if (ok) passes += 1; else failures += 1;
}

async function req(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const contentType = res.headers.get("content-type") || "";
  const parsed = res.status === 204
    ? null
    : contentType.includes("application/json")
      ? await res.json().catch(() => null)
      : await res.text();
  return { status: res.status, body: parsed };
}

async function step1_healthCheck() {
  console.log("\n[1/7] Health check");
  const r = await req("GET", "/health");
  log("GET /health", r.status === 200, `status ${r.status}`);
}

async function step2_addRate() {
  console.log("\n[2/7] Add a client_carrier_rate");
  const r = await req("POST", "/api/operator/client-carrier-rates", {
    orgId: TEST_ORG_ID,
    originZip: "98230",
    destinationZip: "V4A9V4",
    carrierName: "SmokeTest Carrier",
    serviceLevel: "Standard LTL",
    transitDays: 3,
    totalRateUsd: 1250.00,
    rateSource: "manual",
    effectiveDate: new Date().toISOString().split("T")[0],
    notes: "Created by priority1-smoke-test.js",
  });
  log("POST /client-carrier-rates", r.status === 201 && r.body?.rate?.id, `status ${r.status}`);
  created = r.body?.rate;
}

async function step3_listRates() {
  console.log("\n[3/7] List rates for the org");
  const r = await req("GET", `/api/operator/client-carrier-rates?orgId=${encodeURIComponent(TEST_ORG_ID)}`);
  const hasNewRate = Array.isArray(r.body?.rates) && r.body.rates.some((rate) => rate.id === created?.id);
  log("GET /client-carrier-rates?orgId=…", r.status === 200 && hasNewRate, `${r.body?.rates?.length ?? 0} rate(s)`);
}

async function step4_updateRate() {
  if (!created?.id) { log("PATCH /client-carrier-rates/:id", false, "no created rate to update"); return; }
  console.log("\n[4/7] Update the rate");
  const r = await req("PATCH", `/api/operator/client-carrier-rates/${created.id}`, {
    totalRateUsd: 1300.00,
    notes: "Updated by smoke test",
  });
  log("PATCH /client-carrier-rates/:id", r.status === 200 && r.body?.rate?.totalRateUsd === 1300, `status ${r.status}`);
}

async function step5_compare() {
  console.log("\n[5/7] Run a quote comparison");
  const r = await req("POST", "/api/operator/quote-compare", {
    orgId: TEST_ORG_ID,
    originZip: "98230",
    destinationZip: "V4A9V4",
    pickupDateIso: `${new Date().toISOString().split("T")[0]}T00:00:00Z`,
    items: [
      { freightClass: "150", packagingType: "Pallet", units: 1, pieces: 1, totalWeightLbs: 275, lengthIn: 48, widthIn: 40, heightIn: 40 },
    ],
  });
  const has = r.status === 200 && r.body && "quotes" in r.body;
  log("POST /quote-compare", has, `incumbent=${r.body?.incumbent ? "yes" : "no"} · quotes=${r.body?.quotes?.length ?? 0} · simulated=${r.body?.priority1Simulated}`);
  if (r.body?.priority1Simulated) console.log("     (Priority1 in simulation — set PRIORITY1_API_KEY in server env for live quotes.)");
  if (r.body?.priority1Error) console.log(`     Priority1 error surface: ${r.body.priority1Error}`);
}

async function step6_deleteRate() {
  if (!created?.id) { log("DELETE /client-carrier-rates/:id", false, "no created rate to delete"); return; }
  console.log("\n[6/7] Delete the rate");
  const r = await req("DELETE", `/api/operator/client-carrier-rates/${created.id}`);
  log("DELETE /client-carrier-rates/:id", r.status === 204, `status ${r.status}`);
}

async function step7_verifyDeleted() {
  console.log("\n[7/7] Verify deletion");
  const r = await req("GET", `/api/operator/client-carrier-rates?orgId=${encodeURIComponent(TEST_ORG_ID)}`);
  const stillThere = Array.isArray(r.body?.rates) && r.body.rates.some((rate) => rate.id === created?.id);
  log("Rate no longer in list", r.status === 200 && !stillThere);
}

async function main() {
  console.log("=".repeat(64));
  console.log(`Priority1 Quote Comparison — smoke test`);
  console.log(`Target: ${BASE_URL}`);
  console.log(`Test org_id: ${TEST_ORG_ID}`);
  console.log("=".repeat(64));

  try {
    await step1_healthCheck();
    await step2_addRate();
    await step3_listRates();
    await step4_updateRate();
    await step5_compare();
    await step6_deleteRate();
    await step7_verifyDeleted();
  } catch (err) {
    console.error("\n💥 Unhandled error in test run:", err.message);
    failures += 1;
  }

  console.log("\n" + "=".repeat(64));
  console.log(`Result: ${passes} passed, ${failures} failed`);
  console.log("=".repeat(64));
  process.exit(failures === 0 ? 0 : 1);
}

main();
