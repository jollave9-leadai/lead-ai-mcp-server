// Type definitions for Cal.com Slots API

export interface SlotTime {
  start: string;
}

export interface SlotRange {
  start: string;
  end: string;
  attendeesCount?: number;
  bookingUid?: string;
}

export interface SlotsResponse {
  status: "success" | "error";
  data?: {
    [date: string]: SlotTime[] | SlotRange[];
  };
  error?: {
    message: string;
    details?: unknown;
  };
}

export interface GetSlotsRequest {
  // Required parameters
  start: string; // ISO 8601 datestring in UTC
  end: string; // ISO 8601 datestring in UTC

  // Event type identification (choose one method)
  eventTypeId?: number;
}

export interface SlotsSummary {
  success: boolean;
  totalSlots: number;
  availableDates: string[];
  slotsPerDate: { [date: string]: number };
  dateRange: {
    start: string;
    end: string;
  };
  error?: string;
}

export interface SlotValidationResult {
  isAvailable: boolean;
  requestedSlot: string;
  availableSlots: SlotTime[] | SlotRange[];
  nearestAvailable?: SlotTime | SlotRange;
  error?: string;
}
