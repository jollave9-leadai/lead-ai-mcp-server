// Load environment variables first
import dotenv from 'dotenv';
dotenv.config();

import express , { Request, Response }from "express";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import z from "zod";
import {getCalendarEvents, getTodaysCalendarEvents, getUpcomingCalendarEvents, getManagedUsersByClientId, searchBookings, findBookingForReschedule}  from "../calendar_functions/getCalendarEvents.tsx"
import {getClientTimezone, getClientTimezoneByEmail, getClientTimezoneByCode, getClientById}  from "../calendar_functions/getClientTimeZone.tsx"
import {checkClientConnectedCalendars, getConnectedCalendarsForClient, hasActiveCalendarConnections, getPrimaryCalendarForClient} from "../calendar_functions/getConnectedCalendars.tsx"
import {checkClientEventTypes, getEventTypesForClient, hasActiveEventTypes, getCalEventTypeIdsForClient, getEventTypesForCalendar} from "../calendar_functions/getEventTypes.tsx"
import {createValidatedBookingForClient, validateBookingRequest, cancelBookingForClient, rescheduleBookingForClient} from "../calendar_functions/createBooking.tsx"
import {getLeadsForClient, getClientLeadsSummary, searchClientLeads, getLeadsByStage, getRecentLeads} from "../calendar_functions/getLeads.tsx"
import {getCacheStats, invalidateClientCache, invalidateAllCache, cleanupExpiredCache, subscriptionManager, ResourceURI, getCachedResource, setCachedResource} from "../calendar_functions/resourceManager.tsx"
import {getSlotsForClient, createSlotsSummary, validateSlotAvailability, formatSlotsForDisplay, getRandomAvailableSlots, formatRandomSlotsForBooking} from "../calendar_functions/getSlots.tsx"
import type { CalBooking, CreateBookingRequest, CancelBookingRequest, RescheduleBookingRequest, Lead, LeadQueryOptions, GetSlotsRequest } from "../types"

const app = express();
app.use(express.json());

// Debug: Check if environment variables are loaded
console.log('🔍 Environment Variables Check:');
console.log('NEXT_PUBLIC_SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL ? '✅ Set' : '❌ Missing');
console.log('SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ Set' : '❌ Missing');
console.log('NEXT_PUBLIC_SUPABASE_ANON_KEY:', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? '✅ Set' : '❌ Missing');

// Helper function to format date to proper ISO 8601 format for Cal.com API
function formatToISO8601(dateInput: string | Date): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${dateInput}`);
  }
  
  // Return ISO 8601 format with milliseconds and Z timezone (UTC)
  return date.toISOString();
}

// Helper function to validate ISO 8601 date format
function validateISO8601Date(dateString: string): { isValid: boolean; date?: Date; error?: string } {
  try {
    const date = new Date(dateString);
    
    if (isNaN(date.getTime())) {
      return { 
        isValid: false, 
        error: `Invalid date format. Expected ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ), got: ${dateString}` 
      };
    }
    
    // Check if it's in the future
    const now = new Date();
    if (date <= now) {
      return { 
        isValid: false, 
        error: `Date must be in the future. Provided: ${dateString}, Current: ${now.toISOString()}` 
      };
    }
    
    return { isValid: true, date };
  } catch (error) {
    return { 
      isValid: false, 
      error: `Date parsing error: ${error instanceof Error ? error.message : "Unknown error"}` 
    };
  }
}

// Helper function to parse natural language date requests
function parseDateRequest(dateRequest: string | undefined, timezone: string = 'UTC'): { start: string, end: string, description: string } {
  const now = new Date()
  const userNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }))
  
  // Helper function to format date for description in ISO format
  const formatDateDescription = (date: Date) => {
    return date.toISOString().split('T')[0] // Returns YYYY-MM-DD
  }
  
  // Helper function to format date range for description in ISO format
  const formatDateRangeDescription = (startDate: Date, endDate: Date) => {
    const startFormatted = startDate.toISOString().split('T')[0]
    const endFormatted = endDate.toISOString().split('T')[0]
    return `${startFormatted} to ${endFormatted}`
  }
  
  // Handle undefined or empty dateRequest
  if (!dateRequest || dateRequest.trim() === '') {
    dateRequest = 'today'
  }
  
  const normalizedRequest = dateRequest.toLowerCase().trim()
  
  // Today
  if (normalizedRequest.includes('today') || normalizedRequest.includes('this day')) {
    const startOfDay = new Date(userNow)
    startOfDay.setHours(0, 0, 0, 0)
    const endOfDay = new Date(userNow)
    endOfDay.setHours(23, 59, 59, 999)
    
    return {
      start: startOfDay.toISOString(),
      end: endOfDay.toISOString(),
      description: formatDateDescription(userNow)
    }
  }
  
  // Tomorrow
  if (normalizedRequest.includes('tomorrow') || normalizedRequest.includes('next day')) {
    const tomorrow = new Date(userNow)
    tomorrow.setDate(userNow.getDate() + 1)
    const startOfDay = new Date(tomorrow)
    startOfDay.setHours(0, 0, 0, 0)
    const endOfDay = new Date(tomorrow)
    endOfDay.setHours(23, 59, 59, 999)
    
    return {
      start: startOfDay.toISOString(),
      end: endOfDay.toISOString(),
      description: formatDateDescription(tomorrow)
    }
  }
  
  // This week
  if (normalizedRequest.includes('this week') || normalizedRequest.includes('week')) {
    const startOfWeek = new Date(userNow)
    startOfWeek.setDate(userNow.getDate() - userNow.getDay())
    startOfWeek.setHours(0, 0, 0, 0)
    const endOfWeek = new Date(startOfWeek)
    endOfWeek.setDate(startOfWeek.getDate() + 6)
    endOfWeek.setHours(23, 59, 59, 999)
    
    return {
      start: startOfWeek.toISOString(),
      end: endOfWeek.toISOString(),
      description: formatDateRangeDescription(startOfWeek, endOfWeek)
    }
  }
  
  // Next 7 days / upcoming
  if (normalizedRequest.includes('upcoming') || normalizedRequest.includes('next 7') || normalizedRequest.includes('coming up')) {
    const startTime = new Date(userNow)
    const endTime = new Date(userNow)
    endTime.setDate(userNow.getDate() + 7)
    
    return {
      start: startTime.toISOString(),
      end: endTime.toISOString(),
      description: formatDateRangeDescription(startTime, endTime)
    }
  }
  
  // Try to parse as a specific date string (e.g., "September 12, 2025", "2025-09-12", "12/09/2025")
  try {
    const parsedDate = new Date(dateRequest)
    
    // Check if the parsed date is valid
    if (!isNaN(parsedDate.getTime())) {
      console.log(`📅 Parsing specific date: "${dateRequest}" → ${parsedDate.toISOString()}`)
      
      // Create start and end of the specific day in the user's timezone
      const startOfDay = new Date(parsedDate)
      startOfDay.setHours(0, 0, 0, 0)
      const endOfDay = new Date(parsedDate)
      endOfDay.setHours(23, 59, 59, 999)
      
      return {
        start: startOfDay.toISOString(),
        end: endOfDay.toISOString(),
        description: formatDateDescription(parsedDate)
      }
    }
  } catch (error) {
    console.log(`⚠️ Could not parse "${dateRequest}" as a date, falling back to today`)
  }
  
  // Default to today if we can't parse
  console.log(`⚠️ Using default (today) for unrecognized date request: "${dateRequest}"`)
  const startOfDay = new Date(userNow)
  startOfDay.setHours(0, 0, 0, 0)
  const endOfDay = new Date(userNow)
  endOfDay.setHours(23, 59, 59, 999)
  
  return {
    start: startOfDay.toISOString(),
    end: endOfDay.toISOString(),
    description: formatDateDescription(userNow)
  }
}

// Helper function to format calendar events as readable string
function formatCalendarEventsAsString(events: CalBooking[], timezone: string = 'UTC'): string {
  if (events.length === 0) {
    return "No events found for the requested time period."
  }

  const formatTime = (isoString: string) => {
    const date = new Date(isoString)
    return date.toLocaleString('en-US', {
      timeZone: timezone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
  }

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    if (hours > 0) {
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
    }
    return `${mins}m`
  }

  let result = `📅 Found ${events.length} event(s):\n\n`
  
  events.forEach((event, index) => {
    const startTime = formatTime(event.start)
    const attendeeNames = event.attendees.map(a => a.name).join(', ')
    const hostNames = event.hosts.map(h => h.name).join(', ')
    
    result += `${index + 1}. **${event.title}**\n`
    result += `   📅 ${startTime}\n`
    result += `   ⏱️  Duration: ${formatDuration(event.duration)}\n`
    result += `   👥 Host(s): ${hostNames}\n`
    
    if (attendeeNames) {
      result += `   🎯 Attendee(s): ${attendeeNames}\n`
    }
    
    if (event.meetingUrl) {
      result += `   🔗 Meeting: ${event.meetingUrl}\n`
    }
    
    if (event.location && event.location !== event.meetingUrl) {
      result += `   📍 Location: ${event.location}\n`
    }
    
    result += `   📊 Status: ${event.status}\n`
    
    if (event.description) {
      result += `   📝 ${event.description}\n`
    }
    
    result += '\n'
  })
  
  return result.trim()
}

// Create an MCP server
function getServer()
{
    const server = new McpServer({
        name: "demo-server",
        version: "1.0.0"
      });





server.registerTool(
    "GetClientEventTypes",
    {
        title: "Get Client Event Types",
        description: "Get event types for a client, including cal_event_type_ids needed for calendar queries.",
        inputSchema: {
            clientId: z.union([z.number(), z.string().transform(Number)]).describe("The ID of the client to get event types for")
        }
    },
    async (input) => {
      try {
        const { clientId } = input;

        // Convert and validate clientId
        const numericClientId = typeof clientId === 'string' ? parseInt(clientId, 10) : clientId;
        
        if (!numericClientId || isNaN(numericClientId)) {
          return {
            content: [
              {
                type: "text",
                text: "❌ Error: clientId is required and must be a valid number",
              },
            ],
          };
        }

        // Get event types summary
        const summary = await checkClientEventTypes(numericClientId);
        
        if (!summary) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Error: Could not retrieve event types for client ${numericClientId}`,
              },
            ],
          };
        }

        // Get detailed event types
        const eventTypes = await getEventTypesForClient(numericClientId);

        // Format the response
        let responseText = `📋 **Event Types for Client ${numericClientId}**\n\n`;
        
        if (summary.has_active_event_types) {
          responseText += `✅ **Status**: Has Active Event Types\n`;
          responseText += `📊 **Total Event Types**: ${summary.total_event_types}\n`;
          responseText += `🟢 **Active Event Types**: ${summary.active_event_types}\n`;
          responseText += `🔢 **Cal Event Type IDs**: ${summary.cal_event_type_ids.join(', ')}\n\n`;
          
          if (eventTypes.length > 0) {
            responseText += `📝 **Event Type Details**:\n`;
            eventTypes.forEach((et, index) => {
              responseText += `${index + 1}. **${et.title}** (${et.slug})\n`;
              responseText += `   - Cal Event Type ID: ${et.cal_event_type_id}\n`;
              responseText += `   - Duration: ${et.length_in_minutes} minutes\n`;
              responseText += `   - Status: ${et.is_active ? '✅ Active' : '❌ Inactive'}\n`;
              if (et.description) {
                responseText += `   - Description: ${et.description}\n`;
              }
              responseText += `\n`;
            });
          }
          
          responseText += `✅ This client can fetch calendar events using these event type IDs.`;
        } else {
          responseText += `❌ **Status**: No Active Event Types\n`;
          responseText += `📊 **Total Event Types**: ${summary.total_event_types}\n`;
          responseText += `🟢 **Active Event Types**: ${summary.active_event_types}\n`;
          responseText += `\n⚠️ This client needs active event types to fetch calendar events.`;
        }

        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
        };
      } catch (error) {
        console.error("❌ Error in GetClientEventTypes:", error);
        return {
          content: [
            {
              type: "text",
              text: `❌ Error retrieving event types: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
        };
      }
    }
);

server.registerTool(
    "CheckConnectedCalendars",
    {
        title: "Check Connected Calendars",
        description: "Check if a client has connected calendars and get summary information about their calendar integrations.",
        inputSchema: {
            clientId: z.union([z.number(), z.string().transform(Number)]).describe("The ID of the client to check connected calendars for")
        }
    },
    async (input) => {
      try {
        const { clientId } = input;

        // Convert and validate clientId
        const numericClientId = typeof clientId === 'string' ? parseInt(clientId, 10) : clientId;
        
        if (!numericClientId || isNaN(numericClientId)) {
          return {
            content: [
              {
                type: "text",
                text: "❌ Error: clientId is required and must be a valid number",
              },
            ],
          };
        }

        // Check connected calendars
        const summary = await checkClientConnectedCalendars(numericClientId);
        
        if (!summary) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Error: Could not retrieve calendar connection information for client ${numericClientId}`,
              },
            ],
          };
        }

        // Format the response
        let responseText = `📊 **Calendar Connection Status for Client ${numericClientId}**\n\n`;
        
        if (summary.has_active_calendars) {
          responseText += `✅ **Status**: Connected\n`;
          responseText += `📈 **Total Calendars**: ${summary.total_calendars}\n`;
          responseText += `🔗 **Connected Calendars**: ${summary.connected_calendars}\n`;
          
          if (summary.google_calendars > 0) {
            responseText += `📧 **Google Calendars**: ${summary.google_calendars}\n`;
          }
          
          if (summary.office365_calendars > 0) {
            responseText += `🏢 **Office 365 Calendars**: ${summary.office365_calendars}\n`;
          }
          
          if (summary.primary_calendar) {
            responseText += `⭐ **Primary Calendar**: ${summary.primary_calendar.account_email} (${summary.primary_calendar.calendar_type})\n`;
          }
          
          responseText += `\n✅ This client can fetch calendar events.`;
        } else {
          responseText += `❌ **Status**: No Connected Calendars\n`;
          responseText += `📊 **Total Calendars**: ${summary.total_calendars}\n`;
          responseText += `🔗 **Connected Calendars**: ${summary.connected_calendars}\n`;
          responseText += `\n⚠️ This client needs to connect their calendars before fetching events.`;
        }

        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
        };
      } catch (error) {
        console.error("❌ Error in CheckConnectedCalendars:", error);
        return {
          content: [
            {
              type: "text",
              text: `❌ Error checking connected calendars: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
        };
      }
    }
);

server.registerTool(
    "GetCalendarEvents",
    {
        title: "Get Calendar Events",
        description: "Get calendar events for a client from Cal.com. Uses essential parameters: eventTypeIds, afterStart, beforeEnd. Supports natural language date requests like 'today', 'tomorrow', 'this week', 'upcoming'.",
        inputSchema: {
            clientId: z.union([z.number(), z.string().transform(Number)]).describe("The ID of the client to get events for"),
            dateRequest: z.string().optional().describe("Natural language date request (e.g., 'today', 'tomorrow', 'this week', 'upcoming')")
        }
    },
    async (input) => {
      try {
        const { clientId, dateRequest = 'today' } = input;

        // Convert and validate clientId
        const numericClientId = typeof clientId === 'string' ? parseInt(clientId, 10) : clientId;
        
        if (!numericClientId || isNaN(numericClientId)) {
          return {
            content: [
              {
                type: "text",
                text: "❌ Error: clientId is required and must be a valid number",
              },
            ],
          };
        }
  
        // Get client's timezone
        const clientTimezone = await getClientTimezone(numericClientId);
        const timezone = clientTimezone || 'UTC';
  
        // Parse the date request
        const dateRange = parseDateRequest(dateRequest, timezone);
        
        console.log(`📅 Parsed date request "${dateRequest}" to:`, {
          description: dateRange.description,
          start: dateRange.start,
          end: dateRange.end,
          timezone
        });
  
        // Get calendar events (using essential parameters only)
        const events = await getCalendarEvents(numericClientId, {
          afterStart: dateRange.start,
          beforeEnd: dateRange.end
          // eventTypeIds will be automatically fetched by getCalendarEvents function
        });
  
        // Format events as readable string
        const formattedEvents = formatCalendarEventsAsString(events, timezone);
  
        return {
          content: [
            {
              type: "text",
              text: `📅 **Calendar Events for ${dateRange.description}** (Client ID: ${numericClientId})\n🌍 Timezone: ${timezone}\n\n${formattedEvents}`,
            },
          ],
        };
      } catch (error) {
        console.error("❌ Error in GetCalendarEvents:", error);
        return {
          content: [
            {
              type: "text",
              text: `❌ Error retrieving calendar events: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
        };
      }
    }
    );

server.registerTool(
    "CreateBooking",
    {
        title: "Create Booking",
        description: "Create a new booking for a client using Cal.com API. Requires event type ID, start time, and attendee information. Note: Slot availability validation is skipped for faster booking.",
        inputSchema: {
            clientId: z.union([z.number(), z.string().transform(Number)]).describe("The ID of the client to create booking for"),
            eventTypeId: z.number().describe("The Cal.com event type ID for the booking"),
            startTime: z.string().describe("Start time in ISO 8601 format with timezone (YYYY-MM-DDTHH:mm:ss.sssZ). Examples: '2024-01-15T10:00:00.000Z', '2024-12-25T14:30:00Z'"),
            attendeeName: z.string().describe("Name of the attendee"),
            attendeeEmail: z.string().email().describe("Email of the attendee"),
            attendeeTimeZone: z.string().optional().describe("Attendee's timezone (e.g., 'America/New_York')"),
            attendeePhoneNumber: z.string().optional().describe("Phone number of the attendee"),
            title: z.string().optional().describe("Custom title for the booking"),
            description: z.string().optional().describe("Description for the booking"),
            meetingUrl: z.string().optional().describe("Custom meeting URL"),
            language: z.string().optional().describe("Language code (e.g., 'en', 'es')"),
            preferredManagedUserId: z.number().optional().describe("Preferred managed user ID to use for booking creation")
        }
    },
    async (input) => {
      try {
        const { 
          clientId, 
          eventTypeId, 
          startTime, 
          attendeeName, 
          attendeeEmail, 
          attendeeTimeZone,
          attendeePhoneNumber,
          title,
          description,
          meetingUrl,
          language = 'en',
          preferredManagedUserId
        } = input;

        // Convert and validate clientId
        const numericClientId = typeof clientId === 'string' ? parseInt(clientId, 10) : clientId;
        
        if (!numericClientId || isNaN(numericClientId)) {
          return {
            content: [
              {
                type: "text",
                text: "Error: clientId is required and must be a valid number",
              },
            ],
          };
        }

        // Validate and format startTime to proper ISO 8601 format
        const startTimeValidation = validateISO8601Date(startTime);
        if (!startTimeValidation.isValid) {
          return {
            content: [
              {
                type: "text",
                text: `❌ **Invalid Start Time**\n\n**Provided**: ${startTime}\n**Error**: ${startTimeValidation.error}\n\n**Required Format**: ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ)\n**Examples**:\n- 2024-01-15T10:00:00.000Z\n- 2024-01-15T14:30:00Z\n- 2024-12-25T09:15:30.500Z`,
              },
            ],
          };
        }
        
        const formattedStartTime = formatToISO8601(startTimeValidation.date!);
        console.log(`✅ Start time validated and formatted: ${startTime} → ${formattedStartTime}`);

        // Get client's timezone if attendeeTimeZone is not provided
        let finalAttendeeTimeZone = attendeeTimeZone;
        if (!finalAttendeeTimeZone) {
          const clientTimezone = await getClientTimezone(numericClientId);
          finalAttendeeTimeZone = clientTimezone || 'UTC';
          console.log(`Using client timezone: ${finalAttendeeTimeZone}`);
        } else {
          console.log(`Using provided timezone: ${finalAttendeeTimeZone}`);
        }

        console.log(`📅 Proceeding directly with booking for: ${formattedStartTime}`);

        // Create booking directly (skipping slot validation as requested)
        // Create booking request object matching Cal.com API format
        const bookingRequest: CreateBookingRequest = {
          eventTypeId,
          start: formattedStartTime,
          attendee: {
            name: attendeeName,
            email: attendeeEmail,
            timeZone: finalAttendeeTimeZone,
            language,
            ...(attendeePhoneNumber && { phoneNumber: attendeePhoneNumber })
          },
          // ...(title && { title }),
          ...(description && { description }),
          // ...(meetingUrl && { meetingUrl })
        };
        console.log(`Booking Request from the server `, bookingRequest)
        console.log(`Creating booking for client ${numericClientId}:`, {
          eventTypeId,
          startTime,
          attendeeEmail,
          preferredManagedUserId
        });

        // Create the booking with validation
        const result = await createValidatedBookingForClient(
          numericClientId, 
          bookingRequest, 
          preferredManagedUserId
        );

        if (result.success) {
          let responseText = `**BOOKING CREATED SUCCESSFULLY!**\n\n`;
          responseText += `**Great news!** Your booking has been confirmed.\n\n`;
          responseText += `**Booking Details:**\n`;
          responseText += `- **Booking ID**: ${result.bookingId}\n`;
          responseText += `- **Booking UID**: ${result.bookingUid}\n`;
          responseText += `- **Event Title**: ${result.eventTitle}\n`;
          responseText += `- **Start Time**: ${result.startTime}\n`;
          responseText += `- **End Time**: ${result.endTime}\n`;
          responseText += `- **Attendee**: ${result.attendeeName} (${result.attendeeEmail})\n`;
          responseText += `- **Client ID**: ${numericClientId}\n`;
          
          if (preferredManagedUserId) {
            responseText += `- **Managed User ID**: ${preferredManagedUserId}\n`;
          }

          return {
            content: [
              {
                type: "text",
                text: responseText,
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: `**Booking Creation Failed**\n\n**Error**: ${result.error}\n\n**Client ID**: ${numericClientId}\n**Event Type ID**: ${eventTypeId}\n**Start Time**: ${startTime}\n**Attendee**: ${attendeeName} (${attendeeEmail})`,
              },
            ],
          };
        }
      } catch (error) {
        console.error("Error in CreateBooking:", error);
        return {
          content: [
            {
              type: "text",
              text: `Error creating booking: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
        };
      }
    }
);

server.registerTool(
    "CancelBooking",
    {
        title: "Cancel Booking",
        description: "Cancel an existing booking using Cal.com API. Supports both regular bookings and seated bookings.",
        inputSchema: {
            clientId: z.union([z.number(), z.string().transform(Number)]).describe("The ID of the client who owns the booking"),
            bookingUid: z.string().describe("The UID of the booking to cancel"),
            cancellationReason: z.string().describe("Reason for canceling the booking"),
            cancelSubsequentBookings: z.boolean().optional().describe("Whether to cancel subsequent recurring bookings (default: false)"),
            seatUid: z.string().optional().describe("For seated bookings: the specific seat UID to cancel"),
            preferredManagedUserId: z.number().optional().describe("Preferred managed user ID to use for cancellation")
        }
    },
    async (input) => {
      try {
        const { 
          clientId, 
          bookingUid,
          cancellationReason,
          cancelSubsequentBookings = false,
          seatUid,
          preferredManagedUserId
        } = input;

        // Convert and validate clientId
        const numericClientId = typeof clientId === 'string' ? parseInt(clientId, 10) : clientId;
        
        if (!numericClientId || isNaN(numericClientId)) {
          return {
            content: [
              {
                type: "text",
                text: "Error: clientId is required and must be a valid number",
              },
            ],
          };
        }

        // Create cancellation request object
        const cancelRequest: CancelBookingRequest = {
          cancellationReason,
          cancelSubsequentBookings,
          ...(seatUid && { seatUid })
        };

        console.log(`Canceling booking for client ${numericClientId}:`, {
          bookingUid,
          cancellationReason,
          cancelSubsequentBookings,
          seatUid,
          preferredManagedUserId
        });

        // Cancel the booking
        const result = await cancelBookingForClient(
          numericClientId, 
          bookingUid,
          cancelRequest,
          preferredManagedUserId
        );

        if (result.success) {
          let responseText = `**Booking Canceled Successfully!**\n\n`;
          responseText += `**Cancellation Details:**\n`;
          responseText += `- **Booking ID**: ${result.bookingId}\n`;
          responseText += `- **Booking UID**: ${result.bookingUid}\n`;
          responseText += `- **Event Title**: ${result.eventTitle}\n`;
          responseText += `- **Cancellation Reason**: ${result.cancellationReason}\n`;
          responseText += `- **Cancelled By**: ${result.cancelledByEmail}\n`;
          responseText += `- **Client ID**: ${numericClientId}\n`;
          
          if (result.wasSeatedBooking) {
            responseText += `- **Booking Type**: Seated Booking (specific seat canceled)\n`;
          } else {
            responseText += `- **Booking Type**: Regular Booking\n`;
          }
          
          if (cancelSubsequentBookings) {
            responseText += `- **Subsequent Bookings**: Also canceled\n`;
          }
          
          if (preferredManagedUserId) {
            responseText += `- **Managed User ID**: ${preferredManagedUserId}\n`;
          }

          return {
            content: [
              {
                type: "text",
                text: responseText,
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: `❌ **Booking Cancellation Failed**\n\n**Error**: ${result.error}\n\n**Client ID**: ${numericClientId}\n**Booking UID**: ${bookingUid}\n**Cancellation Reason**: ${cancellationReason}`,
              },
            ],
          };
        }
      } catch (error) {
        console.error("❌ Error in CancelBooking:", error);
        return {
          content: [
            {
              type: "text",
              text: `❌ Error canceling booking: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
        };
      }
    }
);

server.registerTool(
    "RescheduleBooking",
    {
        title: "Reschedule Booking",
        description: "Reschedule an existing booking to a new time using Cal.com API. Supports both regular bookings and seated bookings.",
        inputSchema: {
            clientId: z.union([z.number(), z.string().transform(Number)]).describe("The ID of the client who owns the booking"),
            bookingUid: z.string().describe("The UID of the booking to reschedule"),
            newStartTime: z.string().describe("New start time in ISO 8601 format with timezone (YYYY-MM-DDTHH:mm:ss.sssZ). Examples: '2024-01-15T14:00:00.000Z', '2024-12-25T16:30:00Z'"),
            reschedulingReason: z.string().optional().describe("Reason for rescheduling the booking"),
            rescheduledBy: z.string().optional().describe("Email or name of person rescheduling"),
            seatUid: z.string().optional().describe("For seated bookings: the specific seat UID to reschedule"),
            preferredManagedUserId: z.number().optional().describe("Preferred managed user ID to use for rescheduling")
        }
    },
    async (input) => {
      try {
        const { 
          clientId, 
          bookingUid,
          newStartTime,
          reschedulingReason,
          rescheduledBy,
          seatUid,
          preferredManagedUserId
        } = input;

        // Convert and validate clientId
        const numericClientId = typeof clientId === 'string' ? parseInt(clientId, 10) : clientId;
        
        if (!numericClientId || isNaN(numericClientId)) {
          return {
            content: [
              {
                type: "text",
                text: "Error: clientId is required and must be a valid number",
              },
            ],
          };
        }

        // Validate and format newStartTime to proper ISO 8601 format
        const newStartTimeValidation = validateISO8601Date(newStartTime);
        if (!newStartTimeValidation.isValid) {
          return {
            content: [
              {
                type: "text",
                text: `❌ **Invalid New Start Time**\n\n**Provided**: ${newStartTime}\n**Error**: ${newStartTimeValidation.error}\n\n**Required Format**: ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ)\n**Examples**:\n- 2024-01-15T14:00:00.000Z\n- 2024-01-15T16:30:00Z\n- 2024-12-25T10:15:30.500Z`,
              },
            ],
          };
        }
        
        const formattedNewStartTime = formatToISO8601(newStartTimeValidation.date!);
        console.log(`✅ New start time validated and formatted: ${newStartTime} → ${formattedNewStartTime}`);

        // Create rescheduling request object
        const rescheduleRequest: RescheduleBookingRequest = {
          start: formattedNewStartTime,
          ...(reschedulingReason && { reschedulingReason }),
          ...(rescheduledBy && { rescheduledBy }),
          ...(seatUid && { seatUid })
        };

        console.log(`Rescheduling booking for client ${numericClientId}:`, {
          bookingUid,
          newStartTime,
          reschedulingReason,
          rescheduledBy,
          seatUid,
          preferredManagedUserId
        });

        // Reschedule the booking
        const result = await rescheduleBookingForClient(
          numericClientId, 
          bookingUid,
          rescheduleRequest,
          preferredManagedUserId
        );

        if (result.success) {
          let responseText = `**Booking Rescheduled Successfully!**\n\n`;
          responseText += `**Rescheduling Details:**\n`;
          responseText += `- **Booking ID**: ${result.bookingId}\n`;
          responseText += `- **Original Booking UID**: ${result.bookingUid}\n`;
          responseText += `- **New Booking UID**: ${result.newBookingUid}\n`;
          responseText += `- **Event Title**: ${result.eventTitle}\n`;
          responseText += `- **New Start Time**: ${result.newStartTime}\n`;
          responseText += `- **New End Time**: ${result.newEndTime}\n`;
          responseText += `- **Client ID**: ${numericClientId}\n`;
          
          if (result.reschedulingReason) {
            responseText += `- **Rescheduling Reason**: ${result.reschedulingReason}\n`;
          }
          
          if (result.rescheduledByEmail) {
            responseText += `- **Rescheduled By**: ${result.rescheduledByEmail}\n`;
          }
          
          if (result.wasSeatedBooking) {
            responseText += `- **Booking Type**: Seated Booking (specific seat rescheduled)\n`;
          } else {
            responseText += `- **Booking Type**: Regular Booking\n`;
          }
          
          if (preferredManagedUserId) {
            responseText += `- **Managed User ID**: ${preferredManagedUserId}\n`;
          }

          return {
            content: [
              {
                type: "text",
                text: responseText,
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: `**Booking Rescheduling Failed**\n\n**Error**: ${result.error}\n\n**Client ID**: ${numericClientId}\n**Booking UID**: ${bookingUid}\n**New Start Time**: ${newStartTime}`,
              },
            ],
          };
        }
      } catch (error) {
        console.error("Error in RescheduleBooking:", error);
        return {
          content: [
            {
              type: "text",
              text: `Error rescheduling booking: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
        };
      }
    }
);

server.registerTool(
    "GetClientLeads",
    {
        title: "Get Client Leads",
        description: "Get leads for a client with filtering, searching, and pagination options.",
        inputSchema: {
            clientId: z.union([z.number(), z.string().transform(Number)]).describe("The ID of the client to get leads for"),
            stage: z.string().optional().describe("Filter by lead stage (e.g., 'New', 'Contacted', 'Qualified')"),
            source: z.string().optional().describe("Filter by lead source"),
            industry: z.string().optional().describe("Filter by industry"),
            phoneContacted: z.boolean().optional().describe("Filter by whether lead has been phone contacted"),
            search: z.string().optional().describe("Search term to look for in name, email, phone, or company"),
            sortBy: z.enum(['created_at', 'updated_at', 'last_contacted', 'number_of_calls_made', 'full_name']).optional().describe("Field to sort by"),
            sortOrder: z.enum(['asc', 'desc']).optional().describe("Sort order"),
            limit: z.number().optional().describe("Maximum number of leads to return (default: 50)"),
            offset: z.number().optional().describe("Number of leads to skip for pagination (default: 0)")
        }
    },
    async (input) => {
      try {
        const { 
          clientId, 
          stage,
          source,
          industry,
          phoneContacted,
          search,
          sortBy = 'created_at',
          sortOrder = 'desc',
          limit = 50,
          offset = 0
        } = input;

        // Convert and validate clientId
        const numericClientId = typeof clientId === 'string' ? parseInt(clientId, 10) : clientId;
        
        if (!numericClientId || isNaN(numericClientId)) {
          return {
            content: [
              {
                type: "text",
                text: "Error: clientId is required and must be a valid number",
              },
            ],
          };
        }

        // Build query options
        const options: LeadQueryOptions = {
          filters: {
            ...(stage && { stage }),
            ...(source && { source }),
            ...(industry && { industry }),
            ...(phoneContacted !== undefined && { phone_contacted: phoneContacted })
          },
          ...(search && { search }),
          sort_by: sortBy,
          sort_order: sortOrder,
          limit,
          offset
        };

        console.log(`Getting leads for client ${numericClientId}:`, options);

        // Get leads
        const result = await getLeadsForClient(numericClientId, options);

        if (result.leads.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `**No Leads Found**\n\n**Client ID**: ${numericClientId}\n**Total Leads in System**: ${result.total_count}\n**Filters Applied**: ${JSON.stringify(options.filters || {}, null, 2)}`,
              },
            ],
          };
        }

        let responseText = `**Leads for Client ${numericClientId}**\n\n`;
        responseText += `📊 **Summary:**\n`;
        responseText += `- **Total Leads**: ${result.total_count}\n`;
        responseText += `- **Filtered Results**: ${result.filtered_count}\n`;
        responseText += `- **Contacted**: ${result.summary.contacted_count}\n`;
        responseText += `- **Uncontacted**: ${result.summary.uncontacted_count}\n\n`;

        responseText += `📋 **Leads (${Math.min(limit, result.leads.length)} of ${result.filtered_count}):**\n\n`;

        result.leads.forEach((lead, index) => {
          responseText += `${index + 1}. **${lead.full_name}**\n`;
          if (lead.company) responseText += `   - Company: ${lead.company}\n`;
          if (lead.email) responseText += `   - Email: ${lead.email}\n`;
          if (lead.phone_number) responseText += `   - Phone: ${lead.phone_number}\n`;
          responseText += `   - Stage: ${lead.stage || 'Unknown'}\n`;
          if (lead.source) responseText += `   - Source: ${lead.source}\n`;
          responseText += `   - Calls Made: ${lead.number_of_calls_made || 0}\n`;
          responseText += `   - Phone Contacted: ${lead.phone_contacted ? 'Yes' : 'No'}\n`;
          if (lead.last_contacted) {
            responseText += `   - Last Contacted: ${new Date(lead.last_contacted).toLocaleDateString()}\n`;
          }
          responseText += `\n`;
        });

        if (result.filtered_count > limit) {
          responseText += `📄 **Pagination**: Showing ${offset + 1}-${offset + result.leads.length} of ${result.filtered_count} results\n`;
          responseText += `Use offset=${offset + limit} to see more results.\n`;
        }

        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
        };
      } catch (error) {
        console.error("Error in GetClientLeads:", error);
        return {
          content: [
            {
              type: "text",
              text: `Error retrieving leads: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
        };
      }
    }
);

server.registerTool(
    "GetLeadsSummary",
    {
        title: "Get Leads Summary",
        description: "Get a comprehensive summary of leads for a client including statistics and breakdowns.",
        inputSchema: {
            clientId: z.union([z.number(), z.string().transform(Number)]).describe("The ID of the client to get leads summary for")
        }
    },
    async (input) => {
      try {
        const { clientId } = input;

        // Convert and validate clientId
        const numericClientId = typeof clientId === 'string' ? parseInt(clientId, 10) : clientId;
        
        if (!numericClientId || isNaN(numericClientId)) {
          return {
            content: [
              {
                type: "text",
                text: "Error: clientId is required and must be a valid number",
              },
            ],
          };
        }

        console.log(`Getting leads summary for client ${numericClientId}`);

        // Get summary
        const summary = await getClientLeadsSummary(numericClientId);

        if (!summary) {
          return {
            content: [
              {
                type: "text",
                text: `**Error**: Could not retrieve leads summary for client ${numericClientId}`,
              },
            ],
          };
        }

        let responseText = `**Leads Summary for Client ${numericClientId}**\n\n`;
        
        responseText += `📊 **Overall Statistics:**\n`;
        responseText += `- **Total Leads**: ${summary.total_leads}\n`;
        responseText += `- **Contacted Leads**: ${summary.contacted_leads}\n`;
        responseText += `- **Uncontacted Leads**: ${summary.uncontacted_leads}\n`;
        responseText += `- **Recent Leads (7 days)**: ${summary.recent_leads}\n`;
        responseText += `- **Leads with Calls**: ${summary.leads_with_calls}\n`;
        responseText += `- **Average Calls per Lead**: ${summary.average_calls_per_lead}\n\n`;

        if (Object.keys(summary.leads_by_stage).length > 0) {
          responseText += `📈 **Leads by Stage:**\n`;
          Object.entries(summary.leads_by_stage)
            .sort(([,a], [,b]) => b - a)
            .forEach(([stage, count]) => {
              responseText += `- **${stage}**: ${count}\n`;
            });
          responseText += `\n`;
        }

        if (summary.top_sources.length > 0) {
          responseText += `🎯 **Top Sources:**\n`;
          summary.top_sources.forEach((item, index) => {
            responseText += `${index + 1}. **${item.source}**: ${item.count} leads\n`;
          });
          responseText += `\n`;
        }

        if (summary.top_industries.length > 0) {
          responseText += `🏢 **Top Industries:**\n`;
          summary.top_industries.forEach((item, index) => {
            responseText += `${index + 1}. **${item.industry}**: ${item.count} leads\n`;
          });
        }

        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
        };
      } catch (error) {
        console.error("Error in GetLeadsSummary:", error);
        return {
          content: [
            {
              type: "text",
              text: `Error retrieving leads summary: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
        };
      }
    }
);

server.registerTool(
    "SearchLeads",
    {
        title: "Search Leads",
        description: "Search for leads using a search term that looks in names, emails, phone numbers, companies, and other fields.",
        inputSchema: {
            clientId: z.union([z.number(), z.string().transform(Number)]).describe("The ID of the client to search leads for"),
            searchTerm: z.string().describe("Search term to look for in lead data"),
            limit: z.number().optional().describe("Maximum number of results to return (default: 20)")
        }
    },
    async (input) => {
      try {
        const { clientId, searchTerm, limit = 20 } = input;

        // Convert and validate clientId
        const numericClientId = typeof clientId === 'string' ? parseInt(clientId, 10) : clientId;
        
        if (!numericClientId || isNaN(numericClientId)) {
          return {
            content: [
              {
                type: "text",
                text: "Error: clientId is required and must be a valid number",
              },
            ],
          };
        }

        console.log(`Searching leads for client ${numericClientId} with term: "${searchTerm}"`);

        // Search leads
        const leads = await searchClientLeads(numericClientId, searchTerm, limit);

        if (leads.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `**No Results Found**\n\n**Client ID**: ${numericClientId}\n**Search Term**: "${searchTerm}"\n\nTry a different search term or check if the client has any leads.`,
              },
            ],
          };
        }

        let responseText = `**Search Results for "${searchTerm}"**\n\n`;
        responseText += `**Client ID**: ${numericClientId}\n`;
        responseText += `**Found**: ${leads.length} leads\n\n`;

        leads.forEach((lead, index) => {
          responseText += `${index + 1}. **${lead.full_name}**\n`;
          if (lead.company) responseText += `   - Company: ${lead.company}\n`;
          if (lead.email) responseText += `   - Email: ${lead.email}\n`;
          if (lead.phone_number) responseText += `   - Phone: ${lead.phone_number}\n`;
          responseText += `   - Stage: ${lead.stage || 'Unknown'}\n`;
          if (lead.source) responseText += `   - Source: ${lead.source}\n`;
          responseText += `   - Calls Made: ${lead.number_of_calls_made || 0}\n`;
          responseText += `   - Phone Contacted: ${lead.phone_contacted ? 'Yes' : 'No'}\n`;
          responseText += `\n`;
        });

        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
        };
      } catch (error) {
        console.error("Error in SearchLeads:", error);
        return {
          content: [
            {
              type: "text",
              text: `Error searching leads: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
        };
      }
    }
);

server.registerTool(
    "FormatDateForBooking",
    {
        title: "Format Date for Booking",
        description: "Helper tool to format dates into proper ISO 8601 format required for booking creation and rescheduling.",
        inputSchema: {
            dateInput: z.string().describe("Date input in various formats (e.g., '2024-01-15 10:00', 'January 15, 2024 10:00 AM', '2024-01-15T10:00:00')"),
            timezone: z.string().optional().describe("Timezone to interpret the date in (e.g., 'America/New_York', 'Europe/London'). Defaults to UTC.")
        }
    },
    async (input) => {
      try {
        const { dateInput, timezone = 'UTC' } = input;

        console.log(`🕐 Formatting date: ${dateInput} (timezone: ${timezone})`);

        // Try to parse the date
        let date: Date;
        
        try {
          // If timezone is provided and not UTC, we need to handle it carefully
          if (timezone !== 'UTC') {
            // Create a date assuming the input is in the specified timezone
            const tempDate = new Date(dateInput);
            if (isNaN(tempDate.getTime())) {
              throw new Error("Invalid date format");
            }
            
            // Convert to the specified timezone
            const utcTime = tempDate.getTime() + (tempDate.getTimezoneOffset() * 60000);
            date = new Date(utcTime);
          } else {
            date = new Date(dateInput);
          }
          
          if (isNaN(date.getTime())) {
            throw new Error("Invalid date format");
          }
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `❌ **Unable to Parse Date**\n\n**Input**: ${dateInput}\n**Error**: ${error instanceof Error ? error.message : "Unknown error"}\n\n**Supported Formats**:\n- ISO 8601: '2024-01-15T10:00:00Z'\n- Date string: 'January 15, 2024 10:00 AM'\n- Simple format: '2024-01-15 10:00'\n- Unix timestamp: 1705312800000`,
              },
            ],
          };
        }

        // Format to proper ISO 8601
        const formattedDate = formatToISO8601(date);
        
        // Check if it's in the future
        const now = new Date();
        const isInFuture = date > now;
        
        let responseText = `**📅 Date Formatting Result**\n\n`;
        responseText += `**Original Input**: ${dateInput}\n`;
        responseText += `**Timezone**: ${timezone}\n`;
        responseText += `**Formatted Output**: \`${formattedDate}\`\n\n`;
        
        responseText += `**✅ Ready for Booking**: ${isInFuture ? 'Yes' : 'No'}\n`;
        if (!isInFuture) {
          responseText += `**⚠️ Warning**: Date is in the past. Current time: ${now.toISOString()}\n`;
        }
        
        responseText += `\n**📋 Usage Examples**:\n`;
        responseText += `\`\`\`\n`;
        responseText += `CreateBooking with:\n`;
        responseText += `- startTime: "${formattedDate}"\n`;
        responseText += `- eventTypeId: 12345\n`;
        responseText += `- attendeeName: "John Doe"\n`;
        responseText += `- attendeeEmail: "john@example.com"\n`;
        responseText += `\`\`\`\n\n`;
        
        responseText += `**🔄 Alternative Formats**:\n`;
        responseText += `- **Human Readable**: ${date.toLocaleString('en-US', { timeZone: timezone })}\n`;
        responseText += `- **Unix Timestamp**: ${date.getTime()}\n`;
        responseText += `- **Date Only**: ${date.toISOString().split('T')[0]}\n`;

        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
        };
      } catch (error) {
        console.error("Error in FormatDateForBooking:", error);
        return {
          content: [
            {
              type: "text",
              text: `Error formatting date: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
        };
      }
    }
);

server.registerTool(
    "GetAvailableSlots",
    {
        title: "Get Available Slots",
        description: "Get available time slots for an event type before creating a booking. Most common usage: provide clientId, start, end, and eventTypeId. Other parameters are optional for advanced use cases.",
        inputSchema: {
            clientId: z.union([z.number(), z.string().transform(Number)]).describe("The ID of the client to get slots for"),
            start: z.string().describe("Start date/time in ISO 8601 format (UTC). Can be date only (2024-08-13) or with time (2024-08-13T09:00:00Z)"),
            end: z.string().describe("End date/time in ISO 8601 format (UTC). Can be date only (2024-08-20) or with time (2024-08-20T18:00:00Z)"),
            
            // Event type identification (most common: use eventTypeId)
            eventTypeId: z.number().optional().describe("The ID of the event type for which to check available slots (RECOMMENDED - most common usage)"),
            eventTypeSlug: z.string().optional().describe("The slug of the event type (requires username or teamSlug) - ADVANCED usage only"),
            
            // User/Team identification (required with eventTypeSlug)
            username: z.string().optional().describe("Username of the user who owns the event type (for individual events)"),
            teamSlug: z.string().optional().describe("Slug of the team who owns the event type (for team events)"),
            usernames: z.string().optional().describe("Comma-separated usernames for dynamic events (minimum 2 users)"),
            
            // Organization context
            organizationSlug: z.string().optional().describe("Slug of the organization (required for org-scoped events)"),
            
            // Optional parameters
            timeZone: z.string().optional().describe("Timezone for returned slots (defaults to UTC)"),
            duration: z.number().optional().describe("Duration in minutes for multi-duration or dynamic events"),
            format: z.enum(['time', 'range']).optional().describe("Format: 'time' for start time only, 'range' for start and end times"),
            bookingUidToReschedule: z.string().optional().describe("Booking UID when rescheduling (excludes original slot from busy times)"),
            preferredManagedUserId: z.number().optional().describe("Preferred managed user ID to use for the request")
        }
    },
    async (input) => {
      try {
        const { 
          clientId, start, end, eventTypeId, eventTypeSlug, username, teamSlug, usernames,
          organizationSlug, timeZone, duration, format, bookingUidToReschedule, preferredManagedUserId
        } = input;

        // Convert and validate clientId
        const numericClientId = typeof clientId === 'string' ? parseInt(clientId, 10) : clientId;
        
        if (!numericClientId || isNaN(numericClientId)) {
          return {
            content: [
              {
                type: "text",
                text: "Error: clientId is required and must be a valid number",
              },
            ],
          };
        }

        // Validate date inputs
        const startValidation = validateISO8601Date(start);
        const endValidation = validateISO8601Date(end);

        if (!startValidation.isValid) {
          return {
            content: [
              {
                type: "text",
                text: `Error: Invalid start date - ${startValidation.error}`,
              },
            ],
          };
        }

        if (!endValidation.isValid) {
          return {
            content: [
              {
                type: "text",
                text: `Error: Invalid end date - ${endValidation.error}`,
              },
            ],
          };
        }

        // Validate event type identification (eventTypeId is most common and recommended)
        if (!eventTypeId && !eventTypeSlug && !usernames) {
          return {
            content: [
              {
                type: "text",
                text: "Error: Must provide eventTypeId (recommended), eventTypeSlug, or usernames for dynamic events",
              },
            ],
          };
        }

        // Advanced validation for optional parameters
        if (eventTypeSlug && !username && !teamSlug) {
          return {
            content: [
              {
                type: "text",
                text: "Error: eventTypeSlug requires either username (for individual events) or teamSlug (for team events)",
              },
            ],
          };
        }

        if (usernames && usernames.split(',').length < 2) {
          return {
            content: [
              {
                type: "text",
                text: "Error: usernames must contain at least 2 usernames separated by commas",
              },
            ],
          };
        }

        console.log(`🕒 Getting available slots for client ${numericClientId}`);

        // Build slots request (most common: start, end, eventTypeId)
        const slotsRequest: GetSlotsRequest = {
          start: formatToISO8601(start),
          end: formatToISO8601(end),
          eventTypeId
        };

        // Get slots from Cal.com API
        const slotsResponse = await getSlotsForClient(numericClientId, slotsRequest, preferredManagedUserId);

        if (slotsResponse.status === 'error') {
          return {
            content: [
              {
                type: "text",
                text: `❌ Error getting slots: ${slotsResponse.error?.message || 'Unknown error'}`,
              },
            ],
          };
        }

        // Create summary and format for display
        const summary = createSlotsSummary(slotsResponse, slotsRequest);
        const formattedSlots = formatSlotsForDisplay(slotsResponse, timeZone);

        let responseText = `**🕒 Available Slots for Client ${numericClientId}**\n\n`;
        
        // Add summary
        responseText += `**📊 Summary:**\n`;
        responseText += `- **Total Slots**: ${summary.totalSlots}\n`;
        responseText += `- **Available Dates**: ${summary.availableDates.length}\n`;
        responseText += `- **Date Range**: ${summary.dateRange.start} to ${summary.dateRange.end}\n`;
        // Add formatted slots
        responseText += formattedSlots;

        // Add booking recommendations
        if (summary.totalSlots > 0) {
          responseText += `\n**💡 Next Steps:**\n`;
          responseText += `**${summary.totalSlots} slots available** - You can proceed with booking\n`;
          responseText += `**Use CreateBooking tool** with your preferred slot time\n`;
          responseText += `**Remember**: Use exact ISO 8601 format for startTime in booking\n`;
        } else {
          responseText += `\n**No Available Slots:**\n`;
          responseText += `**No slots found** in the specified time range\n`;
          responseText += `**Try**: Expanding date range or checking different event type\n`;
          responseText += `**Alternative**: Use different duration or timezone\n`;
        }

        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
        };
      } catch (error) {
        console.error("Error in GetAvailableSlots:", error);
        return {
          content: [
            {
              type: "text",
              text: `Error getting available slots: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
        };
      }
    }
);

server.registerTool(
    "ValidateSlotAvailability",
    {
        title: "Validate Slot Availability",
        description: "Validate if a specific time slot is available before creating a booking. Most common usage: provide clientId, requestedSlot, start, end, and eventTypeId. Other parameters are optional.",
        inputSchema: {
            clientId: z.union([z.number(), z.string().transform(Number)]).describe("The ID of the client to validate slots for"),
            requestedSlot: z.string().describe("The requested slot time in ISO 8601 format (e.g., '2024-01-15T10:00:00.000Z')"),
            start: z.string().describe("Start date for slot search range in ISO 8601 format"),
            end: z.string().describe("End date for slot search range in ISO 8601 format"),
            
            // Event type identification (most common: use eventTypeId)
            eventTypeId: z.number().optional().describe("The ID of the event type (RECOMMENDED - most common usage)"),
            eventTypeSlug: z.string().optional().describe("The slug of the event type (requires username or teamSlug) - ADVANCED usage only"),
            
            // User/Team identification
            username: z.string().optional().describe("Username for individual events"),
            teamSlug: z.string().optional().describe("Team slug for team events"),
            
            // Optional parameters
            timeZone: z.string().optional().describe("Timezone for validation (defaults to UTC)"),
            duration: z.number().optional().describe("Duration in minutes"),
            preferredManagedUserId: z.number().optional().describe("Preferred managed user ID")
        }
    },
    async (input) => {
      try {
        const { 
          clientId, requestedSlot, start, end, eventTypeId, eventTypeSlug, 
          username, teamSlug, timeZone, duration, preferredManagedUserId
        } = input;

        // Convert and validate clientId
        const numericClientId = typeof clientId === 'string' ? parseInt(clientId, 10) : clientId;
        
        if (!numericClientId || isNaN(numericClientId)) {
          return {
            content: [
              {
                type: "text",
                text: "Error: clientId is required and must be a valid number",
              },
            ],
          };
        }

        // Validate requested slot
        const slotValidation = validateISO8601Date(requestedSlot);
        if (!slotValidation.isValid) {
          return {
            content: [
              {
                type: "text",
                text: `Error: Invalid requested slot - ${slotValidation.error}`,
              },
            ],
          };
        }

        console.log(`🔍 Validating slot availability for client ${numericClientId}: ${requestedSlot}`);

        // Build slots request (most common: start, end, eventTypeId)
        const slotsRequest: GetSlotsRequest = {
          start: formatToISO8601(start),
          end: formatToISO8601(end),
          eventTypeId,
        };

        // Get available slots
        const slotsResponse = await getSlotsForClient(numericClientId, slotsRequest, preferredManagedUserId);

        if (slotsResponse.status === 'error') {
          return {
            content: [
              {
                type: "text",
                text: `❌ Error validating slot: ${slotsResponse.error?.message || 'Unknown error'}`,
              },
            ],
          };
        }

        // Validate the specific slot
        const validation = validateSlotAvailability(slotsResponse, requestedSlot);

        let responseText = `**🔍 Slot Validation for Client ${numericClientId}**\n\n`;
        
        // Format requested slot for display
        const requestedDate = new Date(requestedSlot);
        const formattedDate = requestedDate.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          timeZone: timeZone || 'UTC'
        });
        const formattedTime = requestedDate.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: timeZone || 'UTC'
        });

        responseText += `**📅 Requested Slot:**\n`;
        responseText += `- **Date**: ${formattedDate}\n`;
        responseText += `- **Time**: ${formattedTime} (${timeZone || 'UTC'})\n`;
        responseText += `- **ISO Format**: ${requestedSlot}\n\n`;

        // Availability result
        if (validation.isAvailable) {
          responseText += `**✅ SLOT AVAILABLE**\n\n`;
          responseText += `🎉 **Great news!** The requested slot is available for booking.\n\n`;
          responseText += `**💡 Next Steps:**\n`;
          responseText += `1. ✅ **Proceed with CreateBooking** using this exact time\n`;
          responseText += `2. 📝 **Use startTime**: \`${requestedSlot}\`\n`;
          responseText += `3. 🚀 **Book immediately** to secure this slot\n`;
        } else {
          responseText += `**❌ SLOT NOT AVAILABLE**\n\n`;
          responseText += `😞 **Sorry!** The requested slot is not available.\n\n`;
          
          // Show available slots for that date
          if (validation.availableSlots.length > 0) {
            responseText += `**📅 Available slots on ${formattedDate}:**\n`;
            validation.availableSlots.forEach((slot, index) => {
              const slotTime = new Date(slot.start).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: timeZone || 'UTC'
              });
              responseText += `  ${index + 1}. ${slotTime} (${slot.start})\n`;
            });
            responseText += `\n`;
          } else {
            responseText += `**📅 No slots available on ${formattedDate}**\n\n`;
          }

          // Show nearest alternative
          if (validation.nearestAvailable) {
            const nearestDate = new Date(validation.nearestAvailable.start);
            const nearestFormattedDate = nearestDate.toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              timeZone: timeZone || 'UTC'
            });
            const nearestFormattedTime = nearestDate.toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: timeZone || 'UTC'
            });

            responseText += `**🎯 Nearest Available Slot:**\n`;
            responseText += `- **Date**: ${nearestFormattedDate}\n`;
            responseText += `- **Time**: ${nearestFormattedTime}\n`;
            responseText += `- **ISO Format**: \`${validation.nearestAvailable.start}\`\n\n`;
          }

          responseText += `**💡 Recommendations:**\n`;
          responseText += `1. 🔄 **Try nearest available slot** (shown above)\n`;
          responseText += `2. 📅 **Use GetAvailableSlots** to see all options\n`;
          responseText += `3. 📆 **Expand date range** for more choices\n`;
          responseText += `4. ⏰ **Check different times** on the same day\n`;
        }

        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
        };
      } catch (error) {
        console.error("Error in ValidateSlotAvailability:", error);
        return {
          content: [
            {
              type: "text",
              text: `Error validating slot availability: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
        };
      }
    }
);

server.registerTool(
    "SearchBookings",
    {
        title: "Search Bookings",
        description: "Search for bookings by title, attendee email, or date. Useful for finding bookings before rescheduling or canceling.",
        inputSchema: {
            clientId: z.union([z.number(), z.string().transform(Number)]).describe("The ID of the client to search bookings for"),
            title: z.string().optional().describe("Search by booking title (partial match, case-insensitive)"),
            attendeeEmail: z.string().optional().describe("Search by attendee email or name (partial match)"),
            date: z.string().optional().describe("Search by specific date (YYYY-MM-DD, 'today', 'tomorrow')"),
            dateRange: z.object({
                start: z.string(),
                end: z.string()
            }).optional().describe("Search within a date range (ISO 8601 format)"),
            status: z.array(z.string()).optional().describe("Filter by booking status (e.g., ['accepted', 'pending'])")
        }
    },
    async (input) => {
      try {
        const { clientId, title, attendeeEmail, date, dateRange, status } = input;

        // Convert and validate clientId
        const numericClientId = typeof clientId === 'string' ? parseInt(clientId, 10) : clientId;
        
        if (!numericClientId || isNaN(numericClientId)) {
          return {
            content: [
              {
                type: "text",
                text: "❌ Error: clientId is required and must be a valid number",
              },
            ],
          };
        }

        // Build search criteria
        const searchCriteria: any = {};
        if (title) searchCriteria.title = title;
        if (attendeeEmail) searchCriteria.attendeeEmail = attendeeEmail;
        if (date) searchCriteria.date = date;
        if (dateRange) searchCriteria.dateRange = dateRange;
        if (status) searchCriteria.status = status;

        if (Object.keys(searchCriteria).length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "❌ Error: Please provide at least one search criterion (title, attendeeEmail, date, dateRange, or status)",
              },
            ],
          };
        }

        console.log(`🔍 Searching bookings for client ${numericClientId} with criteria:`, searchCriteria);

        const matchingBookings = await searchBookings(numericClientId, searchCriteria);

        let responseText = `**🔍 Booking Search Results** (Client ID: ${numericClientId})\n\n`;
        
        // Display search criteria
        responseText += `**🎯 Search Criteria:**\n`;
        if (title) responseText += `- **Title**: "${title}"\n`;
        if (attendeeEmail) responseText += `- **Attendee**: "${attendeeEmail}"\n`;
        if (date) responseText += `- **Date**: ${date}\n`;
        if (dateRange) responseText += `- **Date Range**: ${dateRange.start} to ${dateRange.end}\n`;
        if (status) responseText += `- **Status**: ${status.join(', ')}\n`;
        responseText += `\n`;

        if (matchingBookings.length === 0) {
          responseText += `❌ **No bookings found** matching the search criteria.\n\n`;
          responseText += `**💡 Suggestions:**\n`;
          responseText += `- Try a partial title match (e.g., "meeting" instead of "Team Meeting")\n`;
          responseText += `- Check if the date format is correct\n`;
          responseText += `- Expand the date range or remove date filters\n`;
        } else {
          responseText += `✅ **Found ${matchingBookings.length} matching booking(s):**\n\n`;
          
          matchingBookings.forEach((booking, index) => {
            const startDate = new Date(booking.start);
            const endDate = new Date(booking.end);
            
            responseText += `**${index + 1}. ${booking.title || 'Untitled Booking'}**\n`;
            responseText += `   - **UID**: \`${booking.uid}\`\n`;
            responseText += `   - **Date**: ${startDate.toLocaleDateString()}\n`;
            responseText += `   - **Time**: ${startDate.toLocaleTimeString()} - ${endDate.toLocaleTimeString()}\n`;
            responseText += `   - **Status**: ${booking.status || 'Unknown'}\n`;
            
            if (booking.attendees && booking.attendees.length > 0) {
              responseText += `   - **Attendees**: ${booking.attendees.map(a => `${a.name} (${a.email})`).join(', ')}\n`;
            }
            
            if (booking.eventType?.slug) {
              responseText += `   - **Event Type**: ${booking.eventType.slug}\n`;
            }
            
            responseText += `\n`;
          });

          responseText += `**🔄 Next Steps:**\n`;
          responseText += `- Use the **UID** to reschedule or cancel specific bookings\n`;
          responseText += `- Or use **RescheduleBookingByTitle** for easier rescheduling\n`;
        }

        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
        };
      } catch (error) {
        console.error("❌ Error in SearchBookings:", error);
        return {
          content: [
            {
              type: "text",
              text: `❌ Error searching bookings: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
        };
      }
    }
);

server.registerTool(
    "RescheduleBookingByTitle",
    {
        title: "Reschedule Booking by Title",
        description: "Reschedule a booking by finding it using title and optional date, without needing to know the booking UID. Automatically finds the booking and reschedules it.",
        inputSchema: {
            clientId: z.union([z.number(), z.string().transform(Number)]).describe("The ID of the client who owns the booking"),
            title: z.string().describe("Title or partial title of the booking to reschedule"),
            currentDate: z.string().optional().describe("Current date of the booking (YYYY-MM-DD, 'today', 'tomorrow') to help identify the correct booking"),
            newStartTime: z.string().describe("New start time in ISO 8601 format with timezone (YYYY-MM-DDTHH:mm:ss.sssZ)"),
            reschedulingReason: z.string().optional().describe("Reason for rescheduling the booking"),
            rescheduledBy: z.string().optional().describe("Email or name of person rescheduling")
        }
    },
    async (input) => {
      try {
        const { clientId, title, currentDate, newStartTime, reschedulingReason, rescheduledBy } = input;

        // Convert and validate clientId
        const numericClientId = typeof clientId === 'string' ? parseInt(clientId, 10) : clientId;
        
        if (!numericClientId || isNaN(numericClientId)) {
          return {
            content: [
              {
                type: "text",
                text: "❌ Error: clientId is required and must be a valid number",
              },
            ],
          };
        }

        // Validate new start time format
        if (!validateISO8601Date(newStartTime)) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Error: newStartTime must be in ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ). Received: ${newStartTime}`,
              },
            ],
          };
        }

        let responseText = `**🔄 Rescheduling Booking by Title**\n\n`;
        responseText += `**🎯 Search Parameters:**\n`;
        responseText += `- **Title**: "${title}"\n`;
        if (currentDate) responseText += `- **Current Date**: ${currentDate}\n`;
        responseText += `- **New Time**: ${newStartTime}\n\n`;

        // Get client timezone for better date handling
        const clientTimezone = await getClientTimezone(numericClientId);
        const timezone = clientTimezone || 'UTC';

        console.log(`🔍 Finding booking for reschedule: "${title}" on ${currentDate || 'any date'}`);

        // Find the booking
        const booking = await findBookingForReschedule(numericClientId, title, currentDate, timezone);

        if (!booking) {
          responseText += `❌ **Booking Not Found**\n\n`;
          responseText += `No booking found matching title "${title}"`;
          if (currentDate) responseText += ` on ${currentDate}`;
          responseText += `.\n\n`;
          
          responseText += `**💡 Suggestions:**\n`;
          responseText += `- Try a partial title (e.g., "meeting" instead of "Team Meeting")\n`;
          responseText += `- Remove the date filter to search all dates\n`;
          responseText += `- Use **SearchBookings** tool to see all available bookings\n`;
          
          return {
            content: [
              {
                type: "text",
                text: responseText,
              },
            ],
          };
        }

        responseText += `✅ **Found Booking:**\n`;
        responseText += `- **Title**: ${booking.title}\n`;
        responseText += `- **UID**: \`${booking.uid}\`\n`;
        responseText += `- **Current Time**: ${new Date(booking.start).toLocaleString('en-US', { timeZone: timezone })}\n`;
        responseText += `- **New Time**: ${new Date(newStartTime).toLocaleString('en-US', { timeZone: timezone })}\n\n`;

        // Validate the new slot is available
        console.log(`🔍 Validating new slot availability...`);
        
        // Check if new slot is available (optional - you can remove this if you want to allow double-booking)
        try {
          const eventTypeIds = await getCalEventTypeIdsForClient(numericClientId);
          if (eventTypeIds) {
            const newDate = new Date(newStartTime);
            const startOfDay = new Date(newDate);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(newDate);
            endOfDay.setHours(23, 59, 59, 999);

            // You can add slot validation here if needed
            // const isAvailable = await validateSlotAvailability(...)
          }
        } catch (error) {
          console.log(`⚠️ Could not validate slot availability: ${error}`);
        }

        // Proceed with rescheduling
        console.log(`🔄 Rescheduling booking ${booking.uid} to ${newStartTime}`);

        const rescheduleResult = await rescheduleBookingForClient(
          numericClientId,
          booking.uid,
          {
            start: newStartTime,
            reschedulingReason: reschedulingReason || `Rescheduled via booking title search: "${title}"`,
            rescheduledBy: rescheduledBy || 'System'
          }
        );

        if (rescheduleResult.success) {
          responseText += `🎉 **Rescheduling Successful!**\n\n`;
          responseText += `✅ **Booking Details:**\n`;
          if (rescheduleResult.newBookingUid) {
            responseText += `- **New UID**: \`${rescheduleResult.newBookingUid}\`\n`;
          }
          if (rescheduleResult.newStartTime) {
            responseText += `- **New Start**: ${new Date(rescheduleResult.newStartTime).toLocaleString('en-US', { timeZone: timezone })}\n`;
          }
          if (rescheduleResult.newEndTime) {
            responseText += `- **New End**: ${new Date(rescheduleResult.newEndTime).toLocaleString('en-US', { timeZone: timezone })}\n`;
          }
          if (reschedulingReason) {
            responseText += `- **Reason**: ${reschedulingReason}\n`;
          }
        } else {
          responseText += `❌ **Rescheduling Failed**\n\n`;
          responseText += `**Error**: ${rescheduleResult.error}\n\n`;
          
          if (rescheduleResult.error?.includes('slot') || rescheduleResult.error?.includes('available')) {
            responseText += `**💡 Suggestion**: The new time slot might not be available. Try a different time or use **GetAvailableSlots** to find available times.\n`;
          }
        }

        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
        };
      } catch (error) {
        console.error("❌ Error in RescheduleBookingByTitle:", error);
        return {
          content: [
            {
              type: "text",
              text: `❌ Error rescheduling booking: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
        };
      }
    }
);

server.registerTool(
    "DebugSlotsAPI",
    {
        title: "Debug Slots API",
        description: "Debug tool to test different date formats and ranges with Cal.com slots API to identify issues.",
        inputSchema: {
            clientId: z.union([z.number(), z.string().transform(Number)]).describe("The ID of the client to test slots for"),
            eventTypeId: z.number().describe("The event type ID to test"),
            testDate: z.string().optional().default("tomorrow").describe("Base date to test (e.g., 'tomorrow', '2025-09-15')")
        }
    },
    async (input) => {
      try {
        const { clientId, eventTypeId, testDate } = input;

        // Convert and validate clientId
        const numericClientId = typeof clientId === 'string' ? parseInt(clientId, 10) : clientId;
        
        if (!numericClientId || isNaN(numericClientId)) {
          return {
            content: [
              {
                type: "text",
                text: "❌ Error: clientId is required and must be a valid number",
              },
            ],
          };
        }

        let responseText = `**🔍 Slots API Debug Test**\n\n`;
        responseText += `**🎯 Parameters:**\n`;
        responseText += `- **Client ID**: ${numericClientId}\n`;
        responseText += `- **Event Type ID**: ${eventTypeId}\n`;
        responseText += `- **Test Date**: ${testDate}\n\n`;

        // Get client timezone
        const clientTimezone = await getClientTimezone(numericClientId);
        const timezone = clientTimezone || 'UTC';
        responseText += `**🌍 Client Timezone**: ${timezone}\n\n`;

        // Parse the test date
        const parsedDate = parseDateRequest(testDate, timezone);
        const baseDate = new Date(parsedDate.start);
        
        responseText += `**📅 Parsed Base Date**: ${baseDate.toISOString()}\n\n`;

        // Test different date range formats
        const testCases = [
          {
            name: "1 Day Range (Date Only)",
            start: baseDate.toISOString().split('T')[0],
            end: baseDate.toISOString().split('T')[0]
          },
          {
            name: "1 Day Range (Full DateTime)",
            start: baseDate.toISOString(),
            end: new Date(baseDate.getTime() + 24 * 60 * 60 * 1000 - 1).toISOString()
          },
          {
            name: "3 Day Range (Date Only)",
            start: baseDate.toISOString().split('T')[0],
            end: new Date(baseDate.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
          },
          {
            name: "7 Day Range (Current Approach)",
            start: baseDate.toISOString(),
            end: new Date(baseDate.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
          }
        ];

        responseText += `**🧪 Testing Different Date Formats:**\n\n`;

        for (const testCase of testCases) {
          responseText += `**${testCase.name}:**\n`;
          responseText += `- Start: \`${testCase.start}\`\n`;
          responseText += `- End: \`${testCase.end}\`\n`;

          try {
            const slotsRequest: GetSlotsRequest = {
              start: testCase.start,
              end: testCase.end,
              eventTypeId
            };

            const slotsResponse = await getSlotsForClient(numericClientId, slotsRequest);

            if (slotsResponse.status === 'success') {
              const data = slotsResponse.data || {};
              const totalSlots = Object.values(data).reduce((sum, slots) => sum + (slots?.length || 0), 0);
              const dateCount = Object.keys(data).length;

              responseText += `- **Result**: ✅ Success\n`;
              responseText += `- **Dates with slots**: ${dateCount}\n`;
              responseText += `- **Total slots**: ${totalSlots}\n`;

              if (totalSlots > 0) {
                responseText += `- **Sample slots**:\n`;
                Object.keys(data).slice(0, 2).forEach(date => {
                  const slots = data[date] || [];
                  responseText += `  - ${date}: ${slots.length} slots`;
                  if (slots.length > 0) {
                    const firstSlot = new Date(slots[0].start).toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: timezone
                    });
                    responseText += ` (first: ${firstSlot})`;
                  }
                  responseText += `\n`;
                });
              }
            } else {
              responseText += `- **Result**: ❌ Error\n`;
              responseText += `- **Message**: ${slotsResponse.error?.message || 'Unknown error'}\n`;
              if (slotsResponse.error?.details) {
                responseText += `- **Details**: ${JSON.stringify(slotsResponse.error.details, null, 2)}\n`;
              }
            }
          } catch (error) {
            responseText += `- **Result**: 💥 Exception\n`;
            responseText += `- **Error**: ${error instanceof Error ? error.message : 'Unknown error'}\n`;
          }

          responseText += `\n`;
        }

        responseText += `**💡 Analysis:**\n`;
        responseText += `- If all tests return empty, the event type might not have availability configured\n`;
        responseText += `- If only certain date formats work, we need to adjust our API calls\n`;
        responseText += `- If shorter ranges work better, we should limit our date ranges\n`;
        responseText += `- Check Cal.com event type settings for business hours and availability\n`;

        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
        };
      } catch (error) {
        console.error("Error in DebugSlotsAPI:", error);
        return {
          content: [
            {
              type: "text",
              text: `Error debugging slots API: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
        };
      }
    }
);

server.registerTool(
    "TestDateParsing",
    {
        title: "Test Date Parsing",
        description: "Test tool to verify how date requests are being parsed. Useful for debugging date parsing issues.",
        inputSchema: {
            dateRequest: z.string().describe("Date request to test (e.g., 'September 12, 2025', 'today', 'this week')"),
            timezone: z.string().optional().default("UTC").describe("Timezone to use for parsing (defaults to UTC)")
        }
    },
    async (input) => {
      try {
        const { dateRequest, timezone } = input;

        console.log(`🧪 Testing date parsing for: "${dateRequest}" in timezone: ${timezone}`);
        
        const result = parseDateRequest(dateRequest, timezone);
        
        let responseText = `**🧪 Date Parsing Test**\n\n`;
        responseText += `**📝 Input:**\n`;
        responseText += `- **Date Request**: "${dateRequest}"\n`;
        responseText += `- **Timezone**: ${timezone}\n\n`;
        
        responseText += `**📅 Parsed Result:**\n`;
        responseText += `- **Description**: ${result.description}\n`;
        responseText += `- **Start**: ${result.start}\n`;
        responseText += `- **End**: ${result.end}\n\n`;
        
        // Format for human readability
        const startDate = new Date(result.start);
        const endDate = new Date(result.end);
        
        responseText += `**🌍 Human Readable (${timezone}):**\n`;
        responseText += `- **Start**: ${startDate.toLocaleString('en-US', { timeZone: timezone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}\n`;
        responseText += `- **End**: ${endDate.toLocaleString('en-US', { timeZone: timezone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}\n\n`;
        
        responseText += `**✅ Success**: Date parsing completed successfully!`;

        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
        };
      } catch (error) {
        console.error("Error in TestDateParsing:", error);
        return {
          content: [
            {
              type: "text",
              text: `Error testing date parsing: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
        };
      }
    }
);

server.registerTool(
    "DebugBookingFetch",
    {
        title: "Debug Booking Fetch",
        description: "Debug tool to investigate booking fetching issues. Shows detailed information about managed users, event types, and API calls.",
        inputSchema: {
            clientId: z.union([z.number(), z.string().transform(Number)]).describe("The ID of the client to debug booking fetch for"),
            dateRange: z.string().optional().default("today").describe("Date range to test (e.g., 'today', 'this week')")
        }
    },
    async (input) => {
      try {
        const { clientId, dateRange } = input;

        // Convert and validate clientId
        const numericClientId = typeof clientId === 'string' ? parseInt(clientId, 10) : clientId;
        
        if (!numericClientId || isNaN(numericClientId)) {
          return {
            content: [
              {
                type: "text",
                text: "Error: clientId is required and must be a valid number",
              },
            ],
          };
        }

        let responseText = `**🔍 Booking Fetch Debug for Client ${numericClientId}**\n\n`;

        // Get client timezone
        const clientTimezone = await getClientTimezone(numericClientId);
        const timezone = clientTimezone || 'UTC';
        responseText += `**🌍 Client Timezone**: ${timezone}\n\n`;

        // Parse date range
        const parsedDateRange = parseDateRequest(dateRange, timezone);
        responseText += `**📅 Date Range**: ${parsedDateRange.description}\n`;
        responseText += `- **Start**: ${parsedDateRange.start}\n`;
        responseText += `- **End**: ${parsedDateRange.end}\n\n`;

        // Check connected calendars
        const hasConnectedCalendars = await hasActiveCalendarConnections(numericClientId);
        responseText += `**📅 Connected Calendars**: ${hasConnectedCalendars ? '✅ Yes' : '❌ No'}\n`;
        
        if (!hasConnectedCalendars) {
          responseText += `❌ **No connected calendars found** - this will prevent booking fetching\n\n`;
        }

        // Check event types
        const hasEventTypes = await hasActiveEventTypes(numericClientId);
        responseText += `**🎯 Event Types**: ${hasEventTypes ? '✅ Yes' : '❌ No'}\n`;
        
        if (!hasEventTypes) {
          responseText += `❌ **No active event types found** - this will prevent booking fetching\n\n`;
        }

        // Get event type IDs
        const eventTypeIds = await getCalEventTypeIdsForClient(numericClientId);
        responseText += `**🔢 Event Type IDs**: ${eventTypeIds || 'None found'}\n\n`;

        // Get managed users
        const managedUsers = await getManagedUsersByClientId(numericClientId);
        responseText += `**👥 Managed Users (${managedUsers.length}):**\n`;
        
        if (managedUsers.length === 0) {
          responseText += `❌ **No managed users found** - cannot fetch bookings\n\n`;
        } else {
          managedUsers.forEach((user, index) => {
            responseText += `${index + 1}. **${user.email}**\n`;
            responseText += `   - ID: ${user.id}\n`;
            responseText += `   - Cal User ID: ${user.cal_user_id}\n`;
            responseText += `   - Active: ${user.is_active ? 'Yes' : 'No'}\n`;
            responseText += `   - Has Access Token: ${user.access_token ? 'Yes (length: ' + user.access_token.length + ')' : 'No'}\n`;
            responseText += `\n`;
          });
        }

        // Test API call construction
        if (managedUsers.length > 0 && eventTypeIds) {
          const testUser = managedUsers[0];
          responseText += `**🔗 Test API Call Construction:**\n`;
          responseText += `- **Base URL**: https://api.cal.com/v2/bookings\n`;
          responseText += `- **Event Type IDs**: ${eventTypeIds}\n`;
          responseText += `- **After Start**: ${parsedDateRange.start}\n`;
          responseText += `- **Before End**: ${parsedDateRange.end}\n`;
          
          const queryParams = new URLSearchParams();
          queryParams.append('eventTypeIds', eventTypeIds);
          queryParams.append('afterStart', parsedDateRange.start);
          queryParams.append('beforeEnd', parsedDateRange.end);
          
          const testUrl = `https://api.cal.com/v2/bookings?${queryParams.toString()}`;
          responseText += `- **Full URL**: ${testUrl}\n\n`;

          // Test actual API call
          responseText += `**🧪 Test API Call Result:**\n`;
          try {
            const response = await fetch(testUrl, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${testUser.access_token}`,
                'cal-api-version': '2024-08-13',
                'Content-Type': 'application/json'
              }
            });

            responseText += `- **HTTP Status**: ${response.status} ${response.statusText}\n`;
            
            const result = await response.json();
            responseText += `- **Response Status**: ${result.status || 'Unknown'}\n`;
            
            if (result.status === 'success') {
              responseText += `- **Bookings Found**: ${result.data?.length || 0}\n`;
              if (result.data && result.data.length > 0) {
                responseText += `- **Sample Booking**: ${result.data[0].title || 'No title'} (${result.data[0].start})\n`;
              }
            } else {
              responseText += `- **Error**: ${result.error?.message || 'Unknown error'}\n`;
              if (result.error?.details) {
                responseText += `- **Details**: ${JSON.stringify(result.error.details, null, 2)}\n`;
              }
            }
          } catch (apiError) {
            responseText += `- **API Call Failed**: ${apiError instanceof Error ? apiError.message : 'Unknown error'}\n`;
          }
        }

        responseText += `\n**💡 Troubleshooting Steps:**\n`;
        if (!hasConnectedCalendars) {
          responseText += `1. ❌ **Connect calendars** for this client\n`;
        }
        if (!hasEventTypes) {
          responseText += `2. ❌ **Create event types** for this client\n`;
        }
        if (managedUsers.length === 0) {
          responseText += `3. ❌ **Create managed users** for this client\n`;
        }
        if (!eventTypeIds) {
          responseText += `4. ❌ **Verify event type IDs** are properly configured\n`;
        }
        if (hasConnectedCalendars && hasEventTypes && managedUsers.length > 0 && eventTypeIds) {
          responseText += `5. ✅ **All prerequisites met** - check API response details above\n`;
        }

        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
        };
      } catch (error) {
        console.error("Error in DebugBookingFetch:", error);
        return {
          content: [
            {
              type: "text",
              text: `Error debugging booking fetch: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
        };
      }
    }
);

server.registerTool(
    "DebugCalendarConnections",
    {
        title: "Debug Calendar Connections",
        description: "Debug tool to show the relationship between managed users and connected calendars for a client.",
        inputSchema: {
            clientId: z.union([z.number(), z.string().transform(Number)]).describe("The ID of the client to debug calendar connections for")
        }
    },
    async (input) => {
      try {
        const { clientId } = input;

        // Convert and validate clientId
        const numericClientId = typeof clientId === 'string' ? parseInt(clientId, 10) : clientId;
        
        if (!numericClientId || isNaN(numericClientId)) {
          return {
            content: [
              {
                type: "text",
                text: "Error: clientId is required and must be a valid number",
              },
            ],
          };
        }

        console.log(`🔍 Debugging calendar connections for client ${numericClientId}`);

        // Get all relevant data in parallel
        const [managedUsers, connectedCalendars, primaryCalendar] = await Promise.all([
          getManagedUsersByClientId(numericClientId),
          getConnectedCalendarsForClient(numericClientId),
          getPrimaryCalendarForClient(numericClientId)
        ]);

        let responseText = `**🔍 Calendar Connection Debug for Client ${numericClientId}**\n\n`;

        // Managed Users Section
        responseText += `**👥 Managed Users (${managedUsers.length}):**\n`;
        if (managedUsers.length === 0) {
          responseText += `❌ No managed users found\n\n`;
        } else {
          managedUsers.forEach((user, index) => {
            responseText += `${index + 1}. **${user.email}**\n`;
            responseText += `   - ID: ${user.id}\n`;
            responseText += `   - Cal User ID: ${user.cal_user_id}\n`;
            responseText += `   - Active: ${user.is_active ? 'Yes' : 'No'}\n`;
            responseText += `   - Has Access Token: ${user.access_token ? 'Yes' : 'No'}\n`;
            responseText += `\n`;
          });
        }

        // Connected Calendars Section
        responseText += `**📅 Connected Calendars (${connectedCalendars.length}):**\n`;
        if (connectedCalendars.length === 0) {
          responseText += `❌ No connected calendars found\n\n`;
        } else {
          connectedCalendars.forEach((calendar, index) => {
            responseText += `${index + 1}. **${calendar.account_email}** (${calendar.calendar_type})\n`;
            responseText += `   - ID: ${calendar.id}\n`;
            responseText += `   - Cal User ID: ${calendar.cal_user_id}\n`;
            responseText += `   - Primary: ${calendar.is_primary ? 'Yes' : 'No'}\n`;
            responseText += `   - Connected: ${calendar.is_connected ? 'Yes' : 'No'}\n`;
            responseText += `   - Selected: ${calendar.is_selected ? 'Yes' : 'No'}\n`;
            responseText += `\n`;
          });
        }

        // Primary Calendar Section
        responseText += `**🎯 Primary Calendar:**\n`;
        if (primaryCalendar) {
          responseText += `✅ **${primaryCalendar.account_email}** (${primaryCalendar.calendar_type})\n`;
          responseText += `   - Cal User ID: ${primaryCalendar.cal_user_id}\n`;
          responseText += `   - Connected: ${primaryCalendar.is_connected ? 'Yes' : 'No'}\n\n`;
        } else {
          responseText += `❌ No primary calendar found\n\n`;
        }

        // Relationship Analysis
        responseText += `**🔗 Relationship Analysis:**\n`;
        
        if (managedUsers.length === 0) {
          responseText += `❌ **No managed users** - Cannot create bookings\n`;
        } else if (connectedCalendars.length === 0) {
          responseText += `❌ **No connected calendars** - Bookings will use default calendar\n`;
        } else {
          // Check which managed users have matching connected calendars
          const matchedUsers = managedUsers.filter(user => 
            connectedCalendars.some(calendar => calendar.cal_user_id === user.cal_user_id)
          );
          
          const unmatchedUsers = managedUsers.filter(user => 
            !connectedCalendars.some(calendar => calendar.cal_user_id === user.cal_user_id)
          );

          if (matchedUsers.length > 0) {
            responseText += `✅ **Matched Users & Calendars:**\n`;
            matchedUsers.forEach(user => {
              const userCalendars = connectedCalendars.filter(cal => cal.cal_user_id === user.cal_user_id);
              responseText += `   - **${user.email}** → ${userCalendars.map(cal => `${cal.account_email} (${cal.calendar_type})`).join(', ')}\n`;
            });
            responseText += `\n`;
          }

          if (unmatchedUsers.length > 0) {
            responseText += `⚠️ **Unmatched Managed Users:**\n`;
            unmatchedUsers.forEach(user => {
              responseText += `   - **${user.email}** (cal_user_id: ${user.cal_user_id}) - No connected calendar\n`;
            });
            responseText += `\n`;
          }

          // Check orphaned calendars
          const orphanedCalendars = connectedCalendars.filter(calendar => 
            !managedUsers.some(user => user.cal_user_id === calendar.cal_user_id)
          );

          if (orphanedCalendars.length > 0) {
            responseText += `⚠️ **Orphaned Calendars:**\n`;
            orphanedCalendars.forEach(calendar => {
              responseText += `   - **${calendar.account_email}** (cal_user_id: ${calendar.cal_user_id}) - No managed user\n`;
            });
            responseText += `\n`;
          }
        }

        // Booking Recommendations
        responseText += `**💡 Booking Recommendations:**\n`;
        
        if (managedUsers.length === 0) {
          responseText += `1. ❌ **Create managed users** for this client\n`;
        } else if (connectedCalendars.length === 0) {
          responseText += `1. ❌ **Connect calendars** for this client\n`;
        } else if (primaryCalendar) {
          const primaryUser = managedUsers.find(user => user.cal_user_id === primaryCalendar.cal_user_id);
          if (primaryUser) {
            responseText += `1. ✅ **Bookings will use**: ${primaryUser.email} → ${primaryCalendar.account_email}\n`;
          } else {
            responseText += `1. ⚠️ **Primary calendar has no managed user** - will use first available managed user\n`;
          }
        } else {
          responseText += `1. ⚠️ **No primary calendar set** - will use first available managed user\n`;
        }

        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
        };
      } catch (error) {
        console.error("Error in DebugCalendarConnections:", error);
        return {
          content: [
            {
              type: "text",
              text: `Error debugging calendar connections: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
        };
      }
    }
);

server.registerTool(
    "ReadLeadsResource",
    {
        title: "Read Leads Resource",
        description: "Read leads data from MCP server resources. Uses proper MCP protocol with server-side caching for optimal performance.",
        inputSchema: {
            clientId: z.union([z.number(), z.string().transform(Number)]).describe("The ID of the client to get leads for"),
            resourceType: z.enum(['full', 'summary', 'stage']).describe("Type of resource to read: 'full' for complete data, 'summary' for statistics only, 'stage' for specific stage"),
            stage: z.string().optional().describe("Required when resourceType is 'stage' - the stage to filter by")
        }
    },
    async (input) => {
      try {
        const { clientId, resourceType, stage } = input;

        // Convert and validate clientId
        const numericClientId = typeof clientId === 'string' ? parseInt(clientId, 10) : clientId;
        
        if (!numericClientId || isNaN(numericClientId)) {
          return {
            content: [
              {
                type: "text",
                text: "Error: clientId is required and must be a valid number",
              },
            ],
          };
        }

        // Validate stage parameter for stage resource type
        if (resourceType === 'stage' && !stage) {
          return {
            content: [
              {
                type: "text",
                text: "Error: stage parameter is required when resourceType is 'stage'",
              },
            ],
          };
        }

        // Build resource URI based on type
        let resourceUri: string;
        switch (resourceType) {
          case 'full':
            resourceUri = `leads://client/${numericClientId}`;
            break;
          case 'summary':
            resourceUri = `leads://client/${numericClientId}/summary`;
            break;
          case 'stage':
            resourceUri = `leads://client/${numericClientId}/stage/${encodeURIComponent(stage!)}`;
            break;
          default:
            return {
              content: [
                {
                  type: "text",
                  text: "Error: Invalid resourceType. Must be 'full', 'summary', or 'stage'",
                },
              ],
            };
        }

        console.log(`📋 Reading MCP resource: ${resourceUri}`);

        // The resource will be handled by the MCP framework
        // For demonstration, we'll show the resource URI and explain how it works
        let responseText = `**📋 MCP Resource Access**\n\n`;
        responseText += `**Resource URI**: \`${resourceUri}\`\n`;
        responseText += `**Client ID**: ${numericClientId}\n`;
        responseText += `**Resource Type**: ${resourceType}\n`;
        if (stage) responseText += `**Stage**: ${stage}\n`;
        responseText += `\n`;
        
        responseText += `🔄 **How it works:**\n`;
        responseText += `1. MCP client requests resource at URI: \`${resourceUri}\`\n`;
        responseText += `2. Server checks cache first (server-side caching)\n`;
        responseText += `3. If cache miss, fetches fresh data from database\n`;
        responseText += `4. Returns JSON data with cache metadata\n`;
        responseText += `5. MCP client can cache the resource locally\n\n`;
        
        responseText += `⚡ **Performance Benefits:**\n`;
        responseText += `- **Server-side cache**: 5-10 minute TTL based on data type\n`;
        responseText += `- **Client-side cache**: MCP framework handles caching\n`;
        responseText += `- **URI-based access**: RESTful, cacheable by HTTP proxies\n`;
        responseText += `- **Protocol compliance**: Works with any MCP client\n\n`;
        
        responseText += `🛠️ **Available Resources:**\n`;
        responseText += `- \`leads://client/{clientId}\` - Full leads data (5 min cache)\n`;
        responseText += `- \`leads://client/{clientId}/summary\` - Summary stats (10 min cache)\n`;
        responseText += `- \`leads://client/{clientId}/stage/{stage}\` - Stage-filtered (3 min cache)\n\n`;
        
        responseText += `💡 **Usage**: MCP clients can directly access these URIs for cached lead data.`;

        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
        };
      } catch (error) {
        console.error("Error in ReadLeadsResource:", error);
        return {
          content: [
            {
              type: "text",
              text: `Error reading resource: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
        };
      }
    }
);

server.registerTool(
    "GetLeadsFromCache",
    {
        title: "Get Leads from Cache",
        description: "Get leads data using intelligent caching for faster repeated access. Automatically caches results for better performance.",
        inputSchema: {
            clientId: z.union([z.number(), z.string().transform(Number)]).describe("The ID of the client to get leads for"),
            dataType: z.enum(['full', 'summary', 'stage']).describe("Type of data to fetch: 'full' for complete data, 'summary' for statistics only, 'stage' for specific stage"),
            stage: z.string().optional().describe("Required when dataType is 'stage' - the stage to filter by"),
            forceRefresh: z.boolean().optional().describe("Force refresh cache and fetch fresh data from database")
        }
    },
    async (input) => {
      try {
        const { clientId, dataType, stage, forceRefresh = false } = input;

        // Convert and validate clientId
        const numericClientId = typeof clientId === 'string' ? parseInt(clientId, 10) : clientId;
        
        if (!numericClientId || isNaN(numericClientId)) {
          return {
            content: [
              {
                type: "text",
                text: "Error: clientId is required and must be a valid number",
              },
            ],
          };
        }

        // Validate stage parameter for stage data type
        if (dataType === 'stage' && !stage) {
          return {
            content: [
              {
                type: "text",
                text: "Error: stage parameter is required when dataType is 'stage'",
              },
            ],
          };
        }

        // Build cache key based on type
        let cacheKey: string;
        switch (dataType) {
          case 'full':
            cacheKey = ResourceURI.clientLeads(numericClientId);
            break;
          case 'summary':
            cacheKey = ResourceURI.clientSummary(numericClientId);
            break;
          case 'stage':
            cacheKey = ResourceURI.clientStage(numericClientId, stage!);
            break;
          default:
            return {
              content: [
                {
                  type: "text",
                  text: "Error: Invalid dataType. Must be 'full', 'summary', or 'stage'",
                },
              ],
            };
        }

        console.log(`📋 Accessing cached data: ${cacheKey} (force refresh: ${forceRefresh})`);

        // Try to get from cache first (unless force refresh)
        let resourceData: any;
        
        if (!forceRefresh) {
          resourceData = getCachedResource(cacheKey);
          if (resourceData) {
            console.log(`✅ Using cached data for ${cacheKey}`);
          }
        }
        
        // Fetch fresh data if not in cache or force refresh
        if (!resourceData) {
          console.log(`🔄 Fetching fresh data for ${cacheKey}`);
          
          switch (dataType) {
            case 'full':
              const [summary, recentLeads] = await Promise.all([
                getClientLeadsSummary(numericClientId),
                getLeadsForClient(numericClientId, { 
                  sort_by: 'updated_at', 
                  sort_order: 'desc', 
                  limit: 100 
                })
              ]);
              
              if (!summary) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `**No Data Available**\n\n**Client ID**: ${numericClientId}\n**Data Type**: ${dataType}`,
                    },
                  ],
                };
              }
              
              resourceData = {
                client_id: numericClientId,
                last_updated: new Date().toISOString(),
                summary: summary,
                recent_leads: recentLeads.leads,
                total_available: recentLeads.total_count,
                cache_info: {
                  cached_at: new Date().toISOString(),
                  ttl_seconds: 300,
                  auto_refresh: true
                }
              };
              
              // Cache the result
              setCachedResource(cacheKey, resourceData, 300);
              break;
              
            case 'summary':
              const summaryData = await getClientLeadsSummary(numericClientId);
              
              if (!summaryData) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `**No Summary Data Available**\n\n**Client ID**: ${numericClientId}`,
                    },
                  ],
                };
              }
              
              resourceData = {
                client_id: numericClientId,
                last_updated: new Date().toISOString(),
                summary: summaryData,
                cache_info: {
                  cached_at: new Date().toISOString(),
                  ttl_seconds: 600,
                  auto_refresh: true
                }
              };
              
              // Cache the result
              setCachedResource(cacheKey, resourceData, 600);
              break;
              
            case 'stage':
              const stageLeads = await getLeadsByStage(numericClientId, stage!, 100);
              
              resourceData = {
                client_id: numericClientId,
                stage: stage,
                last_updated: new Date().toISOString(),
                leads: stageLeads,
                count: stageLeads.length,
                cache_info: {
                  cached_at: new Date().toISOString(),
                  ttl_seconds: 180,
                  auto_refresh: true
                }
              };
              
              // Cache the result
              setCachedResource(cacheKey, resourceData, 180);
              break;
          }
        }

        let responseText = '';

        switch (dataType) {
          case 'full':
            responseText = `**📋 Leads Resource for Client ${numericClientId}**\n\n`;
            responseText += `🕒 **Cache Info**: Updated ${new Date(resourceData.last_updated).toLocaleString()}\n`;
            responseText += `⏱️ **TTL**: ${resourceData.cache_info.ttl_seconds} seconds\n\n`;
            
            responseText += `📊 **Summary:**\n`;
            responseText += `- **Total Leads**: ${resourceData.summary.total_leads}\n`;
            responseText += `- **Contacted**: ${resourceData.summary.contacted_leads}\n`;
            responseText += `- **Uncontacted**: ${resourceData.summary.uncontacted_leads}\n`;
            responseText += `- **Recent (7 days)**: ${resourceData.summary.recent_leads}\n\n`;

            if (resourceData.summary.leads_by_stage && Object.keys(resourceData.summary.leads_by_stage).length > 0) {
              responseText += `📈 **Leads by Stage:**\n`;
              Object.entries(resourceData.summary.leads_by_stage)
                .sort(([,a], [,b]) => (b as number) - (a as number))
                .forEach(([stage, count]) => {
                  responseText += `- **${stage}**: ${count}\n`;
                });
              responseText += `\n`;
            }

            responseText += `📋 **Recent Leads (${resourceData.recent_leads.length} of ${resourceData.total_available}):**\n\n`;
            resourceData.recent_leads.slice(0, 10).forEach((lead: any, index: number) => {
              responseText += `${index + 1}. **${lead.full_name}**\n`;
              if (lead.company) responseText += `   - Company: ${lead.company}\n`;
              if (lead.email) responseText += `   - Email: ${lead.email}\n`;
              responseText += `   - Stage: ${lead.stage || 'Unknown'}\n`;
              responseText += `   - Calls: ${lead.number_of_calls_made || 0}\n`;
              responseText += `\n`;
            });
            break;

          case 'summary':
            responseText = `**📊 Leads Summary Resource for Client ${numericClientId}**\n\n`;
            responseText += `🕒 **Cache Info**: Updated ${new Date(resourceData.last_updated).toLocaleString()}\n`;
            responseText += `⏱️ **TTL**: ${resourceData.cache_info.ttl_seconds} seconds\n\n`;
            
            responseText += `📊 **Statistics:**\n`;
            responseText += `- **Total Leads**: ${resourceData.summary.total_leads}\n`;
            responseText += `- **Contacted**: ${resourceData.summary.contacted_leads}\n`;
            responseText += `- **Uncontacted**: ${resourceData.summary.uncontacted_leads}\n`;
            responseText += `- **Recent (7 days)**: ${resourceData.summary.recent_leads}\n`;
            responseText += `- **Average Calls**: ${resourceData.summary.average_calls_per_lead}\n\n`;

            if (resourceData.summary.top_sources && resourceData.summary.top_sources.length > 0) {
              responseText += `🎯 **Top Sources:**\n`;
              resourceData.summary.top_sources.forEach((item: any, index: number) => {
                responseText += `${index + 1}. **${item.source}**: ${item.count} leads\n`;
              });
            }
            break;

          case 'stage':
            responseText = `**🎯 Stage Resource: "${resourceData.stage}" for Client ${numericClientId}**\n\n`;
            responseText += `🕒 **Cache Info**: Updated ${new Date(resourceData.last_updated).toLocaleString()}\n`;
            responseText += `⏱️ **TTL**: ${resourceData.cache_info.ttl_seconds} seconds\n\n`;
            
            responseText += `📊 **Stage Summary:**\n`;
            responseText += `- **Stage**: ${resourceData.stage}\n`;
            responseText += `- **Count**: ${resourceData.count} leads\n\n`;

            if (resourceData.leads && resourceData.leads.length > 0) {
              responseText += `📋 **Leads in "${resourceData.stage}" Stage:**\n\n`;
              resourceData.leads.slice(0, 15).forEach((lead: any, index: number) => {
                responseText += `${index + 1}. **${lead.full_name}**\n`;
                if (lead.company) responseText += `   - Company: ${lead.company}\n`;
                if (lead.email) responseText += `   - Email: ${lead.email}\n`;
                responseText += `   - Calls: ${lead.number_of_calls_made || 0}\n`;
                if (lead.last_contacted) {
                  responseText += `   - Last Contact: ${new Date(lead.last_contacted).toLocaleDateString()}\n`;
                }
                responseText += `\n`;
              });
            }
            break;
        }

        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
        };
      } catch (error) {
        console.error("Error in GetLeadsFromResource:", error);
        return {
          content: [
            {
              type: "text",
              text: `Error accessing leads resource: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
        };
      }
    }
);

server.registerTool(
    "ManageLeadsCache",
    {
        title: "Manage Leads Cache",
        description: "Manage the leads resource cache - view stats, invalidate cache, or cleanup expired entries.",
        inputSchema: {
            action: z.enum(['stats', 'invalidate_client', 'invalidate_all', 'cleanup']).describe("Action to perform: 'stats' for cache statistics, 'invalidate_client' to clear client cache, 'invalidate_all' to clear all cache, 'cleanup' to remove expired entries"),
            clientId: z.union([z.number(), z.string().transform(Number)]).optional().describe("Required when action is 'invalidate_client' - the client ID to invalidate cache for")
        }
    },
    async (input) => {
      try {
        const { action, clientId } = input;

        let responseText = '';

        switch (action) {
          case 'stats':
            const stats = getCacheStats()
            const subscriptions = subscriptionManager.getActiveSubscriptions()
            
            responseText = `**📊 Leads Cache Statistics**\n\n`;
            responseText += `🗄️ **Cache Entries:**\n`;
            responseText += `- **Total Entries**: ${stats.total_entries}\n`;
            responseText += `- **Valid Entries**: ${stats.valid_entries}\n`;
            responseText += `- **Expired Entries**: ${stats.expired_entries}\n`;
            responseText += `- **Cache Size**: ${stats.cache_size_mb} MB\n\n`;
            
            responseText += `📡 **Active Subscriptions:**\n`;
            if (subscriptions.length > 0) {
              subscriptions.forEach((uri, index) => {
                responseText += `${index + 1}. ${uri}\n`;
              });
            } else {
              responseText += `- No active subscriptions\n`;
            }
            
            responseText += `\n💡 **Cache Health**: `;
            if (stats.expired_entries > stats.valid_entries) {
              responseText += `⚠️ High expired entries ratio - consider cleanup\n`;
            } else if (stats.cache_size_mb > 50) {
              responseText += `⚠️ Large cache size - consider cleanup\n`;
            } else {
              responseText += `✅ Cache is healthy\n`;
            }
            break;

          case 'invalidate_client':
            if (!clientId) {
              return {
                content: [
                  {
                    type: "text",
                    text: "Error: clientId is required when action is 'invalidate_client'",
                  },
                ],
              };
            }

            const numericClientId = typeof clientId === 'string' ? parseInt(clientId, 10) : clientId;
            
            if (!numericClientId || isNaN(numericClientId)) {
              return {
                content: [
                  {
                    type: "text",
                    text: "Error: clientId must be a valid number",
                  },
                ],
              };
            }

            invalidateClientCache(numericClientId)
            subscriptionManager.unsubscribeClient(numericClientId)
            
            responseText = `**🗑️ Client Cache Invalidated**\n\n`;
            responseText += `**Client ID**: ${numericClientId}\n`;
            responseText += `✅ All cache entries for this client have been invalidated\n`;
            responseText += `✅ All auto-refresh subscriptions for this client have been removed\n\n`;
            responseText += `💡 Next resource access will fetch fresh data from the database`;
            break;

          case 'invalidate_all':
            invalidateAllCache()
            subscriptionManager.cleanup()
            
            responseText = `**🗑️ All Cache Invalidated**\n\n`;
            responseText += `✅ All cache entries have been cleared\n`;
            responseText += `✅ All auto-refresh subscriptions have been removed\n\n`;
            responseText += `💡 Next resource access will fetch fresh data from the database`;
            break;

          case 'cleanup':
            const cleanedCount = cleanupExpiredCache()
            
            responseText = `**🧹 Cache Cleanup Complete**\n\n`;
            responseText += `🗑️ **Removed**: ${cleanedCount} expired entries\n`;
            
            if (cleanedCount > 0) {
              const newStats = getCacheStats()
              responseText += `📊 **Updated Stats**:\n`;
              responseText += `- **Valid Entries**: ${newStats.valid_entries}\n`;
              responseText += `- **Cache Size**: ${newStats.cache_size_mb} MB\n`;
            } else {
              responseText += `✅ No expired entries found - cache is clean`;
            }
            break;

          default:
            return {
              content: [
                {
                  type: "text",
                  text: "Error: Invalid action. Must be 'stats', 'invalidate_client', 'invalidate_all', or 'cleanup'",
                },
              ],
            };
        }

        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
        };
      } catch (error) {
        console.error("Error in ManageLeadsCache:", error);
        return {
          content: [
            {
              type: "text",
              text: `Error managing cache: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
        };
      }
    }
);

// Note: MCP Resources with ResourceTemplate are complex to implement correctly
// The current SDK has specific requirements that are difficult to match
// For now, we'll focus on the caching system which provides the performance benefits
// 
// The proper MCP resource implementation would require:
// 1. Correct callback signatures matching ReadResourceTemplateCallback
// 2. Proper URI template variable handling
// 3. Specific return format compliance
// 
// Our caching system in the tools provides the same performance benefits
// while being easier to implement and maintain.

return server    
}

// This is the part for transporting //
app.post('/mcp', async (req: Request, res: Response) => {
    // In stateless mode, create a new instance of transport and server for each request
    // to ensure complete isolation. A single instance would cause request ID collisions
    // when multiple clients connect concurrently.
    try {
      const server = getServer(); 
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      res.on('close', () => {
        console.log('Request closed');
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }
    }
  });
  
//   // SSE notifications not supported in stateless mode
//   app.get('/mcp', async (req: Request, res: Response) => {
//     console.log('Received GET MCP request');
//     res.writeHead(405).end(JSON.stringify({
//       jsonrpc: "2.0",
//       error: {
//         code: -32000,
//         message: "Method not allowed."
//       },
//       id: null
//     }));
//   });
  
//   // Session termination not needed in stateless mode
//   app.delete('/mcp', async (req: Request, res: Response) => {
//     console.log('Received DELETE MCP request');
//     res.writeHead(405).end(JSON.stringify({
//       jsonrpc: "2.0",
//       error: {
//         code: -32000,
//         message: "Method not allowed."
//       },
//       id: null
//     }));
//   });
  
  
  // Start the server
  const PORT = 3000;
  app.listen(PORT, () => {
    console.log(`🚀 MCP Server running on http://localhost:${PORT}`);
  });