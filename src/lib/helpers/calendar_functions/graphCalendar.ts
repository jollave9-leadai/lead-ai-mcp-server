// Microsoft Graph calendar operations for MCP tools
import type {
  GraphEvent,
  GraphCalendar,
  GraphCalendarConnection,
  CreateGraphEventRequest,
  GetGraphEventsRequest,
  CreateGraphEventMCPRequest,
  GetAvailabilityRequest,
  AvailabilityResponse,
  AvailabilitySlot,
} from '@/types'
import {
  getCalendarConnectionByClientId,
  getCalendarConnectionSummary,
} from './graphDatabase'
import {
  getGraphEvents,
  createGraphEvent,
  updateGraphEvent,
  deleteGraphEvent,
  getGraphCalendars,
  getFreeBusyInfo,
  parseGraphDateRequest,
  formatGraphEventsAsString,
  makeGraphRequest,
} from './graphHelper'
import { getClientTimezone } from './getClientTimeZone'

/**
 * Find available time slots near the requested time
 */
async function findAvailableSlots(
  connection: GraphCalendarConnection,
  requestedStartTime: string,
  requestedEndTime: string,
  timeZone: string,
  durationMinutes: number = 60,
  maxSuggestions: number = 3
): Promise<{
  hasConflict: boolean
  availableSlots?: Array<{
    start: string
    end: string
    startMelbourne: string
    endMelbourne: string
  }>
  conflictDetails?: string
}> {
  try {
    console.log(`🔍 Finding available slots near ${requestedStartTime} to ${requestedEndTime}`)
    
    const requestedStart = new Date(requestedStartTime)
    const requestedEnd = new Date(requestedEndTime)
    
    // Check if requested time has conflicts first
    const conflictCheck = await checkForConflicts(connection, requestedStartTime, requestedEndTime, timeZone)
    
    if (!conflictCheck.hasConflict) {
      console.log(`✅ Requested time slot is available`)
      return { hasConflict: false }
    }
    
    console.log(`⚠️ Requested time has conflicts, finding alternatives...`)
    
    // Search for available slots in a wider window (6 hours before and after)
    const searchStart = new Date(requestedStart.getTime() - 6 * 60 * 60 * 1000)
    const searchEnd = new Date(requestedEnd.getTime() + 6 * 60 * 60 * 1000)
    
    console.log(`🔍 Searching for alternatives from ${searchStart.toISOString()} to ${searchEnd.toISOString()}`)
    
    const eventsResponse = await getGraphEvents(connection, {
      startDateTime: searchStart.toISOString(),
      endDateTime: searchEnd.toISOString(),
      timeZone,
    })

    if (!eventsResponse.success || !eventsResponse.events) {
      return { 
        hasConflict: true, 
        conflictDetails: conflictCheck.conflictDetails,
        availableSlots: []
      }
    }

    // Get all busy periods and sort by start time
    const busyPeriods = eventsResponse.events
      .filter(event => !event.isCancelled)
      .map(event => {
        let eventStart: Date
        let eventEnd: Date
        
        if (event.start.timeZone === 'AUS Eastern Standard Time') {
          const startStr = event.start.dateTime.includes('T') ? event.start.dateTime : `${event.start.dateTime}T00:00:00`
          const endStr = event.end.dateTime.includes('T') ? event.end.dateTime : `${event.end.dateTime}T00:00:00`
          eventStart = new Date(`${startStr}+10:00`)
          eventEnd = new Date(`${endStr}+10:00`)
        } else {
          eventStart = new Date(event.start.dateTime)
          eventEnd = new Date(event.end.dateTime)
        }
        
        return { start: eventStart, end: eventEnd }
      })
      .sort((a, b) => a.start.getTime() - b.start.getTime())

    console.log(`📅 Found ${busyPeriods.length} busy periods to avoid`)

    // Find available slots
    const availableSlots: Array<{
      start: string
      end: string
      startMelbourne: string
      endMelbourne: string
    }> = []

    // Helper function to check if a time slot conflicts with busy periods
    const hasConflictWithBusy = (slotStart: Date, slotEnd: Date): boolean => {
      return busyPeriods.some(busy => 
        slotStart < busy.end && slotEnd > busy.start
      )
    }

    // Helper function to format time for Melbourne display
    const formatMelbourneTime = (date: Date): string => {
      return date.toLocaleString('en-AU', {
        timeZone: 'Australia/Melbourne',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      })
    }

    // Search for slots in 30-minute increments
    const increment = 30 * 60 * 1000 // 30 minutes in milliseconds
    let currentTime = new Date(searchStart.getTime())
    
    while (currentTime < searchEnd && availableSlots.length < maxSuggestions) {
      const slotEnd = new Date(currentTime.getTime() + durationMinutes * 60 * 1000)
      
      // Skip if slot is outside business hours (9 AM - 6 PM Melbourne time)
      const melbourneHour = parseInt(currentTime.toLocaleString('en-AU', {
        timeZone: 'Australia/Melbourne',
        hour: '2-digit',
        hour12: false
      }))
      
      if (melbourneHour >= 9 && melbourneHour < 18) {
        if (!hasConflictWithBusy(currentTime, slotEnd)) {
          availableSlots.push({
            start: currentTime.toISOString(),
            end: slotEnd.toISOString(),
            startMelbourne: formatMelbourneTime(currentTime),
            endMelbourne: formatMelbourneTime(slotEnd)
          })
          
          console.log(`✅ Found available slot: ${formatMelbourneTime(currentTime)} - ${formatMelbourneTime(slotEnd)}`)
        }
      }
      
      currentTime = new Date(currentTime.getTime() + increment)
    }

    // Sort by proximity to requested time
    availableSlots.sort((a, b) => {
      const aDistance = Math.abs(new Date(a.start).getTime() - requestedStart.getTime())
      const bDistance = Math.abs(new Date(b.start).getTime() - requestedStart.getTime())
      return aDistance - bDistance
    })

    console.log(`💡 Found ${availableSlots.length} available alternative slots`)

    return {
      hasConflict: true,
      conflictDetails: conflictCheck.conflictDetails,
      availableSlots: availableSlots.slice(0, maxSuggestions)
    }
  } catch (error) {
    console.error('❌ Error finding available slots:', error)
    return { 
      hasConflict: true, 
      conflictDetails: 'Error finding available slots'
    }
  }
}

/**
 * Check for scheduling conflicts before creating an event
 */
async function checkForConflicts(
  connection: GraphCalendarConnection,
  startDateTime: string,
  endDateTime: string,
  timeZone: string
): Promise<{ hasConflict: boolean; conflictDetails?: string }> {
  try {
    console.log(`🔍 Conflict Check - New event: ${startDateTime} to ${endDateTime}`)
    
    // Parse the input times properly (they include timezone info)
    const newStart = new Date(startDateTime)
    const newEnd = new Date(endDateTime)
    
    // Expand the search window to catch nearby events (in UTC)
    const searchStart = new Date(newStart.getTime() - 2 * 60 * 60 * 1000) // 2 hours before
    const searchEnd = new Date(newEnd.getTime() + 2 * 60 * 60 * 1000) // 2 hours after
    
    console.log(`🔍 Searching for existing events from ${searchStart.toISOString()} to ${searchEnd.toISOString()}`)
    
    // Get events in the expanded time range
    const eventsResponse = await getGraphEvents(connection, {
      startDateTime: searchStart.toISOString(),
      endDateTime: searchEnd.toISOString(),
      timeZone,
    })

    if (!eventsResponse.success || !eventsResponse.events) {
      console.log(`🔍 No events found or error getting events`)
      return { hasConflict: false }
    }

    console.log(`🔍 Found ${eventsResponse.events.length} existing events to check`)
    console.log(`🔍 New event time range: ${newStart.toISOString()} to ${newEnd.toISOString()}`)
    
    const conflictingEvents = eventsResponse.events.filter(event => {
      // Skip cancelled events
      if (event.isCancelled) {
        console.log(`⏭️ Skipping cancelled event: ${event.subject}`)
        return false
      }
      
      // Parse existing event times with proper timezone handling
      // Microsoft Graph returns datetime without timezone offset, but includes timezone info
      let eventStart: Date
      let eventEnd: Date
      
      if (event.start.timeZone && event.start.timeZone !== 'tzone://Microsoft/Custom') {
        // If timezone is provided, parse with timezone context
        const startStr = event.start.dateTime.includes('T') ? event.start.dateTime : `${event.start.dateTime}T00:00:00`
        const endStr = event.end.dateTime.includes('T') ? event.end.dateTime : `${event.end.dateTime}T00:00:00`
        
        // For AUS Eastern Standard Time, we need to handle it as Melbourne time
        if (event.start.timeZone === 'AUS Eastern Standard Time') {
          // Parse as if it's Melbourne time, then convert to UTC
          eventStart = new Date(`${startStr}+10:00`)
          eventEnd = new Date(`${endStr}+10:00`)
        } else {
          eventStart = new Date(event.start.dateTime)
          eventEnd = new Date(event.end.dateTime)
        }
      } else {
        eventStart = new Date(event.start.dateTime)
        eventEnd = new Date(event.end.dateTime)
      }
      
      // Check for exact time match first (same start time)
      const exactMatch = Math.abs(eventStart.getTime() - newStart.getTime()) < 60000 // Within 1 minute
      
      // Events overlap if: newStart < eventEnd AND newEnd > eventStart
      const hasOverlap = newStart < eventEnd && newEnd > eventStart
      
      console.log(`📅 Checking "${event.subject}":`)
      console.log(`   Existing UTC: ${eventStart.toISOString()} - ${eventEnd.toISOString()}`)
      console.log(`   Existing MEL: ${eventStart.toLocaleString('en-AU', {timeZone: 'Australia/Melbourne'})} - ${eventEnd.toLocaleString('en-AU', {timeZone: 'Australia/Melbourne'})}`)
      console.log(`   New UTC:      ${newStart.toISOString()} - ${newEnd.toISOString()}`)
      console.log(`   New MEL:      ${newStart.toLocaleString('en-AU', {timeZone: 'Australia/Melbourne'})} - ${newEnd.toLocaleString('en-AU', {timeZone: 'Australia/Melbourne'})}`)
      console.log(`   Raw event data: start=${event.start.dateTime}, tz=${event.start.timeZone}`)
      console.log(`   Exact match: ${exactMatch ? '❌ YES - SAME TIME!' : '✅ NO'}`)
      console.log(`   Overlap: ${hasOverlap ? '❌ YES - CONFLICT!' : '✅ NO'}`)
      
      return hasOverlap || exactMatch
    })

    if (conflictingEvents.length > 0) {
      const conflictDetails = conflictingEvents.map(event => 
        `"${event.subject}" (${new Date(event.start.dateTime).toLocaleString()} - ${new Date(event.end.dateTime).toLocaleString()})`
      ).join(', ')
      
      console.log(`⚠️ CONFLICTS FOUND: ${conflictingEvents.length} event(s)`)
      console.log(`⚠️ Conflict details: ${conflictDetails}`)
      return { 
        hasConflict: true, 
        conflictDetails: `Conflicts with existing event(s): ${conflictDetails}` 
      }
    }

    console.log(`✅ No conflicts found - time slot is available`)
    return { hasConflict: false }
  } catch (error) {
    console.error('❌ Error checking for conflicts:', error)
    // Don't block event creation if conflict check fails
    return { hasConflict: false }
  }
}

/**
 * Send explicit calendar invitation email using Microsoft Graph
 */
async function sendCalendarInvitationEmail(
  connection: GraphCalendarConnection,
  event: GraphEvent,
  request: CreateGraphEventMCPRequest
): Promise<void> {
  try {
    const startDate = new Date(event.start.dateTime)
    const endDate = new Date(event.end.dateTime)
    
    const emailBody = `
<html>
<body>
<h2>📅 Calendar Invitation</h2>
<p>You have been invited to a meeting:</p>

<table style="border-collapse: collapse; width: 100%;">
<tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Subject:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${event.subject}</td></tr>
<tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Date:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${startDate.toLocaleDateString()}</td></tr>
<tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Time:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${startDate.toLocaleTimeString()} - ${endDate.toLocaleTimeString()}</td></tr>
<tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Organizer:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${connection.email}</td></tr>
${event.location?.displayName ? `<tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Location:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${event.location.displayName}</td></tr>` : ''}
${event.onlineMeeting?.joinUrl ? `<tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Join Online:</strong></td><td style="padding: 8px; border: 1px solid #ddd;"><a href="${event.onlineMeeting.joinUrl}">Join Teams Meeting</a></td></tr>` : ''}
</table>

${request.description ? `<p><strong>Description:</strong><br>${request.description}</p>` : ''}

<p>Please add this event to your calendar and respond with your availability.</p>
<p><strong>Event ID:</strong> ${event.id}</p>
</body>
</html>
    `

    const emailData = {
      message: {
        subject: `📅 Meeting Invitation: ${event.subject}`,
        body: {
          contentType: 'HTML',
          content: emailBody
        },
        toRecipients: [{
          emailAddress: {
            address: request.attendeeEmail,
            name: request.attendeeName
          }
        }]
      }
    }

    // Use the makeGraphRequest helper to handle token refresh
    const response = await makeGraphRequest(connection, '/me/sendMail', {
      method: 'POST',
      body: JSON.stringify(emailData)
    })

    if (response.ok) {
      console.log(`✅ Calendar invitation email sent successfully to ${request.attendeeEmail}`)
    } else {
      const error = await response.text()
      console.error(`❌ Failed to send invitation email:`, error)
    }
  } catch (error) {
    console.error('Error sending calendar invitation email:', error)
  }
}

/**
 * Get calendar events for a client using Microsoft Graph
 */
export async function getCalendarEventsForClient(
  clientId: number,
  request: GetGraphEventsRequest
): Promise<{
  success: boolean
  events?: GraphEvent[]
  formattedEvents?: string
  error?: string
}> {
  try {
    console.log(`Getting calendar events for client ${clientId}`)
    
    // Get calendar connection
    const connection = await getCalendarConnectionByClientId(clientId)
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

    // Get client's timezone from database
    const clientTimezone = await getClientTimezone(clientId)
    if (!clientTimezone) {
      return {
        success: false,
        error: 'Client timezone not found. Please ensure the client has a timezone configured.',
      }
    }

    console.log(`🌍 Using client timezone: ${clientTimezone} for client ${clientId}`)

    // Parse date request if provided
    let startDateTime: string | undefined
    let endDateTime: string | undefined
    
    if (request.dateRequest) {
      const dateRange = parseGraphDateRequest(request.dateRequest, clientTimezone)
      startDateTime = dateRange.start
      endDateTime = dateRange.end

      console.log("Start Date: ", startDateTime)
      console.log("End Date : ", endDateTime)
    } else if (request.startDate && request.endDate) {
      startDateTime = request.startDate
      endDateTime = request.endDate
    }
   
    const eventsResponse = await getGraphEvents(connection, {
      calendarId: request.calendarId || 'primary',
      startDateTime,
      endDateTime,
      timeZone: clientTimezone
    })

    if (!eventsResponse.success) {
      return {
        success: false,
        error: eventsResponse.error,
      }
    }

    const events = eventsResponse.events || []
    const formattedEvents = formatGraphEventsAsString(events)

    return {
      success: true,
      events,
      formattedEvents,
    }
  } catch (error) {
    console.error('Error getting calendar events for client:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Create a calendar event for a client using Microsoft Graph
 */
export async function createCalendarEventForClient(
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
    startMelbourne: string
    endMelbourne: string
  }>
}> {
  try {
    console.log(`Creating calendar event for client ${clientId}`)
    
    // Get calendar connection
    const connection = await getCalendarConnectionByClientId(clientId)
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

    // Get client's timezone from database
    const clientTimezone = await getClientTimezone(clientId)
    if (!clientTimezone) {
      return {
        success: false,
        error: 'Client timezone not found. Please ensure the client has a timezone configured.',
      }
    }

    // Prepare event data
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

    console.log(`📧 Event will send notifications to:`)
    console.log(`📧 - Organizer: ${connection.email} (${connection.display_name || 'No name'})`)
    console.log(`📧 - Attendee: ${request.attendeeEmail} (${request.attendeeName || 'No name'})`)

    // Check for conflicts and find available slots if needed
    console.log(`🔍 Checking for conflicts for new event: ${request.startDateTime} to ${request.endDateTime}`)
    const slotCheck = await findAvailableSlots(connection, request.startDateTime, request.endDateTime, clientTimezone)
    
    if (slotCheck.hasConflict) {
      console.log(`❌ CONFLICT DETECTED - Suggesting alternative slots`)
      
      let errorMessage = `Scheduling conflict detected: ${slotCheck.conflictDetails}`
      
      if (slotCheck.availableSlots && slotCheck.availableSlots.length > 0) {
        errorMessage += `\n\nSuggested available time slots:\n`
        slotCheck.availableSlots.forEach((slot, index) => {
          errorMessage += `${index + 1}. ${slot.startMelbourne} - ${slot.endMelbourne}\n`
        })
        errorMessage += `\nPlease choose one of these available slots or suggest a different time.`
      } else {
        errorMessage += `\n\nNo alternative slots found within business hours (9 AM - 6 PM). Please suggest a different time.`
      }
      
      return {
        success: false,
        error: errorMessage,
        availableSlots: slotCheck.availableSlots
      }
    }
    console.log(`✅ No conflicts - Proceeding with event creation`)

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

    // Create event in Microsoft Graph
    const eventResponse = await createGraphEvent(
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

    // Send explicit email invitation to attendee
    if (eventResponse.event && request.attendeeEmail) {
      console.log(`📧 Sending explicit email invitation to ${request.attendeeEmail}`)
      await sendCalendarInvitationEmail(connection, eventResponse.event, request)
    }

    return {
      success: true,
      event: eventResponse.event,
      eventId: eventResponse.event?.id,
    }
  } catch (error) {
    console.error('Error creating calendar event for client:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Update a calendar event for a client using Microsoft Graph
 */
export async function updateCalendarEventForClient(
  clientId: number,
  eventId: string,
  updates: Partial<CreateGraphEventMCPRequest>
): Promise<{
  success: boolean
  event?: GraphEvent
  error?: string
}> {
  try {
    console.log(`Updating calendar event ${eventId} for client ${clientId}`)
    
    // Get calendar connection
    const connection = await getCalendarConnectionByClientId(clientId)
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
      // Get client's timezone from database
      const clientTimezone = await getClientTimezone(clientId)
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

    // Update event in Microsoft Graph
    const eventResponse = await updateGraphEvent(
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

    return {
      success: true,
      event: eventResponse.event,
    }
  } catch (error) {
    console.error('Error updating calendar event for client:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Delete a calendar event for a client using Microsoft Graph
 */
export async function deleteCalendarEventForClient(
  clientId: number,
  eventId: string,
  calendarId?: string
): Promise<{
  success: boolean
  error?: string
}> {
  try {
    console.log(`Deleting calendar event ${eventId} for client ${clientId}`)
    
    // Get calendar connection
    const connection = await getCalendarConnectionByClientId(clientId)
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

    // Delete event from Microsoft Graph
    const deleteResponse = await deleteGraphEvent(
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

    return {
      success: true,
    }
  } catch (error) {
    console.error('Error deleting calendar event for client:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Get calendars for a client using Microsoft Graph
 */
export async function getCalendarsForClient(clientId: number): Promise<{
  success: boolean
  calendars?: GraphCalendar[]
  error?: string
}> {
  try {
    console.log(`Getting calendars for client ${clientId}`)
    
    // Get calendar connection
    const connection = await getCalendarConnectionByClientId(clientId)
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

    // Get calendars from Microsoft Graph
    const calendarsResponse = await getGraphCalendars(connection)

    if (!calendarsResponse.success) {
      return {
        success: false,
        error: calendarsResponse.error,
      }
    }

    return {
      success: true,
      calendars: calendarsResponse.calendars,
    }
  } catch (error) {
    console.error('Error getting calendars for client:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Get availability/free-busy information for a client
 */
export async function getAvailabilityForClient(
  clientId: number,
  request: GetAvailabilityRequest
): Promise<AvailabilityResponse> {
  try {
    console.log(`Getting availability for client ${clientId}`)
    
    // Get calendar connection
    const connection = await getCalendarConnectionByClientId(clientId)
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

    // Use connection email if no emails provided
    const emails = request.emails || [connection.email]
    
    // Get free/busy information from Microsoft Graph
    const freeBusyResponse = await getFreeBusyInfo(
      connection,
      emails,
      request.startDate,
      request.endDate,
      request.intervalInMinutes || 60
    )

    if (!freeBusyResponse.success) {
      return {
        success: false,
        error: freeBusyResponse.error,
      }
    }

    // Convert Graph response to our format
    const availability: Record<string, AvailabilitySlot[]> = {}
    
    if (freeBusyResponse.data?.schedules) {
      Object.entries(freeBusyResponse.data.schedules).forEach(([email, schedule]) => {
        const slots: AvailabilitySlot[] = []
        
        if (schedule.busyTimes) {
          schedule.busyTimes.forEach(busyTime => {
            slots.push({
              start: busyTime.start.dateTime,
              end: busyTime.end.dateTime,
              status: 'busy',
            })
          })
        }
        
        availability[email] = slots
      })
    }

    return {
      success: true,
      availability,
    }
  } catch (error) {
    console.error('Error getting availability for client:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Check if client has connected calendars
 */
export async function checkClientCalendarConnection(clientId: number): Promise<{
  has_active_connections: boolean
  total_connections: number
  connected_connections: number
  microsoft_connections: number
  google_connections: number
  primary_connection?: {
    email: string
    provider_name: string
    display_name: string
  }
} | null> {
  try {
    console.log(`Checking calendar connection for client ${clientId}`)
    
    const summary = await getCalendarConnectionSummary(clientId)
    return summary
  } catch (error) {
    console.error('Error checking client calendar connection:', error)
    return null
  }
}

/**
 * Find available time slots for a client
 */
export async function findAvailableSlotsForClient(
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
    startMelbourne: string
    endMelbourne: string
  }>
  conflictDetails?: string
  error?: string
}> {
  try {
    console.log(`Finding available slots for client ${clientId}`)
    
    // Get calendar connection
    const connection = await getCalendarConnectionByClientId(clientId)
    if (!connection) {
      return {
        success: false,
        hasConflict: false,
        error: 'No calendar connection found for this client. Please connect a Microsoft calendar first.',
      }
    }

    if (!connection.is_connected) {
      return {
        success: false,
        hasConflict: false,
        error: 'Calendar connection is not active. Please reconnect your Microsoft calendar.',
      }
    }

    // Get client's timezone from database
    const clientTimezone = await getClientTimezone(clientId)
    if (!clientTimezone) {
      return {
        success: false,
        hasConflict: false,
        error: 'Client timezone not found. Please ensure the client has a timezone configured.',
      }
    }

    // Find available slots
    const slotCheck = await findAvailableSlots(
      connection, 
      requestedStartTime, 
      requestedEndTime, 
      clientTimezone, 
      durationMinutes, 
      maxSuggestions
    )

    return {
      success: true,
      hasConflict: slotCheck.hasConflict,
      availableSlots: slotCheck.availableSlots,
      conflictDetails: slotCheck.conflictDetails,
    }
  } catch (error) {
    console.error('Error finding available slots for client:', error)
    return {
      success: false,
      hasConflict: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Search calendar events for a client
 */
export async function searchCalendarEventsForClient(
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
    console.log(`Searching calendar events for client ${clientId} with query: ${searchQuery}`)
    
    // Get calendar connection
    const connection = await getCalendarConnectionByClientId(clientId)
    if (!connection) {
      return {
        success: false,
        error: 'No calendar connection found for this client. Please connect a Microsoft calendar first.',
      }
    }

    // Get client's timezone from database
    const clientTimezone = await getClientTimezone(clientId)
    if (!clientTimezone) {
      return {
        success: false,
        error: 'Client timezone not found. Please ensure the client has a timezone configured.',
      }
    }

    if (!connection.is_connected) {
      return {
        success: false,
        error: 'Calendar connection is not active. Please reconnect your Microsoft calendar.',
      }
    }

    // Build search filter
    let filter = `contains(subject,'${searchQuery}')`
    
    if (options.startDate && options.endDate) {
      filter += ` and start/dateTime ge '${options.startDate}' and end/dateTime le '${options.endDate}'`
    }

    // Get events from Microsoft Graph with search filter
    const eventsResponse = await getGraphEvents(connection, {
      calendarId: options.calendarId || 'primary',
      filter,
      timeZone: clientTimezone,
      top: 50,
    })

    if (!eventsResponse.success) {
      return {
        success: false,
        error: eventsResponse.error,
      }
    }

    const events = eventsResponse.events || []
    const formattedEvents = formatGraphEventsAsString(events)

    return {
      success: true,
      events,
      formattedEvents,
    }
  } catch (error) {
    console.error('Error searching calendar events for client:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
