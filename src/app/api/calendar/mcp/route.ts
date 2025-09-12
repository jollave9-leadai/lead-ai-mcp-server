import { z } from "zod";
import { createMcpHandler } from "mcp-handler";
import {
  validateISO8601Date,
  formatToISO8601,
} from "@/lib/helpers/calendar_functions/helper";
import {
  RescheduleBookingRequest,
  GetSlotsRequest,
  CreateBookingRequest,
  SearchCriteria,
} from "@/types";
import {
  getClientTimezone,
  rescheduleBookingForClient,
  searchBookings,
  findBookingForReschedule,
  getCalEventTypeIdsForClient,
  checkClientEventTypes,
  getEventTypesForClient,
  createSlotsSummary,
  formatSlotsForDisplay,
  getSlotsForClient,
  createValidatedBookingForClient,
} from "@/lib/helpers/calendar_functions";

const handler = createMcpHandler(
  (server) => {
    server.tool(
      "reschedule-booking",
      "Reschedule a booking",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("The ID of the client who owns the booking"),
        bookingUid: z.string().describe("The UID of the booking to reschedule"),
        newStartTime: z
          .string()
          .describe(
            "New start time in ISO 8601 format with timezone (YYYY-MM-DDTHH:mm:ss.sssZ). Examples: '2024-01-15T14:00:00.000Z', '2024-12-25T16:30:00Z'"
          ),
        reschedulingReason: z
          .string()
          .optional()
          .describe("Reason for rescheduling the booking"),
        rescheduledBy: z
          .string()
          .optional()
          .describe("Email or name of person rescheduling"),
        seatUid: z
          .string()
          .optional()
          .describe("For seated bookings: the specific seat UID to reschedule"),
        preferredManagedUserId: z
          .number()
          .optional()
          .describe("Preferred managed user ID to use for rescheduling"),
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
            preferredManagedUserId,
          } = input;

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

          const formattedNewStartTime = formatToISO8601(
            newStartTimeValidation.date!
          );
          console.log(
            `✅ New start time validated and formatted: ${newStartTime} → ${formattedNewStartTime}`
          );

          // Create rescheduling request object
          const rescheduleRequest: RescheduleBookingRequest = {
            start: formattedNewStartTime,
            ...(reschedulingReason && { reschedulingReason }),
            ...(rescheduledBy && { rescheduledBy }),
            ...(seatUid && { seatUid }),
          };

          console.log(`Rescheduling booking for client ${numericClientId}:`, {
            bookingUid,
            newStartTime,
            reschedulingReason,
            rescheduledBy,
            seatUid,
            preferredManagedUserId,
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
                text: `Error rescheduling booking: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              },
            ],
          };
        }
      }
    );
    server.tool(
      "Search-bookings",
      "Search for bookings by title, attendee email, or date. Useful for finding bookings before rescheduling or canceling.",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("The ID of the client to search bookings for"),
        title: z
          .string()
          .optional()
          .describe(
            "Search by booking title (partial match, case-insensitive)"
          ),
        attendeeEmail: z
          .string()
          .optional()
          .describe("Search by attendee email or name (partial match)"),
        date: z
          .string()
          .optional()
          .describe(
            "Search by specific date (YYYY-MM-DD, 'today', 'tomorrow')"
          ),
        dateRange: z
          .object({
            start: z.string(),
            end: z.string(),
          })
          .optional()
          .describe("Search within a date range (ISO 8601 format)"),
        status: z
          .array(z.string())
          .optional()
          .describe("Filter by booking status (e.g., ['accepted', 'pending'])"),
      },
      async (input) => {
        try {
          const { clientId, title, attendeeEmail, date, dateRange, status } =
            input;

          // Convert and validate clientId
          const numericClientId =
            typeof clientId === "string" ? parseInt(clientId, 10) : clientId;

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
          const searchCriteria: SearchCriteria = {};
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

          console.log(
            `🔍 Searching bookings for client ${numericClientId} with criteria:`,
            searchCriteria
          );

          const matchingBookings = await searchBookings(
            numericClientId,
            searchCriteria
          );

          let responseText = `**🔍 Booking Search Results** (Client ID: ${numericClientId})\n\n`;

          // Display search criteria
          responseText += `**🎯 Search Criteria:**\n`;
          if (title) responseText += `- **Title**: "${title}"\n`;
          if (attendeeEmail)
            responseText += `- **Attendee**: "${attendeeEmail}"\n`;
          if (date) responseText += `- **Date**: ${date}\n`;
          if (dateRange)
            responseText += `- **Date Range**: ${dateRange.start} to ${dateRange.end}\n`;
          if (status) responseText += `- **Status**: ${status.join(", ")}\n`;
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

              responseText += `**${index + 1}. ${
                booking.title || "Untitled Booking"
              }**\n`;
              responseText += `   - **UID**: \`${booking.uid}\`\n`;
              responseText += `   - **Date**: ${startDate.toLocaleDateString()}\n`;
              responseText += `   - **Time**: ${startDate.toLocaleTimeString()} - ${endDate.toLocaleTimeString()}\n`;
              responseText += `   - **Status**: ${
                booking.status || "Unknown"
              }\n`;

              if (booking.attendees && booking.attendees.length > 0) {
                responseText += `   - **Attendees**: ${booking.attendees
                  .map((a) => `${a.name} (${a.email})`)
                  .join(", ")}\n`;
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
                text: `❌ Error searching bookings: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              },
            ],
          };
        }
      }
    );

    server.tool(
      "RescheduleBookingByTitle",
      "Reschedule a booking by finding it using title and optional date, without needing to know the booking UID. Automatically finds the booking and reschedules it.",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("The ID of the client who owns the booking"),
        title: z
          .string()
          .describe("Title or partial title of the booking to reschedule"),
        currentDate: z
          .string()
          .optional()
          .describe(
            "Current date of the booking (YYYY-MM-DD, 'today', 'tomorrow') to help identify the correct booking"
          ),
        newStartTime: z
          .string()
          .describe(
            "New start time in ISO 8601 format with timezone (YYYY-MM-DDTHH:mm:ss.sssZ)"
          ),
        reschedulingReason: z
          .string()
          .optional()
          .describe("Reason for rescheduling the booking"),
        rescheduledBy: z
          .string()
          .optional()
          .describe("Email or name of person rescheduling"),
      },
      async (input) => {
        try {
          const {
            clientId,
            title,
            currentDate,
            newStartTime,
            reschedulingReason,
            rescheduledBy,
          } = input;

          // Convert and validate clientId
          const numericClientId =
            typeof clientId === "string" ? parseInt(clientId, 10) : clientId;

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
          if (currentDate)
            responseText += `- **Current Date**: ${currentDate}\n`;
          responseText += `- **New Time**: ${newStartTime}\n\n`;

          // Get client timezone for better date handling
          const clientTimezone = await getClientTimezone(numericClientId);
          const timezone = clientTimezone || "UTC";

          console.log(
            `🔍 Finding booking for reschedule: "${title}" on ${
              currentDate || "any date"
            }`
          );

          // Find the booking
          const booking = await findBookingForReschedule(
            numericClientId,
            title,
            currentDate
          );

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
          responseText += `- **Current Time**: ${new Date(
            booking.start
          ).toLocaleString("en-US", { timeZone: timezone })}\n`;
          responseText += `- **New Time**: ${new Date(
            newStartTime
          ).toLocaleString("en-US", { timeZone: timezone })}\n\n`;

          // Validate the new slot is available
          console.log(`🔍 Validating new slot availability...`);

          // Check if new slot is available (optional - you can remove this if you want to allow double-booking)
          try {
            const eventTypeIds = await getCalEventTypeIdsForClient(
              numericClientId
            );
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
          console.log(
            `🔄 Rescheduling booking ${booking.uid} to ${newStartTime}`
          );

          const rescheduleResult = await rescheduleBookingForClient(
            numericClientId,
            booking.uid,
            {
              start: newStartTime,
              reschedulingReason:
                reschedulingReason ||
                `Rescheduled via booking title search: "${title}"`,
              rescheduledBy: rescheduledBy || "System",
            }
          );

          if (rescheduleResult.success) {
            responseText += `🎉 **Rescheduling Successful!**\n\n`;
            responseText += `✅ **Booking Details:**\n`;
            if (rescheduleResult.newBookingUid) {
              responseText += `- **New UID**: \`${rescheduleResult.newBookingUid}\`\n`;
            }
            if (rescheduleResult.newStartTime) {
              responseText += `- **New Start**: ${new Date(
                rescheduleResult.newStartTime
              ).toLocaleString("en-US", { timeZone: timezone })}\n`;
            }
            if (rescheduleResult.newEndTime) {
              responseText += `- **New End**: ${new Date(
                rescheduleResult.newEndTime
              ).toLocaleString("en-US", { timeZone: timezone })}\n`;
            }
            if (reschedulingReason) {
              responseText += `- **Reason**: ${reschedulingReason}\n`;
            }
          } else {
            responseText += `❌ **Rescheduling Failed**\n\n`;
            responseText += `**Error**: ${rescheduleResult.error}\n\n`;

            if (
              rescheduleResult.error?.includes("slot") ||
              rescheduleResult.error?.includes("available")
            ) {
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
                text: `❌ Error rescheduling booking: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              },
            ],
          };
        }
      }
    );

    server.tool(
      "GetClientEventTypes",
      {
        title: "Get Client Event Types",
        description:
          "Get event types for a client, including cal_event_type_ids needed for calendar queries.",
        inputSchema: {
          clientId: z
            .union([z.number(), z.string().transform(Number)])
            .describe("The ID of the client to get event types for"),
        },
      },
      async (input) => {
        try {
          const { clientId } = input;

          // Convert and validate clientId
          const numericClientId =
            typeof clientId === "string" ? parseInt(clientId, 10) : clientId;

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
            responseText += `🔢 **Cal Event Type IDs**: ${summary.cal_event_type_ids.join(
              ", "
            )}\n\n`;

            if (eventTypes.length > 0) {
              responseText += `📝 **Event Type Details**:\n`;
              eventTypes.forEach((et, index) => {
                responseText += `${index + 1}. **${et.title}** (${et.slug})\n`;
                responseText += `   - Cal Event Type ID: ${et.cal_event_type_id}\n`;
                responseText += `   - Duration: ${et.length_in_minutes} minutes\n`;
                responseText += `   - Status: ${
                  et.is_active ? "✅ Active" : "❌ Inactive"
                }\n`;
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
                text: `❌ Error retrieving event types: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              },
            ],
          };
        }
      }
    );

    server.tool(
      "FormatDateForBooking",
      "Helper tool to format dates into proper ISO 8601 format required for booking creation and rescheduling.",
      {
        dateInput: z
          .string()
          .describe(
            "Date input in various formats (e.g., '2024-01-15 10:00', 'January 15, 2024 10:00 AM', '2024-01-15T10:00:00')"
          ),
        timezone: z
          .string()
          .optional()
          .describe(
            "Timezone to interpret the date in (e.g., 'America/New_York', 'Europe/London'). Defaults to UTC."
          ),
      },
      async (input) => {
        try {
          const { dateInput, timezone = "UTC" } = input;

          console.log(
            `🕐 Formatting date: ${dateInput} (timezone: ${timezone})`
          );

          // Try to parse the date
          let date: Date;

          try {
            // If timezone is provided and not UTC, we need to handle it carefully
            if (timezone !== "UTC") {
              // Create a date assuming the input is in the specified timezone
              const tempDate = new Date(dateInput);
              if (isNaN(tempDate.getTime())) {
                throw new Error("Invalid date format");
              }

              // Convert to the specified timezone
              const utcTime =
                tempDate.getTime() + tempDate.getTimezoneOffset() * 60000;
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
                  text: `❌ **Unable to Parse Date**\n\n**Input**: ${dateInput}\n**Error**: ${
                    error instanceof Error ? error.message : "Unknown error"
                  }\n\n**Supported Formats**:\n- ISO 8601: '2024-01-15T10:00:00Z'\n- Date string: 'January 15, 2024 10:00 AM'\n- Simple format: '2024-01-15 10:00'\n- Unix timestamp: 1705312800000`,
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

          responseText += `**✅ Ready for Booking**: ${
            isInFuture ? "Yes" : "No"
          }\n`;
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
          responseText += `- **Human Readable**: ${date.toLocaleString(
            "en-US",
            { timeZone: timezone }
          )}\n`;
          responseText += `- **Unix Timestamp**: ${date.getTime()}\n`;
          responseText += `- **Date Only**: ${
            date.toISOString().split("T")[0]
          }\n`;

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
                text: `Error formatting date: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              },
            ],
          };
        }
      }
    );

    server.tool(
      "GetAvailableSlots",
      "Get available time slots for an event type before creating a booking. Most common usage: provide clientId, start, end, and eventTypeId. Other parameters are optional for advanced use cases.",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("The ID of the client to get slots for"),
        start: z
          .string()
          .describe(
            "Start date/time in ISO 8601 format (UTC). Can be date only (2024-08-13) or with time (2024-08-13T09:00:00Z)"
          ),
        end: z
          .string()
          .describe(
            "End date/time in ISO 8601 format (UTC). Can be date only (2024-08-20) or with time (2024-08-20T18:00:00Z)"
          ),

        // Event type identification (most common: use eventTypeId)
        eventTypeId: z
          .number()
          .optional()
          .describe(
            "The ID of the event type for which to check available slots (RECOMMENDED - most common usage)"
          ),
        eventTypeSlug: z
          .string()
          .optional()
          .describe(
            "The slug of the event type (requires username or teamSlug) - ADVANCED usage only"
          ),

        // User/Team identification (required with eventTypeSlug)
        username: z
          .string()
          .optional()
          .describe(
            "Username of the user who owns the event type (for individual events)"
          ),
        teamSlug: z
          .string()
          .optional()
          .describe(
            "Slug of the team who owns the event type (for team events)"
          ),
        usernames: z
          .string()
          .optional()
          .describe(
            "Comma-separated usernames for dynamic events (minimum 2 users)"
          ),

        // Organization context
        organizationSlug: z
          .string()
          .optional()
          .describe(
            "Slug of the organization (required for org-scoped events)"
          ),

        // Optional parameters
        timeZone: z
          .string()
          .optional()
          .describe("Timezone for returned slots (defaults to UTC)"),
        duration: z
          .number()
          .optional()
          .describe("Duration in minutes for multi-duration or dynamic events"),
        format: z
          .enum(["time", "range"])
          .optional()
          .describe(
            "Format: 'time' for start time only, 'range' for start and end times"
          ),
        bookingUidToReschedule: z
          .string()
          .optional()
          .describe(
            "Booking UID when rescheduling (excludes original slot from busy times)"
          ),
        preferredManagedUserId: z
          .number()
          .optional()
          .describe("Preferred managed user ID to use for the request"),
      },
      async (input) => {
        try {
          const {
            clientId,
            start,
            end,
            eventTypeId,
            eventTypeSlug,
            username,
            teamSlug,
            usernames,
            timeZone,
            preferredManagedUserId,
          } = input;

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

          if (usernames && usernames.split(",").length < 2) {
            return {
              content: [
                {
                  type: "text",
                  text: "Error: usernames must contain at least 2 usernames separated by commas",
                },
              ],
            };
          }

          console.log(
            `🕒 Getting available slots for client ${numericClientId}`
          );

          // Build slots request (most common: start, end, eventTypeId)
          const slotsRequest: GetSlotsRequest = {
            start: formatToISO8601(start),
            end: formatToISO8601(end),
            eventTypeId,
          };

          // Get slots from Cal.com API
          const slotsResponse = await getSlotsForClient(
            numericClientId,
            slotsRequest,
            preferredManagedUserId
          );

          if (slotsResponse.status === "error") {
            return {
              content: [
                {
                  type: "text",
                  text: `❌ Error getting slots: ${
                    slotsResponse.error?.message || "Unknown error"
                  }`,
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
                text: `Error getting available slots: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              },
            ],
          };
        }
      }
    );

    server.tool(
      "CreateBooking",
      "Create a new booking for a client using Cal.com API. Requires event type ID, start time, and attendee information. Note: Slot availability validation is skipped for faster booking.",
      {
        clientId: z
          .union([z.number(), z.string().transform(Number)])
          .describe("The ID of the client to create booking for"),
        eventTypeId: z
          .number()
          .describe("The Cal.com event type ID for the booking"),
        startTime: z
          .string()
          .describe(
            "Start time in ISO 8601 format with timezone (YYYY-MM-DDTHH:mm:ss.sssZ). Examples: '2024-01-15T10:00:00.000Z', '2024-12-25T14:30:00Z'"
          ),
        attendeeName: z.string().describe("Name of the attendee"),
        attendeeEmail: z.string().email().describe("Email of the attendee"),
        attendeeTimeZone: z
          .string()
          .optional()
          .describe("Attendee's timezone (e.g., 'America/New_York')"),
        attendeePhoneNumber: z
          .string()
          .optional()
          .describe("Phone number of the attendee"),
        title: z.string().optional().describe("Custom title for the booking"),
        description: z
          .string()
          .optional()
          .describe("Description for the booking"),
        meetingUrl: z.string().optional().describe("Custom meeting URL"),
        language: z
          .string()
          .optional()
          .describe("Language code (e.g., 'en', 'es')"),
        preferredManagedUserId: z
          .number()
          .optional()
          .describe("Preferred managed user ID to use for booking creation"),
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
            description,
            language = "en",
            preferredManagedUserId,
          } = input;

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
          console.log(
            `✅ Start time validated and formatted: ${startTime} → ${formattedStartTime}`
          );

          // Get client's timezone if attendeeTimeZone is not provided
          let finalAttendeeTimeZone = attendeeTimeZone;
          if (!finalAttendeeTimeZone) {
            const clientTimezone = await getClientTimezone(numericClientId);
            finalAttendeeTimeZone = clientTimezone || "UTC";
            console.log(`Using client timezone: ${finalAttendeeTimeZone}`);
          } else {
            console.log(`Using provided timezone: ${finalAttendeeTimeZone}`);
          }

          console.log(
            `📅 Proceeding directly with booking for: ${formattedStartTime}`
          );

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
              ...(attendeePhoneNumber && { phoneNumber: attendeePhoneNumber }),
            },
            // ...(title && { title }),
            ...(description && { description }),
            // ...(meetingUrl && { meetingUrl })
          };
          console.log(`Booking Request from the server `, bookingRequest);
          console.log(`Creating booking for client ${numericClientId}:`, {
            eventTypeId,
            startTime,
            attendeeEmail,
            preferredManagedUserId,
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
                text: `Error creating booking: ${
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
