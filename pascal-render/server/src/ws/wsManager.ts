// ============================================================================
// WEBSOCKET MANAGER
// Wraps a `ws` WebSocketServer with typed broadcast helpers for the three
// live channels this platform needs: border wait-time updates, OCR
// ingestion results, and Agent 9 executive approval events. Tracks socket
// health with a ping/pong heartbeat so dead connections get pruned rather
// than silently accumulating.
// ============================================================================

import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { Server as HttpServer } from "node:http";
import type { PipelineResult } from "../types/shipment.js";

export type WsChannel = "border_telemetry" | "ocr_ingestion" | "executive_approval" | "simulation" | "shipment_status";

export interface WsEnvelope<T = unknown> {
  channel: WsChannel;
  type: string;
  payload: T;
  timestampIso: string;
}

interface TrackedSocket extends WebSocket {
  isAlive?: boolean;
}

const HEARTBEAT_INTERVAL_MS = 30_000;

export class WsManager {
  private wss: WebSocketServer;
  private heartbeat: NodeJS.Timeout;

  constructor(httpServer: HttpServer) {
    this.wss = new WebSocketServer({ server: httpServer, path: "/ws" });

    this.wss.on("connection", (socket: TrackedSocket) => {
      socket.isAlive = true;
      socket.on("pong", () => {
        socket.isAlive = true;
      });
      socket.on("message", (data: RawData) => this.handleClientMessage(socket, data));
      socket.send(
        JSON.stringify({
          channel: "border_telemetry",
          type: "connection_ack",
          payload: { message: "Connected to Pascal Logistics live feed." },
          timestampIso: new Date().toISOString(),
        } satisfies WsEnvelope),
      );
    });

    // Prune dead connections — a client that never responds to a ping gets
    // terminated on the following sweep rather than leaking a socket handle.
    this.heartbeat = setInterval(() => {
      this.wss.clients.forEach((raw) => {
        const socket = raw as TrackedSocket;
        if (socket.isAlive === false) {
          socket.terminate();
          return;
        }
        socket.isAlive = false;
        socket.ping();
      });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private handleClientMessage(socket: WebSocket, data: RawData) {
    // Clients only subscribe/ping over this channel today; no inbound
    // command processing yet. Parsed defensively so a malformed frame from
    // a misbehaving client never crashes the server.
    try {
      JSON.parse(data.toString());
    } catch {
      socket.send(JSON.stringify({ channel: "border_telemetry", type: "error", payload: { message: "Malformed message" }, timestampIso: new Date().toISOString() }));
    }
  }

  private broadcast<T>(envelope: WsEnvelope<T>) {
    const message = JSON.stringify(envelope);
    this.wss.clients.forEach((socket) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(message);
    });
  }

  broadcastBorderWaitUpdate(payload: { poeId: string; direction: "northbound" | "southbound"; laneType: "commercial" | "passenger_nexus"; waitMinutes: number }) {
    this.broadcast({ channel: "border_telemetry", type: "wait_time_update", payload, timestampIso: new Date().toISOString() });
  }

  broadcastOcrResult(payload: { shipmentId: string; confidenceScore: number; fieldsExtracted: number }) {
    this.broadcast({ channel: "ocr_ingestion", type: "extraction_complete", payload, timestampIso: new Date().toISOString() });
  }

  broadcastExecutiveApproval(payload: PipelineResult) {
    this.broadcast({ channel: "executive_approval", type: "pipeline_result", payload, timestampIso: new Date().toISOString() });
  }

  broadcastSimulationStep(payload: unknown) {
    this.broadcast({ channel: "simulation", type: "simulation_step", payload, timestampIso: new Date().toISOString() });
  }

  broadcastShipmentStatusChange(payload: { shipmentId: string; statusChip: string; currentMilestone: string; poeId?: string }) {
    this.broadcast({ channel: "shipment_status", type: "status_change", payload, timestampIso: new Date().toISOString() });
  }

  close() {
    clearInterval(this.heartbeat);
    this.wss.close();
  }
}
