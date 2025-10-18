import type {
  CreateGraphEventMCPRequest,
  CreateGraphEventRequest,
  GraphEvent,
} from "@/types";

/**
 * Agent Calendar Service - Handles agent-specific calendar operations
 * Ensures events are created on the correct agent's calendar
 */
export class AgentCalendarService {
  
  /**
   * Create calendar event using agent's specific calendar connection
   * This ensures the event is created on the correct agent's calendar
   */
  static async createEventWithAgentCalendar(
    connection: {
      id: string;
      email: string;
      display_name: string;
      access_token: string;
      refresh_token: string;
      expires_at: string;
    },
    agent: {
      id: number;
      name: string;
      agent_type: string;
      profiles: {
        id: number;
        name: string;
        office_hours: Record<string, { start: string; end: string; enabled: boolean }>;
        timezone: string;
      };
    },
    request: CreateGraphEventMCPRequest,
    clientId: number
  ): Promise<{
    success: boolean;
    event?: GraphEvent;
    eventId?: string;
    error?: string;
    availableSlots?: Array<{
      start: string;
      end: string;
      startFormatted: string;
      endFormatted: string;
      confidence: number;
    }>;
  }> {
    try {
      // Import the necessary functions directly
      const { createGraphEvent } = await import("@/lib/helpers/calendar_functions/graphHelper");
      const { OptimizedConflictDetection } = await import("@/lib/helpers/calendar_functions/optimizedConflictDetection");
      
      // Create a GraphCalendarConnection object for the agent's calendar
      const agentCalendarConnection = {
        id: connection.id,
        client_id: clientId,
        user_id: 'agent-' + agent.id,
        provider_id: 'microsoft-graph',
        provider_name: 'Microsoft Graph',
        provider_user_id: connection.email,
        email: connection.email,
        display_name: connection.display_name,
        access_token: connection.access_token,
        refresh_token: connection.refresh_token || '',
        token_type: 'Bearer',
        expires_at: connection.expires_at,
        calendars: [],
        is_connected: true,
        last_sync_at: new Date().toISOString(),
        sync_status: 'completed' as const,
        sync_error: undefined,
        provider_metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const clientTimezone = agent.profiles.timezone || 'Australia/Melbourne';

      console.log(`📧 Microsoft Graph will automatically send notifications to:`);
      console.log(`📧 - Organizer: ${connection.email} (${connection.display_name})`);
      console.log(`📧 - Attendee: ${request.attendeeEmail} (${request.attendeeName})`);

      // Check for conflicts first
      console.log(`🔍 Checking for conflicts for new event: ${request.startDateTime} to ${request.endDateTime}`);
      
      const conflictResult = await OptimizedConflictDetection.checkForConflicts(
        agentCalendarConnection,
        request.startDateTime,
        request.endDateTime,
        clientTimezone,
        agent.profiles.office_hours
      );

      if (conflictResult.hasConflict) {
        console.log(`❌ CONFLICT DETECTED - Suggesting alternative slots`);
        
        // Find alternative slots
        const alternativeSlots = await OptimizedConflictDetection.findAvailableSlots(
          agentCalendarConnection,
          request.startDateTime,
          request.endDateTime,
          clientTimezone,
          {
            durationMinutes: 60,
            maxSuggestions: 3,
            officeHours: agent.profiles.office_hours,
            agentTimezone: agent.profiles.timezone
          }
        );

        return {
          success: false,
          error: `Scheduling conflict detected: ${conflictResult.conflictDetails}`,
          availableSlots: alternativeSlots.availableSlots?.map(slot => ({
            start: slot.start.toISOString(),
            end: slot.end.toISOString(),
            startFormatted: slot.startFormatted,
            endFormatted: slot.endFormatted,
            confidence: slot.confidence
          }))
        };
      }

      console.log(`✅ No conflicts - Proceeding with event creation`);

      // Prepare event data for Microsoft Graph
      const eventData: CreateGraphEventRequest = {
        subject: request.subject,
        start: {
          dateTime: request.startDateTime,
          timeZone: clientTimezone,
        },
        end: {
          dateTime: request.endDateTime,
          timeZone: clientTimezone,
        },
        organizer: {
          emailAddress: {
            name: connection.display_name || connection.email,
            address: connection.email
          }
        },
        attendees: [
          // Add organizer as attendee to receive notifications
          {
            type: 'required' as const,
            emailAddress: {
              name: connection.display_name || connection.email,
              address: connection.email,
            },
            status: {
              response: 'organizer' as const,
              time: new Date().toISOString()
            }
          },
          // Add the actual attendee
          {
            type: 'required' as const,
            emailAddress: {
              name: request.attendeeName,
              address: request.attendeeEmail,
            },
            status: {
              response: 'none' as const,
              time: new Date().toISOString()
            }
          }
        ],
        responseRequested: true,
      };

      // Add optional fields
      if (request.description) {
        eventData.body = {
          contentType: 'text',
          content: request.description,
        };
      }

      if (request.location) {
        eventData.location = {
          displayName: request.location,
        };
      }

      console.log(`🔍 DEBUG: request.isOnlineMeeting = ${request.isOnlineMeeting}`);
      
      if (request.isOnlineMeeting) {
        console.log(`💻 TEAMS MEETING REQUESTED - Setting up Teams meeting`);
        eventData.isOnlineMeeting = true;
        eventData.onlineMeetingProvider = 'teamsForBusiness';
        
        // Add Teams meeting information to the body if not already present
        const teamsInfo = '\n\n--- Microsoft Teams Meeting ---\nJoin the meeting from your calendar or use the Teams app.\n';
        if (eventData.body) {
          eventData.body.content += teamsInfo;
        } else {
          eventData.body = {
            contentType: 'html',
            content: `<p>Meeting details:</p>${teamsInfo.replace(/\n/g, '<br>')}`
          };
        }
      } else {
        console.log(`📝 REGULAR MEETING - No Teams meeting requested`);
      }

      // Create event directly using the agent's calendar connection
      const eventResponse = await createGraphEvent(
        agentCalendarConnection,
        eventData,
        request.calendarId || 'primary'
      );

      if (!eventResponse.success) {
        return {
          success: false,
          error: eventResponse.error,
        };
      }

      console.log(`📧 Microsoft Graph will automatically send email invitations to attendees`);

      return {
        success: true,
        event: eventResponse.event,
        eventId: eventResponse.event?.id,
      };

    } catch (error) {
      console.error('Error in createEventWithAgentCalendar:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error creating event'
      };
    }
  }
}
