/**
 * Booking MCP Server Route
 * 
 * Provides 3 MCP tools for AI agents to book appointments:
 * 1. CreateCalendarEvent - Book appointments with contact lookup and conflict detection
 * 2. FindAvailableSlots - Check availability and get alternative time slots
 * 3. GetAvailability - Get detailed availability information
 */

import { z } from "zod";
import { createMcpHandler } from "mcp-handler";
import {
  createBooking,
  findAvailableTimeSlots,
  getDetailedAvailability,
} from "@/lib/helpers/booking_functions";

const handler = createMcpHandler(
  (server) => {
    /**
     * Tool 1: CreateCalendarEvent
     * 
     * Book appointments with automatic contact lookup, conflict detection,
     * and office hours validation.
     */
    server.tool(
      "CreateCalendarEvent",
      "Book a calendar appointment with automatic contact search in customer/lead databases. Validates office hours, detects conflicts, and suggests alternatives. Creates Teams meetings by default.",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("Client ID number (e.g., 10000002)"),
        agentId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("Agent ID number (e.g., 123) - identifies which agent's calendar to use"),
        subject: z
          .string()
          .min(3)
          .describe("Meeting title (e.g., 'Sales Call with John Smith')"),
        startDateTime: z
          .string()
          .describe(
            "Start time in ISO format: '2025-10-20T13:00:00' (must be at least 15 minutes in future)"
          ),
        endDateTime: z
          .string()
          .describe(
            "End time in ISO format: '2025-10-20T14:00:00' (must be after start time)"
          ),
        customerTimezone: z
          .string()
          .optional()
          .describe(
            "Customer's timezone (e.g., 'America/New_York', 'EST', 'Pacific', 'AEST'). If provided, times will be converted from customer timezone to business timezone. If not provided, times are assumed to be in business timezone."
          ),
        contactName: z
          .string()
          .optional()
          .describe(
            "Contact name to search in database: 'John Smith' (searches customers and leads automatically)"
          ),
        contactEmail: z
          .string()
          .email()
          .optional()
          .describe(
            "Contact email: 'john@company.com' (required if contact not found in database)"
          ),
        contactPhone: z
          .string()
          .optional()
          .describe("Contact phone number (optional, for reference)"),
        description: z
          .string()
          .optional()
          .describe("Meeting description or agenda (optional)"),
        location: z
          .string()
          .optional()
          .describe(
            "Meeting location: 'Conference Room A' or physical address (optional)"
          ),
        isOnlineMeeting: z
          .boolean()
          .optional()
          .default(true)
          .describe("Create Teams meeting link: true/false (default: true)"),
        calendarId: z
          .string()
          .optional()
          .describe("Specific calendar ID (optional, uses primary calendar if not specified)"),
      },
      async (input) => {
        try {
          console.log("📅 CreateCalendarEvent MCP Tool called");
          console.table(input);

          // Validate and convert clientId
          const numericClientId =
            typeof input.clientId === "string"
              ? parseInt(input.clientId, 10)
              : input.clientId;

          if (!numericClientId || isNaN(numericClientId)) {
            return {
              content: [
                {
                  type: "text",
                  text: "❌ **ERROR**: Client ID is required and must be a valid number",
                },
              ],
            };
          }

          // Validate and convert agentId
          const numericAgentId =
            typeof input.agentId === "string"
              ? parseInt(input.agentId, 10)
              : input.agentId;

          if (!numericAgentId || isNaN(numericAgentId)) {
            return {
              content: [
                {
                  type: "text",
                  text: "❌ **ERROR**: Agent ID is required and must be a valid number",
                },
              ],
            };
          }

          // Create booking
          const result = await createBooking({
            clientId: numericClientId,
            agentId: numericAgentId,
            subject: input.subject,
            startDateTime: input.startDateTime,
            endDateTime: input.endDateTime,
            customerTimezone: input.customerTimezone,
            contactName: input.contactName,
            contactEmail: input.contactEmail,
            contactPhone: input.contactPhone,
            description: input.description,
            location: input.location,
            isOnlineMeeting: input.isOnlineMeeting,
            calendarId: input.calendarId,
          });

          // Handle failure with conflict suggestions
          if (!result.success) {
            if (result.availableSlots && result.availableSlots.length > 0) {
              let responseText = "❌ **SCHEDULING CONFLICT**\n\n";
              responseText += `**Issue**: ${result.error}\n\n`;

              if (result.conflictDetails) {
                responseText += `**Conflicting Events**:\n${result.conflictDetails}\n\n`;
              }

              responseText += `**💡 ALTERNATIVE TIME SLOTS**:\n`;
              result.availableSlots.forEach((slot, index) => {
                responseText += `${index + 1}. ${slot.startFormatted} - ${slot.endFormatted}\n`;
              });
              responseText += `\nPlease choose one of these alternative times and try booking again.`;

              return {
                content: [
                  {
                    type: "text",
                    text: responseText,
                  },
                ],
              };
            }

            return {
              content: [
                {
                  type: "text",
                  text: `❌ **BOOKING FAILED**\n\n**Error**: ${result.error}`,
                },
              ],
            };
          }

          // Success response
          const booking = result.booking!;
          let responseText = "✅ **APPOINTMENT BOOKED SUCCESSFULLY!**\n\n";
          responseText += `📋 **${booking.subject}**\n`;
          responseText += `📅 **Date/Time**: ${new Date(booking.startDateTime).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} - ${new Date(booking.endDateTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}\n`;
          responseText += `👤 **Contact**: ${booking.contact.name}\n`;
          responseText += `📧 **Email**: ${booking.contact.email}\n`;

          if (booking.location) {
            responseText += `📍 **Location**: ${booking.location}\n`;
          }

          if (booking.teamsLink) {
            responseText += `💻 **Teams Meeting**: ${booking.teamsLink}\n`;
          }

          responseText += `\n🆔 **Event ID**: ${booking.eventId}\n`;
          responseText += `\n✉️ **Invitation sent** to ${booking.contact.email}`;

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
                text: `❌ **UNEXPECTED ERROR**\n\n${error instanceof Error ? error.message : "Unknown error occurred"}`,
              },
            ],
          };
        }
      }
    );

    /**
     * Tool 2: FindAvailableSlots
     * 
     * Check if a time slot is available and get alternative suggestions
     */
    server.tool(
      "FindAvailableSlots",
      "Check if a specific time slot is available for booking. If not available, automatically suggests alternative time slots within business hours. Useful for finding the best meeting time.",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("Client ID number (e.g., 10000002)"),
        agentId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("Agent ID number (e.g., 123) - identifies which agent's calendar to check"),
        requestedStartTime: z
          .string()
          .describe("Preferred start time: '2025-10-20T13:00:00'"),
        requestedEndTime: z
          .string()
          .describe("Preferred end time: '2025-10-20T14:00:00'"),
        durationMinutes: z
          .number()
          .optional()
          .default(60)
          .describe("Meeting duration in minutes: 30, 60, 90 (default: 60)"),
        maxSuggestions: z
          .number()
          .optional()
          .default(5)
          .describe("Maximum number of alternative slots to suggest: 3-10 (default: 5)"),
      },
      async (input) => {
        try {
          console.log("🔍 FindAvailableSlots MCP Tool called");
          console.table(input);

          const numericClientId =
            typeof input.clientId === "string"
              ? parseInt(input.clientId, 10)
              : input.clientId;

          if (!numericClientId || isNaN(numericClientId)) {
            return {
              content: [
                {
                  type: "text",
                  text: "❌ **ERROR**: Client ID is required and must be a valid number",
                },
              ],
            };
          }

          const numericAgentId =
            typeof input.agentId === "string"
              ? parseInt(input.agentId, 10)
              : input.agentId;

          if (!numericAgentId || isNaN(numericAgentId)) {
            return {
              content: [
                {
                  type: "text",
                  text: "❌ **ERROR**: Agent ID is required and must be a valid number",
                },
              ],
            };
          }

          const result = await findAvailableTimeSlots({
            clientId: numericClientId,
            agentId: numericAgentId,
            startDateTime: input.requestedStartTime,
            endDateTime: input.requestedEndTime,
            durationMinutes: input.durationMinutes,
            maxSuggestions: input.maxSuggestions,
          });

          if (!result.success) {
            return {
              content: [
                {
                  type: "text",
                  text: `❌ **ERROR**: ${result.error}`,
                },
              ],
            };
          }

          let responseText = "📅 **AVAILABILITY CHECK RESULTS**\n\n";
          responseText += `**Requested Time**: ${result.requestedSlot.startFormatted} - ${result.requestedSlot.endFormatted}\n\n`;

          if (result.isAvailable) {
            responseText += "✅ **AVAILABLE!**\n\n";
            responseText += "The requested time slot is free and can be booked immediately.\n";
            responseText += "You can proceed with creating the calendar event using CreateCalendarEvent tool.";
          } else {
            responseText += "❌ **NOT AVAILABLE**\n\n";

            if (result.conflictDetails) {
              responseText += `**Reason**: ${result.conflictDetails}\n\n`;
            }

            if (result.availableSlots && result.availableSlots.length > 0) {
              responseText += `**💡 SUGGESTED ALTERNATIVE TIMES** (within business hours):\n\n`;

              result.availableSlots.forEach((slot, index) => {
                responseText += `${index + 1}. ${slot.startFormatted} - ${slot.endFormatted}\n`;
              });

              responseText += `\n**Next Step**: Choose one of these times and use CreateCalendarEvent to book it.`;
            } else {
              responseText += "⚠️ **No alternative slots found** within the next 7 days during business hours.\n";
              responseText += "Please try a different date or contact support.";
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
                text: `❌ **UNEXPECTED ERROR**\n\n${error instanceof Error ? error.message : "Unknown error occurred"}`,
              },
            ],
          };
        }
      }
    );

    /**
     * Tool 3: GetAvailability
     * 
     * Get detailed availability information for scheduling
     */
    server.tool(
      "GetAvailability",
      "Get detailed free/busy information for a date range. Shows all busy periods and working hours. Useful for understanding availability patterns before scheduling.",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("Client ID number (e.g., 10000002)"),
        startDate: z
          .string()
          .describe("Check availability from: '2025-10-20T09:00:00'"),
        endDate: z
          .string()
          .describe("Check availability until: '2025-10-20T17:00:00'"),
        emails: z
          .array(z.string().email())
          .optional()
          .describe(
            "Email addresses to check availability for: ['john@company.com'] (optional, uses client email if not provided)"
          ),
        intervalInMinutes: z
          .number()
          .optional()
          .describe("Time slot intervals: 15, 30, 60 minutes (default: 60)"),
      },
      async (input) => {
        try {
          console.log("📊 GetAvailability MCP Tool called");
          console.table(input);

          const numericClientId =
            typeof input.clientId === "string"
              ? parseInt(input.clientId, 10)
              : input.clientId;

          if (!numericClientId || isNaN(numericClientId)) {
            return {
              content: [
                {
                  type: "text",
                  text: "❌ **ERROR**: Client ID is required and must be a valid number",
                },
              ],
            };
          }

          const result = await getDetailedAvailability(
            numericClientId,
            input.startDate,
            input.endDate,
            input.emails
          );

          if (!result.success) {
            return {
              content: [
                {
                  type: "text",
                  text: `❌ **ERROR**: ${result.error}`,
                },
              ],
            };
          }

          let responseText = "📊 **AVAILABILITY INFORMATION**\n\n";
          responseText += `**Date Range**: ${new Date(input.startDate).toLocaleDateString("en-US")} - ${new Date(input.endDate).toLocaleDateString("en-US")}\n\n`;

          if (!result.availability || result.availability.length === 0) {
            responseText += "✅ **COMPLETELY FREE**\n\n";
            responseText += "No busy periods found. All time slots in this range are available for booking.";
          } else {
            responseText += "**BUSY PERIODS**:\n\n";

            result.availability.forEach((person) => {
              responseText += `👤 **${person.email}**:\n`;

              if (person.availability.length === 0) {
                responseText += "  ✅ Free for the entire period\n";
              } else {
                person.availability.forEach((slot, index) => {
                  const startTime = new Date(slot.start).toLocaleString(
                    "en-US"
                  );
                  const endTime = new Date(slot.end).toLocaleString("en-US");
                  responseText += `  ${index + 1}. **${slot.status.toUpperCase()}**: ${startTime} - ${endTime}\n`;
                });
              }

              responseText += "\n";
            });

            responseText += "💡 Use FindAvailableSlots to get specific free time slots for booking.";
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
                text: `❌ **UNEXPECTED ERROR**\n\n${error instanceof Error ? error.message : "Unknown error occurred"}`,
              },
            ],
          };
        }
      }
    );
  },
  {},
  { basePath: "/api/booking" }
);

export { handler as GET, handler as POST };

