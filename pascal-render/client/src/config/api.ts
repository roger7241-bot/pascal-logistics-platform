// ============================================================================
// API CLIENT & WEBSOCKET WRAPPER
// Dynamically connects to import.meta.env.VITE_API_BASE_URL. The WebSocket
// wrapper auto-reconnects with exponential backoff and lets callers
// subscribe per-channel without each one managing its own socket.
// ============================================================================

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

if (!API_BASE_URL) {
  // Fail loudly in the browser console rather than silently issuing
  // requests to a relative path that happens to 404.
  console.error("VITE_API_BASE_URL is not set — API calls will fail. Check your Render static site environment variables.");
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  const contentType = response.headers.get("content-type") ?? "";
  const parsed = contentType.includes("application/json") ? await response.json().catch(() => null) : await response.text();

  if (!response.ok) {
    const message = parsed && typeof parsed === "object" && "error" in parsed ? String((parsed as { error: unknown }).error) : `Request failed with status ${response.status}`;
    throw new ApiError(response.status, parsed, message);
  }

  return parsed as T;
}

export const api = {
  health: () => request<{ status: string; service: string; websocket: string; timestampIso: string }>("/health"),
  ingestShipment: <TResult = unknown>(payload: unknown) => request<TResult>("/api/shipments/ingest", { method: "POST", body: payload }),
  borderTelemetry: <TResult = unknown>() => request<TResult>("/api/border/telemetry"),
  rerouteAdvisories: <TResult = unknown>(shipmentId?: string) => request<TResult>(`/api/reroute/advisories${shipmentId ? `?shipmentId=${encodeURIComponent(shipmentId)}` : ""}`),
  createRerouteAdvisory: <TResult = unknown>(payload: unknown) => request<TResult>("/api/reroute/advisories", { method: "POST", body: payload }),
  rerouteClientSignoff: <TResult = unknown>(id: string, payload: { approved: boolean; clientSignoffName: string }) =>
    request<TResult>(`/api/reroute/advisories/${id}/client-signoff`, { method: "POST", body: payload }),
  rerouteBrokerConfirm: <TResult = unknown>(id: string) => request<TResult>(`/api/reroute/advisories/${id}/broker-confirm`, { method: "POST" }),
  dispatchConsignees: <TResult = unknown>(orgId?: string) => request<TResult>(`/api/operator/dispatch/consignees${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`),
  dispatchCarriers: <TResult = unknown>(orgId?: string) => request<TResult>(`/api/operator/dispatch/carriers${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`),
  dispatchWeightBaseline: <TResult = unknown>(packagingType: string) => request<TResult>(`/api/operator/dispatch/weight-baseline?packagingType=${encodeURIComponent(packagingType)}`),
  dispatchStagingQueue: <TResult = unknown>(orgId?: string) => request<TResult>(`/api/operator/dispatch/staging${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`),
  createDispatchStaging: <TResult = unknown>(payload: unknown) => request<TResult>("/api/operator/dispatch/staging", { method: "POST", body: payload }),
  cancelDispatchStaging: <TResult = unknown>(id: string) => request<TResult>(`/api/operator/dispatch/staging/${id}/cancel`, { method: "PATCH" }),
  deleteDispatchStaging: <TResult = unknown>(id: string) => request<TResult>(`/api/operator/dispatch/staging/${id}`, { method: "DELETE" }),
  sendDispatchGateSms: <TResult = unknown>(id: string, payload?: { driverPhone?: string; message?: string }) =>
    request<TResult>(`/api/operator/dispatch/staging/${id}/send-gate-sms`, { method: "POST", body: payload ?? {} }),
  createMagicUploadLink: <TResult = unknown>(id: string) => request<TResult>(`/api/operator/dispatch/staging/${id}/magic-upload-link`, { method: "POST" }),
  clientShipments: <TResult = unknown>() => request<TResult>("/api/client/shipments"),
  deleteClientShipment: <TResult = unknown>(id: string) => request<TResult>(`/api/client/shipments/${id}`, { method: "DELETE" }),
  clientShipmentDetail: <TResult = unknown>(id: string) => request<TResult>(`/api/client/shipments/${encodeURIComponent(id)}`),
  overridePaps: <TResult = unknown>(id: string) => request<TResult>(`/api/client/shipments/${encodeURIComponent(id)}/override-paps`, { method: "PATCH" }),
  rerouteShipment: <TResult = unknown>(id: string, newPoeId: string) => request<TResult>(`/api/client/shipments/${encodeURIComponent(id)}/reroute`, { method: "PATCH", body: { newPoeId } }),
  requestVaultUpload: <TResult = unknown>(id: string, clientEmail?: string) => request<TResult>(`/api/client/shipments/${encodeURIComponent(id)}/request-vault-upload`, { method: "POST", body: { clientEmail } }),
  escalateShipment: <TResult = unknown>(id: string) => request<TResult>(`/api/client/shipments/${encodeURIComponent(id)}/escalate`, { method: "POST" }),
  batchSms: <TResult = unknown>(shipmentIds: string[], message: string) => request<TResult>("/api/client/shipments/batch-sms", { method: "POST", body: { shipmentIds, message } }),
  // Operator Control Tower
  ceoMetrics: <TResult = unknown>() => request<TResult>("/api/ceo/metrics"),
  ceoAlerts: <TResult = unknown>() => request<TResult>("/api/ceo/alerts"),
  ceoActivity: <TResult = unknown>() => request<TResult>("/api/ceo/activity"),
  ceoCorridorShipments: <TResult = unknown>() => request<TResult>("/api/ceo/corridor-shipments"),
  accounts: <TResult = unknown>() => request<TResult>("/api/operator/accounts"),
  createAccount: <TResult = unknown>(payload: unknown) => request<TResult>("/api/operator/accounts", { method: "POST", body: payload }),
  accountKpis: <TResult = unknown>() => request<TResult>("/api/operator/accounts/kpis"),
  accountDetail: <TResult = unknown>(id: string) => request<TResult>(`/api/operator/accounts/${id}/detail`),
  carriers: <TResult = unknown>(mode?: string) => request<TResult>(`/api/operator/carriers${mode ? `?mode=${mode}` : ""}`),
  createCarrier: <TResult = unknown>(payload: unknown) => request<TResult>("/api/operator/carriers", { method: "POST", body: payload }),
  updateCarrierScorecard: <TResult = unknown>(id: string, payload: unknown) => request<TResult>(`/api/operator/carriers/${id}/scorecard`, { method: "PATCH", body: payload }),
  carrierBorderVelocity: <TResult = unknown>() => request<TResult>("/api/operator/carriers/border-velocity"),
  requestRateQuote: <TResult = unknown>(payload: unknown) => request<TResult>("/api/operator/rate-quote", { method: "POST", body: payload }),
  savingsByAccount: <TResult = unknown>() => request<TResult>("/api/operator/savings-by-account"),
  invoices: <TResult = unknown>(displayCurrency?: string) => request<TResult>(`/api/operator/invoices${displayCurrency ? `?displayCurrency=${displayCurrency}` : ""}`),
  createInvoice: <TResult = unknown>(payload: unknown) => request<TResult>("/api/operator/invoices", { method: "POST", body: payload }),
  updateInvoiceStatus: <TResult = unknown>(id: string, status: string) => request<TResult>(`/api/operator/invoices/${id}/status`, { method: "PATCH", body: { status } }),
  updateInvoicePod: <TResult = unknown>(id: string, podStatus: string) => request<TResult>(`/api/operator/invoices/${id}/pod`, { method: "PATCH", body: { podStatus } }),
  auditInvoice: <TResult = unknown>(id: string) => request<TResult>(`/api/operator/invoices/${id}/audit`, { method: "POST" }),
  sendQuickPayLink: <TResult = unknown>(id: string, clientEmail?: string) => request<TResult>(`/api/operator/invoices/${id}/quick-pay-link`, { method: "POST", body: { clientEmail } }),
  billingKpis: <TResult = unknown>(displayCurrency?: string) => request<TResult>(`/api/operator/billing-kpis${displayCurrency ? `?displayCurrency=${displayCurrency}` : ""}`),
  leads: <TResult = unknown>(segment?: string) => request<TResult>(`/api/operator/leads${segment ? `?segment=${segment}` : ""}`),
  createLead: <TResult = unknown>(payload: unknown) => request<TResult>("/api/operator/leads", { method: "POST", body: payload }),
  updateLeadStage: <TResult = unknown>(id: string, stage: string) => request<TResult>(`/api/operator/leads/${id}/stage`, { method: "PATCH", body: { stage } }),
  leadPipelineKpis: <TResult = unknown>() => request<TResult>("/api/operator/leads/pipeline-kpis"),
  draftIntroEmail: <TResult = unknown>(id: string) => request<TResult>(`/api/operator/leads/${id}/draft-intro-email`, { method: "POST" }),
  generateSavingsProposal: <TResult = unknown>(id: string) => request<TResult>(`/api/operator/leads/${id}/savings-proposal`, { method: "POST" }),
  convertLeadToAccount: <TResult = unknown>(id: string, orgId: string) => request<TResult>(`/api/operator/leads/${id}/convert-to-account`, { method: "POST", body: { orgId } }),
  vault: <TResult = unknown>(orgId?: string) => request<TResult>(`/api/operator/vault${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`),
  uploadVaultDocument: <TResult = unknown>(payload: unknown) => request<TResult>("/api/operator/vault", { method: "POST", body: payload }),
  vaultDownloadUrl: <TResult = unknown>(id: string) => request<TResult>(`/api/operator/vault/${id}/download`),
  accountAuditLog: <TResult = unknown>(accountId: string) => request<TResult>(`/api/operator/accounts/${accountId}/audit-log`),
  executiveDrafts: <TResult = unknown>(status?: string) => request<TResult>(`/api/operator/executive-drafts${status ? `?status=${status}` : ""}`),
  decideExecutiveDraft: <TResult = unknown>(id: string, decision: "approved" | "rejected") => request<TResult>(`/api/operator/executive-drafts/${id}/decide`, { method: "PATCH", body: { decision } }),
  calendarEvents: <TResult = unknown>(orgId?: string) => request<TResult>(`/api/calendar/events${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`),
  createCalendarEvent: <TResult = unknown>(payload: unknown) => request<TResult>("/api/calendar/events", { method: "POST", body: payload }),
  calendarEventShipment: <TResult = unknown>(id: string) => request<TResult>(`/api/calendar/events/${id}/shipment`),
  rescheduleCalendarEvent: <TResult = unknown>(id: string, payload: { startsAtIso: string; endsAtIso?: string }) =>
    request<TResult>(`/api/calendar/events/${id}/reschedule`, { method: "PATCH", body: payload }),
  cancelCalendarEvent: <TResult = unknown>(id: string) => request<TResult>(`/api/calendar/events/${id}/cancel`, { method: "PATCH" }),
  sendCalendarEventSmsAlert: <TResult = unknown>(id: string, payload?: { driverPhone?: string }) =>
    request<TResult>(`/api/calendar/events/${id}/send-sms-alert`, { method: "POST", body: payload ?? {} }),
  facilities: <TResult = unknown>() => request<TResult>("/api/client/facilities"),
  // Facility Management & Warehouse Rules Hub (Operator Control Tower)
  operatorFacilities: <TResult = unknown>(includeArchived?: boolean) => request<TResult>(`/api/operator/facilities${includeArchived ? "?includeArchived=true" : ""}`),
  createOperatorFacility: <TResult = unknown>(payload: unknown) => request<TResult>("/api/operator/facilities", { method: "POST", body: payload }),
  updateOperatorFacility: <TResult = unknown>(id: string, payload: unknown) => request<TResult>(`/api/operator/facilities/${id}`, { method: "PATCH", body: payload }),
  archiveOperatorFacility: <TResult = unknown>(id: string, archived = true) => request<TResult>(`/api/operator/facilities/${id}/archive`, { method: "PATCH", body: { archived } }),
  facilityBoundShipments: <TResult = unknown>(id: string) => request<TResult>(`/api/operator/facilities/${id}/bound-shipments`),
  sendStagingSms: <TResult = unknown>(id: string, payload: { driverPhone: string; driverName?: string; shipmentId?: string }) =>
    request<TResult>(`/api/operator/facilities/${id}/send-staging-sms`, { method: "POST", body: payload }),
  poaStatus: <TResult = unknown>() => request<TResult>("/api/client/poa"),
  chat: <TResult = unknown>(orgId: string, question: string) => request<TResult>("/api/client/chat", { method: "POST", body: { orgId, question } }),
  callLogs: <TResult = unknown>(search?: string) => request<TResult>(`/api/operator/calls${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  logCall: <TResult = unknown>(payload: unknown) => request<TResult>("/api/operator/calls", { method: "POST", body: payload }),
  dncList: <TResult = unknown>(search?: string) => request<TResult>(`/api/operator/dnc${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  addToDnc: <TResult = unknown>(payload: unknown) => request<TResult>("/api/operator/dnc", { method: "POST", body: payload }),
  sendRateProposalEmail: <TResult = unknown>(leadId: string) => request<TResult>(`/api/operator/leads/${leadId}/send-rate-proposal-email`, { method: "POST" }),
  sendUsmcaPacket: <TResult = unknown>(leadId: string) => request<TResult>(`/api/operator/leads/${leadId}/send-usmca-packet`, { method: "POST" }),
  leadSegments: <TResult = unknown>() => request<TResult>("/api/operator/leads/segments"),
  leadsBySegment: <TResult = unknown>(segment: string) => request<TResult>(`/api/operator/leads?segment=${encodeURIComponent(segment)}`),
};

// --- WebSocket wrapper with auto-reconnect ----------------------------------

export type WsChannel = "border_telemetry" | "ocr_ingestion" | "executive_approval" | "simulation" | "shipment_status";

export interface WsEnvelope<T = unknown> {
  channel: WsChannel;
  type: string;
  payload: T;
  timestampIso: string;
}

type WsListener = (envelope: WsEnvelope) => void;

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30_000;

export class PascalLogisticsSocket {
  private socket: WebSocket | undefined;
  private listeners = new Set<WsListener>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private closedByCaller = false;

  connect(): void {
    if (!API_BASE_URL) return;
    this.closedByCaller = false;
    const wsUrl = API_BASE_URL.replace(/^http/, "ws") + "/ws";

    this.socket = new WebSocket(wsUrl);

    this.socket.onopen = () => {
      this.reconnectAttempt = 0;
    };

    this.socket.onmessage = (event) => {
      try {
        const envelope = JSON.parse(event.data) as WsEnvelope;
        this.listeners.forEach((listener) => listener(envelope));
      } catch {
        console.warn("Received malformed WebSocket message, ignoring.");
      }
    };

    this.socket.onclose = () => {
      if (!this.closedByCaller) this.scheduleReconnect();
    };

    this.socket.onerror = () => {
      this.socket?.close();
    };
  }

  private scheduleReconnect(): void {
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_DELAY_MS);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  subscribe(listener: WsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  disconnect(): void {
    this.closedByCaller = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
  }
}

export const pascalSocket = new PascalLogisticsSocket();
