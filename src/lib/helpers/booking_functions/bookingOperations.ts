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
  isValidEmail,
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
  calculateBookingConfidence,
} from "./conflictDetectionService";
import { getCalendarConnectionByAgentId } from "./calendarConnectionService";
import { FinalOptimizedCalendarOperations } from "../calendar_functions/finalOptimizedCalendarOperations";

/**
 * Create a booking appointment
 */
export async function createBooking(
  request: BookingRequest
): Promise<BookingResponse> {
  try {
    console.log("📅 Creating booking:", request);

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

    console.log(`✅ Using calendar connection: ${connection.id} for agent ${request.agentId}`);

    // Step 2: Get agent office hours directly by agent ID
    const officeHours = await getAgentOfficeHoursByAgentId(
      request.agentId,
      request.clientId
    );

    const timezone = officeHours?.timezone || "Australia/Melbourne";

    // Step 3: Resolve contact information
    let contactEmail = request.contactEmail;
    let contactName = request.contactName || "Unknown";
    let contactFound = false;

    if (request.contactName && !request.contactEmail) {
      console.log(`🔍 Searching for contact: ${request.contactName}`);
      const contactSearch = await searchContactByName(
        request.contactName,
        request.clientId
      );

      if (contactSearch.found && contactSearch.contact) {
        contactEmail = contactSearch.contact.email;
        contactName = contactSearch.contact.name;
        contactFound = true;
        console.log(`✅ Found contact: ${contactName} (${contactEmail})`);
      } else if (contactSearch.matches && contactSearch.matches.length > 0) {
        return {
          success: false,
          error: `Multiple contacts found for "${request.contactName}". Please specify email address. Found: ${contactSearch.matches.map((m) => `${m.name} (${m.email})`).join(", ")}`,
        };
      } else {
        return {
          success: false,
          error: `Contact "${request.contactName}" not found. Please provide email address.`,
        };
      }
    }

    if (!contactEmail) {
      return {
        success: false,
        error: "Contact email is required",
      };
    }

    // Step 4: Validate booking request
    const validation = validateBookingRequest({
      subject: request.subject,
      startDateTime: request.startDateTime,
      endDateTime: request.endDateTime,
      contactEmail,
      contactName,
      officeHours: officeHours?.schedule,
      timezone,
    });

    if (!validation.isValid) {
      return {
        success: false,
        error: `Validation failed: ${validation.errors.join(", ")}`,
      };
    }

    // Log warnings if any
    if (validation.warnings.length > 0) {
      console.log(`⚠️ Warnings: ${validation.warnings.join(", ")}`);
    }

    // Step 5: Check for conflicts
    const startDate = new Date(request.startDateTime);
    const endDate = new Date(request.endDateTime);

    // Get existing events for conflict detection (use agent's calendar)
    const eventsResult =
      await FinalOptimizedCalendarOperations.getCalendarEventsForClient(
        request.clientId,
        {
          clientId: request.clientId,
          startDate: request.startDateTime,
          endDate: request.endDateTime,
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
        console.log("⚠️ Conflict detected, finding alternatives...");

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
              timezone,
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
            timezone
          ),
          availableSlots: alternatives,
        };
      }
    }

    // Step 6: Create the calendar event (use agent's calendar)
    console.log("✅ No conflicts, creating event...");

    const createResult =
      await FinalOptimizedCalendarOperations.createCalendarEventForClient(
        request.clientId,
        {
          clientId: request.clientId,
          subject: request.subject,
          startDateTime: request.startDateTime,
          endDateTime: request.endDateTime,
          attendeeEmail: contactEmail,
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

    // Calculate confidence score
    const confidence = calculateBookingConfidence({
      hasContactInDatabase: contactFound,
      isWithinOfficeHours: true,
      hasNoConflicts: true,
      isReasonableDuration: true,
      hasValidEmail: isValidEmail(contactEmail),
    });

    console.log(
      `✅ Booking created successfully (confidence: ${confidence.level})`
    );

    return {
      success: true,
      booking: {
        eventId: createResult.eventId || "",
        subject: request.subject,
        startDateTime: request.startDateTime,
        endDateTime: request.endDateTime,
        contact: contactFound
          ? { name: contactName, email: contactEmail, source: "customer" }
          : createManualContact(contactName, contactEmail, request.contactPhone),
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
    console.log("🔍 Finding available slots:", request);

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
    const startDate = new Date(request.startDateTime);
    const endDate = new Date(request.endDateTime);

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
    const eventsResult =
      await FinalOptimizedCalendarOperations.getCalendarEventsForClient(
        request.clientId,
        {
          clientId: request.clientId,
          startDate: request.startDateTime,
          endDate: request.endDateTime,
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

    const allSlots = officeHours?.schedule
      ? generateAvailableSlots(
          searchRange.start,
          searchRange.end,
          officeHours.schedule,
          timezone,
          duration
        )
      : [];

    const availableSlots = eventsResult.events
      ? filterAvailableSlots(allSlots, eventsResult.events)
      : allSlots;

    const alternatives = findAlternativeSlots(
      startDate,
      endDate,
      availableSlots,
      request.maxSuggestions || 5
    );

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

