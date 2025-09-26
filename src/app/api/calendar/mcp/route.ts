import { z } from "zod";
import { createMcpHandler } from "mcp-handler";
import {
  getCalendarEventsForClient,
  createCalendarEventForClient,
  updateCalendarEventForClient,
  deleteCalendarEventForClient,
  getCalendarsForClient,
  getAvailabilityForClient,
  checkClientCalendarConnection,
  searchCalendarEventsForClient,
  findAvailableSlotsForClient,
} from "@/lib/helpers/calendar_functions";
import type {
  GetGraphEventsRequest,
  CreateGraphEventMCPRequest,
  GetAvailabilityRequest,
} from "@/types";

const handler = createMcpHandler(
  (server) => {
    //GetCalendarEvents
    server.tool(
      "GetCalendarEvents",
      "Get calendar events for a client from Microsoft Graph. Client timezone is automatically retrieved from database. Supports natural language date requests like 'today', 'tomorrow', 'this week', 'upcoming'.",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("The ID of the client to get events for"),
        dateRequest: z
          .string()
          .optional()
          .describe(
            "Natural language date request (e.g., 'today', 'tomorrow', 'this week', 'upcoming')"
          ),
        calendarId: z
          .string()
          .optional()
          .describe("Specific calendar ID (defaults to primary calendar)"),
        startDate: z
          .string()
          .optional()
          .describe("Start date in ISO 8601 format (alternative to dateRequest)"),
        endDate: z
          .string()
          .optional()
          .describe("End date in ISO 8601 format (alternative to dateRequest)"),
      },
      async (input) => {
        try {
          const {
            clientId,
            dateRequest,
            calendarId,
            startDate,
            endDate,
          } = input;
          
          console.log("get calendar events (Microsoft Graph)");
          console.table(input);
          
          // Convert and validate clientId
          const numericClientId =
            typeof clientId === "string" ? parseInt(clientId, 10) : clientId;

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

          const request: GetGraphEventsRequest = {
            clientId: numericClientId,
            dateRequest,
            calendarId,
            startDate,
            endDate,
          };
          console.log("Request: ", request)

          const result = await getCalendarEventsForClient(numericClientId, request);

          if (!result.success) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error retrieving calendar events: ${result.error}`,
                },
              ],
            };
          }

            return {
              content: [
                {
                  type: "text",
                  text: `**Microsoft Calendar Events for Client ID: ${numericClientId}**\n\n${result.formattedEvents}`,
                },
              ],
            };
        } catch (error) {
          console.error("Error in GetCalendarEvents:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error retrieving calendar events: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              },
            ],
          };
        }
      }
    );
    //CreateCalendarEvent
    server.tool(
      "CreateCalendarEvent",
      "Create a new calendar event for a client using Microsoft Graph. Client timezone is automatically retrieved from database. Creates events directly in the user's Microsoft calendar.",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("The ID of the client to create event for"),
        subject: z.string().describe("Title/subject of the event"),
        startDateTime: z
          .string()
          .describe("Start date/time in ISO 8601 format"),
        endDateTime: z
          .string()
          .describe("End date/time in ISO 8601 format"),
        attendeeEmail: z.string().email().describe("Email of the attendee"),
        attendeeName: z
          .string()
          .optional()
          .describe("Name of the attendee"),
        description: z
          .string()
          .optional()
          .describe("Description/body of the event"),
        location: z
          .string()
          .optional()
          .describe("Location of the event"),
        isOnlineMeeting: z
          .boolean()
          .optional()
          .describe("Whether to create as an online Teams meeting"),
        calendarId: z
          .string()
          .optional()
          .describe("Specific calendar ID (defaults to primary calendar)"),
      },
      async (input) => {
        try {
          const {
            clientId,
            subject,
            startDateTime,
            endDateTime,
            attendeeEmail,
            attendeeName,
            description,
            location,
            isOnlineMeeting,
            calendarId,
          } = input;
          
          console.log("create calendar event (Microsoft Graph)");
          console.table(input);
          
          // Convert and validate clientId
          const numericClientId =
            typeof clientId === "string" ? parseInt(clientId, 10) : clientId;

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

          const request: CreateGraphEventMCPRequest = {
            clientId: numericClientId,
            subject,
            startDateTime,
            endDateTime,
            attendeeEmail,
            attendeeName,
            description,
            location,
            isOnlineMeeting,
            calendarId,
          };

          const result = await createCalendarEventForClient(numericClientId, request);

          if (!result.success) {
            return {
              content: [
                {
                  type: "text",
                  text: `**Event Creation Failed**\n\n**Error**: ${result.error}\n\n**Client ID**: ${numericClientId}\n**Subject**: ${subject}\n**Start Time**: ${startDateTime}\n**Attendee**: ${attendeeName || attendeeEmail}`,
                },
              ],
            };
          }

          let responseText = `**CALENDAR EVENT CREATED SUCCESSFULLY!**\n\n`;
          responseText += `**Event Details:**\n`;
          responseText += `- **Event ID**: ${result.eventId}\n`;
          responseText += `- **Subject**: ${result.event?.subject}\n`;
          responseText += `- **Start Time**: ${new Date(result.event?.start.dateTime || startDateTime).toLocaleString("en-US")}\n`;
          responseText += `- **End Time**: ${new Date(result.event?.end.dateTime || endDateTime).toLocaleString("en-US")}\n`;
          responseText += `- **Attendee**: ${attendeeName || attendeeEmail}\n`;
          responseText += `- **Client ID**: ${numericClientId}\n`;

          if (result.event?.location?.displayName) {
            responseText += `- **Location**: ${result.event.location.displayName}\n`;
          }

          if (result.event?.onlineMeeting?.joinUrl) {
            responseText += `- **Teams Meeting**: ${result.event.onlineMeeting.joinUrl}\n`;
          }

          if (result.event?.webLink) {
            responseText += `- **Calendar Link**: ${result.event.webLink}\n`;
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
          console.error("Error in CreateCalendarEvent:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error creating calendar event: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              },
            ],
          };
        }
      }
    );
    //UpdateCalendarEvent
    server.tool(
      "UpdateCalendarEvent",
      "Update an existing calendar event for a client using Microsoft Graph. Client timezone is automatically retrieved from database.",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("The ID of the client who owns the event"),
        eventId: z.string().describe("The ID of the event to update"),
        subject: z.string().optional().describe("New title/subject of the event"),
        startDateTime: z
          .string()
          .optional()
          .describe("New start date/time in ISO 8601 format"),
        endDateTime: z
          .string()
          .optional()
          .describe("New end date/time in ISO 8601 format"),
        attendeeEmail: z
          .string()
          .email()
          .optional()
          .describe("New attendee email"),
        attendeeName: z
          .string()
          .optional()
          .describe("New attendee name"),
        description: z
          .string()
          .optional()
          .describe("New description/body of the event"),
        location: z
          .string()
          .optional()
          .describe("New location of the event"),
        calendarId: z
          .string()
          .optional()
          .describe("Specific calendar ID (defaults to primary calendar)"),
      },
      async (input) => {
        try {
          const {
            clientId,
            eventId,
            subject,
            startDateTime,
            endDateTime,
            attendeeEmail,
            attendeeName,
            description,
            location,
            calendarId,
          } = input;
          
          console.log("update calendar event (Microsoft Graph)");
          console.table(input);
          
          // Convert and validate clientId
          const numericClientId =
            typeof clientId === "string" ? parseInt(clientId, 10) : clientId;

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

          const updates: Partial<CreateGraphEventMCPRequest> = {
            subject,
            startDateTime,
            endDateTime,
            attendeeEmail,
            attendeeName,
            description,
            location,
            calendarId,
          };

          const result = await updateCalendarEventForClient(numericClientId, eventId, updates);

          if (!result.success) {
            return {
              content: [
                {
                  type: "text",
                  text: `**Event Update Failed**\n\n**Error**: ${result.error}\n\n**Client ID**: ${numericClientId}\n**Event ID**: ${eventId}`,
                },
              ],
            };
          }

          let responseText = `**CALENDAR EVENT UPDATED SUCCESSFULLY!**\n\n`;
          responseText += `**Updated Event Details:**\n`;
          responseText += `- **Event ID**: ${eventId}\n`;
          responseText += `- **Subject**: ${result.event?.subject}\n`;
          
          if (result.event?.start.dateTime) {
            responseText += `- **Start Time**: ${new Date(result.event.start.dateTime).toLocaleString("en-US")}\n`;
          }
          
          if (result.event?.end.dateTime) {
            responseText += `- **End Time**: ${new Date(result.event.end.dateTime).toLocaleString("en-US")}\n`;
          }
          
          responseText += `- **Client ID**: ${numericClientId}\n`;

          if (result.event?.location?.displayName) {
            responseText += `- **Location**: ${result.event.location.displayName}\n`;
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
          console.error("Error in UpdateCalendarEvent:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error updating calendar event: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              },
            ],
          };
        }
      }
    );
//DeleteCalendarEvent
    server.tool(
      "DeleteCalendarEvent",
      "Delete a calendar event for a client using Microsoft Graph.",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("The ID of the client who owns the event"),
        eventId: z.string().describe("The ID of the event to delete"),
        calendarId: z
          .string()
          .optional()
          .describe("Specific calendar ID (defaults to primary calendar)"),
      },
      async (input) => {
        try {
          const { clientId, eventId, calendarId } = input;
          
          console.log("delete calendar event (Microsoft Graph)");
          console.table(input);

          // Convert and validate clientId
          const numericClientId =
            typeof clientId === "string" ? parseInt(clientId, 10) : clientId;

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

          const result = await deleteCalendarEventForClient(numericClientId, eventId, calendarId);

          if (!result.success) {
            return {
              content: [
                {
                  type: "text",
                  text: `**Event Deletion Failed**\n\n**Error**: ${result.error}\n\n**Client ID**: ${numericClientId}\n**Event ID**: ${eventId}`,
                },
              ],
            };
          }

          return {
            content: [
              {
                type: "text",
                text: `**CALENDAR EVENT DELETED SUCCESSFULLY!**\n\n**Event ID**: ${eventId}\n**Client ID**: ${numericClientId}`,
              },
            ],
          };
        } catch (error) {
          console.error("Error in DeleteCalendarEvent:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error deleting calendar event: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              },
            ],
          };
        }
      }
    );
    //SearchCalendarEvents
    server.tool(
      "SearchCalendarEvents",
      "Search for calendar events by subject/title for a client using Microsoft Graph. Client timezone is automatically retrieved from database.",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("The ID of the client to search events for"),
        searchQuery: z
          .string()
          .describe("Search query to match against event subjects"),
        startDate: z
          .string()
          .optional()
          .describe("Start date to limit search (ISO 8601 format)"),
        endDate: z
          .string()
          .optional()
          .describe("End date to limit search (ISO 8601 format)"),
        calendarId: z
          .string()
          .optional()
          .describe("Specific calendar ID (defaults to primary calendar)"),
      },
      async (input) => {
        try {
          const {
            clientId,
            searchQuery,
            startDate,
            endDate,
            calendarId,
          } = input;
          
          console.log("search calendar events (Microsoft Graph)");
          console.table(input);
          
          // Convert and validate clientId
          const numericClientId =
            typeof clientId === "string" ? parseInt(clientId, 10) : clientId;

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

          const result = await searchCalendarEventsForClient(
            numericClientId,
            searchQuery,
            { startDate, endDate, calendarId }
          );

          if (!result.success) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error searching calendar events: ${result.error}`,
                },
              ],
            };
          }

          let responseText = `**Calendar Event Search Results** (Client ID: ${numericClientId})\n\n`;
          responseText += `**Search Query**: "${searchQuery}"\n`;
          
          if (startDate && endDate) {
            responseText += `**Date Range**: ${startDate} to ${endDate}\n`;
          }
          
          responseText += `\n${result.formattedEvents}`;

          return {
            content: [
              {
                type: "text",
                text: responseText,
              },
            ],
          };
        } catch (error) {
          console.error("Error in SearchCalendarEvents:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error searching calendar events: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              },
            ],
          };
        }
      }
    );
//GetCalendars
    server.tool(
      "GetCalendars",
      "Get all calendars for a client from Microsoft Graph.",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("The ID of the client to get calendars for"),
      },
      async (input) => {
        try {
          const { clientId } = input;
          
          console.log("get calendars (Microsoft Graph)");
          console.table(input);
          
          // Convert and validate clientId
          const numericClientId =
            typeof clientId === "string" ? parseInt(clientId, 10) : clientId;

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

          const result = await getCalendarsForClient(numericClientId);

          if (!result.success) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error retrieving calendars: ${result.error}`,
                },
              ],
            };
          }

          let responseText = `**Microsoft Calendars for Client ${numericClientId}**\n\n`;

          if (!result.calendars || result.calendars.length === 0) {
            responseText += `No calendars found.`;
          } else {
            responseText += `Found ${result.calendars.length} calendar(s):\n\n`;

            result.calendars.forEach((calendar, index) => {
              responseText += `**${index + 1}. ${calendar.name}**\n`;
              responseText += `- **ID**: \`${calendar.id}\`\n`;
              responseText += `- **Default**: ${calendar.isDefaultCalendar ? "✅ Yes" : "❌ No"}\n`;
              responseText += `- **Can Edit**: ${calendar.canEdit ? "✅ Yes" : "❌ No"}\n`;
              
              if (calendar.owner) {
                responseText += `   - **Owner**: ${calendar.owner.name || calendar.owner.address}\n`;
              }
              
              if (calendar.color) {
                responseText += `   - **Color**: ${calendar.color}\n`;
              }
              
              responseText += `\n`;
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
          console.error("Error in GetCalendars:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error retrieving calendars: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              },
            ],
          };
        }
      }
    );
//CheckCalendarConnection
    server.tool(
      "CheckCalendarConnection",
      "Check if a client has connected Microsoft calendars and get connection summary.",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("The ID of the client to check calendar connection for"),
      },
      async (input) => {
        try {
          const { clientId } = input;
          
          console.log("check calendar connection (Microsoft Graph)");
          console.table(input);

          // Convert and validate clientId
          const numericClientId =
            typeof clientId === "string" ? parseInt(clientId, 10) : clientId;

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

          const summary = await checkClientCalendarConnection(numericClientId);

          if (!summary) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: Could not retrieve calendar connection information for client ${numericClientId}`,
                },
              ],
            };
          }

          let responseText = `**Calendar Connection Status for Client ${numericClientId}**\n\n`;

          if (summary.has_active_connections) {
            responseText += `**Status**: Connected\n`;
            responseText += `**Total Connections**: ${summary.total_connections}\n`;
            responseText += `**Active Connections**: ${summary.connected_connections}\n`;

            if (summary.microsoft_connections > 0) {
              responseText += `**Microsoft Connections**: ${summary.microsoft_connections}\n`;
            }

            if (summary.google_connections > 0) {
              responseText += `**Google Connections**: ${summary.google_connections}\n`;
            }

            if (summary.primary_connection) {
              responseText += `**Primary Connection**: ${summary.primary_connection.display_name} (${summary.primary_connection.email}) - ${summary.primary_connection.provider_name}\n`;
            }

            responseText += `\nThis client can access calendar events through Microsoft Graph.`;
          } else {
            responseText += `**Status**: No Active Connections\n`;
            responseText += `**Total Connections**: ${summary.total_connections}\n`;
            responseText += `**Active Connections**: ${summary.connected_connections}\n`;
            responseText += `\nThis client needs to connect their Microsoft calendar before accessing events.`;
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
          console.error("❌ Error in CheckCalendarConnection:", error);
          return {
            content: [
              {
                type: "text",
                text: `❌ Error checking calendar connection: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              },
            ],
          };
        }
      }
    );
    //GetAvailability
    server.tool(
      "GetAvailability",
      "Get availability/free-busy information for a client using Microsoft Graph. Client timezone is automatically retrieved from database.",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("The ID of the client to get availability for"),
        startDate: z
          .string()
          .describe("Start date/time in ISO 8601 format"),
        endDate: z
          .string()
          .describe("End date/time in ISO 8601 format"),
        emails: z
          .array(z.string().email())
          .optional()
          .describe("Email addresses to check availability for (defaults to client's email)"),
        intervalInMinutes: z
          .number()
          .optional()
          .describe("Interval in minutes for availability slots (default: 60)"),
      },
      async (input) => {
        try {
          const {
            clientId,
            startDate,
            endDate,
            emails,
            intervalInMinutes,
          } = input;
          
          console.log("get availability (Microsoft Graph)");
          console.table(input);
          
          // Convert and validate clientId
          const numericClientId =
            typeof clientId === "string" ? parseInt(clientId, 10) : clientId;

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

          const request: GetAvailabilityRequest = {
            clientId: numericClientId,
            startDate,
            endDate,
            emails,
            intervalInMinutes,
          };

          const result = await getAvailabilityForClient(numericClientId, request);

          if (!result.success) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error retrieving availability: ${result.error}`,
                },
              ],
            };
          }

          let responseText = `**Availability Information for Client ${numericClientId}**\n\n`;
          responseText += `**Date Range**: ${new Date(startDate).toLocaleDateString("en-US")} - ${new Date(endDate).toLocaleDateString("en-US")}\n\n`;

          if (!result.availability || Object.keys(result.availability).length === 0) {
            responseText += `**No busy times found** - All requested time slots appear to be available.`;
          } else {
            responseText += `**Busy Times Found:**\n\n`;

            Object.entries(result.availability).forEach(([email, slots]) => {
              responseText += `**👤 ${email}:**\n`;
              
              if (slots.length === 0) {
                responseText += ` No busy times - Available for the entire period\n`;
          } else {
                slots.forEach((slot, index) => {
                  const startTime = new Date(slot.start).toLocaleString("en-US");
                  const endTime = new Date(slot.end).toLocaleString("en-US");
                  responseText += `   ${index + 1}. **${slot.status.toUpperCase()}**: ${startTime} - ${endTime}\n`;
                });
              }
              
                      responseText += `\n`;
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
          console.error("Error in GetAvailability:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error retrieving availability: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              },
            ],
          };
        }
      }
    );
    //FindAvailableSlots
    server.tool(
      "FindAvailableSlots",
      "Find available time slots near a requested time for a client using Microsoft Graph. Suggests alternative slots if the requested time conflicts with existing events.",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("The ID of the client to find available slots for"),
        requestedStartTime: z
          .string()
          .describe("Requested start date/time in ISO 8601 format"),
        requestedEndTime: z
          .string()
          .describe("Requested end date/time in ISO 8601 format"),
        durationMinutes: z
          .number()
          .optional()
          .default(60)
          .describe("Duration of the appointment in minutes (default: 60)"),
        maxSuggestions: z
          .number()
          .optional()
          .default(5)
          .describe("Maximum number of alternative slots to suggest (default: 5)"),
      },
      async (input) => {
        try {
          const {
            clientId,
            requestedStartTime,
            requestedEndTime,
            durationMinutes,
            maxSuggestions,
          } = input;
          
          console.log("find available slots (Microsoft Graph)");
          console.table(input);
          
          // Convert and validate clientId
          const numericClientId =
            typeof clientId === "string" ? parseInt(clientId, 10) : clientId;

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

          const result = await findAvailableSlotsForClient(
            numericClientId,
            requestedStartTime,
            requestedEndTime,
            durationMinutes || 60,
            maxSuggestions || 5
          );

          if (!result.success) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error finding available slots: ${result.error}`,
                },
              ],
            };
          }

          let responseText = `**Available Time Slots for Client ${numericClientId}**\n\n`;
          responseText += `**Requested Time**: ${new Date(requestedStartTime).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" })} - ${new Date(requestedEndTime).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" })} (Melbourne Time)\n\n`;

          if (!result.hasConflict) {
            responseText += `**✅ REQUESTED TIME IS AVAILABLE!**\n\n`;
            responseText += `The requested time slot is free and can be booked immediately.\n`;
            responseText += `You can proceed with creating the calendar event at this time.`;
          } else {
            responseText += `**❌ REQUESTED TIME HAS CONFLICTS**\n\n`;
            
            if (result.conflictDetails) {
              responseText += `**Conflict Details**: ${result.conflictDetails}\n\n`;
            }

            if (result.availableSlots && result.availableSlots.length > 0) {
              responseText += `**💡 SUGGESTED ALTERNATIVE SLOTS** (within business hours 9 AM - 6 PM):\n\n`;
              
              result.availableSlots.forEach((slot, index) => {
                responseText += `**${index + 1}.** ${slot.startMelbourne} - ${slot.endMelbourne}\n`;
              });
              
              responseText += `\n**Next Steps**: Choose one of the suggested time slots above and create a new calendar event with that time.`;
            } else {
              responseText += `**⚠️ NO ALTERNATIVE SLOTS FOUND**\n\n`;
              responseText += `No available slots found within business hours (9 AM - 6 PM Melbourne time).\n`;
              responseText += `Please try a different date or time range.`;
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
          console.error("Error in FindAvailableSlots:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error finding available slots: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              },
            ],
          };
        }
      }
    );
  },
  {},
  { basePath: "/api/calendar" }
);

export { handler as GET, handler as POST, handler as DELETE };
