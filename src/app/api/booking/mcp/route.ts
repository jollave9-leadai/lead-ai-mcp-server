import { z } from "zod";
import { createMcpHandler } from "mcp-handler";
import { FinalOptimizedCalendarOperations } from "@/lib/helpers/calendar_functions/finalOptimizedCalendarOperations";
import { AgentCalendarService } from "@/lib/helpers/booking/agentCalendarService";
import {
  getContactWithFuzzySearch,
  getCalendarConnectionByAgent,
  isWithinOfficeHours 
} from "@/lib/helpers/utils";
import type {
  CreateGraphEventMCPRequest,
  GetAvailabilityRequest,
} from "@/types";


const handler = createMcpHandler((server) => {
  // CreateCalendarEvent - Main booking tool for customers
  server.tool(
    "CreateCalendarEvent",
    "Book a new appointment with an agent. Searches both customers and leads database, checks for conflicts, validates office hours, and sends email invitations. Ideal for inbound/outbound AI agents. For VAPI: Use {{now}} variable for datetime formatting.",
    {
      clientId: z
        .union([z.number(), z.string().transform(Number)])
        .describe("Client ID number (e.g., 10000001)"),
      agentId: z
        .union([z.number(), z.string().transform(Number)])
        .describe("Agent ID making the call (e.g., 123) - required to identify which calendar to use"),
      subject: z.string().describe("Meeting title (e.g., 'Sales Call with John Smith')"),
      startDateTime: z
        .string()
        .describe("Start time in ISO format: '2025-10-15T14:00:00'. For VAPI: Use {{now}} variable (e.g., {{now.plus({days: 1}).set({hour: 14, minute: 0}).toISO()}})"),
      endDateTime: z
        .string()
        .describe("End time in ISO format: '2025-10-15T15:00:00'. For VAPI: Use {{now}} variable (e.g., {{now.plus({days: 1}).set({hour: 15, minute: 0}).toISO()}})"),
      contactName: z
        .string()
        .optional()
        .describe("Contact name to search in database: 'John Smith' (searches both customers and leads automatically)"),
      contactPhone: z
        .string()
        .optional()
        .describe("Contact phone number: '+1234567890' (useful for inbound/outbound call context)"),
      attendeeEmail: z
        .string()
        .email()
        .optional()
        .describe("Attendee email: 'john@company.com' (required if contact not found in database)"),
      attendeeName: z
        .string()
        .optional()
        .describe("Attendee display name: 'John Smith' (auto-filled from contact database)"),
      searchType: z
        .enum(['customer', 'lead', 'both'])
        .optional()
        .default('both')
        .describe("Where to search for contact: 'customer' (existing customers), 'lead' (prospects), 'both' (default)"),
      description: z
        .string()
        .optional()
        .describe("Meeting description or notes (optional)"),
      location: z
        .string()
        .optional()
        .describe("Meeting location: 'Conference Room A' or address (optional)"),
      isOnlineMeeting: z
        .boolean()
        .optional()
        .default(true)
        .describe("Create Teams meeting: true/false (default: true)"),
      calendarId: z
        .string()
        .optional()
        .describe("Calendar ID (optional, uses primary calendar if not specified)"),
    },
    async (input) => {
      try {
        const {
          clientId,
          agentId,
          subject,
          startDateTime,
          endDateTime,
          contactName,
          contactPhone,
          attendeeEmail,
          attendeeName,
          searchType,
          description,
          location,
          isOnlineMeeting,
          calendarId,
        } = input;
        
        console.log("📅 Customer booking request (CreateCalendarEvent)");
        console.table(input);
        
        // Convert and validate clientId and agentId
        const numericClientId =
          typeof clientId === "string" ? parseInt(clientId, 10) : clientId;
        const numericAgentId =
          typeof agentId === "string" ? parseInt(agentId, 10) : agentId;

        if (!numericClientId || isNaN(numericClientId)) {
          return {
            content: [
              {
                type: "text",
                text: "❌ Invalid client ID. Please provide a valid client ID number.",
              },
            ],
          };
        }

        if (!numericAgentId || isNaN(numericAgentId)) {
          return {
            content: [
              {
                type: "text",
                text: "❌ Invalid agent ID. Please provide a valid agent ID number.",
              },
            ],
          };
        }

        // Contact lookup logic (searches both customers and leads)
        let finalAttendeeEmail = attendeeEmail;
        let finalAttendeeName = attendeeName;
        let contactFound = false;
        let contactSource = '';

        // If contactName is provided, search in database
        if (contactName) {
          console.log(`🔍 Searching for contact: "${contactName}" for client ${numericClientId} (type: ${searchType})`);
          
          try {
            const contactResult = await getContactWithFuzzySearch(contactName, numericClientId.toString(), searchType);
            
            if (contactResult.found && contactResult.contact) {
              const contact = contactResult.contact;
              
              console.log(`✅ Found contact match:`, {
                score: contactResult.score,
                contact: {
                  id: contact.id,
                  full_name: contact.full_name,
                  email: contact.email,
                  company: contact.company,
                  source: contact.source
                }
              });

              if (contact.email) {
                finalAttendeeEmail = contact.email;
                finalAttendeeName = contact.full_name || attendeeName;
                contactFound = true;
                contactSource = contact.source;
                
                console.log(`📧 Using ${contact.source} email: ${finalAttendeeEmail} (${finalAttendeeName})`);
              } else {
                console.log(`⚠️ Contact found but no email address available`);
              }
            } else {
              console.log(`❌ No contact found matching: "${contactName}" in ${searchType}`);
            }
          } catch (error) {
            console.error('Error searching for contact:', error);
          }
        }

        // Validate that we have an email address
        if (!finalAttendeeEmail) {
          let errorMessage = "";
          if (contactName && !contactFound) {
            errorMessage = `Contact "${contactName}" not found in ${searchType === 'both' ? 'customers or leads' : searchType} database. Please provide attendeeEmail manually, or check the contact name spelling.`;
          } else if (contactName && contactFound) {
            errorMessage = `Contact "${contactName}" found but has no email address. Please provide attendeeEmail manually.`;
          } else {
            errorMessage = "Either contactName (to search database) or attendeeEmail is required for booking.";
          }

          return {
            content: [
              {
                type: "text",
                text: `❌ ${errorMessage}`,
              },
            ],
          };
        }

        // Validate that the booking is not in the past
        console.log(`🕐 Validating booking time is not in the past...`)
        
        const now = new Date()
        const requestedStart = new Date(startDateTime)
        const minimumAdvanceMinutes = 15 // Minimum 15 minutes in advance
        const minimumBookingTime = new Date(now.getTime() + minimumAdvanceMinutes * 60 * 1000)
        
        const timeDifference = Math.floor((requestedStart.getTime() - now.getTime()) / (1000 * 60))
        
        if (requestedStart <= minimumBookingTime) {
          const errorMessage = timeDifference <= 0 
            ? `Cannot book in the past. Earliest available: ${minimumBookingTime.toLocaleString()}`
            : `Minimum ${minimumAdvanceMinutes} minutes advance required. Earliest available: ${minimumBookingTime.toLocaleString()}`
          
          return {
            content: [
              {
                type: "text",
                text: `❌ ${errorMessage}`,
              },
            ],
          }
        }
        
        console.log(`✅ Booking time is valid (${timeDifference} minutes in the future)`)

        // Get agent's calendar connection and validate office hours
        console.log(`🏢 Getting calendar connection for agent ${numericAgentId}...`);
        
        const agentCalendarResult = await getCalendarConnectionByAgent(numericAgentId, numericClientId);
        
        if (!agentCalendarResult.success) {
          return {
            content: [
              {
                type: "text",
                text: `❌ ${agentCalendarResult.error}`,
              },
            ],
          };
        }

        const { connection, agent } = agentCalendarResult;
        
        if (!connection || !agent) {
          return {
            content: [
              {
                type: "text",
                text: "❌ Failed to get agent calendar information. Please check agent calendar assignment.",
              },
            ],
          };
        }

        // Check if the requested time is within office hours
        const officeHoursCheck = isWithinOfficeHours(
          startDateTime, 
          agent.profiles.office_hours, 
          agent.profiles.timezone || 'Australia/Melbourne'
        );
        
        if (!officeHoursCheck.isWithin) {
          return {
            content: [
              {
                type: "text",
                text: `❌ ${officeHoursCheck.reason} (Agent: ${agent.name})`,
              },
            ],
          };
        }
        
        console.log(`✅ Requested time is within office hours for agent ${agent.name} (${agent.agent_type})`);
        console.log(`📅 Using calendar: ${connection.email} (${connection.display_name})`);

        // Create the calendar event using the agent's specific calendar connection
        const request: CreateGraphEventMCPRequest = {
          clientId: numericClientId,
          subject,
          startDateTime,
          endDateTime,
          attendeeEmail: finalAttendeeEmail,
          attendeeName: finalAttendeeName,
          description,
          location,
          isOnlineMeeting,
          calendarId,
        };

        // Create the event using the agent's specific calendar connection
        // We need to bypass the client-level calendar lookup and use the agent's calendar directly
        console.log(`📅 Creating event on agent ${agent.name}'s calendar: ${connection.email}`);
        
        const result = await AgentCalendarService.createEventWithAgentCalendar(
          connection,
          agent,
          request,
          numericClientId
        );

        if (!result.success) {
          // Check if it's a conflict with suggested slots
          if (result.availableSlots && result.availableSlots.length > 0) {
            let conflictText = `That time slot isn't available. Here are some alternative times:\n\n`;
            result.availableSlots.slice(0, 3).forEach((slot, index) => {
              conflictText += `${index + 1}. ${slot.startFormatted}\n`;
            });
            conflictText += `\nWhich of these times works better for you?`;
            
            return {
              content: [
                {
                  type: "text",
                  text: conflictText,
                },
              ],
            };
          }

          return {
            content: [
              {
                type: "text",
                text: `❌ Booking failed: ${result.error}`,
              },
            ],
          };
        }

        // Success response - VAPI optimized
        const eventTime = result.event?.start.dateTime 
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

        let successText = `Perfect! I've successfully booked your appointment.\n\n`;
        successText += `✅ Appointment Confirmed\n\n`;
        successText += `• Contact: ${finalAttendeeName || finalAttendeeEmail}`;
        if (contactFound && contactSource) {
          successText += ` (${contactSource === 'lead' ? 'Lead' : 'Customer'})`;
        }
        successText += `\n`;
        if (contactPhone) {
          successText += `• Phone: ${contactPhone}\n`;
        }
        successText += `• Type: ${subject}\n`;
        successText += `• Date & Time: ${eventTime}\n`;
        successText += `• Meeting: ${isOnlineMeeting ? 'Online Teams meeting' : 'In-person'}\n`;
        
        if (result.event?.onlineMeeting?.joinUrl) {
          successText += `• Meeting Link: Available in calendar invite\n`;
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
      } catch (error) {
        console.error("Error in CreateCalendarEvent:", error);
        return {
          content: [
            {
              type: "text",
              text: `❌ Error creating appointment: ${
                error instanceof Error ? error.message : "Unknown error"
              }`,
            },
          ],
        };
      }
    }
  );

  // FindAvailableSlots - Check availability and suggest alternatives
  server.tool(
    "FindAvailableSlots",
    "Check availability and suggest alternative time slots. Considers existing appointments and office hours. For VAPI: Use {{now}} variable for datetime formatting.",
    {
      clientId: z
        .union([z.number(), z.string().transform(Number)])
        .describe("Client ID number (e.g., 10000001)"),
      requestedStartTime: z
        .string()
        .describe("Preferred start time in ISO format: '2025-10-15T14:00:00'. For VAPI: Use {{now}} variable"),
      requestedEndTime: z
        .string()
        .describe("Preferred end time in ISO format: '2025-10-15T15:00:00'. For VAPI: Use {{now}} variable"),
      durationMinutes: z
        .number()
        .optional()
        .default(60)
        .describe("Meeting duration in minutes: 30, 60, 90 (default: 60)"),
      maxSuggestions: z
        .number()
        .optional()
        .default(5)
        .describe("Number of alternative slots to suggest: 3-10 (default: 5)"),
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
        
        console.log("🔍 Customer checking availability (FindAvailableSlots)");
        console.table(input);

        // Convert and validate clientId
        const numericClientId =
          typeof clientId === "string" ? parseInt(clientId, 10) : clientId;

        if (!numericClientId || isNaN(numericClientId)) {
          return {
            content: [
              {
                type: "text",
                text: "❌ Invalid client ID. Please provide a valid client ID number.",
              },
            ],
          };
        }

        const result = await FinalOptimizedCalendarOperations.findAvailableSlotsForClient(
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
                text: `❌ Error finding available slots: ${result.error}`,
              },
            ],
          };
        }

        const requestedTime = new Date(requestedStartTime).toLocaleString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });

        if (!result.hasConflict) {
          return {
            content: [
              {
                type: "text",
                text: `✅ Great news! Your requested time (${requestedTime}) is available and can be booked immediately.`,
              },
            ],
          };
        } else {
          let responseText = `I'm sorry, ${requestedTime} isn't available.`;
          
          if (result.availableSlots && result.availableSlots.length > 0) {
            responseText += ` Here are some alternative times I found:\n\n`;
            
            result.availableSlots.slice(0, 3).forEach((slot, index) => {
              responseText += `${index + 1}. ${slot.startFormatted}\n`;
            });
            
            responseText += `\nWhich of these times works better for you?`;
          } else {
            responseText += ` Unfortunately, I couldn't find any alternative slots within business hours. Please try a different date.`;
          }

          return {
            content: [
              {
                type: "text",
                text: responseText,
              },
            ],
          };
        }
      } catch (error) {
        console.error("Error in FindAvailableSlots:", error);
          return {
            content: [
              {
                type: "text",
                text: `❌ Error finding available slots: ${
                  error instanceof Error ? error.message : "Unknown error"
                }`,
              },
            ],
          };
      }
    }
  );

  // GetAvailability - Check detailed availability information
  server.tool(
    "GetAvailability",
    "Check when people are free or busy. Shows detailed availability information for scheduling. For VAPI: Use {{now}} variable for datetime formatting.",
    {
      clientId: z
        .union([z.number(), z.string().transform(Number)])
        .describe("Client ID number (e.g., 10000001)"),
      startDate: z
        .string()
        .describe("Check from in ISO format: '2025-10-15T09:00:00'. For VAPI: Use {{now}} variable"),
      endDate: z
        .string()
        .describe("Check until in ISO format: '2025-10-15T17:00:00'. For VAPI: Use {{now}} variable"),
      emails: z
        .array(z.string().email())
        .optional()
        .describe("Email addresses to check: ['john@company.com'] (optional, uses client email if not provided)"),
      intervalInMinutes: z
        .number()
        .optional()
        .describe("Time slot intervals: 15, 30, 60 minutes (default: 60)"),
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
        
        console.log("📊 Customer checking detailed availability (GetAvailability)");
        console.table(input);

        // Convert and validate clientId
        const numericClientId =
          typeof clientId === "string" ? parseInt(clientId, 10) : clientId;

        if (!numericClientId || isNaN(numericClientId)) {
          return {
            content: [
              {
                type: "text",
                text: "❌ Invalid client ID. Please provide a valid client ID number.",
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

        const result = await FinalOptimizedCalendarOperations.getAvailabilityForClient(numericClientId, request);

        if (!result.success) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Error retrieving availability: ${result.error}`,
              },
            ],
          };
        }

        const dateRange = `${new Date(startDate).toLocaleDateString("en-US")} - ${new Date(endDate).toLocaleDateString("en-US")}`;

        if (!result.availability || result.availability.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `✅ Great news! No busy times found for ${dateRange}. All requested time slots appear to be available for booking.`,
              },
            ],
          };
        } else {
          let responseText = `📊 Availability for ${dateRange}:\n\n`;

          result.availability.forEach((person) => {
            responseText += `👤 ${person.email}:\n`;
            
            if (person.availability.length === 0) {
              responseText += `   ✅ Available for the entire period\n`;
            } else {
              person.availability.forEach((slot, index) => {
                const startTime = new Date(slot.start).toLocaleString("en-US");
                const endTime = new Date(slot.end).toLocaleString("en-US");
                responseText += `   ${index + 1}. ${slot.status.toUpperCase()}: ${startTime} - ${endTime}\n`;
              });
            }
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
        }
      } catch (error) {
        console.error("Error in GetAvailability:", error);
        return {
          content: [
            {
              type: "text",
              text: `❌ Error retrieving availability: ${
                error instanceof Error ? error.message : "Unknown error"
              }`,
            },
          ],
        };
      }
    }
  );

  // CheckCalendarConnection - Verify calendar connection
  server.tool(
    "CheckCalendarConnection",
    "Verify if a client has Microsoft calendar connected. Shows connection status and details.",
    {
      clientId: z
        .union([z.number(), z.string().transform(Number)])
        .describe("Client ID number (e.g., 10000001)"),
    },
    async (input) => {
      try {
        const { clientId } = input;
        
        console.log("🔗 Customer checking calendar connection");
        console.table(input);

        // Convert and validate clientId
        const numericClientId =
          typeof clientId === "string" ? parseInt(clientId, 10) : clientId;

        if (!numericClientId || isNaN(numericClientId)) {
          return {
            content: [
              {
                type: "text",
                text: "❌ Invalid client ID. Please provide a valid client ID number.",
              },
            ],
          };
        }

        const summary = await FinalOptimizedCalendarOperations.checkClientCalendarConnection(numericClientId);

        if (!summary) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Could not retrieve calendar connection information for client ${numericClientId}`,
              },
            ],
          };
        }

        if (summary.connected) {
          let responseText = `✅ Calendar is connected and ready for booking!\n\n`;
          
          if (summary.connectionDetails) {
            const details = summary.connectionDetails;
            responseText += `📧 Connected Account: ${details.userEmail}\n`;
            responseText += `👤 User: ${details.userName}\n`;
            responseText += `📅 Connected: ${new Date(details.connectedAt).toLocaleDateString()}\n`;
            
            if (details.calendarsCount !== undefined) {
              responseText += `📊 Available Calendars: ${details.calendarsCount}\n`;
            }
          }
          
          responseText += `\nYou can now book appointments through this system.`;

          return {
            content: [
              {
                type: "text",
                text: responseText,
              },
            ],
          };
        } else {
          let responseText = `❌ Calendar not connected\n\n`;
          if (summary.error) {
            responseText += `Error: ${summary.error}\n\n`;
          }
          responseText += `Please connect your Microsoft calendar before booking appointments.`;

          return {
            content: [
              {
                type: "text",
                text: responseText,
              },
            ],
          };
        }
      } catch (error) {
        console.error("Error in CheckCalendarConnection:", error);
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

  // GetCalendars - List available calendars
  server.tool(
    "GetCalendars",
    "List all available calendars for a client. Shows primary and secondary calendars.",
    {
      clientId: z
        .union([z.number(), z.string().transform(Number)])
        .describe("Client ID number (e.g., 10000001)"),
    },
    async (input) => {
      try {
        const { clientId } = input;
        
        console.log("📅 Customer checking available calendars");
        console.table(input);
        
        // Convert and validate clientId
        const numericClientId =
          typeof clientId === "string" ? parseInt(clientId, 10) : clientId;

        if (!numericClientId || isNaN(numericClientId)) {
          return {
            content: [
              {
                type: "text",
                text: "❌ Invalid client ID. Please provide a valid client ID number.",
              },
            ],
          };
        }

        const result = await FinalOptimizedCalendarOperations.getCalendarsForClient(numericClientId);

        if (!result.success) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Error retrieving calendars: ${result.error}`,
              },
            ],
          };
        }

        if (!result.calendars || result.calendars.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `📅 No calendars found for client ${numericClientId}. Please check your calendar connection.`,
              },
            ],
          };
        } else {
          let responseText = `📅 Available calendars for booking:\n\n`;

          result.calendars.forEach((calendar, index) => {
            responseText += `${index + 1}. **${calendar.name}**\n`;
            responseText += `   ${calendar.isDefault ? "✅ Primary Calendar" : "📋 Secondary Calendar"}\n`;
            responseText += `   Owner: ${calendar.owner}\n`;
            responseText += `   ID: \`${calendar.id}\`\n\n`;
          });

          return {
            content: [
              {
                type: "text",
                text: responseText,
              },
            ],
          };
        }
      } catch (error) {
        console.error("Error in GetCalendars:", error);
        return {
          content: [
            {
              type: "text",
              text: `❌ Error retrieving calendars: ${
                error instanceof Error ? error.message : "Unknown error"
              }`,
            },
          ],
        };
      }
    }
  );

}, {}, { basePath: "/api/booking" });

export { handler as GET, handler as POST };