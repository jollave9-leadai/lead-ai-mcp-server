import { z } from "zod";
import { createMcpHandler } from "mcp-handler";
import { SimplifiedBookingService } from "@/lib/helpers/booking/simplifiedBookingService";

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

      console.log("📅 Customer booking request");
      console.table(input);

      const numericClientId = typeof clientId === "string" ? parseInt(clientId, 10) : clientId;

      if (!numericClientId || isNaN(numericClientId)) {
        return {
          content: [
            {
              type: "text",
              text: "❌ **Booking Failed**\n\nInvalid client ID. Please provide a valid client ID number.",
            },
          ],
        };
      }

      // Use the simplified booking service
      const result = await SimplifiedBookingService.bookAppointment({
        clientId: numericClientId,
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
      });

      if (result.success) {
        // Successful booking
        let successText = `✅ **Appointment Booked Successfully!**\n\n`;
        successText += `**📋 Booking Details:**\n`;
        successText += `- **Customer**: ${customerName}\n`;
        successText += `- **Type**: ${appointmentType}\n`;
        successText += `- **Date & Time**: ${new Date(result.event?.start?.dateTime || '').toLocaleString()}\n`;
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
        
        successText += `\n📧 **Confirmation emails sent to all participants.**`;
        
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
        // Booking failed - check if alternatives are available
        if (result.availableSlots && result.availableSlots.length > 0) {
          let responseText = `⚠️ **Time Slot Unavailable**\n\n`;
          responseText += `${result.error}\n\n`;
          responseText += `**📋 Available Alternative Times:**\n\n`;

          result.availableSlots.forEach((slot, index) => {
            responseText += `${index + 1}. **${slot.startFormatted}** - ${slot.endFormatted}\n`;
          });

          responseText += `\n💡 **${result.suggestedAction || 'Please choose one of the available times above.'}**`;

          return {
            content: [
              {
                type: "text",
                text: responseText,
              },
            ],
          };
        } else {
          // No alternatives available
          return {
            content: [
              {
                type: "text",
                text: `❌ **Booking Failed**\n\n${result.error}\n\n💡 **${result.suggestedAction || 'Please try again or contact support.'}**`,
              },
            ],
          };
        }
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

      console.log("🔍 Customer checking availability");
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

      // Use the simplified booking service
      const result = await SimplifiedBookingService.checkAvailability({
        clientId: numericClientId,
        dateRequest,
        startDate,
        endDate,
        duration,
        maxSlots
      });

      if (!result.success) {
        return {
          content: [
            {
              type: "text",
              text: `❌ **Error**: ${result.error}\n\nPlease try again or contact support.`,
            },
          ],
        };
      }

      if (!result.availableSlots || result.availableSlots.length === 0) {
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
      responseText += `Found **${result.availableSlots.length}** available slot(s) for ${duration}-minute appointments:\n\n`;

      result.availableSlots.forEach((slot, index) => {
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
    }
  );

},
{}, 
{ basePath: "/api/booking"});

export { handler as GET, handler as POST };
