// Microsoft Graph API helper functions
import type {
  GraphCalendarConnection,
  GraphEvent,
  GraphCalendar,
  CreateGraphEventRequest,
  GraphEventResponse,
  GraphEventsListResponse,
  GraphCalendarListResponse,
  GraphTokenResponse,
  GraphErrorResponse,
  GraphFreeBusyResponse,
} from '@/types'
import { DateTime } from "luxon"
const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0'

/**
 * Convert IANA timezone to Windows timezone identifier for Microsoft Graph
 */
function convertToWindowsTimezone(ianaTimezone: string): string {
  const timezoneMap: Record<string, string> = {
    // Australia
    'Australia/Melbourne': 'AUS Eastern Standard Time',
    'Australia/Sydney': 'AUS Eastern Standard Time',
    'Australia/Brisbane': 'E. Australia Standard Time',
    'Australia/Perth': 'W. Australia Standard Time',
    'Australia/Adelaide': 'Cen. Australia Standard Time',
    'Australia/Darwin': 'AUS Central Standard Time',
    'Australia/Hobart': 'Tasmania Standard Time',
    
    // Asia
    'Asia/Manila': 'Singapore Standard Time',
    'Asia/Singapore': 'Singapore Standard Time',
    'Asia/Bangkok': 'SE Asia Standard Time',
    'Asia/Jakarta': 'SE Asia Standard Time',
    'Asia/Hong_Kong': 'China Standard Time',
    'Asia/Shanghai': 'China Standard Time',
    'Asia/Tokyo': 'Tokyo Standard Time',
    'Asia/Seoul': 'Korea Standard Time',
    'Asia/Kolkata': 'India Standard Time',
    'Asia/Dubai': 'Arabian Standard Time',
    
    // Americas
    'America/New_York': 'Eastern Standard Time',
    'America/Chicago': 'Central Standard Time',
    'America/Denver': 'Mountain Standard Time',
    'America/Los_Angeles': 'Pacific Standard Time',
    'America/Toronto': 'Eastern Standard Time',
    'America/Vancouver': 'Pacific Standard Time',
    
    // Europe
    'Europe/London': 'GMT Standard Time',
    'Europe/Paris': 'W. Europe Standard Time',
    'Europe/Berlin': 'W. Europe Standard Time',
    'Europe/Rome': 'W. Europe Standard Time',
    'Europe/Madrid': 'W. Europe Standard Time',
    'Europe/Amsterdam': 'W. Europe Standard Time',
    'Europe/Brussels': 'W. Europe Standard Time',
    'Europe/Zurich': 'W. Europe Standard Time',
    'Europe/Vienna': 'W. Europe Standard Time',
    'Europe/Stockholm': 'W. Europe Standard Time',
    'Europe/Oslo': 'W. Europe Standard Time',
    'Europe/Copenhagen': 'W. Europe Standard Time',
    'Europe/Helsinki': 'FLE Standard Time',
    'Europe/Warsaw': 'Central European Standard Time',
    'Europe/Prague': 'Central European Standard Time',
    'Europe/Budapest': 'Central European Standard Time',
    'Europe/Moscow': 'Russian Standard Time',
    
    // UTC
    'UTC': 'UTC',
    'GMT': 'GMT Standard Time',
  }
  
  return timezoneMap[ianaTimezone] || ianaTimezone
}


/**
 * Get calendar connection for a client from database
 */
export async function getCalendarConnection(clientId: number): Promise<GraphCalendarConnection | null> {
  try {
    // This would be replaced with your actual database query
    // For now, returning null as placeholder
    console.log(`Getting calendar connection for client ${clientId}`)
    
    // Example query structure:
    // SELECT * FROM lead_dialer.calendar_connections 
    // WHERE client_id = $1 AND is_connected = true 
    // ORDER BY created_at DESC LIMIT 1
    
    return null
  } catch (error) {
    console.error('Error getting calendar connection:', error)
    return null
  }
}

/**
 * Refresh Microsoft Graph access token
 */
export async function refreshGraphToken(connection: GraphCalendarConnection): Promise<GraphTokenResponse | null> {
  try {
    if (!connection.refresh_token) {
      throw new Error('No refresh token available')
    }

    const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID || '',
        client_secret: process.env.MICROSOFT_CLIENT_SECRET || '',
        refresh_token: connection.refresh_token,
        grant_type: 'refresh_token',
        scope: 'https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read offline_access',
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(`Token refresh failed: ${error.error_description || error.error}`)
    }

    const tokenData: GraphTokenResponse = await response.json()
    
    // Update the connection in database with new tokens
    const { updateCalendarConnectionTokens } = await import('./graphDatabase')
    await updateCalendarConnectionTokens(connection.id, {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || connection.refresh_token,
      expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
    })

    return tokenData
  } catch (error) {
    console.error('Error refreshing Graph token:', error)
    return null
  }
}


/**
 * Make authenticated request to Microsoft Graph API
 */
export async function makeGraphRequest(
  connection: GraphCalendarConnection,
  endpoint: string,
  options: RequestInit = {},
  timeZone?: string
): Promise<Response> {
  const url = endpoint.startsWith('http') ? endpoint : `${GRAPH_BASE_URL}${endpoint}`
  
  // Check if token needs refresh (expires within 5 minutes)
  const expiresAt = new Date(connection.expires_at)
  const now = new Date()
  const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000)
  
  let accessToken = connection.access_token
  
  if (expiresAt <= fiveMinutesFromNow) {
    console.log('Token expires soon, refreshing...')
    const refreshedToken = await refreshGraphToken(connection)
    if (refreshedToken) {
      accessToken = refreshedToken.access_token
    } else {
      throw new Error('Failed to refresh access token')
    }
  }

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  }

  // Add timezone preference header if provided
  if (timeZone) {
    const windowsTimezone = convertToWindowsTimezone(timeZone)
    headers['Prefer'] = `outlook.timezone="${windowsTimezone}"`
    console.log(`🌍 Setting timezone header: ${timeZone} → ${windowsTimezone}`)
  }

  const response = await fetch(url, {
    ...options,
    headers,
  })

  return response
  
}

/**
 * Get user's calendars from Microsoft Graph
 */
export async function getGraphCalendars(connection: GraphCalendarConnection): Promise<GraphCalendarListResponse> {
  try {
    const response = await makeGraphRequest(connection, '/me/calendars')
    
    if (!response.ok) {
      const error: GraphErrorResponse = await response.json()
      return {
        success: false,
        error: error.error.message,
        details: error,
      }
    }

    const data = await response.json()
    const calendars: GraphCalendar[] = data.value.map((cal: {
      id: string
      name: string
      color?: string
      isDefaultCalendar?: boolean
      canEdit?: boolean
      canShare?: boolean
      canViewPrivateItems?: boolean
      owner?: {
        name?: string
        address?: string
      }
    }) => ({
      id: cal.id,
      name: cal.name,
      color: cal.color,
      isDefaultCalendar: cal.isDefaultCalendar,
      canEdit: cal.canEdit,
      canShare: cal.canShare,
      canViewPrivateItems: cal.canViewPrivateItems,
      owner: cal.owner ? {
        name: cal.owner.name,
        address: cal.owner.address,
      } : undefined,
    }))

    return {
      success: true,
      calendars,
    }
  } catch (error) {
    console.error('Error getting Graph calendars:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Get calendar events from Microsoft Graph
 */
export async function getGraphEvents(
  connection: GraphCalendarConnection,
  options: {
    calendarId?: string
    startDateTime?: string
    endDateTime?: string
    top?: number
    filter?: string
    timeZone?: string
  } = {}
): Promise<GraphEventsListResponse> {
  try {
    const {
      calendarId = 'primary',
      startDateTime,
      endDateTime,
      timeZone,
      filter,
    } = options

    let endpoint = calendarId === 'primary' 
      ? '/me/events' 
      : `/me/calendars/${calendarId}/events`

    const params = new URLSearchParams()
    
    // Always use calendarView for date-based queries to get ALL events (single + recurring instances)
    if (startDateTime && endDateTime) {
      endpoint = endpoint.replace('/events', '/calendarView')
      // calendarView uses startDateTime and endDateTime as query parameters, not $filter
      params.append('startDateTime', startDateTime)
      params.append('endDateTime', endDateTime)
      console.log(`📅 Using calendarView to fetch ALL events (single + recurring instances) between ${startDateTime} and ${endDateTime}`)
    } else {
      // For non-date queries, use regular events endpoint with filter
      if (filter) {
        params.append('$filter', filter)
      }
      console.log(`📅 Using events endpoint for non-date-based query`)
    }
    
    params.append('$orderby', 'start/dateTime')
    params.append('$select', 'id,subject,body,start,end,location,attendees,organizer,isAllDay,isCancelled,importance,showAs,responseStatus,onlineMeeting,createdDateTime,lastModifiedDateTime,webLink')

    if (params.toString()) {
      endpoint += `?${params.toString()}`
    }

    console.log(`🔍 Microsoft Graph API Request:`, {
      endpoint,
      fullURL: endpoint.startsWith('http') ? endpoint : `${GRAPH_BASE_URL}${endpoint}`,
      timeZone,
      windowsTimezone: timeZone ? convertToWindowsTimezone(timeZone) : 'None',
      startDateTime,
      endDateTime,
      calendarId,
      filter,
    })

    const response = await makeGraphRequest(connection, endpoint, {}, timeZone)
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error(`❌ Microsoft Graph API Error:`, {
        status: response.status,
        statusText: response.statusText,
        errorText,
        endpoint
      })
      
      try {
        const error: GraphErrorResponse = JSON.parse(errorText)
        return {
          success: false,
          error: error.error.message,
          details: error,
        }
      } catch {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          details: { errorText },
        }
      }
    }

    const data = await response.json()
    const events: GraphEvent[] = data.value

    console.log(`📊 Microsoft Graph API Response:`, {
      totalEvents: events.length,
      nextLink: data['@odata.nextLink'] ? 'Has more pages' : 'No more pages',
      rawResponseKeys: Object.keys(data),
      allEvents: events.map((e, i) => ({
        index: i + 1,
        subject: e.subject,
        start: {
          dateTime: e.start.dateTime,
          timeZone: e.start.timeZone
        },
        end: {
          dateTime: e.end.dateTime,
          timeZone: e.end.timeZone
        },
        location: e.location?.displayName || 'No location',
        id: e.id?.substring(0, 20) + '...'
      }))
    })

    return {
      success: true,
      events,
      nextLink: data['@odata.nextLink'],
    }
  } catch (error) {
    console.error('Error getting Graph events:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Create a new calendar event in Microsoft Graph
 */
export async function createGraphEvent(
  connection: GraphCalendarConnection,
  eventData: CreateGraphEventRequest,
  calendarId: string = 'primary'
): Promise<GraphEventResponse> {
  try {
    const endpoint = calendarId === 'primary' 
      ? '/me/events' 
      : `/me/calendars/${calendarId}/events`

    console.log(`📧 Creating event - Microsoft Graph will automatically send invitations to attendees`)
    console.log(`📧 Event data:`, JSON.stringify(eventData, null, 2))
    
    const response = await makeGraphRequest(connection, endpoint, {
      method: 'POST',
      body: JSON.stringify(eventData),
    })
    
    if (!response.ok) {
      const error: GraphErrorResponse = await response.json()
      return {
        success: false,
        error: error.error.message,
        details: error,
      }
    }

    const event: GraphEvent = await response.json()

    return {
      success: true,
      event,
    }
  } catch (error) {
    console.error('Error creating Graph event:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Update an existing calendar event in Microsoft Graph
 */
export async function updateGraphEvent(
  connection: GraphCalendarConnection,
  eventId: string,
  eventData: Partial<CreateGraphEventRequest>,
  calendarId: string = 'primary'
): Promise<GraphEventResponse> {
  try {
    const endpoint = calendarId === 'primary' 
      ? `/me/events/${eventId}` 
      : `/me/calendars/${calendarId}/events/${eventId}`

    // Add notification parameter to ensure email notifications are sent for updates
    const updateEndpoint = `${endpoint}?sendNotifications=true`
    
    const response = await makeGraphRequest(connection, updateEndpoint, {
      method: 'PATCH',
      body: JSON.stringify(eventData),
    })
    
    console.log(`📧 Updating event with email notifications enabled`)
    
    if (!response.ok) {
      const error: GraphErrorResponse = await response.json()
      return {
        success: false,
        error: error.error.message,
        details: error,
      }
    }

    const event: GraphEvent = await response.json()

    return {
      success: true,
      event,
    }
  } catch (error) {
    console.error('Error updating Graph event:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Delete a calendar event from Microsoft Graph
 */
export async function deleteGraphEvent(
  connection: GraphCalendarConnection,
  eventId: string,
  calendarId: string = 'primary'
): Promise<{ success: boolean; error?: string }> {
  try {
    const endpoint = calendarId === 'primary' 
      ? `/me/events/${eventId}` 
      : `/me/calendars/${calendarId}/events/${eventId}`

    // Add notification parameter to ensure email notifications are sent for cancellations
    const deleteEndpoint = `${endpoint}?sendNotifications=true`
    
    const response = await makeGraphRequest(connection, deleteEndpoint, {
      method: 'DELETE',
    })
    
    console.log(`📧 Deleting event with email notifications enabled`)
    
    if (!response.ok) {
      const error: GraphErrorResponse = await response.json()
      return {
        success: false,
        error: error.error.message,
      }
    }

    return {
      success: true,
    }
  } catch (error) {
    console.error('Error deleting Graph event:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Get free/busy information for users
 */
export async function getFreeBusyInfo(
  connection: GraphCalendarConnection,
  emails: string[],
  startTime: string,
  endTime: string,
  intervalInMinutes: number = 60
): Promise<{ success: boolean; data?: GraphFreeBusyResponse; error?: string }> {
  try {
    const endpoint = '/me/calendar/getSchedule'
    
    const requestBody = {
      schedules: emails,
      startTime: {
        dateTime: startTime,
        timeZone: 'UTC',
      },
      endTime: {
        dateTime: endTime,
        timeZone: 'UTC',
      },
      availabilityViewInterval: intervalInMinutes,
    }

    const response = await makeGraphRequest(connection, endpoint, {
      method: 'POST',
      body: JSON.stringify(requestBody),
    })
    
    if (!response.ok) {
      const error: GraphErrorResponse = await response.json()
      return {
        success: false,
        error: error.error.message,
      }
    }

    const data: GraphFreeBusyResponse = await response.json()

    return {
      success: true,
      data,
    }
  } catch (error) {
    console.error('Error getting free/busy info:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Parse date request into start and end dates for Microsoft Graph
 * Calculate ranges in client timezone, then convert to UTC for API parameters
 */
export function parseGraphDateRequest(
  dateRequest: string,
  clientTimezone: string
): {
  start: string
  end: string
  description: string
} {
  // Get current time in client's timezone
  const nowInClientTZ = DateTime.now().setZone(clientTimezone)
  let start: DateTime
  let end: DateTime
  let description: string


  const lower = dateRequest.toLowerCase().trim()

  switch (true) {
    case lower === "today":
      // Today in client timezone
      start = nowInClientTZ.startOf("day")
      end = nowInClientTZ.endOf("day")
      description = "Today"
      break

    case lower === "tomorrow":
      // Tomorrow in client timezone
      start = nowInClientTZ.plus({ days: 1 }).startOf("day")
      end = nowInClientTZ.plus({ days: 1 }).endOf("day")
      description = "Tomorrow"
      break

    case lower === "this week":
      // This week in client timezone (Monday to Sunday)
      start = nowInClientTZ.startOf("week")
      end = nowInClientTZ.endOf("week")
      description = "This Week"
      break

    case lower === "next week":
      // Next week in client timezone
      start = nowInClientTZ.plus({ weeks: 1 }).startOf("week")
      end = nowInClientTZ.plus({ weeks: 1 }).endOf("week")
      description = "Next Week"
      break

    case lower === "upcoming" || lower === "next 7 days":
      // Next 7 days from today in client timezone
      start = nowInClientTZ.startOf("day")
      end = nowInClientTZ.plus({ days: 7 }).endOf("day")
      description = "Next 7 Days"
      break

    // Handle "this friday", "next monday", etc.
    case /^this (monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/.test(lower): {
      const dayName = lower.replace("this ", "")
      const targetDay = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"].indexOf(dayName)
      // Convert Luxon weekday (1=Mon, 7=Sun) to our array index (0=Sun, 6=Sat)
      const currentWeekday = nowInClientTZ.weekday === 7 ? 0 : nowInClientTZ.weekday
      
      console.log(`🗓️ DEBUG "this ${dayName}":`, {
        currentDate: nowInClientTZ.toFormat('yyyy-MM-dd (cccc)'),
        luxonWeekday: nowInClientTZ.weekday,
        currentWeekday: currentWeekday,
        targetDay: targetDay,
        targetDayName: dayName
      })
      
      let diff = (targetDay - currentWeekday + 7) % 7
      // If diff is 0, it means it's today - for "this friday" we want the upcoming friday
      if (diff === 0) {
        diff = 0 // Use today if it's the same day
      }
      
      start = nowInClientTZ.plus({ days: diff }).startOf("day")
      end = nowInClientTZ.plus({ days: diff }).endOf("day")
      description = `This ${dayName.charAt(0).toUpperCase() + dayName.slice(1)}`
      
      console.log(`🗓️ Result: ${diff} days from now = ${start.toFormat('yyyy-MM-dd (cccc)')}`)
      break
    }

    case /^next (monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/.test(lower): {
      const dayName = lower.replace("next ", "")
      const targetDay = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"].indexOf(dayName)
      const diff = (targetDay - nowInClientTZ.weekday + 7) % 7 || 7
      start = nowInClientTZ.plus({ days: diff }).startOf("day")
      end = nowInClientTZ.plus({ days: diff }).endOf("day")
      description = `Next ${dayName.charAt(0).toUpperCase() + dayName.slice(1)}`
      break
    }

    default:
      try {
        // Try parsing as ISO date in client timezone
        const parsed = DateTime.fromISO(dateRequest, { zone: clientTimezone })
        if (parsed.isValid) {
          start = parsed.startOf("day")
          end = parsed.endOf("day")
          description = parsed.toFormat("DDD")
        } else {
          throw new Error("Invalid date")
        }
      } catch {
        // Fallback: today in client timezone
        start = nowInClientTZ.startOf("day")
        end = nowInClientTZ.endOf("day")
        description = "Today (default)"
      }
  }

  // Convert client timezone ranges to UTC for Microsoft Graph API
  const startUTC = start.toUTC().toISO() || ''
  const endUTC = end.toUTC().toISO() || ''

  console.log(`📅 Date parsing for "${dateRequest}" in ${clientTimezone}:`, {
    description,
    clientTimezone,
    startInClientTZ: start.toFormat('yyyy-MM-dd HH:mm:ss ZZZZ'),
    endInClientTZ: end.toFormat('yyyy-MM-dd HH:mm:ss ZZZZ'),
    startUTC,
    endUTC,
    targetDate: start.toFormat('yyyy-MM-dd'),
    note: "Client timezone range → UTC for Microsoft Graph API"
  })

  return {
    start: startUTC,
    end: endUTC,
    description,
  }
}

/**
 * Format Graph events for display
 */
export function formatGraphEventsAsString(events: GraphEvent[]): string {
  console.log(`🎨 Formatting ${events?.length || 0} events for display`)
  
  if (!events || events.length === 0) {
    console.log(`📅 No events to format`)
    return '📅 No events found for the specified time period.'
  }

  console.log(`📝 Events to format:`, events.map((e, i) => ({
    index: i + 1,
    subject: e.subject,
    rawStart: e.start.dateTime,
    rawEnd: e.end.dateTime,
    startTimeZone: e.start.timeZone,
    endTimeZone: e.end.timeZone,
  })))

  let output = `Found ${events.length} event(s):\n\n`

  events.forEach((event, index) => {
    const startDate = new Date(event.start.dateTime)
    const endDate = new Date(event.end.dateTime)
    
    // Microsoft Graph already returns events in the requested timezone via Prefer header
    // so we don't need to apply timezone conversion again
    const formattedDate = startDate.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    
    const startTime = startDate.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
    
    const endTime = endDate.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })

    output += `**${index + 1}. ${event.subject || 'Untitled Event'}**\n`
    output += `   📅 **Date**: ${formattedDate}\n`
    output += `   🕐 **Time**: ${startTime} - ${endTime}\n`
    
    if (event.location?.displayName) {
      output += `   📍 **Location**: ${event.location.displayName}\n`
    }
    
    if (event.attendees && event.attendees.length > 0) {
      const attendeeNames = event.attendees
        .map(a => a.emailAddress.name || a.emailAddress.address)
        .join(', ')
      output += `   👥 **Attendees**: ${attendeeNames}\n`
    }
    
    if (event.organizer) {
      output += `   👤 **Organizer**: ${event.organizer.emailAddress.name || event.organizer.emailAddress.address}\n`
    }
    
    if (event.onlineMeeting?.joinUrl) {
      output += `   💻 **Online Meeting**: Available\n`
    }
    
    if (event.body?.content && event.body.content.trim()) {
      const description = event.body.content.replace(/<[^>]*>/g, '').trim()
      if (description.length > 100) {
        output += `   📝 **Description**: ${description.substring(0, 100)}...\n`
      } else if (description) {
        output += `   📝 **Description**: ${description}\n`
      }
    }
    
    output += `   🆔 **Event ID**: ${event.id}\n`
    output += '\n'
  })

  return output
}
