import { useEffect, useState } from "react";
import { X, Truck, MapPin, MessageSquareText, CalendarClock, Ban, Clock, User } from "lucide-react";
import { api } from "../config/api";
import type { CalendarEvent } from "../types/calendar";
import type { FacilityProfile } from "../types/facility";
import { formatDateInZone, formatTimeInZone } from "../lib/calendarDate";

interface ShipmentLookup {
  id: string;
  lane: string;
  statusChip: string;
  driverName?: string;
  driverPhone?: string;
  carrierName?: string;
}

const CATEGORY_META: Record<string, { emoji: string; label: string }> = {
  dock_appointment: { emoji: "🚚", label: "Delivery & Pickup Appointment" },
  ocean_demurrage: { emoji: "⚓", label: "Ocean Laycan & Demurrage" },
  border_clearance: { emoji: "🛂", label: "Border Clearance & PAPS Window" },
  discovery_call: { emoji: "📅", label: "Discovery Call / Client Meeting" },
  other: { emoji: "🗓️", label: "Other" },
};

export interface CalendarEventDrawerProps {
  event: CalendarEvent;
  isOperator: boolean;
  onClose: () => void;
  onUpdated: (event: CalendarEvent) => void;
  onCancelled: (eventId: string) => void;
}

export function CalendarEventDrawer({ event, isOperator, onClose, onUpdated, onCancelled }: CalendarEventDrawerProps) {
  const [facility, setFacility] = useState<FacilityProfile | undefined>();
  const [shipment, setShipment] = useState<ShipmentLookup | undefined>();
  const [rescheduling, setRescheduling] = useState(false);
  const [newStart, setNewStart] = useState("");
  const [smsStatus, setSmsStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (event.facilityId) {
      const facilitiesRequest = isOperator ? api.operatorFacilities<{ facilities: FacilityProfile[] }>() : api.facilities<{ facilities: FacilityProfile[] }>();
      facilitiesRequest.then((d) => setFacility(d.facilities.find((f) => f.id === event.facilityId)));
    }
    if (event.shipmentId) {
      api.calendarEventShipment<{ shipment?: ShipmentLookup }>(event.id).then((d) => setShipment(d.shipment));
    }
  }, [event.id, event.facilityId, event.shipmentId, isOperator]);

  const meta = CATEGORY_META[event.eventType] ?? CATEGORY_META.other;

  async function handleReschedule() {
    if (!newStart) return;
    const updated = await api.rescheduleCalendarEvent<CalendarEvent>(event.id, { startsAtIso: new Date(newStart).toISOString() });
    onUpdated(updated);
    setRescheduling(false);
  }

  async function handleSendSms() {
    setSmsStatus("sending");
    try {
      await api.sendCalendarEventSmsAlert(event.id, shipment?.driverPhone ? { driverPhone: shipment.driverPhone } : undefined);
      setSmsStatus("sent");
    } catch {
      setSmsStatus("error");
    }
  }

  async function handleCancel() {
    if (!confirm(`Cancel "${event.title}"? This keeps the event on record but marks it cancelled.`)) return;
    setCancelling(true);
    try {
      await api.cancelCalendarEvent(event.id);
      onCancelled(event.id);
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="h-full w-full max-w-lg overflow-y-auto border-l border-slate-200 bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">{meta.emoji}</span>
            <p className="text-sm font-bold text-slate-900">{event.title}</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={16} />
          </button>
        </div>
        <p className="mb-4 flex items-center gap-1 text-xs text-slate-500">
          <Clock size={11} />
          {formatDateInZone(event.startsAtIso, event.timezone)} · {formatTimeInZone(event.startsAtIso, event.timezone)} ({event.timezone.split("/")[1]?.replace("_", " ")})
        </p>

        <div className="mb-5 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{meta.label}</span>
          {event.status !== "scheduled" && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${event.status === "cancelled" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>
              {event.status}
            </span>
          )}
        </div>

        {event.notes && <p className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{event.notes}</p>}

        {/* Bound shipment & driver */}
        {event.shipmentId && (
          <section className="mb-5 rounded-lg border border-slate-200 p-4">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Truck size={13} /> Bound Shipment
            </p>
            <p className="font-mono text-xs font-bold text-slate-900">{event.shipmentId}</p>
            {shipment ? (
              <div className="mt-2 space-y-1 text-xs text-slate-500">
                <p>{shipment.lane}</p>
                {shipment.driverName && (
                  <p className="flex items-center gap-1">
                    <User size={11} /> {shipment.driverName} {shipment.driverPhone && `· ${shipment.driverPhone}`}
                  </p>
                )}
                {shipment.carrierName && <p>Carrier: {shipment.carrierName}</p>}
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-400">No driver details on file for this shipment.</p>
            )}
          </section>
        )}

        {/* Facility SOP rules */}
        {facility && (
          <section className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <MapPin size={13} /> Facility SOP — {facility.name}
            </p>
            <p className="mb-1 text-xs text-slate-600">
              Dock hours {facility.receivingHoursStart}–{facility.receivingHoursEnd}
              {facility.breakWindow ? ` (break ${facility.breakWindow})` : ""}
            </p>
            <p className="text-xs text-slate-600">{facility.driverStagingNotes || "No staging notes on file."}</p>
          </section>
        )}

        {/* Quick actions */}
        {isOperator && event.status !== "cancelled" && (
          <div className="space-y-2 border-t border-slate-200 pt-4">
            {!rescheduling ? (
              <button
                onClick={() => setRescheduling(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <CalendarClock size={13} /> Reschedule Appointment
              </button>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 p-2">
                <input type="datetime-local" value={newStart} onChange={(e) => setNewStart(e.target.value)} className="flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-xs" />
                <button onClick={handleReschedule} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">
                  Confirm
                </button>
              </div>
            )}

            <button
              onClick={handleSendSms}
              disabled={smsStatus === "sending"}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <MessageSquareText size={13} />
              {smsStatus === "sending" ? "Sending…" : smsStatus === "sent" ? "SMS Sent" : smsStatus === "error" ? "Failed — retry" : "Send SMS Alert to Driver"}
            </button>

            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
            >
              <Ban size={13} /> {cancelling ? "Cancelling…" : "Cancel Event"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
