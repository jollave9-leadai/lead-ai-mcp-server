/**
 * Booking MCP Server Route
 * 
 * Provides 3 MCP tools for AI agents:
 * 1. FindAvailableSlots - Check availability and get alternative time slots
 * 2. GetAvailability - Get detailed availability information
 * 3. CreateBooking - Create a confirmed calendar booking
 */

import { z } from "zod";
import { createMcpHandler } from "mcp-handler";
import {
  findAvailableTimeSlots,
  getDetailedAvailability,
  createBooking,
} from "@/lib/helpers/booking_functions";
import {
  normalizeDateTimeString,
  createDateTimeErrorMessage,
} from "@/lib/helpers/booking_functions/dateNormalizer";

const handler = createMcpHandler(
  (server) => {
    /**
     * Tool 1: FindAvailableSlots
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
          .describe("Start time in ISO 8601 format: '2025-10-20T13:00:00' or '2025-10-20T13:00:00+08:00'. For VAPI: Use {{now}} variable and add duration to calculate."),
        requestedEndTime: z
          .string()
          .describe("End time in ISO 8601 format: '2025-10-20T14:00:00' or '2025-10-20T14:00:00+08:00'. Must be after start time."),
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

          // Normalize datetime strings from VAPI
          const normalizedStart = normalizeDateTimeString(input.requestedStartTime);
          if (!normalizedStart.success) {
            return {
              content: [
                {
                  type: "text",
                  text: createDateTimeErrorMessage(input.requestedStartTime),
                },
              ],
            };
          }

          const normalizedEnd = normalizeDateTimeString(input.requestedEndTime);
          if (!normalizedEnd.success) {
            return {
              content: [
                {
                  type: "text",
                  text: createDateTimeErrorMessage(input.requestedEndTime),
                },
              ],
            };
          }

          console.log(`✅ Normalized dates:`);
          console.log(`   Start: ${normalizedStart.originalInput} → ${normalizedStart.normalizedDateTime}`);
          console.log(`   End: ${normalizedEnd.originalInput} → ${normalizedEnd.normalizedDateTime}`);

          const result = await findAvailableTimeSlots({
            clientId: numericClientId,
            agentId: numericAgentId,
            startDateTime: normalizedStart.normalizedDateTime!,
            endDateTime: normalizedEnd.normalizedDateTime!,
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

    /**
     * Tool 3: CreateBooking
     * 
     * Create a confirmed calendar booking after availability has been checked
     */
    server.tool(
      "CreateBooking",
      "Create a confirmed calendar booking. Use this ONLY after checking availability with FindAvailableSlots. Creates Teams meeting by default.",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("Client ID number (e.g., 10000002)"),
        agentId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("Agent ID number (e.g., 123)"),
        subject: z
          .string()
          .min(3)
          .describe("Meeting title (e.g., 'Sales Call with John Smith')"),
        startDateTime: z
          .string()
          .describe("Start time in ISO 8601 format: '2025-10-20T13:00:00' or '2025-10-20T13:00:00+08:00'. For VAPI: Use {{now}} and add offset."),
        endDateTime: z
          .string()
          .describe("End time in ISO 8601 format: '2025-10-20T14:00:00' or '2025-10-20T14:00:00+08:00'. Must be after start time."),
        contactName: z
          .string()
          .describe("Contact name: 'John Smith'"),
        contactEmail: z
          .string()
          .email()
          .optional()
          .describe("Contact email: 'john@company.com' (optional - will check database first)"),
        contactPhone: z
          .string()
          .optional()
          .describe("Contact phone number (optional)"),
        description: z
          .string()
          .optional()
          .describe("Meeting description or agenda (optional)"),
        location: z
          .string()
          .optional()
          .describe("Meeting location (optional)"),
        isOnlineMeeting: z
          .boolean()
          .optional()
          .default(true)
          .describe("Create Teams meeting link (default: true)"),
      },
      async (input) => {
        try {
          console.log("📅 CreateBooking MCP Tool called");
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

          // Normalize datetime strings from VAPI
          const normalizedStart = normalizeDateTimeString(input.startDateTime);
          if (!normalizedStart.success) {
            return {
              content: [
                {
                  type: "text",
                  text: createDateTimeErrorMessage(input.startDateTime),
                },
              ],
            };
          }

          const normalizedEnd = normalizeDateTimeString(input.endDateTime);
          if (!normalizedEnd.success) {
            return {
              content: [
                {
                  type: "text",
                  text: createDateTimeErrorMessage(input.endDateTime),
                },
              ],
            };
          }

          console.log(`✅ Normalized dates:`);
          console.log(`   Start: ${normalizedStart.originalInput} → ${normalizedStart.normalizedDateTime}`);
          console.log(`   End: ${normalizedEnd.originalInput} → ${normalizedEnd.normalizedDateTime}`);

          // Create booking
          const result = await createBooking({
            clientId: numericClientId,
            agentId: numericAgentId,
            subject: input.subject,
            startDateTime: normalizedStart.normalizedDateTime!,
            endDateTime: normalizedEnd.normalizedDateTime!,
            contactName: input.contactName,
            contactEmail: input.contactEmail,
            contactPhone: input.contactPhone,
            description: input.description,
            location: input.location,
            isOnlineMeeting: input.isOnlineMeeting,
          });

          if (!result.success) {
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
          
          if (booking.contact.email) {
            responseText += `📧 **Email**: ${booking.contact.email}\n`;
          } else {
            responseText += `⚠️ **No email provided** - Invitation not sent\n`;
          }

          if (booking.location) {
            responseText += `📍 **Location**: ${booking.location}\n`;
          }

          if (booking.teamsLink) {
            responseText += `💻 **Teams Meeting**: ${booking.teamsLink}\n`;
          }

          responseText += `\n🆔 **Event ID**: ${booking.eventId}\n`;
          
          if (booking.contact.email) {
            responseText += `\n✉️ **Invitation sent** to ${booking.contact.email}`;
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
          console.error("Error in CreateBooking:", error);
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

