// ============================================================================
// Pascal Logistics API Server
// Express + WebSocket (ws) server for the Fractional Logistics Platform.
// Health check, strictly-scoped CORS, and the shipment ingestion pipeline.
// ============================================================================

import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import http from "node:http";
import { WsManager } from "./ws/wsManager.js";
import { createShipmentsRouter } from "./routes/shipments.js";
import { createBorderRouter } from "./routes/border.js";
import { createExceptionsRouter } from "./routes/exceptions.js";
import { createClientRouter } from "./routes/client.js";
import { createFacilitiesRouter } from "./routes/facilities.js";
import { createOperatorFacilitiesRouter } from "./routes/operatorFacilities.js";
import { createSimulationRouter } from "./routes/simulation.js";
import { createPoaRouter } from "./routes/poa.js";
import { createDocumentsRouter } from "./routes/documents.js";
import { createAccountsRouter } from "./routes/accounts.js";
import { createCarriersRouter } from "./routes/carriers.js";
import { createAgentsRouter } from "./routes/agents.js";
import { createTier3Router } from "./routes/tier3.js";
import { createTrackingRouter } from "./routes/tracking.js";
import { createWebhooksRouter } from "./routes/webhooks.js";
import { createSprint2Router } from "./routes/sprint2.js";
import { createOperatorInboxRouter, createClientActivityRouter } from "./routes/sprint3.js";
import { createMultiUserRouter, createProspectsRouter, createGoogleCalendarRouter } from "./routes/sprint4.js";
import { createPublicLandedCostRouter, createAuthedLandedCostRouter } from "./routes/landedCost.js";
import { createInviteAcceptRouter } from "./routes/publicInvites.js";
import { createDocGenRouter } from "./routes/documentGeneration.js";
import { createUtilityAgentRouter, createErpWebhookRouter } from "./routes/utilityAgents.js";
import { createClientDayOneRouter } from "./routes/clientDayOne.js";
import { createBillingRouter } from "./routes/billing.js";
import { createLeadsRouter } from "./routes/leads.js";
import { createVaultRouter } from "./routes/vault.js";
import { createCalendarRouter } from "./routes/calendar.js";
import { createRerouteRouter } from "./routes/reroute.js";
import { createExecutiveDraftsRouter } from "./routes/executiveDrafts.js";
import { createCeoMetricsRouter } from "./routes/ceoMetrics.js";
import { createChatRouter } from "./routes/chat.js";
import { createCallsRouter } from "./routes/calls.js";
import { createDispatchRouter, createMagicUploadRouter } from "./routes/dispatch.js";
import { createPublicTrackingRouter } from "./routes/publicTracking.js";
import { createAuthRouter } from "./routes/auth.js";
import { requireAuth, requireOperator } from "./middleware/requireAuth.js";
import { generateMorningDigest } from "./services/morningBrief.js";
import { BorderTelemetryService } from "./services/borderTelemetryService.js";

const PORT = Number(process.env.PORT) || 4000;
const CLIENT_ORIGIN_URL = process.env.CLIENT_ORIGIN_URL;

if (!CLIENT_ORIGIN_URL) {
  // Fail loudly at boot rather than silently running with an open CORS
  // policy — this is a production API, not a local dev script.
  console.error("FATAL: CLIENT_ORIGIN_URL is not set. Refusing to start with an unrestricted CORS policy.");
  process.exit(1);
}

const app = express();

// Render's Node services run behind a reverse proxy — without this,
// req.ip resolves to the proxy's internal address, not the real caller,
// which would silently make every ipAddress field in security_audit_logs
// wrong. `1` trusts exactly one hop (Render's own LB), not an arbitrary
// chain, so a client can't spoof X-Forwarded-For past that.
app.set("trust proxy", 1);

app.use(
  cors({
    origin: CLIENT_ORIGIN_URL,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    credentials: true,
  }),
);
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

const httpServer = http.createServer(app);
const wsManager = new WsManager(httpServer);
const borderTelemetryService = new BorderTelemetryService(wsManager);
borderTelemetryService.start();

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    service: "pascal-logistics-api",
    websocket: "attached",
    timestampIso: new Date().toISOString(),
  });
});

app.use("/api/shipments", createShipmentsRouter(wsManager));
app.use("/api/border", createBorderRouter(borderTelemetryService));
app.use("/api/exceptions", createExceptionsRouter(wsManager));

// Login/logout — must stay reachable without a session.
app.use("/api/auth", createAuthRouter());

// Genuinely public, unauthenticated-by-design routes — a customer
// tracking a package, or a forklift driver's phone scanning a document
// mid-dock, shouldn't need to log in first.
app.use("/api/v1/magic-upload", createMagicUploadRouter());
app.use("/api/v1/track", createPublicTrackingRouter());

// Public webhooks — mounted BEFORE auth middleware so external providers
// (AgentMail inbound email, Terminal49 / CargoAi tracking) can POST without
// a session. Each handler validates its own payload shape.
app.use("/api/webhooks", createWebhooksRouter());

// Public landed-cost calculator — no auth so the marketing site widget
// and unauthenticated visitors can get an estimate. Every submission with
// an email becomes a prospect row + fires Chief of Staff draft.
app.use("/api/public", createPublicLandedCostRouter());
app.use("/api/public", createInviteAcceptRouter());
app.use("/api/webhooks", createErpWebhookRouter());

// Everything else below requires a real, verified session — this is the
// actual fix for the "no auth layer, org_id trusted from request params"
// gap. requireOperator (Pascal staff only) gates the routes with no
// client-facing counterpart. requireAuth (either role) gates everything
// a shipper legitimately calls too — checked against actual frontend
// call sites, not assumed: /api/shipments/ingest is the wizard's booking
// submit, /api/border and /api/calendar and /api/reroute all have real
// client-portal pages calling them, /api/simulation's demo button is on
// both headers, /api/documents backs the wizard's document parser.
// /api/exceptions has no frontend caller at all currently, so it
// defaults to the more restrictive requireOperator rather than being
// left open on the assumption it'll only ever be operator-facing.
app.use("/api/operator", requireOperator);
app.use("/api/ceo", requireOperator);
app.use("/api/exceptions", requireOperator);
app.use("/api/client", requireAuth);
app.use("/api/shipments", requireAuth);
app.use("/api/border", requireAuth);
app.use("/api/simulation", requireAuth);
app.use("/api/documents", requireAuth);
app.use("/api/calendar", requireAuth);
app.use("/api/reroute", requireAuth);

app.use("/api/client", createClientRouter(wsManager, borderTelemetryService));
app.use("/api/client", createFacilitiesRouter());
app.use("/api/operator", createOperatorFacilitiesRouter());
app.use("/api/simulation", createSimulationRouter(wsManager));
app.use("/api/client", createPoaRouter());
app.use("/api/documents", createDocumentsRouter());
app.use("/api/operator", createAccountsRouter());
app.use("/api/operator", createCarriersRouter(borderTelemetryService));
app.use("/api/operator", createAgentsRouter());
app.use("/api/operator", createTier3Router());
app.use("/api/operator", createTrackingRouter("operator"));
app.use("/api/client", createTrackingRouter("client"));
app.use("/api/operator", createSprint2Router("operator"));
app.use("/api/client", createSprint2Router("client"));
app.use("/api/operator", createOperatorInboxRouter());
app.use("/api/client", createClientActivityRouter());
app.use("/api/operator", createMultiUserRouter("operator"));
app.use("/api/client", createMultiUserRouter("client"));
app.use("/api/operator", createProspectsRouter());
app.use("/api/operator", createGoogleCalendarRouter());
app.use("/api/operator", createCalendarRouter());
app.use("/api/operator", createAuthedLandedCostRouter());
app.use("/api/client", createAuthedLandedCostRouter());
app.use("/api/operator", createDocGenRouter("operator"));
app.use("/api/client", createDocGenRouter("client"));
app.use("/api/operator", createUtilityAgentRouter());
app.use("/api/operator", createClientDayOneRouter("operator"));
app.use("/api/client", createClientDayOneRouter("client"));
app.use("/api/operator", createBillingRouter());
app.use("/api/operator", createLeadsRouter());
app.use("/api/operator", createVaultRouter());
app.use("/api/calendar", createCalendarRouter());
app.use("/api/reroute", createRerouteRouter());
app.use("/api/operator", createDispatchRouter());
app.get("/api/operator/morning-brief/:orgId", requireOperator, async (req, res) => {
  const narrative = await generateMorningDigest(req.params.orgId);
  res.status(200).json({ narrative });
});
app.use("/api/operator", createExecutiveDraftsRouter());
app.use("/api/ceo", createCeoMetricsRouter(borderTelemetryService));
app.use("/api/client", createChatRouter());
app.use("/api/operator", createCallsRouter());

// Centralized error handler — keeps malformed requests from ever crashing
// the process, and never leaks stack traces to the client.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled request error:", err);
  res.status(500).json({ error: "Internal server error." });
});

httpServer.listen(PORT, () => {
  console.log(`Pascal Logistics API listening on port ${PORT}`);
  console.log(`WebSocket server attached at ws://localhost:${PORT}/ws`);
  console.log(`CORS restricted to origin: ${CLIENT_ORIGIN_URL}`);
});

// Express 4 does not automatically catch rejected promises from async
// route handlers — an unhandled DB error inside one would otherwise crash
// the entire process (confirmed the hard way: a SQL type-ambiguity bug in
// one route took the whole server down before this was added). This
// keeps the server alive for every other request; it's a safety net, not
// a substitute for fixing the actual bug that caused it.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection (server stays up):", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception (server stays up):", err);
});

process.on("SIGTERM", () => {
  console.log("SIGTERM received — shutting down gracefully.");
  borderTelemetryService.stop();
  wsManager.close();
  httpServer.close(() => process.exit(0));
});
