// Export all types from their respective files
export type { Client } from "./client";
export type {
  Lead,
  LeadSummary,
  LeadFilters,
  LeadQueryOptions,
  LeadsResponse,
} from "./lead";
export type {
  GraphCalendarConnection,
  GraphCalendar,
  GraphEvent,
  GraphAttendee,
  GraphFreeBusyResponse,
  CreateGraphEventRequest,
  UpdateGraphEventRequest,
  GraphEventResponse,
  GraphEventsListResponse,
  GraphCalendarListResponse,
  GraphTokenResponse,
  GraphErrorResponse,
  CalendarProvider,
  OAuthState,
  GetGraphEventsRequest,
  CreateGraphEventMCPRequest,
  GetAvailabilityRequest,
  AvailabilitySlot,
  AvailabilityResponse,
} from "./microsoft-graph";
export type {
  ContactInfo,
  ContactSearchResult,
  TimeSlot,
  ConflictCheckResult,
  BookingValidationResult,
  BookingRequest,
  BookingResponse,
  AvailabilityCheckRequest,
  AvailabilityCheckResponse,
  AgentOfficeHours,
  CalendarConnectionStatus,
} from "./booking";
