/**
 * Conflict Detection Service
 * 
 * Handles detecting scheduling conflicts and validating bookings
 * against calendar events and business rules.
 */

import type {
  ConflictCheckResult,
  BookingValidationResult,
  TimeSlot,
} from "@/types";
import type { GraphEvent } from "@/types/microsoft-graph";
import {
  isValidFutureTime,
  isWithinOfficeHours,
  calculateDurationMinutes,
} from "./availabilityService";
import { isValidEmail } from "./contactLookupService";
import { parseDateInTimezone } from "./parseDateInTimezone";
import { convertFromWindowsTimezone } from "../calendar_functions/graphHelper";

/**
 * Check for conflicts with existing calendar events
 * 
 * IMPORTANT: Both requested times and event times must be in the same timezone context
 * Graph API returns times in the timezone specified by the event.start.timeZone field
 */
export function checkEventConflicts(
  requestedStart: Date,
  requestedEnd: Date,
  existingEvents: GraphEvent[]
): ConflictCheckResult {
  const conflicts: Array<{
    id: string;
    subject: string;
    start: string;
    end: string;
  }> = [];

  for (const event of existingEvents) {
    // Graph API returns Windows timezone format (e.g., "AUS Eastern Standard Time")
    // Convert to IANA format for JavaScript compatibility
    const windowsTimezone = event.start.timeZone || "Australia/Melbourne";
    const eventTimezone = convertFromWindowsTimezone(windowsTimezone);
    
    // If dateTime ends with 'Z', it's already UTC
    const eventStartStr = event.start.dateTime;
    const eventEndStr = event.end.dateTime;
    
    let eventStart: Date;
    let eventEnd: Date;
    
    if (eventStartStr.endsWith('Z')) {
      // Already UTC, parse directly
      eventStart = new Date(eventStartStr);
      eventEnd = new Date(eventEndStr);
      console.log(`   Event "${event.subject}" (UTC format): ${eventStart.toISOString()} to ${eventEnd.toISOString()}`);
    } else {
      // Local time, parse in timezone
      eventStart = parseDateInTimezone(eventStartStr, eventTimezone);
      eventEnd = parseDateInTimezone(eventEndStr, eventTimezone);
      console.log(`   Event "${event.subject}" (Local format in ${eventTimezone}): ${eventStart.toISOString()} to ${eventEnd.toISOString()}`);
    }

    // Check for overlap using UTC timestamps (timezone-agnostic comparison)
    const hasOverlap = requestedStart.getTime() < eventEnd.getTime() && requestedEnd.getTime() > eventStart.getTime();
    console.log(`   Requested: ${requestedStart.toISOString()} - ${requestedEnd.toISOString()}`);
    console.log(`   Event: ${eventStart.toISOString()} - ${eventEnd.toISOString()}`);
    console.log(`   Overlap: ${hasOverlap}`);
    
    if (hasOverlap) {
      conflicts.push({
        id: event.id,
        subject: event.subject,
        start: event.start.dateTime,
        end: event.end.dateTime,
      });
    }
  }

  if (conflicts.length > 0) {
    const conflictSummary =
      conflicts.length === 1
        ? `Conflicts with: "${conflicts[0].subject}"`
        : `Conflicts with ${conflicts.length} events`;

    return {
      hasConflict: true,
      conflictingEvents: conflicts,
      message: conflictSummary,
    };
  }

  return {
    hasConflict: false,
    message: "No conflicts detected",
  };
}

/**
 * Validate a booking request before creating it
 */
export function validateBookingRequest({
  subject,
  startDateTime,
  endDateTime,
  contactEmail,
  contactName,
  officeHours,
  timezone,
}: {
  subject: string;
  startDateTime: string;
  endDateTime: string;
  contactEmail?: string;
  contactName?: string;
  officeHours?: Record<
    string,
    { start: string; end: string; enabled: boolean }
  >;
  timezone?: string;
}): BookingValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate subject
  if (!subject || subject.trim().length === 0) {
    errors.push("Meeting subject is required");
  } else if (subject.trim().length < 3) {
    errors.push("Meeting subject must be at least 3 characters");
  } else if (subject.trim().length > 255) {
    errors.push("Meeting subject must be less than 255 characters");
  }

  // Validate dates
  let startDate: Date;
  let endDate: Date;

  try {
    // Parse dates IN the target timezone (important: customer's "2pm" means 2pm in client TZ, not UTC!)
    startDate = parseDateInTimezone(startDateTime, timezone || "Australia/Melbourne");
    endDate = parseDateInTimezone(endDateTime, timezone || "Australia/Melbourne");

    if (isNaN(startDate.getTime())) {
      errors.push("Invalid start date format");
    }
    if (isNaN(endDate.getTime())) {
      errors.push("Invalid end date format");
    }

    // Check if we have valid dates before further validation
    if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
      // Validate time order
      if (endDate <= startDate) {
        errors.push("End time must be after start time");
      }

      // Validate duration
      const durationMinutes = calculateDurationMinutes(startDate, endDate);

      if (durationMinutes < 15) {
        errors.push("Meeting duration must be at least 15 minutes");
      } else if (durationMinutes > 480) {
        // 8 hours
        warnings.push("Meeting duration exceeds 8 hours");
      }

      // Validate future time
      const futureCheck = isValidFutureTime(startDate, 15);
      if (!futureCheck.isValid) {
        errors.push(
          futureCheck.reason || "Start time must be at least 15 minutes in the future"
        );
      }

      // Validate office hours if provided
      if (officeHours && timezone) {
        const startCheck = isWithinOfficeHours(
          startDate,
          officeHours,
          timezone
        );
        if (!startCheck.isWithin) {
          errors.push(`Start time: ${startCheck.reason}`);
        }

        const endCheck = isWithinOfficeHours(endDate, officeHours, timezone);
        if (!endCheck.isWithin) {
          errors.push(`End time: ${endCheck.reason}`);
        }
      }

      // Check for weekend
      const dayOfWeek = startDate.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        warnings.push(
          "Booking is scheduled for weekend (Sunday or Saturday)"
        );
      }

      // Check for late night
      const hour = startDate.getHours();
      if (hour < 6 || hour > 21) {
        warnings.push("Booking is scheduled outside typical business hours");
      }
    }
  } catch {
    errors.push("Error parsing date/time values");
  }

  // Validate contact information
  if (!contactName) {
    errors.push("Contact name is required");
  }

  if (contactName && contactName.trim().length < 2) {
    errors.push("Contact name must be at least 2 characters");
  }

  // Email is optional but must be valid if provided
  if (contactEmail && !isValidEmail(contactEmail)) {
    errors.push("Invalid email address format");
  }
  
  // Warn if no email provided
  if (!contactEmail && contactName) {
    warnings.push("No email address provided - invitation will not be sent");
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Find conflicting time slots from a list of slots
 */
export function findConflictingSlots(
  slots: TimeSlot[],
  events: GraphEvent[]
): TimeSlot[] {
  return slots.filter((slot) => {
    const slotStart = new Date(slot.start);
    const slotEnd = new Date(slot.end);

    return events.some((event) => {
      const eventStart = new Date(event.start.dateTime);
      const eventEnd = new Date(event.end.dateTime);

      return slotStart < eventEnd && slotEnd > eventStart;
    });
  });
}

/**
 * Get conflict details for display
 */
export function formatConflictDetails(
  conflicts: Array<{
    id: string;
    subject: string;
    start: string;
    end: string;
  }>,
  timezone: string = "Australia/Melbourne"
): string {
  if (conflicts.length === 0) {
    return "No conflicts";
  }

  const details: string[] = [];

  conflicts.forEach((conflict, index) => {
    const start = new Date(conflict.start).toLocaleString("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const end = new Date(conflict.end).toLocaleTimeString("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
    });

    details.push(`${index + 1}. "${conflict.subject}" (${start} - ${end})`);
  });

  return details.join("\n");
}

/**
 * Check if a time range spans multiple days
 */
export function spansMultipleDays(startDate: Date, endDate: Date): boolean {
  return startDate.getDate() !== endDate.getDate();
}

/**
 * Validate email list for attendees
 */
export function validateAttendeeEmails(emails: string[]): {
  valid: string[];
  invalid: string[];
} {
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const email of emails) {
    if (isValidEmail(email.trim())) {
      valid.push(email.trim());
    } else {
      invalid.push(email.trim());
    }
  }

  return { valid, invalid };
}

/**
 * Check for overlapping time ranges
 */
export function hasOverlap(
  range1Start: Date,
  range1End: Date,
  range2Start: Date,
  range2End: Date
): boolean {
  return range1Start < range2End && range1End > range2Start;
}

/**
 * Get minimum gap between meetings (buffer time)
 */
export function hasMinimumGap(
  meeting1End: Date,
  meeting2Start: Date,
  minimumGapMinutes: number = 5
): boolean {
  const gapMs = meeting2Start.getTime() - meeting1End.getTime();
  const gapMinutes = gapMs / (1000 * 60);
  return gapMinutes >= minimumGapMinutes;
}

/**
 * Validate business hours configuration
 */
export function validateOfficeHours(
  officeHours: Record<
    string,
    { start: string; end: string; enabled: boolean }
  >
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  const validDays = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ];

  const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;

  for (const day of validDays) {
    const schedule = officeHours[day];

    if (!schedule) {
      continue; // Optional days
    }

    if (schedule.enabled) {
      if (!timeRegex.test(schedule.start)) {
        errors.push(
          `Invalid start time format for ${day}: ${schedule.start}`
        );
      }

      if (!timeRegex.test(schedule.end)) {
        errors.push(`Invalid end time format for ${day}: ${schedule.end}`);
      }

      if (schedule.start >= schedule.end) {
        errors.push(
          `End time must be after start time for ${day} (${schedule.start} - ${schedule.end})`
        );
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Calculate booking confidence score
 */
export function calculateBookingConfidence({
  hasContactInDatabase,
  isWithinOfficeHours,
  hasNoConflicts,
  isReasonableDuration,
  hasValidEmail,
}: {
  hasContactInDatabase: boolean;
  isWithinOfficeHours: boolean;
  hasNoConflicts: boolean;
  isReasonableDuration: boolean;
  hasValidEmail: boolean;
}): { score: number; level: "high" | "medium" | "low" } {
  let score = 0;

  if (hasContactInDatabase) score += 25;
  if (isWithinOfficeHours) score += 25;
  if (hasNoConflicts) score += 25;
  if (isReasonableDuration) score += 15;
  if (hasValidEmail) score += 10;

  const level = score >= 80 ? "high" : score >= 50 ? "medium" : "low";

  return { score, level };
}

