// ============================================================================
// Pascal Logistics API Server
// Express + WebSocket (ws) server for the Fractional Logistics Platform.
// Health check, strictly-scoped CORS, and the shipment ingestion pipeline.
// ============================================================================

import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import http from "node:http";
import { WsManager } from "./ws/wsManager.js";
import { createShipmentsRouter } from "./routes/shipments.js";
import { createBorderRouter } from "./routes/border.js";
import { createExceptionsRouter } from "./routes/exceptions.js";
import { createClientRouter } from "./routes/client.js";
import { createFacilitiesRouter } from "./routes/facilities.js";
import { createSimulationRouter } from "./routes/simulation.js";
import { createPoaRouter } from "./routes/poa.js";
import { createDocumentsRouter } from "./routes/documents.js";
import { createAccountsRouter } from "./routes/accounts.js";
import { createCarriersRouter } from "./routes/carriers.js";
import { createBillingRouter } from "./routes/billing.js";
import { createLeadsRouter } from "./routes/leads.js";
import { createVaultRouter } from "./routes/vault.js";
import { createCalendarRouter } from "./routes/calendar.js";
import { createExecutiveDraftsRouter } from "./routes/executiveDrafts.js";
import { createCeoMetricsRouter } from "./routes/ceoMetrics.js";
import { createChatRouter } from "./routes/chat.js";
import { createCallsRouter } from "./routes/calls.js";
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

app.use(
  cors({
    origin: CLIENT_ORIGIN_URL,
    methods: ["GET", "POST", "PATCH"],
    credentials: true,
  }),
);
app.use(express.json({ limit: "2mb" }));

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
app.use("/api/client", createClientRouter(wsManager, borderTelemetryService));
app.use("/api/client", createFacilitiesRouter());
app.use("/api/simulation", createSimulationRouter(wsManager));
app.use("/api/client", createPoaRouter());
app.use("/api/documents", createDocumentsRouter());
app.use("/api/operator", createAccountsRouter());
app.use("/api/operator", createCarriersRouter(borderTelemetryService));
app.use("/api/operator", createBillingRouter());
app.use("/api/operator", createLeadsRouter());
app.use("/api/operator", createVaultRouter());
app.use("/api/calendar", createCalendarRouter());
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
