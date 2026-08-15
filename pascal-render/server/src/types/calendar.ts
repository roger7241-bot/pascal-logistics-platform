// ============================================================================
// SCHEDULING HUB TYPES — shared calendar event shape for both the Operator
// Control Tower's Scheduling Hub and the Client Portal's calendar tab.
// ============================================================================

export type CalendarEventCategory = "dock_appointment" | "ocean_demurrage" | "border_clearance" | "discovery_call" | "other";
export type CalendarEventStatus = "scheduled" | "rescheduled" | "cancelled";
export type CalendarEventTimezone = "America/Los_Angeles" | "America/New_York" | "UTC";
export type ReminderThreshold = "15m" | "1h" | "24h";
export type ReminderChannel = "email" | "sms";
export type PoeId = "peace_arch" | "pacific_highway" | "aldergrove" | "sumas" | "point_roberts";

export interface CalendarEvent {
  id: string;
  orgId: string;
  title: string;
  eventType: CalendarEventCategory;
  startsAtIso: string;
  endsAtIso?: string;
  shipmentId?: string;
  poeId?: PoeId;
  facilityId?: string;
  timezone: CalendarEventTimezone;
  reminderThresholds: ReminderThreshold[];
  reminderChannels: ReminderChannel[];
  status: CalendarEventStatus;
  notes?: string;
  createdAtIso?: string;
}

export interface CalendarEventUpsertPayload {
  orgId: string;
  title: string;
  eventType: CalendarEventCategory;
  startsAtIso: string;
  endsAtIso?: string;
  shipmentId?: string;
  poeId?: PoeId;
  facilityId?: string;
  timezone?: CalendarEventTimezone;
  reminderThresholds?: ReminderThreshold[];
  reminderChannels?: ReminderChannel[];
  notes?: string;
}
