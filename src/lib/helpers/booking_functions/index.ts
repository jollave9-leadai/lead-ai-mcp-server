/**
 * Booking Functions Module
 * 
 * Exports all booking-related services and utilities
 */

// Calendar Connection Service
export { getCalendarConnectionByAgentId } from "./calendarConnectionService";

// Contact Lookup Service
export {
  searchContactByName,
  searchContactByEmail,
  searchContactByPhone,
  isValidEmail,
  createManualContact,
} from "./contactLookupService";

// Availability Service
export {
  generateAvailableSlots,
  filterAvailableSlots,
  findAlternativeSlots,
  isSlotAvailable,
  getAgentOfficeHoursByAgentId,
  isWithinOfficeHours,
  isValidFutureTime,
  formatDateTime,
  formatDateRange,
  calculateDurationMinutes,
  getNextBusinessDay,
} from "./availabilityService";

// Conflict Detection Service
export {
  checkEventConflicts,
  validateBookingRequest,
  findConflictingSlots,
  formatConflictDetails,
  spansMultipleDays,
  validateAttendeeEmails,
  hasOverlap,
  hasMinimumGap,
  validateOfficeHours,
  calculateBookingConfidence,
} from "./conflictDetectionService";

// Timezone Service
export {
  convertCustomerTimeToBusinessTime,
  formatDateTimeInTimezone,
  isValidTimezone,
  normalizeTimezone,
  COMMON_TIMEZONES,
} from "./timezoneService";

// Booking Operations (Main Service)
export {
  createBooking,
  findAvailableTimeSlots,
  checkCalendarConnection,
  getAvailableCalendars,
  getDetailedAvailability,
} from "./bookingOperations";

