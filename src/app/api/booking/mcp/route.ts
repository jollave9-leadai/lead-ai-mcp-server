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
        .describe("Preferred date and time in ISO format: '2025-10-15T14:00:00'. For VAPI: Use {{now}} variable to calculate relative times (e.g., for 'tomorrow at 2pm', use {{now.plus({days: 1}).set({hour: 14, minute: 0}).toISO()}})"),
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
        // VAPI-friendly success response - concise and voice-optimized
        const eventTime = result.event?.start?.dateTime 
          ? new Date(result.event.start.dateTime).toLocaleString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            })
          : 'the requested time';

        let successText = `Perfect! I've successfully booked your appointment. Here are the details:\n\n`;
        successText += `✅ Appointment Confirmed\n\n`;
        successText += `• Customer: ${customerName}\n`;
        successText += `• Email: ${result.event?.start?.dateTime ? 'confirmation sent' : 'will be sent'}\n`;
        successText += `• Type: ${appointmentType}\n`;
        successText += `• Date & Time: ${eventTime} (${duration} hour duration)\n`;
        successText += `• Meeting: Online Teams meeting\n`;
        
        if (result.event?.onlineMeeting?.joinUrl) {
          successText += `• Meeting Link: Join Teams Meeting\n`;
        }
        
        successText += `\nConfirmation emails have been sent to all participants.`;

        return {
          content: [
            {
              type: "text",
              text: successText,
            },
          ],
        };
      } else {
        // VAPI-friendly error responses
        if (result.availableSlots && result.availableSlots.length > 0) {
          let responseText = `I'm sorry, that time slot isn't available. ${result.error}\n\n`;
          responseText += `Here are some alternative times I found:\n\n`;

          result.availableSlots.slice(0, 3).forEach((slot, index) => {
            responseText += `${index + 1}. ${slot.startFormatted}\n`;
          });

          responseText += `\nWhich of these times works better for you?`;

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
                text: `I'm sorry, I couldn't book that appointment. ${result.error} ${result.suggestedAction || 'Please try a different time or let me know how I can help.'}`,
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
        .describe("Date to check in ISO format: '2025-10-15' or '2025-10-15T09:00:00'. For VAPI: Use {{now}} variable (e.g., for 'tomorrow', use {{now.plus({days: 1}).toISODate()}})"),
      startDate: z
        .string()
        .optional()
        .describe("Start date: '2025-10-15T09:00:00' (use for specific date ranges)"),
      endDate: z
        .string()
        .optional()
        .describe("End date: '2025-10-15T17:00:00' (use with startDate for date range)"),
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
              text: `I don't see any available appointment slots for that time period. Please try a different date or let me know if you'd like to check another time.`,
            },
          ],
        };
      }

      // VAPI-friendly available slots response
      let responseText = `I found ${result.availableSlots.length} available appointment slots:\n\n`;

      result.availableSlots.slice(0, 5).forEach((slot, index) => {
        responseText += `${index + 1}. ${slot.startFormatted}\n`;
      });

      responseText += `\nWhich time works best for you?`;

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
