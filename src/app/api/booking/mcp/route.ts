import { z } from "zod";
import { createMcpHandler } from "mcp-handler";
import { FinalOptimizedCalendarOperations } from "@/lib/helpers/calendar_functions/finalOptimizedCalendarOperations";
import { AdvancedCacheService } from "@/lib/helpers/cache/advancedCacheService";
import {
  getCustomerWithFuzzySearch, 
  getAgentByCalendarConnection, 
  isWithinOfficeHours
} from "@/lib/helpers/utils";

const handler = createMcpHandler((server) => {
  // BookAppointment - Main booking tool with smart slot suggestions
  server.tool(
    "BookAppointment",
    "Book an appointment with an agent. Automatically suggests alternative slots if requested time is unavailable.",
    {
      clientId: z
        .union([z.number(), z.string().transform(Number)])
        .describe("Client ID number (e.g., 10000001)"),
      customerName: z
        .string()
        .describe("Customer's full name: 'John Smith' or 'Jane Doe'"),
      customerEmail: z
        .string()
        .email()
        .optional()
        .describe("Customer's email address (optional if customer exists in system)"),
      customerPhone: z
        .string()
        .optional()
        .describe("Customer's phone number (recommended for outbound calls)"),
      callContext: z
        .string()
        .optional()
        .describe("Context from the call: 'Interested in premium package', 'Follow-up from previous demo' (optional)"),
      appointmentType: z
        .string()
        .describe("Type of appointment: 'Sales Call', 'Consultation', 'Follow-up', 'Demo'"),
      preferredDateTime: z
        .string()
        .describe("Preferred date and time: '2025-10-08T14:00:00' or natural language like 'tomorrow at 2pm'"),
      duration: z
        .number()
        .default(60)
        .describe("Appointment duration in minutes (default: 60)"),
      notes: z
        .string()
        .optional()
        .describe("Additional notes or requirements for the appointment"),
      isOnlineMeeting: z
        .boolean()
        .default(true)
        .describe("Create Teams meeting: true for online, false for in-person (default: true)"),
      location: z
        .string()
        .optional()
        .describe("Meeting location if in-person, or additional location details"),
    },
    async (input) => {
      const { 
        clientId, 
        customerName, 
        customerEmail, 
        customerPhone,
        callContext,
        appointmentType, 
        preferredDateTime, 
        duration, 
        notes, 
        isOnlineMeeting, 
        location 
      } = input;

      console.log("📅 Booking appointment request");
      console.table(input);

      const numericClientId = typeof clientId === "string" ? parseInt(clientId, 10) : clientId;

      if (!numericClientId || isNaN(numericClientId)) {
        return {
          content: [
            {
              type: "text",
              text: "❌ **Booking Failed**\n\nError: Invalid client ID. Please provide a valid client ID number.",
            },
          ],
        };
      }

      try {
        // 1. Find or validate customer
        let finalCustomerEmail = customerEmail;
        let finalCustomerName = customerName;
        let customerId: number | null = null;

        if (!customerEmail) {
          console.log(`🔍 Looking up customer: "${customerName}" for client ${numericClientId}`);
          
          try {
            const searchResults = await getCustomerWithFuzzySearch(customerName, numericClientId.toString());
            if (searchResults && searchResults.length > 0) {
              const customer = searchResults[0].item; // Get the first match
              finalCustomerEmail = customer.email;
              finalCustomerName = customer.full_name || customerName;
              customerId = customer.id;
              console.log(`✅ Found existing customer: ${finalCustomerEmail}`);
            } else {
              return {
                content: [
                  {
                    type: "text",
                    text: `❌ **Booking Failed**\n\n**Customer Not Found**: "${customerName}"\n\nPlease provide the customer's email address or ensure the customer exists in the system.`,
                  },
                ],
              };
            }
          } catch (error) {
            console.error("Error looking up customer:", error);
            return {
              content: [
                {
                  type: "text",
                  text: `❌ **Booking Failed**\n\n**Customer Lookup Error**: Could not verify customer "${customerName}"\n\nPlease provide the customer's email address to proceed with booking.`,
                },
              ],
            };
          }
        }

        if (!finalCustomerEmail) {
          return {
            content: [
              {
                type: "text",
                text: `❌ **Booking Failed**\n\n**Missing Email**: Customer email is required for appointment booking.\n\nPlease provide the customer's email address.`,
              },
            ],
          };
        }

        // 2. Get calendar connection and validate agent info
        console.log(`🏢 Checking calendar connection and agent availability...`);
        
        let agentInfo;
        let calendarConnection;
        try {
          // Get calendar connection first
          const clientData = await AdvancedCacheService.getClientCalendarData(numericClientId);
          if (!clientData?.connection) {
            return {
              content: [
                {
                  type: "text",
                  text: `❌ **Booking Failed**\n\n**No Calendar Connection**: No calendar is connected for this client.\n\nPlease connect a Microsoft calendar to enable booking.`,
                },
              ],
            };
          }
          
          calendarConnection = clientData.connection;
          
          // Get agent assigned to this calendar connection
          agentInfo = await getAgentByCalendarConnection(calendarConnection.id, numericClientId);
          if (!agentInfo) {
            return {
              content: [
                {
                  type: "text",
                  text: `❌ **Booking Failed**\n\n**No Agent Available**: No agent is currently assigned to handle bookings for this client.\n\nPlease contact support to set up agent availability.`,
                },
              ],
            };
          }
        } catch (error) {
          console.error("Error getting agent info:", error);
          return {
            content: [
              {
                type: "text",
                text: `❌ **Booking Failed**\n\n**Agent Lookup Error**: Could not verify agent availability.\n\nPlease try again or contact support.`,
              },
            ],
          };
        }

        // 3. Parse and validate requested time
        let startDateTime: string;
        let endDateTime: string;

        try {
          // Handle natural language or ISO format
          if (preferredDateTime.includes('T')) {
            // ISO format
            startDateTime = preferredDateTime;
          } else {
            // Natural language - you might want to add a date parsing library here
            // For now, assume it's already in the correct format
            startDateTime = preferredDateTime;
          }

          const startDate = new Date(startDateTime);
          const endDate = new Date(startDate.getTime() + duration * 60 * 1000);
          endDateTime = endDate.toISOString().slice(0, 19); // Remove milliseconds and Z
        } catch (dateError) {
          console.error("Date parsing error:", dateError);
          return {
            content: [
              {
                type: "text",
                text: `❌ **Booking Failed**\n\n**Invalid Date**: Could not parse the preferred date/time "${preferredDateTime}"\n\nPlease use format like "2025-10-08T14:00:00" or "tomorrow at 2pm"`,
              },
            ],
          };
        }

        // 4. Check if requested time is in the past
        const requestedTime = new Date(startDateTime);
        const now = new Date();
        const minimumAdvanceTime = new Date(now.getTime() + 15 * 60 * 1000); // 15 minutes advance

        if (requestedTime < minimumAdvanceTime) {
          return {
            content: [
              {
                type: "text",
                text: `❌ **Booking Failed**\n\n**Invalid Time**: Cannot book appointments in the past or less than 15 minutes in advance.\n\n**Requested**: ${requestedTime.toLocaleString()}\n**Minimum Time**: ${minimumAdvanceTime.toLocaleString()}\n\nPlease choose a future time.`,
              },
            ],
          };
        }

        // 5. Check office hours
        const agent = agentInfo.agents as unknown as {
          id: number;
          name: string;
          profiles: {
            id: number;
            name: string;
            office_hours: Record<string, { start: string; end: string; enabled: boolean }>;
            timezone: string;
          } | {
            id: number;
            name: string;
            office_hours: Record<string, { start: string; end: string; enabled: boolean }>;
            timezone: string;
          }[];
        };
        
        const profile = Array.isArray(agent.profiles) ? agent.profiles[0] : agent.profiles;
        const officeHours = profile?.office_hours;
        const agentTimezone = profile?.timezone || 'UTC';

        if (officeHours && !isWithinOfficeHours(startDateTime, officeHours, agentTimezone)) {
          // Get available slots within office hours
          console.log(`⏰ Requested time is outside office hours, finding alternatives...`);
          
          try {
            const slotsResult = await FinalOptimizedCalendarOperations.findAvailableSlotsForClient(
              numericClientId,
              startDateTime,
              endDateTime,
              duration,
              5 // max 5 suggestions
            );

            if (slotsResult.success && slotsResult.availableSlots && slotsResult.availableSlots.length > 0) {
              let responseText = `⏰ **Outside Office Hours**\n\n`;
              responseText += `The requested time (${requestedTime.toLocaleString()}) is outside business hours.\n\n`;
              responseText += `**📋 Available Alternative Times:**\n\n`;

              slotsResult.availableSlots.forEach((slot, index) => {
                responseText += `${index + 1}. **${slot.startFormatted}** - ${slot.endFormatted}\n`;
              });

              responseText += `\n💡 **To book one of these slots**, use the BookAppointment tool with your preferred alternative time.`;

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
                    text: `⏰ **Outside Office Hours**\n\nThe requested time is outside business hours and no alternative slots are currently available.\n\nPlease contact us during business hours or try a different date.`,
                  },
                ],
              };
            }
          } catch (slotError) {
            console.error("Error finding alternative slots:", slotError);
            return {
              content: [
                {
                  type: "text",
                  text: `⏰ **Outside Office Hours**\n\nThe requested time is outside business hours.\n\nPlease choose a time during business hours or contact support.`,
                },
              ],
            };
          }
        }

        // 6. Attempt to book the appointment
        console.log(`📅 Attempting to book appointment for ${finalCustomerName} at ${startDateTime}`);

        const bookingRequest = {
          clientId: numericClientId,
          subject: `${appointmentType} - ${finalCustomerName}`,
          startDateTime,
          endDateTime,
          attendeeEmail: finalCustomerEmail,
          attendeeName: finalCustomerName,
          description: [
            appointmentType,
            callContext ? `Call Context: ${callContext}` : '',
            notes ? `Notes: ${notes}` : ''
          ].filter(Boolean).join('\n\n'),
          location,
          isOnlineMeeting,
          // Add metadata for traceability and future features
          metadata: {
            client_id: numericClientId,
            agent_id: agentInfo.agents[0].id,
            customer_id: customerId,
            booking_source: 'booking_mcp',
            call_context: callContext || null,
            customer_phone: customerPhone || null,
            created_via: agentInfo.agents[0].agent_type || 'unknown',
            appointment_type: appointmentType
          }
        };

        const result = await FinalOptimizedCalendarOperations.createCalendarEventForClient(
          numericClientId,
          bookingRequest
        );

        if (result.success) {
          // Successful booking
          let successText = `✅ **Appointment Booked Successfully!**\n\n`;
          successText += `**📋 Booking Details:**\n`;
          successText += `- **Customer**: ${finalCustomerName}\n`;
          successText += `- **Email**: ${finalCustomerEmail}\n`;
          successText += `- **Type**: ${appointmentType}\n`;
          successText += `- **Date & Time**: ${new Date(startDateTime).toLocaleString()}\n`;
          successText += `- **Duration**: ${duration} minutes\n`;
          
          if (isOnlineMeeting && result.event?.onlineMeeting?.joinUrl) {
            successText += `- **Meeting Link**: ${result.event.onlineMeeting.joinUrl}\n`;
          } else if (location) {
            successText += `- **Location**: ${location}\n`;
          }
          
          if (callContext) {
            successText += `- **Call Context**: ${callContext}\n`;
          }
          
          if (notes) {
            successText += `- **Notes**: ${notes}\n`;
          }
          
          successText += `\n📧 **Confirmation emails have been sent to all participants.**`;
          
          if (customerPhone) {
            successText += `\n📱 **Customer Phone**: ${customerPhone}`;
          }

          return {
            content: [
              {
                type: "text",
                text: successText,
              },
            ],
          };
        } else {
          // Booking failed - check if it's due to conflicts
          if (result.availableSlots && result.availableSlots.length > 0) {
            let conflictText = `⚠️ **Time Slot Unavailable**\n\n`;
            conflictText += `The requested time (${new Date(startDateTime).toLocaleString()}) is already booked.\n\n`;
            conflictText += `**📋 Available Alternative Times:**\n\n`;

            result.availableSlots.forEach((slot, index) => {
              conflictText += `${index + 1}. **${slot.startFormatted}** - ${slot.endFormatted}\n`;
            });

            conflictText += `\n💡 **To book one of these slots**, use the BookAppointment tool with your preferred alternative time.`;

            return {
              content: [
                {
                  type: "text",
                  text: conflictText,
                },
              ],
            };
          } else {
            // Other booking error
            return {
              content: [
                {
                  type: "text",
                  text: `❌ **Booking Failed**\n\n**Error**: ${result.error || 'Unknown error occurred'}\n\nPlease try again or contact support.`,
                },
              ],
            };
          }
        }

      } catch (error) {
        console.error("Error in BookAppointment:", error);
        return {
          content: [
            {
              type: "text",
              text: `❌ **Booking Failed**\n\n**System Error**: ${error instanceof Error ? error.message : 'An unexpected error occurred'}\n\nPlease try again or contact support.`,
            },
          ],
        };
      }
    }
  );

  // CheckAvailability - Check available time slots
  server.tool(
    "CheckAvailability",
    "Check available appointment slots for a specific date or date range",
    {
      clientId: z
        .union([z.number(), z.string().transform(Number)])
        .describe("Client ID number (e.g., 10000001)"),
      dateRequest: z
        .string()
        .optional()
        .describe("Natural language date: 'today', 'tomorrow', 'next monday' (optional)"),
      startDate: z
        .string()
        .optional()
        .describe("Start date: '2025-10-08T09:00:00' (use instead of dateRequest for specific dates)"),
      endDate: z
        .string()
        .optional()
        .describe("End date: '2025-10-08T17:00:00' (use with startDate for date range)"),
      duration: z
        .number()
        .default(60)
        .describe("Appointment duration in minutes (default: 60)"),
      maxSlots: z
        .number()
        .default(10)
        .describe("Maximum number of available slots to return (default: 10)"),
    },
    async (input) => {
      const { clientId, dateRequest, startDate, endDate, duration, maxSlots } = input;

      console.log("🔍 Checking availability");
      console.table(input);

      const numericClientId = typeof clientId === "string" ? parseInt(clientId, 10) : clientId;

      if (!numericClientId || isNaN(numericClientId)) {
        return {
          content: [
            {
              type: "text",
              text: "❌ **Error**: Invalid client ID. Please provide a valid client ID number.",
            },
          ],
        };
      }

      try {
        // Use either dateRequest or startDate/endDate
        let searchStartDate: string;
        let searchEndDate: string;

        if (dateRequest) {
          // For natural language, we'll use the calendar's date parsing
          const eventsResult = await FinalOptimizedCalendarOperations.getCalendarEventsForClient(
            numericClientId,
            { clientId: numericClientId, dateRequest }
          );

          if (!eventsResult.success) {
            return {
              content: [
                {
                  type: "text",
                  text: `❌ **Error**: Could not process date request "${dateRequest}"\n\nPlease use a specific date format like "2025-10-08T09:00:00"`,
                },
              ],
            };
          }

          // For availability check, we'll use today if dateRequest was used
          const today = new Date();
          searchStartDate = today.toISOString().slice(0, 19);
          const endOfDay = new Date(today);
          endOfDay.setHours(23, 59, 59);
          searchEndDate = endOfDay.toISOString().slice(0, 19);
        } else if (startDate && endDate) {
          searchStartDate = startDate;
          searchEndDate = endDate;
        } else {
          // Default to today
          const today = new Date();
          searchStartDate = today.toISOString().slice(0, 19);
          const endOfDay = new Date(today);
          endOfDay.setHours(23, 59, 59);
          searchEndDate = endOfDay.toISOString().slice(0, 19);
        }

        // Find available slots
        const slotsResult = await FinalOptimizedCalendarOperations.findAvailableSlotsForClient(
          numericClientId,
          searchStartDate,
          searchEndDate,
          duration,
          maxSlots
        );

        if (!slotsResult.success) {
          return {
            content: [
              {
                type: "text",
                text: `❌ **Error**: ${slotsResult.error || 'Could not check availability'}\n\nPlease try again or contact support.`,
              },
            ],
          };
        }

        if (!slotsResult.availableSlots || slotsResult.availableSlots.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `📅 **No Available Slots**\n\nNo available appointment slots found for the requested time period.\n\nPlease try a different date or contact us to discuss alternative options.`,
              },
            ],
          };
        }

        // Format the available slots
        let responseText = `📅 **Available Appointment Slots**\n\n`;
        responseText += `Found **${slotsResult.availableSlots.length}** available slot(s) for ${duration}-minute appointments:\n\n`;

        slotsResult.availableSlots.forEach((slot, index) => {
          responseText += `**${index + 1}. ${slot.startFormatted}** - ${slot.endFormatted}\n`;
        });

        responseText += `\n💡 **To book an appointment**, use the BookAppointment tool with your preferred time slot.`;

        return {
          content: [
            {
              type: "text",
              text: responseText,
            },
          ],
        };

      } catch (error) {
        console.error("Error in CheckAvailability:", error);
        return {
          content: [
            {
              type: "text",
              text: `❌ **Error**: ${error instanceof Error ? error.message : 'An unexpected error occurred'}\n\nPlease try again or contact support.`,
            },
          ],
        };
      }
    }
  );

},
{}, 
{ basePath: "/api/booking"});

export { handler as GET, handler as POST };
