/**
 * Booking Operations Service
 * 
 * Main orchestrator for all booking operations.
 * Integrates contact lookup, availability checking, conflict detection,
 * and Microsoft Graph calendar operations.
 */

import type {
  BookingRequest,
  BookingResponse,
  AvailabilityCheckRequest,
  AvailabilityCheckResponse,
  CalendarConnectionStatus,
} from "@/types";
import {
  searchContactByName,
  createManualContact,
} from "./contactLookupService";
import {
  generateAvailableSlots,
  filterAvailableSlots,
  findAlternativeSlots,
  getAgentOfficeHoursByAgentId,
  isWithinOfficeHours,
  isValidFutureTime,
  formatDateTime,
} from "./availabilityService";
import {
  checkEventConflicts,
  validateBookingRequest,
  formatConflictDetails,
} from "./conflictDetectionService";
import { getCalendarConnectionByAgentId } from "./calendarConnectionService";
import {
  normalizeTimezone,
  isValidTimezone,
} from "./timezoneService";
import { parseDateInTimezone } from "./parseDateInTimezone";
import { FinalOptimizedCalendarOperations } from "../calendar_functions/finalOptimizedCalendarOperations";

/**
 * Create a booking appointment
 */
export async function createBooking(
  request: BookingRequest
): Promise<BookingResponse> {
  try {
    // Reduced logging for VAPI performance
    console.log(`📅 Creating booking for ${request.contactName} at ${request.startDateTime}`);

    // Step 1: Get calendar connection for this agent
    const connection = await getCalendarConnectionByAgentId(
      request.agentId,
      request.clientId
    );

    if (!connection) {
      return {
        success: false,
        error: `No calendar connection found for agent ${request.agentId}`,
      };
    }

    // Step 2: Get agent office hours directly by agent ID
    const officeHours = await getAgentOfficeHoursByAgentId(
      request.agentId,
      request.clientId
    );

    const businessTimezone = officeHours?.timezone || "Australia/Melbourne";

    // Step 3: Timezone handling
    let customerTimezone: string | undefined;

    if (request.customerTimezone) {
      customerTimezone = normalizeTimezone(request.customerTimezone);
      
      if (!isValidTimezone(customerTimezone)) {
        return {
          success: false,
          error: `Invalid timezone: "${request.customerTimezone}". Please provide a valid timezone.`,
        };
      }
    }

    const startDateTime = request.startDateTime;
    const endDateTime = request.endDateTime;

    // Step 4: Resolve contact information
    let contactEmail = request.contactEmail;
    let contactName = request.contactName || "Unknown";
    let contactFound = false;

    // Always try to find contact in database if name is provided
    if (request.contactName) {
      const contactSearch = await searchContactByName(
        request.contactName,
        request.clientId
      );

      if (contactSearch.found && contactSearch.contact) {
        // Found exact match - use database info
        contactEmail = contactSearch.contact.email || contactEmail;
        contactName = contactSearch.contact.name;
        contactFound = true;
      } else if (contactSearch.matches && contactSearch.matches.length > 0) {
        // Multiple matches - ask for clarification
        return {
          success: false,
          error: `Multiple contacts found for "${request.contactName}". Please specify email address.`,
        };
      }
    }

    // Contact name is required, but email is optional
    if (!contactName || contactName === "Unknown") {
      return {
        success: false,
        error: "Contact name is required",
      };
    }

    // Step 5: Validate booking request (use converted business times)
    const validation = validateBookingRequest({
      subject: request.subject,
      startDateTime,
      endDateTime,
      contactEmail,
      contactName,
      officeHours: officeHours?.schedule,
      timezone: businessTimezone,
    });

    if (!validation.isValid) {
      return {
        success: false,
        error: `Validation failed: ${validation.errors.join(", ")}`,
      };
    }

    // Step 6: Check for conflicts
    // Parse dates in client timezone (customer's "2pm" is 2pm Melbourne, not 2pm UTC!)
    const startDate = parseDateInTimezone(startDateTime, businessTimezone);
    const endDate = parseDateInTimezone(endDateTime, businessTimezone);

    // Expand search range to catch overlapping events
    const searchStart = new Date(startDate);
    searchStart.setHours(searchStart.getHours() - 2); // Look 2 hours before
    const searchEnd = new Date(endDate);
    searchEnd.setHours(searchEnd.getHours() + 2); // Look 2 hours after

    // Get existing events for conflict detection (use agent's calendar)
    const eventsResult =
      await FinalOptimizedCalendarOperations.getCalendarEventsForClient(
        request.clientId,
        {
          clientId: request.clientId,
          startDate: searchStart.toISOString().slice(0, 19),
          endDate: searchEnd.toISOString().slice(0, 19),
          calendarId: request.calendarId,
        },
        connection.id // Pass the agent's calendar connection ID
      );

    if (eventsResult.success && eventsResult.events) {
      const conflictCheck = checkEventConflicts(
        startDate,
        endDate,
        eventsResult.events
      );

      if (conflictCheck.hasConflict) {

        // Find alternative slots
        const searchRange = {
          start: new Date(startDate.getTime() - 24 * 60 * 60 * 1000), // 1 day before
          end: new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000), // 7 days after
        };

        const allSlots = officeHours?.schedule
          ? generateAvailableSlots(
              searchRange.start,
              searchRange.end,
              officeHours.schedule,
              businessTimezone,
              Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60))
            )
          : [];

        const availableSlots = filterAvailableSlots(
          allSlots,
          eventsResult.events
        );

        const alternatives = findAlternativeSlots(
          startDate,
          endDate,
          availableSlots,
          5
        );

        return {
          success: false,
          error: "Time slot has conflicts",
          conflictDetails: formatConflictDetails(
            conflictCheck.conflictingEvents || [],
            businessTimezone
          ),
          availableSlots: alternatives,
        };
      }
    }

    // Step 7: Create the calendar event (use agent's calendar with converted times)

    const createResult =
      await FinalOptimizedCalendarOperations.createCalendarEventForClient(
        request.clientId,
        {
          clientId: request.clientId,
          subject: request.subject,
          startDateTime, // Use converted business timezone
          endDateTime, // Use converted business timezone
          attendeeEmail: contactEmail || undefined, // Optional - only include if available
          attendeeName: contactName,
          description: request.description,
          location: request.location,
          isOnlineMeeting: request.isOnlineMeeting ?? true,
          calendarId: request.calendarId,
        },
        connection.id // Pass the agent's calendar connection ID
      );

    if (!createResult.success) {
      return {
        success: false,
        error: createResult.error || "Failed to create booking",
      };
    }

    return {
      success: true,
      booking: {
        eventId: createResult.eventId || "",
        subject: request.subject,
        startDateTime, // Return business timezone
        endDateTime, // Return business timezone
        contact: contactFound
          ? { name: contactName, email: contactEmail || "", source: "customer" }
          : createManualContact(contactName, contactEmail || "", request.contactPhone),
        teamsLink: createResult.event?.onlineMeeting?.joinUrl,
        location: request.location,
      },
    };
  } catch (error) {
    console.error("Error creating booking:", error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unknown booking error",
    };
  }
}

/**
 * Find available time slots
 */
export async function findAvailableTimeSlots(
  request: AvailabilityCheckRequest
): Promise<AvailabilityCheckResponse> {
  try {

    // Get calendar connection for this agent
    const connection = await getCalendarConnectionByAgentId(
      request.agentId,
      request.clientId
    );

    if (!connection) {
      return {
        success: false,
        isAvailable: false,
        requestedSlot: {
          start: request.startDateTime,
          end: request.endDateTime,
          startFormatted: "",
          endFormatted: "",
          available: false,
        },
        hasConflict: false,
        error: `No calendar connection found for agent ${request.agentId}`,
      };
    }

    // Get agent office hours directly by agent ID
    const officeHours = await getAgentOfficeHoursByAgentId(
      request.agentId,
      request.clientId
    );

    const timezone = officeHours?.timezone || "Australia/Melbourne";
    // Parse dates in client timezone
    const startDate = parseDateInTimezone(request.startDateTime, timezone);
    const endDate = parseDateInTimezone(request.endDateTime, timezone);

    // Validate time
    const futureCheck = isValidFutureTime(startDate, 15);
    if (!futureCheck.isValid) {
      return {
        success: false,
        isAvailable: false,
        requestedSlot: {
          start: request.startDateTime,
          end: request.endDateTime,
          startFormatted: formatDateTime(startDate, timezone),
          endFormatted: formatDateTime(endDate, timezone),
          available: false,
        },
        hasConflict: false,
        error: futureCheck.reason,
      };
    }

    // Check office hours
    if (officeHours) {
      const startCheck = isWithinOfficeHours(
        startDate,
        officeHours.schedule,
        timezone
      );
      if (!startCheck.isWithin) {
        return {
          success: false,
          isAvailable: false,
          requestedSlot: {
            start: request.startDateTime,
            end: request.endDateTime,
            startFormatted: formatDateTime(startDate, timezone),
            endFormatted: formatDateTime(endDate, timezone),
            available: false,
          },
          hasConflict: false,
          error: startCheck.reason,
        };
      }
    }

    // Get existing events (use agent's calendar)
    // Expand search range to catch events that might overlap
    // Graph API calendarView endpoint may not include events at exact boundaries
    const searchStart = new Date(request.startDateTime);
    searchStart.setHours(searchStart.getHours() - 2); // Look 2 hours before
    const searchEnd = new Date(request.endDateTime);
    searchEnd.setHours(searchEnd.getHours() + 2); // Look 2 hours after

    const eventsResult =
      await FinalOptimizedCalendarOperations.getCalendarEventsForClient(
        request.clientId,
        {
          clientId: request.clientId,
          startDate: searchStart.toISOString().slice(0, 19), // Remove .000Z
          endDate: searchEnd.toISOString().slice(0, 19),
        },
        connection.id // Pass the agent's calendar connection ID
      );

    const hasConflict =
      eventsResult.success && eventsResult.events
        ? checkEventConflicts(startDate, endDate, eventsResult.events)
            .hasConflict
        : false;

    // If no conflict, requested slot is available
    if (!hasConflict) {
      return {
        success: true,
        isAvailable: true,
        requestedSlot: {
          start: request.startDateTime,
          end: request.endDateTime,
          startFormatted: formatDateTime(startDate, timezone),
          endFormatted: formatDateTime(endDate, timezone),
          available: true,
        },
        hasConflict: false,
      };
    }

    // Find alternative slots
    const duration =
      request.durationMinutes ||
      Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60));

    const searchRange = {
      start: new Date(startDate.getTime() - 24 * 60 * 60 * 1000),
      end: new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000),
    };

    // Debug logging for VAPI availability issues
    console.log(`🔍 Generating slots: ${searchRange.start.toISOString()} to ${searchRange.end.toISOString()}`);
    console.log(`📋 Office hours:`, JSON.stringify(officeHours?.schedule));
    console.log(`🌍 Timezone: ${timezone}`);

    const allSlots = officeHours?.schedule
      ? generateAvailableSlots(
          searchRange.start,
          searchRange.end,
          officeHours.schedule,
          timezone,
          duration
        )
      : [];

    console.log(`📊 Generated ${allSlots.length} total slots`);

    const availableSlots = eventsResult.events
      ? filterAvailableSlots(allSlots, eventsResult.events)
      : allSlots;

    console.log(`✅ ${availableSlots.length} slots after filtering conflicts`);

    const alternatives = findAlternativeSlots(
      startDate,
      endDate,
      availableSlots,
      request.maxSuggestions || 5
    );

    console.log(`💡 Found ${alternatives.length} alternative slots`);

    return {
      success: true,
      isAvailable: false,
      requestedSlot: {
        start: request.startDateTime,
        end: request.endDateTime,
        startFormatted: formatDateTime(startDate, timezone),
        endFormatted: formatDateTime(endDate, timezone),
        available: false,
      },
      hasConflict: true,
      conflictDetails: "Requested time slot is not available",
      availableSlots: alternatives,
    };
  } catch (error) {
    console.error("Error finding available slots:", error);
    return {
      success: false,
      isAvailable: false,
      requestedSlot: {
        start: request.startDateTime,
        end: request.endDateTime,
        startFormatted: "",
        endFormatted: "",
        available: false,
      },
      hasConflict: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown availability check error",
    };
  }
}

/**
 * Check calendar connection status
 */
export async function checkCalendarConnection(
  clientId: number
): Promise<CalendarConnectionStatus> {
  try {
    const summary =
      await FinalOptimizedCalendarOperations.checkClientCalendarConnection(
        clientId
      );

    if (!summary) {
      return {
        connected: false,
        clientId,
        error: "Unable to retrieve calendar connection status",
      };
    }

    if (summary.connected && summary.connectionDetails) {
      return {
        connected: true,
        clientId,
        email: summary.connectionDetails.userEmail,
        displayName: summary.connectionDetails.userName,
        calendarsCount: summary.connectionDetails.calendarsCount,
        lastSync: summary.connectionDetails.lastSync,
      };
    }

    return {
      connected: false,
      clientId,
      error: summary.error,
    };
  } catch (error) {
    console.error("Error checking calendar connection:", error);
    return {
      connected: false,
      clientId,
      error:
        error instanceof Error
          ? error.message
          : "Unknown connection check error",
    };
  }
}

/**
 * Get list of available calendars
 */
export async function getAvailableCalendars(clientId: number) {
  try {
    const result =
      await FinalOptimizedCalendarOperations.getCalendarsForClient(clientId);
    return result;
  } catch (error) {
    console.error("Error getting calendars:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error getting calendars",
    };
  }
}

/**
 * Get detailed availability information
 */
export async function getDetailedAvailability(
  clientId: number,
  startDate: string,
  endDate: string,
  emails?: string[]
) {
  try {
    const result =
      await FinalOptimizedCalendarOperations.getAvailabilityForClient(
        clientId,
        {
          startDate,
          endDate,
          emails,
          intervalInMinutes: 60,
        }
      );
    return result;
  } catch (error) {
    console.error("Error getting availability:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error getting availability",
    };
  }
}

