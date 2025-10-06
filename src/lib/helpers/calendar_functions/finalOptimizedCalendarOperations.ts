// Final optimized calendar operations with all enhancements
import type {
  GraphEvent,
  CreateGraphEventRequest,
  GetGraphEventsRequest,
  CreateGraphEventMCPRequest,
} from '@/types'

import { AdvancedCacheService } from '../cache/advancedCacheService'
import { EnhancedGraphApiService } from './enhancedGraphApiService'
import { OptimizedConflictDetection } from './optimizedConflictDetection'
import { EnhancedErrorHandler } from './enhancedErrorHandler'
import { parseGraphDateRequest, formatGraphEventsAsString } from './graphHelper'

/**
 * Final optimized calendar operations with all performance enhancements
 */
export class FinalOptimizedCalendarOperations {

  /**
   * Get calendar events with full optimization stack
   */
  static async getCalendarEventsForClient(
    clientId: number,
    request: GetGraphEventsRequest
  ): Promise<{
    success: boolean
    events?: GraphEvent[]
    formattedEvents?: string
    error?: string
  }> {
    try {
      console.log(`🚀 FINAL OPTIMIZED: Getting calendar events for client ${clientId}`)
      
      // Get all client data with advanced caching
      const clientData = await AdvancedCacheService.getClientCalendarData(clientId)
      if (!clientData) {
        return {
          success: false,
          error: 'No calendar connection found or client not configured properly.'
        }
      }

      const { connection, timezone } = clientData

      if (!connection.is_connected) {
        return {
          success: false,
          error: 'Calendar connection is not active. Please reconnect your Microsoft calendar.'
        }
      }

      console.log(`🌍 Using cached client timezone: ${timezone}`)

      // Parse date request if provided
      let startDateTime: string | undefined
      let endDateTime: string | undefined
      
      if (request.dateRequest) {
        const dateRange = parseGraphDateRequest(request.dateRequest, timezone)
        startDateTime = dateRange.start
        endDateTime = dateRange.end
      } else if (request.startDate && request.endDate) {
        startDateTime = request.startDate
        endDateTime = request.endDate
      }

      // Use enhanced Graph API with comprehensive optimizations
      const eventsResponse = await EnhancedGraphApiService.getEventsOptimized(connection, {
        calendarId: request.calendarId || 'primary',
        startDateTime,
        endDateTime,
        fieldSet: 'STANDARD',
        timeZone: timezone,
        maxResults: 100,
        useCache: true
      })

      if (!eventsResponse.success) {
        return {
          success: false,
          error: eventsResponse.error
        }
      }

      const events = eventsResponse.events || []
      const formattedEvents = formatGraphEventsAsString(events)

      console.log(`✅ FINAL OPTIMIZED: Retrieved ${events.length} events for client ${clientId}`)

      return {
        success: true,
        events,
        formattedEvents
      }
    } catch (error) {
      console.error('Error in final optimized getCalendarEventsForClient:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Create calendar event with full optimization and enhanced conflict detection
   */
  static async createCalendarEventForClient(
    clientId: number,
    request: CreateGraphEventMCPRequest
  ): Promise<{
    success: boolean
    event?: GraphEvent
    eventId?: string
    error?: string
    availableSlots?: Array<{
      start: string
      end: string
      startFormatted: string
      endFormatted: string
      confidence: number
    }>
  }> {
    try {
      console.log(`🚀 FINAL OPTIMIZED: Creating calendar event for client ${clientId}`)
      
      // Get all client data with advanced caching
      const clientData = await AdvancedCacheService.getClientCalendarData(clientId)
      if (!clientData) {
        return {
          success: false,
          error: 'No calendar connection found or client not configured properly.'
        }
      }

      const { connection, timezone, agentOfficeHours, agentTimezone } = clientData

      if (!connection.is_connected) {
        return {
          success: false,
          error: 'Calendar connection is not active. Please reconnect your Microsoft calendar.'
        }
      }

      // Use optimized conflict detection with office hours validation
      const conflictResult = await OptimizedConflictDetection.findAvailableSlots(
        connection,
        request.startDateTime,
        request.endDateTime,
        timezone,
        {
          durationMinutes: 60,
          maxSuggestions: 3,
          officeHours: agentOfficeHours,
          agentTimezone: agentTimezone || timezone,
          searchWindowHours: 4 // Optimized search window
        }
      )

      if (conflictResult.hasConflict && conflictResult.availableSlots) {
        console.log(`❌ CONFLICT DETECTED - Suggesting ${conflictResult.availableSlots.length} alternative slots`)
        
        let errorMessage = `Scheduling conflict detected: ${conflictResult.conflictDetails}`
        
        if (conflictResult.availableSlots.length > 0) {
          errorMessage += `\n\nSuggested available time slots:\n`
          conflictResult.availableSlots.forEach((slot, index) => {
            errorMessage += `${index + 1}. ${slot.startFormatted} - ${slot.endFormatted}\n`
          })
          errorMessage += `\nPlease choose one of these available slots or suggest a different time.`
        }
        
        return {
          success: false,
          error: errorMessage,
          availableSlots: conflictResult.availableSlots.map(slot => ({
            start: slot.start.toISOString(),
            end: slot.end.toISOString(),
            startFormatted: slot.startFormatted,
            endFormatted: slot.endFormatted,
            confidence: slot.confidence
          }))
        }
      }

      console.log(`✅ No conflicts - Proceeding with enhanced event creation`)

      // Prepare event data
      const eventData: CreateGraphEventRequest = {
        subject: request.subject,
        start: {
          dateTime: request.startDateTime,
          timeZone: timezone,
        },
        end: {
          dateTime: request.endDateTime,
          timeZone: timezone,
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
            type: 'required',
            emailAddress: {
              name: connection.display_name || connection.email,
              address: connection.email,
            },
            status: {
              response: 'organizer',
              time: new Date().toISOString()
            }
          },
          // Add the actual attendee
          {
            type: 'required',
            emailAddress: {
              name: request.attendeeName,
              address: request.attendeeEmail,
            },
            status: {
              response: 'none',
              time: new Date().toISOString()
            }
          }
        ],
        responseRequested: true,
      }

      // Add optional fields
      if (request.description) {
        eventData.body = {
          contentType: 'text',
          content: request.description,
        }
      }

      if (request.location) {
        eventData.location = {
          displayName: request.location,
        }
      }

      if (request.isOnlineMeeting) {
        eventData.isOnlineMeeting = true
        eventData.onlineMeetingProvider = 'teamsForBusiness'
      }

      // Create event using enhanced Graph API service
      const eventResponse = await EnhancedGraphApiService.createEventOptimized(
        connection,
        eventData,
        request.calendarId || 'primary'
      )

      if (!eventResponse.success) {
        return {
          success: false,
          error: eventResponse.error,
        }
      }

      console.log(`✅ FINAL OPTIMIZED: Created event ${eventResponse.event?.id} for client ${clientId}`)

      return {
        success: true,
        event: eventResponse.event,
        eventId: eventResponse.event?.id,
      }
    } catch (error) {
      console.error('Error in final optimized createCalendarEventForClient:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Update calendar event with enhanced error handling
   */
  static async updateCalendarEventForClient(
    clientId: number,
    eventId: string,
    updates: Partial<CreateGraphEventMCPRequest>
  ): Promise<{
    success: boolean
    event?: GraphEvent
    error?: string
  }> {
    try {
      console.log(`🚀 FINAL OPTIMIZED: Updating calendar event ${eventId} for client ${clientId}`)
      
      // Get calendar connection with advanced caching
      const connection = await AdvancedCacheService.getCalendarConnection(clientId)
      if (!connection) {
        return {
          success: false,
          error: 'No calendar connection found for this client. Please connect a Microsoft calendar first.',
        }
      }

      if (!connection.is_connected) {
        return {
          success: false,
          error: 'Calendar connection is not active. Please reconnect your Microsoft calendar.',
        }
      }

      // Prepare update data
      const updateData: Partial<CreateGraphEventRequest> = {}

      if (updates.subject) {
        updateData.subject = updates.subject
      }

      if (updates.startDateTime && updates.endDateTime) {
        // Get client's timezone from cache
        const clientTimezone = await AdvancedCacheService.getClientTimezone(clientId)
        if (clientTimezone) {
          updateData.start = {
            dateTime: updates.startDateTime,
            timeZone: clientTimezone,
          }
          updateData.end = {
            dateTime: updates.endDateTime,
            timeZone: clientTimezone,
          }
        }
      }

      if (updates.description) {
        updateData.body = {
          contentType: 'text',
          content: updates.description,
        }
      }

      if (updates.location) {
        updateData.location = {
          displayName: updates.location,
        }
      }

      if (updates.attendeeEmail) {
        updateData.attendees = [{
          type: 'required',
          emailAddress: {
            name: updates.attendeeName,
            address: updates.attendeeEmail,
          },
        }]
      }

      // Update event using enhanced Graph API service
      const eventResponse = await EnhancedGraphApiService.updateEventOptimized(
        connection,
        eventId,
        updateData,
        updates.calendarId || 'primary'
      )

      if (!eventResponse.success) {
        return {
          success: false,
          error: eventResponse.error,
        }
      }

      console.log(`✅ FINAL OPTIMIZED: Updated event ${eventId} for client ${clientId}`)

      return {
        success: true,
        event: eventResponse.event,
      }
    } catch (error) {
      console.error('Error in final optimized updateCalendarEventForClient:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Delete calendar event with enhanced error handling
   */
  static async deleteCalendarEventForClient(
    clientId: number,
    eventId: string,
    calendarId?: string
  ): Promise<{
    success: boolean
    error?: string
  }> {
    try {
      console.log(`🚀 FINAL OPTIMIZED: Deleting calendar event ${eventId} for client ${clientId}`)
      
      // Get calendar connection with advanced caching
      const connection = await AdvancedCacheService.getCalendarConnection(clientId)
      if (!connection) {
        return {
          success: false,
          error: 'No calendar connection found for this client. Please connect a Microsoft calendar first.',
        }
      }

      if (!connection.is_connected) {
        return {
          success: false,
          error: 'Calendar connection is not active. Please reconnect your Microsoft calendar.',
        }
      }

      // Validate event exists before deletion (optional check for better UX)
      try {
        const eventCheck = await EnhancedGraphApiService.getEventsOptimized(connection, {
          calendarId: calendarId || 'primary',
          fieldSet: 'MINIMAL'
        })
        
        if (eventCheck.success && eventCheck.events) {
          const eventExists = eventCheck.events.some(event => event.id === eventId)
          if (!eventExists) {
            console.log(`⚠️ Event ${eventId} not found in calendar, proceeding with deletion anyway`)
          }
        }
      } catch (checkError) {
        console.log(`⚠️ Could not verify event existence, proceeding with deletion: ${checkError}`)
      }

      // Delete event using enhanced Graph API service
      const deleteResponse = await EnhancedGraphApiService.deleteEventOptimized(
        connection,
        eventId,
        calendarId || 'primary'
      )

      if (!deleteResponse.success) {
        return {
          success: false,
          error: deleteResponse.error,
        }
      }

      console.log(`✅ FINAL OPTIMIZED: Deleted event ${eventId} for client ${clientId}`)

      return {
        success: true,
      }
    } catch (error) {
      console.error('Error in final optimized deleteCalendarEventForClient:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Find available time slots with enhanced optimization
   */
  static async findAvailableSlotsForClient(
    clientId: number,
    requestedStartTime: string,
    requestedEndTime: string,
    durationMinutes: number = 60,
    maxSuggestions: number = 5
  ): Promise<{
    success: boolean
    hasConflict: boolean
    availableSlots?: Array<{
      start: string
      end: string
      startFormatted: string
      endFormatted: string
      confidence: number
    }>
    conflictDetails?: string
    error?: string
  }> {
    try {
      console.log(`🚀 FINAL OPTIMIZED: Finding available slots for client ${clientId}`)
      
      // Get all client data with advanced caching
      const clientData = await AdvancedCacheService.getClientCalendarData(clientId)
      if (!clientData) {
        return {
          success: false,
          hasConflict: false,
          error: 'No calendar connection found or client not configured properly.',
        }
      }

      const { connection, timezone, agentOfficeHours, agentTimezone } = clientData

      if (!connection.is_connected) {
        return {
          success: false,
          hasConflict: false,
          error: 'Calendar connection is not active. Please reconnect your Microsoft calendar.',
        }
      }

      // Use optimized conflict detection
      const slotCheck = await OptimizedConflictDetection.findAvailableSlots(
        connection, 
        requestedStartTime, 
        requestedEndTime, 
        timezone, 
        {
          durationMinutes, 
          maxSuggestions,
          officeHours: agentOfficeHours,
          agentTimezone: agentTimezone || timezone,
          searchWindowHours: 6 // Slightly larger window for slot finding
        }
      )

      console.log(`✅ FINAL OPTIMIZED: Found ${slotCheck.availableSlots?.length || 0} available slots`)

      return {
        success: true,
        hasConflict: slotCheck.hasConflict,
        availableSlots: slotCheck.availableSlots?.map(slot => ({
          start: slot.start.toISOString(),
          end: slot.end.toISOString(),
          startFormatted: slot.startFormatted,
          endFormatted: slot.endFormatted,
          confidence: slot.confidence
        })),
        conflictDetails: slotCheck.conflictDetails,
      }
    } catch (error) {
      console.error('Error in final optimized findAvailableSlotsForClient:', error)
      return {
        success: false,
        hasConflict: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Search calendar events with enhanced optimization
   */
  static async searchCalendarEventsForClient(
    clientId: number,
    searchQuery: string,
    options: {
      startDate?: string
      endDate?: string
      calendarId?: string
    } = {}
  ): Promise<{
    success: boolean
    events?: GraphEvent[]
    formattedEvents?: string
    error?: string
  }> {
    try {
      console.log(`🚀 FINAL OPTIMIZED: Searching calendar events for client ${clientId} with query: ${searchQuery}`)
      
      // Get all client data with advanced caching
      const clientData = await AdvancedCacheService.getClientCalendarData(clientId)
      if (!clientData) {
        return {
          success: false,
          error: 'No calendar connection found or client not configured properly.'
        }
      }

      const { connection, timezone } = clientData

      if (!connection.is_connected) {
        return {
          success: false,
          error: 'Calendar connection is not active. Please reconnect your Microsoft calendar.'
        }
      }

      // Use enhanced Graph API for search with caching
      const cacheKey = `search-${connection.id}-${searchQuery}-${options.startDate}-${options.endDate}`
      
      const eventsResponse = await AdvancedCacheService.getGraphEvents(
        cacheKey,
        async () => {
          // Build search filter (currently not used as we do client-side filtering)
          // let filter = `contains(subject,'${searchQuery}')`
          // if (options.startDate && options.endDate) {
          //   filter += ` and start/dateTime ge '${options.startDate}' and end/dateTime le '${options.endDate}'`
          // }

          return await EnhancedGraphApiService.getEventsOptimized(connection, {
            calendarId: options.calendarId || 'primary',
            fieldSet: 'STANDARD',
            timeZone: timezone,
            maxResults: 50,
            useCache: false // Don't double-cache search results
          })
        },
        60 // 1 minute TTL for search results
      )

      if (!eventsResponse.success) {
        return {
          success: false,
          error: eventsResponse.error
        }
      }

      // Filter events by search query (client-side filtering for more precise results)
      const events = (eventsResponse.events || []).filter(event => 
        event.subject?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        event.body?.content?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        event.location?.displayName?.toLowerCase().includes(searchQuery.toLowerCase())
      )

      const formattedEvents = formatGraphEventsAsString(events)

      console.log(`✅ FINAL OPTIMIZED: Found ${events.length} matching events for client ${clientId}`)

      return {
        success: true,
        events,
        formattedEvents,
      }
    } catch (error) {
      console.error('Error in final optimized searchCalendarEventsForClient:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Force cleanup of all caches and resources (for maintenance)
   */
  static async forceCleanup(): Promise<void> {
    AdvancedCacheService.forceCleanup()
    console.log('🧹 Cache cleanup completed')
  }
}

export default FinalOptimizedCalendarOperations
